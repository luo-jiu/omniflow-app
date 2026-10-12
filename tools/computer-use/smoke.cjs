/*
 * Run with: node tools/computer-use/smoke.cjs
 * --fixture-only checks the local renderer without OS screen capture or AX actions.
 * Real mode captures only one native window via ScreenCaptureKit, never the display.
 * --capture-only verifies the window PNG without AX inspection or input.
 * Exit 2 means the real integration is blocked/skipped, never a successful test.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '../..');
const fixtureOnly = process.argv.includes('--fixture-only');
const captureOnly = process.argv.includes('--capture-only');
const markerColors = {
  northwest: [232, 62, 87],
  northeast: [52, 196, 212],
  southwest: [157, 204, 53],
  southeast: [202, 108, 229],
};

function fixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
    <title>OmniFlow computer use isolated fixture</title><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#1c222e;color:#fff;font:20px system-ui}
    .marker{position:absolute;width:64px;height:64px}
    #northwest{left:5%;top:5%;background:#e83e57}#northeast{right:5%;top:5%;background:#34c4d4}
    #southwest{left:5%;bottom:5%;background:#9dcc35}#southeast{right:5%;bottom:5%;background:#ca6ce5}
    main{position:absolute;inset:25% 15%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
    h1{font-size:28px}p{font-size:16px;color:#bcc8da}
    #target{width:300px;height:110px;flex:none;background:#f0bb43;color:#17202d;border:0;border-radius:12px;font:bold 25px system-ui}
    #target[data-count="1"]{background:#32b865}#target:focus{outline:0}
    </style></head><body>
    ${Object.keys(markerColors).map(id => `<div class="marker" id="${id}"></div>`).join('')}
    <main><h1>OmniFlow computer use smoke</h1><p>Local fixture only · no account or library content</p>
    <button id="target" data-count="0" aria-label="Native click test">Native clicks: 0</button>
    <p id="result">Waiting for one native AXPress callback</p></main>
    <script>document.getElementById('target').addEventListener('click', event => {
      const target = event.currentTarget;
      const count = Number(target.dataset.count) + 1;
      target.dataset.count = String(count);
      target.textContent = 'Native clicks: ' + count;
      document.getElementById('result').textContent = 'Button callback received';
      target.dataset.trusted = String(event.isTrusted);
    });</script></body></html>`;
}

async function runDriver() {
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-computer-use-smoke-'));
  const runtimePath = path.join(runDirectory, 'desktop-computer.cjs');
  const htmlPath = path.join(runDirectory, 'fixture.html');
  fs.writeFileSync(htmlPath, fixtureHtml());
  if (!fixtureOnly) {
    await require('esbuild').build({
      entryPoints: [path.join(projectRoot, 'electron/platform/computer-use/desktop-computer.ts')],
      outfile: runtimePath,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      external: ['electron'],
      logLevel: 'silent',
    });
  }
  const electronPath = require('electron');
  const childEnvironment = { ...process.env };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  childEnvironment.OMNIFLOW_COMPUTER_USE_SMOKE_DIR = runDirectory;
  const child = spawn(electronPath, [__filename, '--electron-smoke', ...(fixtureOnly ? ['--fixture-only'] : []), ...(captureOnly ? ['--capture-only'] : [])], {
    cwd: projectRoot,
    env: childEnvironment,
    stdio: 'inherit',
    shell: false,
  });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 60000);
  const killTimeout = setTimeout(() => { if (timedOut) child.kill('SIGKILL'); }, 65000);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code === null ? 1 : code));
  }).finally(() => { clearTimeout(timeout); clearTimeout(killTimeout); });
  if (timedOut) throw new Error('Isolated Electron smoke exceeded 60 seconds');
  process.exitCode = exitCode;
}

function pixelMatches(image, point, color, displayBounds, label) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const x = Math.min(width - 1, Math.max(0, Math.round(point.x * width / displayBounds.width)));
  const y = Math.min(height - 1, Math.max(0, Math.round(point.y * height / displayBounds.height)));
  const offset = (y * width + x) * 4;
  const rgb = [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
  assert(rgb.every((channel, index) => Math.abs(channel - color[index]) <= 12), `${label} is missing`);
}

function markerMatches(image, points, displayBounds) {
  for (const [id, color] of Object.entries(markerColors)) {
    pixelMatches(image, points[id], color, displayBounds, `Screen fixture marker ${id}`);
  }
}

async function runElectron() {
  const { app, BrowserWindow, nativeImage, screen, session, systemPreferences } = require('electron');
  const runDirectory = process.env.OMNIFLOW_COMPUTER_USE_SMOKE_DIR;
  assert(runDirectory && path.isAbsolute(runDirectory), 'An isolated run directory is required');
  app.setPath('userData', path.join(runDirectory, 'user-data'));
  app.setPath('sessionData', path.join(runDirectory, 'session-data'));
  app.setAppPath(projectRoot);
  app.setName('OmniFlow computer use smoke');
  const controller = new AbortController();
  let window;
  let finished = false;
  const report = { mode: fixtureOnly ? 'fixture-only' : captureOnly ? 'window-capture-only' : 'window-and-ax-press', platform: process.platform, arch: process.arch, checks: [] };
  function finish(status, detail, exitCode) {
    if (finished) return;
    finished = true;
    controller.abort();
    clearTimeout(deadline);
    report.status = status;
    report.detail = detail;
    fs.writeFileSync(path.join(runDirectory, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, runDirectory }));
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(exitCode);
  }
  const deadline = setTimeout(() => finish('failed', 'Isolated integration timed out', 1), 55000);
  app.on('window-all-closed', () => { if (!finished) finish('failed', 'Fixture window closed before validation', 1); });
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));

  try {
    if (process.platform !== 'darwin' && !fixtureOnly) return finish('skipped', 'The native click adapter currently supports macOS only', 2);
    const display = screen.getPrimaryDisplay();
    report.display = { id: String(display.id), bounds: display.bounds, scaleFactor: display.scaleFactor };

    let runtime;
    if (!fixtureOnly) {
      // Inspect existing permissions only; this script never requests OS access.
      report.screenPermission = systemPreferences.getMediaAccessStatus('screen');
      if (report.screenPermission !== 'granted') return finish('blocked', 'macOS Screen Recording permission is not granted; no capture or click was attempted', 2);
      runtime = require(path.join(runDirectory, 'desktop-computer.cjs'));
      if (!captureOnly) {
        report.clickPermission = await runtime.statusAgentComputerClick(controller.signal);
        if (!report.clickPermission.available) return finish('blocked', 'AX permission/helper is unavailable; no capture or action was attempted', 2);
      }
    }

    const bounds = { x: display.bounds.x + 100, y: display.bounds.y + 100, width: 900, height: 650 };
    window = new BrowserWindow({
      ...bounds,
      frame: false,
      roundedCorners: false,
      hasShadow: false,
      show: false,
      backgroundColor: '#1c222e',
      resizable: false,
      fullscreenable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, zoomFactor: 1 },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => finish('failed', 'Fixture renderer exited', 1));
    await window.loadFile(path.join(runDirectory, 'fixture.html'));
    if (!fixtureOnly) {
      window.showInactive();
    }
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const points = await window.webContents.executeJavaScript(`Object.fromEntries([...document.querySelectorAll('.marker,#target')].map(element => {
      const rect = element.getBoundingClientRect(); return [element.id, {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, left: rect.x, top: rect.y}];
    }))`);
    const fixtureImage = await window.webContents.capturePage();
    assert(!fixtureImage.isEmpty(), 'Fixture renderer screenshot is empty');
    markerMatches(fixtureImage, points, { width: bounds.width, height: bounds.height });
    fs.writeFileSync(path.join(runDirectory, 'fixture-render.png'), fixtureImage.toPNG());
    report.checks.push('local fixture renderer and four marker colors');
    if (fixtureOnly) return finish('fixture-render-only', 'capturePage passed; OS screen capture and native input were not tested', 2);

    const actualBounds = window.getContentBounds();
    assert.deepEqual(actualBounds, bounds, 'Fixture content bounds changed');
    assert(window.isVisible(), 'Fixture must be visible before a window screenshot');
    await new Promise(resolve => setTimeout(resolve, 180));
    const mediaSourceId = window.getMediaSourceId();
    const nativeWindowId = /^window:(\d+):\d+$/.exec(mediaSourceId);
    assert(nativeWindowId, 'Fixture does not have an exact CG window source ID');
    const metadata = await runtime.getAgentComputerWindows(controller.signal);
    const approvedWindow = metadata.windows.find(candidate => candidate.windowId === Number(nativeWindowId[1]) && candidate.pid === process.pid);
    if (!approvedWindow) return finish('blocked', 'The isolated fixture identity is not in native window metadata; no screenshot or AX action was attempted', 2);
    report.window = { windowId: approvedWindow.windowId, pid: approvedWindow.pid, bounds: approvedWindow.bounds };
    const clickPosition = { x: approvedWindow.bounds.x + points.target.x, y: approvedWindow.bounds.y + points.target.y };
    function sameRect(a, b) { return ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]); }
    function fixtureTarget(observation) {
      if (observation.truncated) return null;
      const target = observation.target;
      if (!target || target.pid !== process.pid || target.layer !== 0 || !target.processStartedAt
        || target.windowId !== approvedWindow.windowId || !sameRect(target.bounds, approvedWindow.bounds)) return null;
      const candidates = target.candidates.filter(candidate => candidate.role === 'AXButton' && candidate.title === 'Native click test'
        && clickPosition.x >= candidate.bounds.x && clickPosition.x < candidate.bounds.x + candidate.bounds.width
        && clickPosition.y >= candidate.bounds.y && clickPosition.y < candidate.bounds.y + candidate.bounds.height);
      if (candidates.length !== 1) return null;
      const { candidates: _candidates, ...identity } = target;
      return { window: identity, candidate: candidates[0] };
    }
    let frozenTarget;
    if (!captureOnly) {
      frozenTarget = fixtureTarget(await runtime.getAgentComputerWindowTarget(approvedWindow, controller.signal));
      if (!frozenTarget) return finish('blocked', 'The approved window lacks a complete unique AXPress button; no screenshot or action was attempted', 2);
    }
    const png = await runtime.captureAgentComputerWindow(approvedWindow, controller.signal);
    if (!captureOnly) {
      const stableTarget = fixtureTarget(await runtime.getAgentComputerWindowTarget(approvedWindow, controller.signal));
      if (!stableTarget || JSON.stringify(frozenTarget) !== JSON.stringify(stableTarget)) {
        return finish('blocked', 'Approved AX identity changed around the window screenshot; no action was attempted', 2);
      }
    }
    assert(Buffer.isBuffer(png) && png.length > 1000, 'Approved window capture must return nonempty PNG bytes');
    const screenImage = nativeImage.createFromBuffer(png);
    assert(!screenImage.isEmpty(), 'Approved window screenshot cannot be decoded');
    const imageSize = screenImage.getSize();
    assert(imageSize.width >= 200 && imageSize.height >= 200, 'Approved window screenshot dimensions are too small');
    assert(Math.max(imageSize.width, imageSize.height) <= 2048, 'Approved window screenshot exceeds its dimension limit');
    assert(Math.abs(imageSize.width / imageSize.height - bounds.width / bounds.height) < 0.02, 'Screenshot aspect ratio does not match the approved window');
    markerMatches(screenImage, points, bounds);
    const buttonMarker = { x: points.target.left + 30, y: points.target.top + 15 };
    pixelMatches(screenImage, buttonMarker, [240, 187, 67], bounds, 'Initial button color');
    fs.writeFileSync(path.join(runDirectory, 'window-before.png'), png);
    report.checks.push('production single-window PNG, dimensions, aspect ratio and fixture markers');
    report.screenshotSize = imageSize;
    report.fixtureWasFocused = window.isFocused();
    if (captureOnly) return finish('passed', 'One approved native window screenshot passed; no AX scan or action was attempted', 0);

    const click = { ...clickPosition, button: 'left', clickCount: 1, target: frozenTarget };
    // No DOM click or webContents.sendInputEvent is used: this calls one AXPress.
    await runtime.clickAgentComputerPoint(click, controller.signal);
    let count = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      count = await window.webContents.executeJavaScript('Number(document.getElementById("target").dataset.count)');
      if (count !== 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(count, 1, 'One native AXPress must increment the fixture count exactly once');
    const trusted = await window.webContents.executeJavaScript('document.getElementById("target").dataset.trusted');
    report.eventIsTrusted = trusted;
    report.checks.push('production AXPress invokes one fixture button callback');
    report.nativeClickCount = count;
    await new Promise(resolve => setTimeout(resolve, 100));
    const afterPng = await runtime.captureAgentComputerWindow(approvedWindow, controller.signal);
    const afterImage = nativeImage.createFromBuffer(afterPng);
    markerMatches(afterImage, points, bounds);
    pixelMatches(afterImage, buttonMarker, [50, 184, 101], bounds, 'Button color after native click');
    fs.writeFileSync(path.join(runDirectory, 'window-after.png'), afterPng);
    report.checks.push('production approved-window observation after AXPress');
    finish('passed', 'One approved native window screenshot and one AXPress callback passed; foreground state is recorded separately', 0);
  } catch (error) {
    finish('failed', error instanceof Error ? error.message : String(error), 1);
  }
}

if (process.argv.includes('--electron-smoke')) {
  runElectron().catch(error => { console.error(error.message); process.exitCode = 1; });
} else {
  runDriver().catch(error => { console.error(error.message); process.exitCode = 1; });
}
