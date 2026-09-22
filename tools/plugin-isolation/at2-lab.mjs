import { app, BrowserWindow, webContents } from 'electron';
import { registerPluginScheme, PluginDevelopmentHost } from '../../electron/service/extensions/isolated-view.ts';
import { PluginManager } from '../../electron/service/extensions/plugin-manager.ts';
import { PluginToolRuntime, createPluginToolCallAuthority } from '../../electron/service/extensions/plugin-tool-runtime.ts';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const work = process.env.OMNIFLOW_LAB_WORK;
const sample = process.env.OMNIFLOW_LAB_SAMPLE;
const legacyDirectory = process.env.OMNIFLOW_LAB_LEGACY;
assert.ok(work && sample && legacyDirectory, 'AT2 requires isolated runner directories');
app.setPath('userData', path.join(work, 'profile'));
registerPluginScheme();
app.on('window-all-closed', () => undefined);
const checks = [];
const observations = {};
const started = Date.now();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(test, label, timeout = 10000) {
  const start = Date.now();
  while (!await test()) { if (Date.now() - start > timeout) throw new Error(`Condition timed out: ${label}`); await delay(20); }
}
function pass(name, value = true) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); }
async function rejected(promise, codes, label) {
  let fault;
  try { await promise; } catch (error) { fault = error; }
  pass(label, fault && codes.includes(fault.code));
  return fault;
}
function pack(directory) {
  execFileSync(process.execPath, ['pack.mjs'], { cwd: directory, stdio: 'pipe', timeout: 10000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  return path.join(directory, 'plugin.zip');
}
// Every adversarial asset is generated below the runner's temporary work directory.
async function fixture(name, { version = '0.1.0', timeoutMs = 15000, invalidSchema = false } = {}) {
  const directory = path.join(work, name);
  await mkdir(directory, { recursive: true });
  await cp(sample, path.join(directory, 'dist'), { recursive: true });
  await copyFile(path.join(path.dirname(sample), 'pack.mjs'), path.join(directory, 'pack.mjs'));
  const manifestPath = path.join(directory, 'dist', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const id = name === 'upgrade' ? 'example.csv-tools' : `example.${name}`;
  manifest.id = id; manifest.version = version;
  manifest.viewers[0].id = `${id}.table`;
  manifest.agentTools[0].id = `${id}.query`;
  manifest.agentTools[0].timeoutMs = timeoutMs;
  manifest.activation = [`viewer:${id}.table`, `tool:${id}.query`];
  if (invalidSchema) manifest.agentTools[0].outputSchema.$ref = 'https://invalid.test/schema';
  await writeFile(manifestPath, JSON.stringify(manifest));
  if (name !== 'upgrade') {
    await writeFile(path.join(directory, 'dist', 'tool.js'), `import { createPluginClient } from './sdk.js';
const client = createPluginClient();
await client.ready();
const invocation = await client.toolInvocation();
const context = await client.context();
const output = { headers: ['name'], totalRows: 1, matchedRows: 1, rows: [['fixture']], truncated: false };
globalThis.at2Probe = { invocationId: invocation.invocationId, ready: true, errors: [] };
if (invocation.input.equals === 'read') {
  try { await client.read(context.resource.handle, 0, 1); await client.completeTool(invocation.invocationId, output); }
  catch (error) { globalThis.at2Probe.errors.push(error.code); }
} else if (invocation.input.equals === 'invalid') {
  try { await client.completeTool(invocation.invocationId, { unexpected: true }); }
  catch (error) { globalThis.at2Probe.errors.push(error.code); }
} else if (invocation.input.equals === 'oversized') {
  try { await client.completeTool(invocation.invocationId, { ...output, rows: Array.from({length: 10}, () => ['x'.repeat(4000)]) }); }
  catch (error) { globalThis.at2Probe.errors.push(error.code); }
} else if (invocation.input.equals === 'success') {
  await client.completeTool(invocation.invocationId, output);
}
`);
  }
  return { id, toolId: `${id}.query`, zip: pack(directory) };
}

void (async () => {
  let parent, viewerHost, toolHost, runtime, legacy;
  let completed = false;
  const pending = new Set();
  try {
    await app.whenReady();
    const managerRoot = path.join(work, 'plugins');
    const manager = new PluginManager(managerRoot, legacyDirectory);
    await manager.initialize();
    const install = async zip => { const review = await manager.prepare(zip); await manager.commit(review.ticket); };
    const grant = async id => {
      for (const action of ['enable', 'approve-read', 'approve-tools']) await manager.action(id, action);
      return manager.catalog().plugins.find(plugin => plugin.id === id).fingerprint;
    };
    pack(path.dirname(sample));
    await install(path.join(path.dirname(sample), 'plugin.zip'));
    const csvId = 'example.csv-tools'; const csvToolId = `${csvId}.query`;
    const firstFingerprint = await grant(csvId);
    const bad = await fixture('at2-faults'); await install(bad.zip); const badFingerprint = await grant(bad.id);
    const short = await fixture('at2-short', { timeoutMs: 1500 }); await install(short.zip); const shortFingerprint = await grant(short.id);
    const malformed = await fixture('at2-malformed', { invalidSchema: true });
    let schemaRejected = false;
    try { await manager.prepare(malformed.zip); } catch { schemaRejected = true; }
    pass('unsupported-manifest-schema-rejected-before-install', schemaRejected && !manager.catalog().plugins.some(plugin => plugin.id === malformed.id));

    parent = new BrowserWindow({ show: false, width: 850, height: 650, webPreferences: { sandbox: true, contextIsolation: true } });
    await parent.loadURL('data:text/html,<h1>AT2 synthetic host</h1>');
    viewerHost = new PluginDevelopmentHost(parent, path.join(work, 'preload.cjs'));
    toolHost = new PluginDevelopmentHost(parent, path.join(work, 'preload.cjs'));
    // Observe public load results without changing production execution or stop behavior.
    const toolInstances = [];
    const partitions = new Set();
    const originalLoad = toolHost.load.bind(toolHost);
    toolHost.load = async (...args) => {
      const instance = await originalLoad(...args);
      toolInstances.push(instance); partitions.add(instance.partition); return instance;
    };
    runtime = new PluginToolRuntime(manager, toolHost);
    const bytes = Buffer.from('name,city\n甲,北京\n乙,上海\n丙,北京\n');
    const resource = { accountScope: 'at2-synthetic-account', libraryId: 3, nodeId: 10, name: 'fixture.csv', size: bytes.length, revision: 'v1',
      authorize: async () => true, currentRevision: async () => 'v1', readRange: async (offset, length) => bytes.subarray(offset, offset + length) };
    const theme = { schemaVersion: 1, revision: 1, mode: 'light', colors: { 'surface.app': '#ffffff', 'text.primary': '#222222' } };
    legacy = await viewerHost.load(legacyDirectory, resource, theme, true);
    partitions.add(legacy.partition);
    await until(() => legacy.broker.isReady, 'legacy Viewer ready');
    const legacyContents = legacy.view.webContents;
    const baselineContents = webContents.getAllWebContents().length;
    const baselineResizeListeners = parent.listenerCount('resize');
    let invocationSequence = 0;
    const execute = (toolId = csvToolId, fingerprint = firstFingerprint, input = { resource: { nodeId: 10 } }, source = resource, signal = new AbortController().signal) => {
      const binding = { pluginId: toolId.slice(0, toolId.lastIndexOf('.')), toolId, packageFingerprint: fingerprint,
        accountScope: source.accountScope, backendScope: 'at2-synthetic-backend', libraryId: 3, nodeId: 10,
        sessionId: 'at2-session', runId: 'at2-run', toolRunId: `at2-tool-${++invocationSequence}`, aiDestinationId: 'at2-synthetic-destination' };
      const capability = createPluginToolCallAuthority(binding, source, signal, async requestSignal => { requestSignal.throwIfAborted(); });
      const result = runtime.execute(toolId, fingerprint, input, capability);
      pending.add(result); result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    };
    const settle = async () => {
      await until(() => runtime.size === 0 && toolHost.size === 0 && webContents.getAllWebContents().length === baselineContents, 'resource baseline');
      assert.equal(parent.listenerCount('resize'), baselineResizeListeners);
      assert.ok(manager.catalog().plugins.every(plugin => plugin.running === 0));
    };
    const heldCall = async (toolId = csvToolId, fingerprint = firstFingerprint) => {
      let reading = false; const released = deferred();
      const source = { ...resource, readRange: async (offset, length) => { reading = true; await released.promise; return bytes.subarray(offset, offset + length); } };
      const result = execute(toolId, fingerprint, { resource: { nodeId: 10 } }, source);
      await until(() => reading, 'Tool read entered');
      return { result, release: released.resolve, instance: toolInstances.at(-1) };
    };
    const rpc = (contents, method, params) => contents.executeJavaScript(`omniflowTransport.exchange(JSON.stringify({version:1,id:crypto.randomUUID(),method:${JSON.stringify(method)},params:${JSON.stringify(params)}})).then(JSON.parse)`);
    const probeCall = async (mode = 'idle', target = bad, fingerprint = badFingerprint, source = resource) => {
      const count = toolInstances.length;
      const result = execute(target.toolId, fingerprint, { resource: { nodeId: 10 }, equals: mode }, source);
      await until(() => toolInstances.length > count, 'fault fixture loaded');
      const instance = toolInstances.at(-1); const contents = instance.view.webContents;
      await until(() => contents.executeJavaScript('Boolean(globalThis.at2Probe?.ready)'), 'fault fixture ready');
      return { result, instance, contents };
    };
    const responsive = async label => {
      const context = await rpc(legacyContents, 'context.get', {});
      pass(label, !parent.isDestroyed() && await parent.webContents.executeJavaScript('2 + 2') === 4
        && context.ok && context.value.viewerId === 'example.csv.table' && parent.contentView.children.length === 1);
    };
    pass('legacy-viewer-isolated-baseline', viewerHost.size === 1 && parent.contentView.children.length === 1);

    for (const action of ['revoke-read', 'revoke-tools', 'disable']) {
      const call = await heldCall();
      await manager.action(csvId, action);
      await rejected(call.result, ['CANCELLED'], `${action}-cancels-read`);
      call.release(); await settle();
      await rejected(execute(), ['FORBIDDEN'], `${action}-rejects-retry`);
      await grant(csvId);
    }
    const safeCall = await heldCall();
    await manager.safeMode(true);
    await rejected(safeCall.result, ['CANCELLED'], 'safe-mode-cancels-read');
    safeCall.release(); await settle();
    await rejected(execute(), ['FORBIDDEN'], 'safe-mode-rejects-new-call');
    await responsive('safe-mode-preserves-bundled-viewer-and-parent');
    await manager.safeMode(false);
    pass('leaving-safe-mode-restores-existing-approved-catalog', manager.toolSnapshot().some(entry => entry.pluginId === csvId));

    const cancelled = new AbortController();
    const cancelledCall = await probeCall('idle');
    await manager.action(bad.id, 'disable');
    await rejected(cancelledCall.result, ['CANCELLED'], 'disabled-idle-call-cancelled'); await settle(); await grant(bad.id);
    const callerCount = toolInstances.length;
    const callerPromise = execute(bad.toolId, badFingerprint, { resource: { nodeId: 10 }, equals: 'idle' }, resource, cancelled.signal);
    await until(() => toolInstances.length > callerCount, 'caller Tool loaded'); cancelled.abort();
    await rejected(callerPromise, ['CANCELLED'], 'caller-abort-releases-instance'); await settle();

    const upgrade = await fixture('upgrade', { version: '0.1.1' });
    const upgradeCall = await heldCall(); await install(upgrade.zip);
    await rejected(upgradeCall.result, ['CANCELLED'], 'upgrade-cancels-old-call'); upgradeCall.release(); await settle();
    const updated = manager.catalog().plugins.find(plugin => plugin.id === csvId);
    pass('upgrade-clears-both-grants-and-enable', updated.version === '0.1.1' && !updated.enabled && !updated.readApproved && !updated.toolApproved && updated.fingerprint !== firstFingerprint);
    await rejected(execute(), ['FORBIDDEN'], 'upgraded-package-rejects-old-fingerprint');
    const upgradedFingerprint = await grant(csvId);
    await rejected(execute(), ['FORBIDDEN'], 'reapproved-package-still-rejects-old-fingerprint');
    const updatedResult = await execute(csvToolId, upgradedFingerprint);
    pass('reapproved-upgrade-executes-with-new-source', updatedResult.output.totalRows === 3 && updatedResult.source.version === '0.1.1'); await settle();
    const rollbackCall = await heldCall(csvToolId, upgradedFingerprint); await manager.action(csvId, 'rollback');
    await rejected(rollbackCall.result, ['CANCELLED'], 'rollback-cancels-running-call'); rollbackCall.release(); await settle();
    const rolledBack = manager.catalog().plugins.find(plugin => plugin.id === csvId);
    pass('rollback-clears-grants-and-restores-original-fingerprint', rolledBack.fingerprint === firstFingerprint && !rolledBack.enabled && !rolledBack.readApproved && !rolledBack.toolApproved);
    await rejected(execute(csvToolId, upgradedFingerprint), ['FORBIDDEN'], 'rollback-rejects-newer-fingerprint'); await grant(csvId);
    const uninstallCall = await heldCall(); await manager.action(csvId, 'uninstall');
    await rejected(uninstallCall.result, ['CANCELLED'], 'uninstall-cancels-running-call'); uninstallCall.release(); await settle();
    await rejected(execute(), ['FORBIDDEN'], 'uninstalled-tool-rejects-retry');
    pass('uninstalled-tool-removed-from-catalog', !manager.catalog().plugins.some(plugin => plugin.id === csvId));
    await install(path.join(path.dirname(sample), 'plugin.zip')); await grant(csvId);

    for (const mode of ['idle', 'invalid', 'oversized']) {
      const start = Date.now(); const call = await probeCall(mode, short, shortFingerprint);
      if (mode !== 'idle') {
        await until(async () => (await call.contents.executeJavaScript('globalThis.at2Probe.errors.length')) > 0, 'invalid output rejected');
        const codes = await call.contents.executeJavaScript('globalThis.at2Probe.errors');
        pass(`${mode}-output-rejected-by-sdk-or-broker`, codes.includes(mode === 'invalid' ? 'BAD_REQUEST' : 'LIMIT'));
        if (mode === 'oversized') {
          const invocationId = await call.contents.executeJavaScript('globalThis.at2Probe.invocationId');
          await assert.rejects(rpc(call.contents, 'tool.complete', { invocationId, output: { excessive: 'x'.repeat(40000) } }), /Request size limit/);
          pass('oversized-wire-envelope-rejected-by-preload');
          const response = await rpc(call.contents, 'tool.complete', { invocationId, output: {
            headers: ['name'], totalRows: 9, matchedRows: 9, rows: Array.from({ length: 9 }, () => ['x'.repeat(3700)]), truncated: false,
          } });
          pass('schema-valid-output-over-byte-budget-rejected-by-host', !response.ok && response.error.code === 'BAD_REQUEST');
        }
      }
      await rejected(call.result, ['TIMEOUT'], `${mode}-call-has-bounded-timeout`);
      observations[`${mode}TimeoutMs`] = Date.now() - start; await settle();
      pass(`${mode}-timeout-not-misreported-as-success`, observations[`${mode}TimeoutMs`] < 5000);
    }

    for (const fault of ['crash', 'loop']) {
      const call = await probeCall();
      if (fault === 'crash') call.contents.forcefullyCrashRenderer();
      else void call.contents.executeJavaScript('while (true) {}').catch(() => undefined);
      await rejected(call.result, ['UNAVAILABLE'], `renderer-${fault}-settles-call`);
      await settle();
      await until(() => Boolean(manager.installs.snapshot().plugins.find(plugin => plugin.manifest.id === bad.id)?.failure), 'quarantine persisted');
      const reason = manager.installs.snapshot().plugins.find(plugin => plugin.manifest.id === bad.id).failure;
      pass(`renderer-${fault}-quarantined`, fault === 'crash' ? reason === 'renderer-gone' : ['cpu-budget', 'heartbeat-timeout'].includes(reason));
      observations[`${fault}StopReason`] = reason;
      await rejected(execute(bad.toolId, badFingerprint), ['FORBIDDEN'], `renderer-${fault}-retry-rejected`);
      const reloaded = new PluginManager(managerRoot, legacyDirectory); await reloaded.initialize();
      pass(`renderer-${fault}-quarantine-survives-manager-reload`, !reloaded.toolSnapshot().some(entry => entry.pluginId === bad.id));
      await responsive(`renderer-${fault}-does-not-harm-viewer-or-parent`); await grant(bad.id);
    }

    let revision = 'v1'; let authCalls = 0; let gateAt = Infinity; const finalGate = deferred();
    const terminalSource = { ...resource, authorize: async () => { if (++authCalls >= gateAt) await finalGate.promise; return true; } };
    const terminal = await probeCall('idle', bad, badFingerprint, terminalSource);
    const invocationId = await terminal.contents.executeJavaScript('globalThis.at2Probe.invocationId');
    const output = { headers: ['name'], totalRows: 1, matchedRows: 1, rows: [['fixture']], truncated: false };
    const foreign = await rpc(terminal.contents, 'tool.complete', { invocationId: 'foreign-invocation', output });
    pass('foreign-terminal-id-rejected', !foreign.ok && foreign.error.code === 'FORBIDDEN');
    gateAt = authCalls + 2;
    const accepted = await rpc(terminal.contents, 'tool.complete', { invocationId, output });
    pass('first-terminal-accepted-once', accepted.ok);
    await until(() => authCalls >= gateAt, 'final delivery authorization entered');
    const duplicate = await rpc(terminal.contents, 'tool.complete', { invocationId, output: { ...output, rows: [['forged-late']] } });
    pass('duplicate-terminal-rejected-before-delivery', !duplicate.ok && duplicate.error.code === 'UNAVAILABLE');
    finalGate.resolve();
    const terminalResult = await terminal.result;
    pass('duplicate-terminal-cannot-overwrite-first-result', terminalResult.output.rows[0][0] === 'fixture'); await settle();
    const late = JSON.parse(await terminal.instance.broker.exchange(JSON.stringify({ version: 1, id: 'late-terminal', method: 'tool.complete', params: { invocationId, output } })));
    pass('disposed-call-rejects-late-terminal', !late.ok && late.error.code === 'UNAVAILABLE');

    const changed = await probeCall('idle', bad, badFingerprint, { ...resource, currentRevision: async () => revision });
    const changedId = await changed.contents.executeJavaScript('globalThis.at2Probe.invocationId'); revision = 'v2';
    void rpc(changed.contents, 'tool.complete', { invocationId: changedId, output }).catch(() => undefined);
    await rejected(changed.result, ['CONTENT_CHANGED'], 'changed-resource-rejects-final-delivery'); await settle();
    revision = 'v1';
    let readEntered = false; const readGate = deferred();
    const changingRead = { ...resource, currentRevision: async () => revision,
      readRange: async (offset, length) => { readEntered = true; await readGate.promise; return bytes.subarray(offset, offset + length); } };
    const readingCall = await probeCall('read', short, shortFingerprint, changingRead);
    await until(() => readEntered, 'version-changing read entered'); revision = 'v2'; readGate.resolve();
    await until(async () => (await readingCall.contents.executeJavaScript('globalThis.at2Probe.errors')).includes('CONTENT_CHANGED'), 'changed read rejected');
    pass('resource-version-change-during-read-rejected');
    await rejected(readingCall.result, ['TIMEOUT'], 'noncooperative-version-error-remains-bounded'); await settle(); revision = 'v1';

    const occupied = [];
    for (let index = 0; index < 3; index++) occupied.push(await probeCall());
    pass('viewer-and-three-tools-use-four-global-slots', toolHost.size === 3 && viewerHost.size === 1 && parent.contentView.children.length === 1);
    await rejected(execute(), ['UNAVAILABLE'], 'fifth-instance-rejected-without-evicting-viewer');
    await manager.action(bad.id, 'disable');
    for (const call of occupied) await rejected(call.result, ['CANCELLED'], 'busy-slot-cancelled');
    await settle(); await grant(bad.id);
    const reused = await execute();
    pass('released-slot-reusable-by-valid-tool', reused.output.totalRows === 3); await settle();

    for (let index = 0; index < 12; index++) {
      const call = await heldCall(); await manager.action(csvId, index % 2 ? 'disable' : 'revoke-tools');
      await assert.rejects(call.result, error => error.code === 'CANCELLED'); call.release(); await settle(); await grant(csvId);
    }
    pass('twelve-stop-reenable-cycles-return-native-resources-to-baseline', runtime.size === 0 && toolHost.size === 0
      && webContents.getAllWebContents().length === baselineContents && parent.listenerCount('resize') === baselineResizeListeners);
    pass('session-partitions-remain-within-four-slot-budget', partitions.size <= 4);
    observations.cycles = 12; observations.sessionPartitions = partitions.size; observations.nativeWebContentsAtBaseline = baselineContents;
    await responsive('final-legacy-viewer-and-parent-still-responsive');
    runtime.dispose(); toolHost.dispose();
    await responsive('disposing-tool-runtime-preserves-viewer-routing');
    completed = true;
  } catch (error) { console.error(error.stack ?? String(error)); observations.failure = String(error.message ?? error); }
  finally {
    runtime?.dispose(); toolHost?.dispose(); viewerHost?.dispose();
    await Promise.allSettled([...pending]);
    await writeFile(path.join(work, 'results.json'), JSON.stringify({ completed, checks, observations, elapsedMs: Date.now() - started, electron: process.versions.electron, platform: process.platform }, null, 2));
    console.log(JSON.stringify({ completed, work })); parent?.destroy(); app.exit(completed ? 0 : 1);
  }
})();
