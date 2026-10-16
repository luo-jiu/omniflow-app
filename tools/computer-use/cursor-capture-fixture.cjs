// Electron-only fixture body. Start with cursor-capture-smoke.cjs via Node.
'use strict';
if (!process.versions.electron || process.type !== 'browser'
    || process.env.OMNIFLOW_GUI_FIXTURE_CHILD !== '1'
    || process.env.OMNIFLOW_GUI_FIXTURE_DEPTH !== '1'
    || !process.env.OMNIFLOW_GUI_FIXTURE_TOKEN
    || process.argv.at(-1) !== `--fixture-token=${process.env.OMNIFLOW_GUI_FIXTURE_TOKEN}`
    || typeof process.send !== 'function') {
  throw new Error('Cursor fixture requires the safe Node supervisor.');
}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '../..');
const directoryVariable = 'OMNIFLOW_CURSOR_CAPTURE_SMOKE_RUN_DIR';
const fixtureTitle = 'OmniFlow isolated native cursor capture';
function smallError(error) { return String(error).slice(0, 1024); }

function fixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
    <title>${fixtureTitle}</title>
    <style>body{margin:0;background:#18212c;color:white;font:22px system-ui}main{padding:60px}
    p{color:#9daec1}.marker{width:240px;height:160px;border:1px solid #596c80;background:#233b51}</style></head>
    <body><main>Isolated cursor capture fixture<p>No account or library data. No input operations.</p><div class="marker"></div></main>
    <script>globalThis.cursorCaptureInputEvents=0;
    for(const type of ['pointerdown','pointerup','keydown','keyup','beforeinput','input','wheel','dragstart','drop'])
      addEventListener(type,()=>{globalThis.cursorCaptureInputEvents+=1},{capture:true,passive:true});</script></body></html>`;
}

function verifyCapture(nativeImage, plainPng, captured, target, surface, runDirectory, prefix) {
  assert(Buffer.isBuffer(plainPng) && Buffer.isBuffer(captured.png) && captured.cursorIncluded === true,
    'Native cursor capture fell back to plain');
  assert.equal(captured.captureMethod, 'included-windows', 'The same-display fixture did not use a single included-windows frame');
  fs.writeFileSync(path.join(runDirectory, `${prefix}-plain.png`), plainPng);
  fs.writeFileSync(path.join(runDirectory, `${prefix}-cursor.png`), captured.png);
  const plain = nativeImage.createFromBuffer(plainPng);
  const combined = nativeImage.createFromBuffer(captured.png);
  assert(!plain.isEmpty() && !combined.isEmpty(), 'Native PNG cannot be decoded');
  assert.deepEqual(plain.getSize(), combined.getSize(), 'Cursor changed the target image extent');
  const { width, height } = plain.getSize();
  assert(width > 0 && height > 0 && Math.max(width, height) <= 2048, 'Unexpected native image dimensions');
  assert(Math.abs(width / height - target.bounds.width / target.bounds.height) < 0.02, 'Capture does not match the exact target extent');
  const a = plain.toBitmap(); const b = combined.toBitmap();
  assert.equal(a.length, width * height * 4); assert.equal(b.length, a.length);
  const placement = {
    x: (surface.bounds.x - target.bounds.x) * width / target.bounds.width,
    y: (surface.bounds.y - target.bounds.y) * height / target.bounds.height,
    width: surface.bounds.width * width / target.bounds.width,
    height: surface.bounds.height * height / target.bounds.height,
  };
  let changedPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const changed = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3];
    if (!changed) continue;
    changedPixels += 1;
    assert(x >= Math.floor(placement.x) - 1 && x <= Math.ceil(placement.x + placement.width) + 1
      && y >= Math.floor(placement.y) - 1 && y <= Math.ceil(placement.y + placement.height) + 1,
    'Unexpected pixels outside the trusted cursor surface');
  }
  assert(changedPixels > 20, 'No actual native cursor pixels in canonical image');
  return { dimensions: { width, height }, changedPixels };
}

function withDeadline(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Cursor exit confirmation timed out')), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

async function runElectron() {
  const { app, BrowserWindow, nativeImage, screen, session, systemPreferences } = require('electron');
  const runDirectory = process.env[directoryVariable];
  assert(runDirectory && path.isAbsolute(runDirectory), 'A supervised output directory is required');
  app.setPath('userData', path.join(runDirectory, 'user-data'));
  app.setPath('sessionData', path.join(runDirectory, 'session-data'));
  app.setAppPath(projectRoot);
  app.setName('OmniFlow isolated cursor capture');
  const controller = new AbortController();
  let window;
  let cover;
  let lease;
  let indicatorRequested = false;
  let focused = false;
  let exitCode = 1;
  const report = { mode: 'isolated-native-cursor-capture', platform: process.platform, arch: process.arch, checks: [] };
  const cancel = () => controller.abort(new Error('Isolated smoke interrupted'));
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  app.on('window-all-closed', () => {});
  try {
    await app.whenReady();
    controller.signal.throwIfAborted();
    app.setActivationPolicy('accessory');
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    report.screenPermission = systemPreferences.getMediaAccessStatus('screen');
    if (process.platform !== 'darwin' || report.screenPermission !== 'granted') {
      report.status = process.platform === 'darwin' ? 'blocked' : 'skipped';
      report.detail = 'Existing macOS Screen Recording permission is required; no access was requested';
      exitCode = 2;
      return;
    }
    const api = require(path.join(runDirectory, 'runtime.cjs'));
    const area = screen.getPrimaryDisplay().workArea;
    window = new BrowserWindow({
      x: area.x + Math.min(100, Math.max(0, area.width - 700)),
      y: area.y + Math.min(100, Math.max(0, area.height - 480)), width: 700, height: 480,
      title: fixtureTitle, show: false, frame: false, focusable: false, hasShadow: false, resizable: false, fullscreenable: false, backgroundColor: '#18212c',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    window.on('focus', () => { focused = true; });
    window.setIgnoreMouseEvents(true);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('page-title-updated', event => event.preventDefault());
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml())}`);
    window.setTitle(fixtureTitle);
    window.webContents.on('will-navigate', event => event.preventDefault());
    controller.signal.throwIfAborted();
    window.showInactive();
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    controller.signal.throwIfAborted();
    const nativeId = /^window:(\d+):\d+$/.exec(window.getMediaSourceId());
    assert(nativeId, 'Fixture lacks an exact native window source ID');
    let target;
    let previous;
    const expectedBounds = window.getBounds();
    const fixtureDeadline = Date.now() + 2000;
    // macOS showInactive may animate the native surface through intermediate
    // bounds after renderer RAFs. Wait only for this exact self-owned window.
    for (let attempt = 0; attempt < 60 && Date.now() < fixtureDeadline; attempt++) {
      controller.signal.throwIfAborted();
      const metadata = await api.getAgentComputerWindows(controller.signal);
      const candidate = metadata.windows.find(item => item.pid === process.pid && item.windowId === Number(nativeId[1])
        && item.title === fixtureTitle && item.layer === 0
        && item.bounds.x === expectedBounds.x && item.bounds.y === expectedBounds.y
        && item.bounds.width === expectedBounds.width && item.bounds.height === expectedBounds.height);
      report.fixtureMetadataSamples = attempt + 1;
      const identity = candidate && JSON.stringify([candidate.windowId, candidate.pid, candidate.processStartedAt,
        candidate.layer, candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height, candidate.title]);
      if (identity && identity === previous) { target = candidate; break; }
      previous = identity;
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    }
    assert(target, 'Exact isolated self-window title and identity did not stabilize');
    // Exclude an opaque, overlapping window from the capture even when it has
    // the target's PID. The two-window whitelist must not become app-wide.
    cover = new BrowserWindow({ ...expectedBounds, show: false, frame: false, hasShadow: false,
      focusable: false, resizable: false, fullscreenable: false, backgroundColor: '#f0268a',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    cover.setIgnoreMouseEvents(true);
    cover.on('focus', () => { focused = true; });
    await cover.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:#f0268a}</style>Unapproved opaque cover'));
    cover.showInactive();
    const coverId = /^window:(\d+):\d+$/.exec(cover.getMediaSourceId());
    assert(coverId, 'Cover lacks an exact native window source ID');
    let coverVerified = false;
    const coverDeadline = Date.now() + 2000;
    for (let attempt = 0; attempt < 60 && Date.now() < coverDeadline; attempt++) {
      controller.signal.throwIfAborted();
      const metadata = await api.getAgentComputerWindows(controller.signal);
      const entry = metadata.windows.find(item => item.pid === process.pid && item.windowId === Number(coverId[1]) && item.layer === 0);
      if (entry && ['x', 'y', 'width', 'height'].every(key => entry.bounds[key] === target.bounds[key])) {
        coverVerified = true; break;
      }
      await cover.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    }
    assert(coverVerified, 'Opaque same-app cover did not reach the exact target extent');
    report.opaqueCoverVerified = true;
    const point = { x: target.bounds.x + 150, y: target.bounds.y + 220 };
    indicatorRequested = true;
    lease = await api.showAgentComputerWindowIndicator({ window: target, operation: 'click', point, accentColor: '#8b6cef' }, controller.signal);
    assert(lease.shown && typeof lease.snapshot === 'function', 'Native cursor did not become ready');
    const surface = await lease.snapshot();
    assert(surface && surface.pid > 0 && surface.layer === 0 && surface.bounds.width <= 36 && surface.bounds.height <= 36,
      'Settled private native cursor surface is missing or outside its normal layer');
    // The static fixture obtains a separate reference only for pixel comparison.
    // Production pointer capture itself returns one canonical image, not a pair.
    const referencePng = await api.captureAgentComputerWindow(target, controller.signal);
    const initial = verifyCapture(nativeImage, referencePng,
      await api.captureAgentComputerWindowWithPointer(target, controller.signal, surface), target, surface, runDirectory, 'initial');
    report.checks.push('Single included-windows frame; native cursor pixels; exact extent; opaque same-app cover excluded; unchanged outside cursor surface');
    assert(await lease.update({ window: target, operation: 'click',
      point: { x: point.x + 180, y: point.y + 100 }, accentColor: '#8b6cef' }), 'Persistent native motion update failed');
    const moved = await lease.snapshot();
    assert(moved, 'Settled motion snapshot missing');
    assert.equal(moved.windowId, surface.windowId); assert.equal(moved.pid, surface.pid); assert.equal(moved.layer, 0);
    assert(Math.abs(moved.bounds.x - surface.bounds.x - 180) <= 1 && Math.abs(moved.bounds.y - surface.bounds.y - 100) <= 1,
      'Motion endpoint did not match the requested displacement');
    const afterMotion = verifyCapture(nativeImage, referencePng,
      await api.captureAgentComputerWindowWithPointer(target, controller.signal, moved), target, moved, runDirectory, 'moved');
    assert.deepEqual(afterMotion.dimensions, initial.dimensions);
    report.checks.push('Same panel after native spring motion; exact endpoint; returned to normal layer');
    report.inputEvents = await window.webContents.executeJavaScript('globalThis.cursorCaptureInputEvents');
    assert.equal(report.inputEvents, 0, 'The isolated target received an input event');
    assert.equal(focused, false, 'The isolated target received focus');
    controller.signal.throwIfAborted();
    report.dimensions = initial.dimensions;
    report.changedPixels = { initial: initial.changedPixels, moved: afterMotion.changedPixels };
    report.status = 'passed';
    exitCode = 0;
  } catch (error) { report.status = 'failed'; report.detail = smallError(error); }
  finally {
    controller.abort();
    // A startup rejection does not by itself prove that no helper was spawned.
    let cursorExitConfirmed = !indicatorRequested;
    if (lease) {
      try { lease.dispose(); cursorExitConfirmed = await withDeadline(lease.closed, 1500) === true; }
      catch { cursorExitConfirmed = false; }
    }
    if (window && !window.isDestroyed()) window.destroy();
    if (cover && !cover.isDestroyed()) cover.destroy();
    report.cleanup = { cursorExitConfirmed, fixtureDestroyed: !window || window.isDestroyed(), coverDestroyed: !cover || cover.isDestroyed() };
    report.fixtureFocused = focused;
    if (!cursorExitConfirmed || !report.cleanup.fixtureDestroyed || !report.cleanup.coverDestroyed || focused) {
      report.status = 'failed'; report.detail = 'Cursor exit, fixture destruction or lack of focus could not be confirmed'; exitCode = 1;
    }
    if (report.status === 'passed') report.checks.push('No target input/focus; confirmed cursor exit and fixture destruction');
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    fs.writeFileSync(path.join(runDirectory, 'result.json'), JSON.stringify(report, null, 2));
    app.exit(exitCode);
  }
}

runElectron().catch(error => { console.error(smallError(error)); require('electron').app.exit(1); });
