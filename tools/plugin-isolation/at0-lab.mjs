import { app, BrowserWindow, webContents } from 'electron';
import { registerPluginScheme, PluginDevelopmentHost } from '../../electron/service/extensions/isolated-view.ts';
import { PluginManager } from '../../electron/service/extensions/plugin-manager.ts';
import { PluginToolRuntime, createPluginToolCallAuthority } from '../../electron/service/extensions/plugin-tool-runtime.ts';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const work = process.env.OMNIFLOW_LAB_WORK;
app.setPath('userData', path.join(work, 'profile'));
registerPluginScheme();
app.on('window-all-closed', () => undefined);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test) { const start = Date.now(); while (!await test()) { if (Date.now() - start > 10000) throw new Error('Condition timed out'); await delay(25); } }
const checks = [];
function pass(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); }
void (async () => {
  let parent, viewerHost, toolHost, runtime, detachViewer; let completed = false;
  try {
    await app.whenReady();
    const sample = process.env.OMNIFLOW_LAB_SAMPLE;
    execFileSync(process.execPath, ['pack.mjs'], { cwd: path.dirname(sample), stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const manager = new PluginManager(path.join(work, 'plugins'), process.env.OMNIFLOW_LAB_LEGACY);
    await manager.initialize();
    const review = await manager.prepare(path.join(path.dirname(sample), 'plugin.zip'));
    pass('tool-permission-in-install-review', review.addedPermissions.includes('agent.tools'));
    await manager.commit(review.ticket); await manager.action('example.csv-tools', 'enable'); await manager.action('example.csv-tools', 'approve-read');
    pass('read-approval-does-not-authorize-tools', manager.toolSnapshot().length === 0);
    await manager.action('example.csv-tools', 'approve-tools');
    const snapshot = manager.toolSnapshot();
    pass('frozen-tool-catalog', snapshot.length === 1 && Object.isFrozen(snapshot) && Object.isFrozen(snapshot[0].contribution));
    const fingerprint = snapshot[0].fingerprint;
    parent = new BrowserWindow({ show: false, width: 850, height: 650, webPreferences: { sandbox: true, contextIsolation: true } });
    await parent.loadURL('data:text/html,<h1>AT0 synthetic host</h1>');
    viewerHost = new PluginDevelopmentHost(parent, path.join(work, 'preload.cjs'));
    toolHost = new PluginDevelopmentHost(parent, path.join(work, 'preload.cjs'));
    runtime = new PluginToolRuntime(manager, toolHost);
    const bytes = Buffer.from('name,city\n甲,北京\n乙,上海\n丙,北京\n');
    const resource = { accountScope: 'synthetic-account', libraryId: 3, nodeId: 10, name: 'fixture.csv', size: bytes.length, revision: 'v1',
      authorize: async () => true, currentRevision: async () => 'v1', readRange: async (offset, length) => bytes.subarray(offset, offset + length) };
    const binding = { pluginId: 'example.csv-tools', toolId: 'example.csv-tools.query', packageFingerprint: fingerprint, accountScope: resource.accountScope, backendScope: 'synthetic-backend', libraryId: 3, nodeId: 10, sessionId: 'session', runId: 'run', toolRunId: 'toolrun', aiDestinationId: 'synthetic-destination' };
    const capability = (source = resource, signal = new AbortController().signal) => createPluginToolCallAuthority(binding, source, signal, async sig => { sig.throwIfAborted(); });
    const theme = { schemaVersion: 1, revision: 1, mode: 'light', colors: { 'surface.app': '#ffffff', 'text.primary': '#222222' } };
    const legacy = await viewerHost.load(process.env.OMNIFLOW_LAB_LEGACY, resource, theme, true);
    await until(() => legacy.broker.isReady);
    pass('legacy-viewer-coexists', viewerHost.size === 1 && parent.contentView.children.length === 1);
    const result = await runtime.execute('example.csv-tools.query', fingerprint, { resource: { nodeId: 10 }, column: 1, equals: '北京', limit: 1 }, capability());
    pass('hidden-tool-returns-bounded-csv-result', result.output.totalRows === 3 && result.output.matchedRows === 2 && result.output.rows[0][0] === '甲' && result.output.truncated === true);
    pass('host-binds-result-provenance', result.source.fingerprint === fingerprint && result.source.nodeId === 10 && result.source.resourceRevision === 'v1');
    await until(() => toolHost.size === 0);
    pass('successful-tool-releases-instance-and-count', runtime.size === 0 && manager.catalog().plugins.find(p => p.id === 'example.csv-tools').running === 0);
    pass('tool-did-not-attach-viewer-or-close-existing-viewer', parent.contentView.children.length === 1 && !legacy.view.webContents.isDestroyed());

    const spec = manager.resolveTool('example.csv-tools.query', fingerprint);
    const mixed = await viewerHost.load(spec.directory, resource, theme, true, { viewerId: 'example.csv-tools.table', expectedFingerprint: fingerprint });
    const mixedContents = mixed.view.webContents;
    detachViewer = manager.attachRuntime(id => { if (!id || id === 'example.csv-tools') mixed.stop('revoked'); });
    await until(() => mixed.broker.isReady);
    let pendingRead = false;
    const held = { ...resource, readRange: async () => { pendingRead = true; return new Promise(() => undefined); } };
    const pending = runtime.execute('example.csv-tools.query', fingerprint, { resource: { nodeId: 10 } }, capability(held)).catch(error => error);
    await until(() => pendingRead);
    pass('running-tool-is-counted-without-visible-tab', manager.catalog().plugins.find(p => p.id === 'example.csv-tools').running === 1 && parent.contentView.children.length === 2);
    const tool = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('omniflow-extension:') && wc.id !== legacy.view.webContents.id && wc.id !== mixed.view.webContents.id);
    pass('tool-is-sandboxed', await tool.executeJavaScript('typeof process === "undefined" && typeof require === "undefined"'));
    const rpc = (method, params) => tool.executeJavaScript(`omniflowTransport.exchange(JSON.stringify({version:1,id:crypto.randomUUID(),method:${JSON.stringify(method)},params:${JSON.stringify(params)}})).then(JSON.parse)`);
    pass('foreign-viewer-handle-denied', (await rpc('resource.read', { handle: legacy.broker.handle, offset: 0, length: 1 })).error.code === 'FORBIDDEN');
    pass('viewer-state-not-exposed-to-tool', (await rpc('state.get', {})).error.code === 'UNSUPPORTED');
    await manager.action('example.csv-tools', 'revoke-tools');
    pass('revoke-cancels-in-flight-tool', (await pending).code === 'CANCELLED');
    await until(() => tool.isDestroyed() && mixedContents.isDestroyed());
    pass('revoke-reaches-both-runtimes', toolHost.size === 0 && viewerHost.size === 1 && manager.toolSnapshot().length === 0);
    await manager.action('example.csv-tools', 'approve-tools');
    const caller = new AbortController(); pendingRead = false;
    const cancelled = runtime.execute('example.csv-tools.query', fingerprint, { resource: { nodeId: 10 } }, capability(held, caller.signal)).catch(error => error);
    await until(() => pendingRead); caller.abort();
    pass('caller-cancel-releases-tool', (await cancelled).code === 'CANCELLED');
    await until(() => toolHost.size === 0);
    runtime.dispose(); toolHost.dispose();
    const oldContext = await legacy.view.webContents.executeJavaScript('omniflowTransport.exchange(JSON.stringify({version:1,id:crypto.randomUUID(),method:"context.get",params:{}})).then(JSON.parse)');
    pass('disposing-tool-host-preserves-viewer-rpc', oldContext.ok && oldContext.value.viewerId === 'example.csv.table');
    pass('total-viewer-resources-remain-bounded', viewerHost.size === 1 && parent.contentView.children.length === 1);
    completed = true;
  } catch (error) { console.error(error.stack ?? String(error)); }
  finally {
    detachViewer?.(); runtime?.dispose(); toolHost?.dispose(); viewerHost?.dispose();
    await writeFile(path.join(work, 'results.json'), JSON.stringify({ completed, checks, electron: process.versions.electron, platform: process.platform }, null, 2));
    console.log(JSON.stringify({ completed, work })); parent?.destroy(); app.exit(completed ? 0 : 1);
  }
})();
