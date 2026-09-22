import { app, BrowserWindow, webContents } from 'electron';
import { registerPluginScheme } from '../../electron/service/extensions/isolated-view.ts';
import { registerFirstPartyViewer } from '../../electron/service/extensions/first-party-viewer.ts';
import { PluginManager } from '../../electron/service/extensions/plugin-manager.ts';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const work = process.env.OMNIFLOW_LAB_WORK;
app.setPath('userData', path.join(work, 'profile'));
registerPluginScheme();
app.on('window-all-closed', () => undefined);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test) { const start = Date.now(); while (!await test()) { if (Date.now() - start > 15000) throw new Error('Condition timed out'); await delay(50); } }
const checks = [];
function pass(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); }
void (async () => {
  let parent, server, completed = false;
  try {
    await app.whenReady();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAUAAAAG4CAIAAAC7M6mJAAAFF0lEQVR4nO3TQQkAMRDAwPVvoUrORm3URD3cpwQGRkA+mbMXEDXPC4DfDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoawOd8CogwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMAND2AXdyn7zT6mwYwAAAABJRU5ErkJggg==', 'base64');
    let allowed = true, moved = false, leaked = false, origin;
    const node = id => ({ id, libraryId: 3, parentId: moved && id === 12 ? 20 : 10, type: 'file', name: 'page-' + id, ext: 'png', fileSize: bytes.length, storageKey: id + '.png', storageBucket: 'bucket', storageProvider: 'test', updatedAt: 'v1' });
    server = createServer((req, res) => {
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (!allowed || req.headers.authorization !== 'Bearer synthetic') { res.writeHead(403); res.end(); return; }
        let data;
        if (url.pathname.endsWith('/user/me')) data = { id: 42 };
        else if (url.pathname.endsWith('/nodes/10')) data = { id: 10, libraryId: 3, type: 'dir', name: 'Synthetic comic', builtInType: 'COMIC' };
        else if (url.pathname.endsWith('/children')) data = [node(11), node(12)];
        else if (/\/nodes\/(11|12)$/.test(url.pathname)) data = node(Number(url.pathname.split('/').pop()));
        else if (url.pathname.endsWith('/directory/link')) data = origin + '/bucket/' + url.searchParams.get('nodeId') + '.png';
        else { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: '0', data })); return;
      }
      if (req.headers.authorization || req.headers.username) leaked = true;
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
      if (!range) { res.writeHead(400); res.end(); return; }
      res.writeHead(206, { ETag: '"v1"', 'Content-Range': `bytes ${range[1]}-${range[2]}/${bytes.length}` });
      res.end(bytes.subarray(Number(range[1]), Number(range[2]) + 1));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
    const sample = process.env.OMNIFLOW_LAB_SAMPLE;
    execFileSync(process.execPath, ['pack.mjs'], { cwd: path.dirname(sample), stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const manager = new PluginManager(path.join(work, 'plugins'), path.join(work, 'no-bundled'));
    await manager.initialize();
    const review = await manager.prepare(path.join(path.dirname(sample), 'plugin.zip'));
    pass('new-directory-permission-visible', review.addedPermissions.includes('directory.read'));
    await manager.commit(review.ticket); await manager.action('example.comic', 'enable'); await manager.action('example.comic', 'approve-read');
    parent = new BrowserWindow({ show: true, width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(work, 'host-preload.cjs') } });
    await parent.loadURL('data:text/html,<h1>Synthetic directory host</h1>');
    registerFirstPartyViewer(() => parent, { apiBaseUrl: origin + '/api', storageOrigins: [origin], manager, preloadPath: path.join(work, 'preload.cjs') });
    await parent.webContents.executeJavaScript('window.events=[];electronPluginViewer.subscribe(event=>events.push(event));true');
    const call = (method, ...args) => parent.webContents.executeJavaScript(`electronPluginViewer.${method}(...${JSON.stringify(args)})`);
    const current = () => webContents.getAllWebContents().find(wc => wc.getURL().startsWith('omniflow-extension:'));
    const input = { clientId: 'comic-a', viewerId: 'example.comic.reader', nodeId: 10, libraryId: 3, token: 'synthetic', username: 'fixture', theme: { schemaVersion: 1, revision: 1, mode: 'light', colors: { 'surface.app': '#ffffff', 'text.primary': '#222222' } }, snapshot: null };
    pass('installed-directory-plugin-open', (await call('open', input)).ok);
    await call('layout', input.clientId, { x: 0, y: 0, width: 900, height: 650 });
    let plugin = current();
    await until(async () => plugin.executeJavaScript('document.getElementById("position").textContent.startsWith("1 / 2")'));
    pass('actual-isolated-image-decoded', await plugin.executeJavaScript('document.getElementById("page").naturalWidth===320&&!document.getElementById("page").hidden'));
    await until(async () => plugin.executeJavaScript('!document.getElementById("next").disabled'));
    await plugin.executeJavaScript('document.getElementById("next").click()');
    await until(async () => parent.webContents.executeJavaScript('events.some(e=>e.type==="state"&&e.snapshot.state.value.index===1)'));
    const snapshot = await parent.webContents.executeJavaScript('events.filter(e=>e.type==="state").at(-1).snapshot');
    await call('close', input.clientId); await until(() => !current());
    pass('close-releases-view', parent.contentView.children.length === 0);
    pass('directory-reading-restore-open', (await call('open', { ...input, clientId: 'comic-b', snapshot })).ok);
    await call('layout', 'comic-b', { x: 0, y: 0, width: 900, height: 650 });
    plugin = current(); await until(async () => plugin.executeJavaScript('document.getElementById("position").textContent.startsWith("2 / 2")'));
    pass('directory-reading-position-restored', true);
    await writeFile(path.join(work, 'comic-light.png'), (await plugin.capturePage()).toPNG());
    await call('theme', 'comic-b', { ...input.theme, revision: 2, mode: 'dark', colors: { 'surface.app': '#161616', 'text.primary': '#eeeeee' } });
    await until(async () => plugin.executeJavaScript('getComputedStyle(document.body).backgroundColor==="rgb(22, 22, 22)"'));
    pass('directory-theme-updates', true);
    await writeFile(path.join(work, 'comic-dark.png'), (await plugin.capturePage()).toPNG());
    await until(async () => plugin.executeJavaScript('!document.getElementById("previous").disabled'));
    await plugin.executeJavaScript('document.getElementById("previous").click()');
    await until(async () => plugin.executeJavaScript('document.getElementById("position").textContent.startsWith("1 / 2")&&!document.getElementById("next").disabled'));
    moved = true; await plugin.executeJavaScript('document.getElementById("next").click()');
    await until(async () => plugin.executeJavaScript('document.getElementById("status").textContent.includes("移出")'));
    pass('moved-child-denied-without-stale-image', await plugin.executeJavaScript('document.getElementById("page").hidden'));
    await manager.action('example.comic', 'revoke-read'); await until(() => !current());
    pass('management-revocation-stops-directory-instance', parent.contentView.children.length === 0);
    pass('cannot-reopen-without-grant', !(await call('open', { ...input, clientId: 'denied' })).ok);
    pass('no-storage-credential-leak', !leaked);
    allowed = false; completed = true;
  } catch (error) { console.error(error.stack ?? String(error)); const view = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('omniflow-extension:')); if (view) console.error(await view.executeJavaScript('JSON.stringify({text:document.body.innerText,width:document.getElementById("page").naturalWidth,src:document.getElementById("page").src.length})'));  }
  finally {
    await writeFile(path.join(work, 'results.json'), JSON.stringify({ completed, checks, electron: process.versions.electron, platform: process.platform }, null, 2));
    console.log(JSON.stringify({ completed, work })); parent?.destroy(); server?.close(); app.exit(completed ? 0 : 1);
  }
})();
