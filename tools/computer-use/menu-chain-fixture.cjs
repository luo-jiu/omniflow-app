'use strict';
// Electron-only, reached exactly once through safe-fixture-entry.cjs.
if (!process.versions.electron || process.type !== 'browser'
    || process.env.OMNIFLOW_GUI_FIXTURE_CHILD !== '1' || process.env.OMNIFLOW_GUI_FIXTURE_DEPTH !== '1'
    || !process.env.OMNIFLOW_GUI_FIXTURE_TOKEN
    || process.argv.at(-1) !== `--fixture-token=${process.env.OMNIFLOW_GUI_FIXTURE_TOKEN}`
    || typeof process.send !== 'function') throw new Error('Menu fixture requires the safe Node supervisor.');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, session, systemPreferences } = require('electron');
const runDirectory = process.env.OMNIFLOW_MENU_CHAIN_RUN_DIR;
const executable = process.env.OMNIFLOW_MENU_CHAIN_EXECUTABLE;
const sanity = process.env.OMNIFLOW_MENU_CHAIN_MODE === 'sanity';
const pointerMode = process.env.OMNIFLOW_MENU_CHAIN_MODE === 'pointer';
assert(runDirectory && path.isAbsolute(runDirectory)); assert(executable && path.isAbsolute(executable));
app.setPath('userData', path.join(runDirectory, 'user-data'));
app.setPath('sessionData', path.join(runDirectory, 'session-data'));
app.setAppPath(path.resolve(__dirname, '../..'));
app.setName('OmniFlow isolated menu acceptance');
app.on('window-all-closed', () => {});
const controller = new AbortController();
const report = { mode: sanity ? 'native-menu-sanity' : pointerMode ? 'native-menu-pointer' : 'native-menu-chain', steps: [], cleanup: {} };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const statePath = path.join(path.dirname(path.dirname(path.dirname(path.dirname(executable)))), 'state.json');
function state(expectedPid) {
  const source = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(source.fixture, 'appkit-native-menu-v1');
  if (expectedPid !== undefined && source.pid !== expectedPid) return undefined;
  assert.equal(source.wasFrontmost, false, 'Receiver activated'); assert.equal(source.wasKeyOrMain, false, 'Receiver became key/main');
  return source;
}
async function until(read, accept, timeout = 2500) {
  const end = Date.now() + timeout;
  do { controller.signal.throwIfAborted(); const value = await read(); if (accept(value)) return value; await pause(100); } while (Date.now() < end);
  throw new Error('Fixture condition did not become true before its deadline');
}
async function main() {
  let receiver; let receiverExited = false; let lease; let indicator; let pointerIdentity; let exitCode = 1;
  const cancel = () => controller.abort(); process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  try {
    await app.whenReady(); app.setActivationPolicy('accessory');
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    report.screenPermission = systemPreferences.getMediaAccessStatus('screen');
    const api = require(path.join(runDirectory, 'platform.cjs'));
    const accessibility = await api.statusAgentComputerClick(controller.signal);
    if (!accessibility.available || !sanity && report.screenPermission !== 'granted') {
      report.status = 'blocked'; report.detail = 'Existing macOS access is unavailable; no new permission was requested.'; exitCode = 2; return;
    }
    receiver = spawn(executable, [], { shell: false, stdio: ['pipe', 'ignore', 'pipe'] });
    receiver.once('exit', () => { receiverExited = true; }); receiver.once('close', () => { receiverExited = true; });
    receiver.on('error', error => { report.receiverError = String(error).slice(0, 500); controller.abort(); });
    let diagnosticBytes = 0;
    receiver.stderr.on('data', chunk => { diagnosticBytes += chunk.length; if (diagnosticBytes > 65536) controller.abort(); });
    const initial = await until(() => { try { return state(receiver.pid); } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error;
    } }, value => value?.pid === receiver.pid && value?.lastLifecycle === 'ready' && value.elapsedMs >= 500);
    report.initialState = initial;
    const windows = await api.getAgentComputerWindows(controller.signal);
    const target = windows.windows.find(window => window.pid === receiver.pid && window.windowId === initial.windowNumber);
    assert(target, 'Exact isolated receiver window missing');
    report.target = target;
    if (sanity) { report.status = 'passed'; exitCode = 0; return; }
    const originalAX = await api.getAgentComputerWindowTarget(target, controller.signal);
    fs.writeFileSync(path.join(runDirectory, 'initial-window-ax.json'), JSON.stringify(originalAX, null, 2));
    lease = await api.createAgentComputerMenuSession(target, controller.signal);
    async function observe(label) {
      const value = await lease.observe(controller.signal); state();
      fs.writeFileSync(path.join(runDirectory, `${label}-ax.json`), JSON.stringify(value, null, 2));
      report.steps.push({ type: 'observe', label, items: value.items.map(item => ({ label: item.label, operations: item.operations })),
        menus: value.menus.length, mappedSurfaces: value.menus.filter(menu => menu.surface).length });
      return value;
    }
    async function action(observation, label, preferred) {
      const matches = observation.items.filter(item => item.label === label && item.operations.includes(preferred));
      assert.equal(matches.length, 1, `No unique ${preferred} capability for ${label}`);
      const request = { observationId: observation.observationId, itemId: matches[0].itemId, operation: preferred };
      if (pointerMode) {
        const resolved = await lease.resolvePointer(request, controller.signal);
        assert(resolved.available, `Pointer target unavailable: ${resolved.reason}`);
        const plan = { window: target, operation: 'click', point: resolved.point,
          ...(resolved.menuSurface ? { menuSurface: resolved.menuSurface } : {}) };
        const start = Date.now();
        if (indicator) assert(await indicator.update(plan), 'Persistent pointer update failed');
        else { indicator = await api.showAgentComputerWindowIndicator(plan, controller.signal); assert(indicator.shown, 'Pointer failed to show'); }
        const pointer = await indicator.snapshot(); assert(pointer, 'Settled pointer snapshot unavailable');
        const identity = `${pointer.pid}:${pointer.processStartedAt}:${pointer.windowId}`;
        if (pointerIdentity) assert.equal(identity, pointerIdentity, 'Menu transition recreated the pointer');
        else pointerIdentity = identity;
        report.steps.push({ type: 'pointer', label, elapsedMs: Date.now() - start, point: resolved.point,
          menuSurface: resolved.menuSurface, pointerWindow: pointer });
        if (resolved.menuSurface) {
          const captured = await lease.capture({ observationId: observation.observationId, pointerWindow: pointer }, controller.signal);
          assert(captured.available && captured.cursorIncluded, 'Menu capture omitted its native pointer');
          const filename = `pointer-${report.steps.filter(step => step.type === 'pointer').length}.png`;
          fs.writeFileSync(path.join(runDirectory, filename), captured.png);
          report.steps.push({ type: 'pointer-capture', label, filename, bounds: captured.bounds, cursorIncluded: captured.cursorIncluded });
        }
      }
      let dispatched = false;
      await lease.action(request, controller.signal, () => { dispatched = true; });
      assert(dispatched, 'Missing actual dispatch acknowledgement');
      report.steps.push({ type: 'action', label, operation: preferred, dispatched });
      await assert.rejects(() => lease.action(request, controller.signal), error => error.dispatchState === 'not-dispatched');
      await pause(150); state();
    }
    async function capture(observation, label) {
      const pointerWindow = pointerMode ? await indicator?.snapshot() : undefined;
      const image = await lease.capture({ observationId: observation.observationId, ...(pointerWindow ? { pointerWindow } : {}) }, controller.signal);
      report.steps.push({ type: 'capture', label, available: image.available,
        ...(image.available ? { bounds: image.bounds, menuCapture: image.menuCapture } : { reason: image.reason }) });
      if (image.available) fs.writeFileSync(path.join(runDirectory, `${label}.png`), image.png);
      return image;
    }
    async function captureClosedMenu(label) {
      // Keep the lease alive: this catches cross-process SCK ownership bugs
      // that disappear if the test closes the menu helper between screenshots.
      const image = await lease.captureWindow({}, controller.signal);
      assert.equal(image.cursorIncluded, false);
      assert.equal(image.captureMethod, 'independent-window');
      const filename = `${label}-closed-window.png`;
      fs.writeFileSync(path.join(runDirectory, filename), image.png);
      report.steps.push({ type: 'closed-menu-capture', label, filename, bytes: image.png.length });
    }
    async function open(label) {
      const source = await observe(`${label}-source`);
      await action(source, '打开 QA 右键菜单', 'open');
      await until(state, value => value.menuVisible);
      const menu = await observe(`${label}-root-menu`);
      if (!menu.menus.length) {
        report.status = 'blocked'; report.detail = 'Real NSMenu opened, but no supported application menu AX root was discovered.';
        return undefined;
      }
      assert(!menu.items.some(item => item.label.startsWith('不可用') && item.operations.length), 'Disabled item received an action');
      assert(!menu.items.some(item => item.label === '执行二级动作' || item.label === '执行三级动作'), 'Closed submenu leaked visible choices');
      const disabled = menu.items.find(item => item.label === '不可用一级动作');
      assert(disabled, 'Disabled item missing from observation');
      await assert.rejects(() => lease.action({ observationId: menu.observationId, itemId: disabled.itemId, operation: 'press' }, controller.signal),
        error => error.dispatchState === 'not-dispatched');
      return menu;
    }
    let menu = await open('primary'); if (!menu) { exitCode = 2; return; }
    await capture(menu, 'primary-menu');
    await action(menu, '执行一级动作', 'press');
    await until(state, value => value.selectionCount === 1 && !value.menuVisible);
    await captureClosedMenu('primary');
    if (pointerMode) { await pause(120); assert.equal(await indicator.snapshot(), undefined, 'Closed menu kept a capturable pointer'); }
    menu = await open('secondary'); if (!menu) { exitCode = 2; return; }
    const more = menu.items.find(item => item.label === '更多操作');
    await action(menu, '更多操作', more?.operations.includes('open') ? 'open' : 'press');
    menu = await observe('secondary-opened'); await capture(menu, 'secondary-menu');
    assert(!menu.items.some(item => item.label === '执行三级动作'), 'Closed third-level submenu leaked visible choices');
    await action(menu, '执行二级动作', 'press');
    await until(state, value => value.selectionCount === 2 && !value.menuVisible);
    await captureClosedMenu('secondary');
    menu = await open('tertiary'); if (!menu) { exitCode = 2; return; }
    await action(menu, '更多操作', menu.items.find(item => item.label === '更多操作')?.operations.includes('open') ? 'open' : 'press');
    menu = await observe('tertiary-parent');
    await action(menu, '深入操作', menu.items.find(item => item.label === '深入操作')?.operations.includes('open') ? 'open' : 'press');
    menu = await observe('tertiary-opened'); const thirdImage = await capture(menu, 'tertiary-menu');
    if (thirdImage.available) {
      assert(thirdImage.bounds.x < target.bounds.x || thirdImage.bounds.y < target.bounds.y
        || thirdImage.bounds.x + thirdImage.bounds.width > target.bounds.x + target.bounds.width
        || thirdImage.bounds.y + thirdImage.bounds.height > target.bounds.y + target.bounds.height,
      'Nested menu capture did not exercise the extent beyond the main window');
    }
    await action(menu, '执行三级动作', 'press');
    await until(state, value => value.selectionCount === 3 && value.lastAction === 'tertiary-action' && !value.menuVisible);
    await captureClosedMenu('tertiary');
    if (pointerMode) { await pause(120); assert.equal(await indicator.snapshot(), undefined, 'Closed tertiary menu kept a capturable pointer'); }
    menu = await open('cancel'); if (!menu) { exitCode = 2; return; }
    const cancelItem = menu.items.find(item => item.operations.includes('cancel'));
    if (cancelItem) await action(menu, cancelItem.label, 'cancel');
    else await action(menu, '取消菜单', 'press');
    await until(state, value => !value.menuVisible);
    await captureClosedMenu('cancel');
    report.finalState = state();
    report.menuActionsPassed = true;
    report.postMenuScreenshotsPassed = report.steps.filter(step => step.type === 'closed-menu-capture').length === 4;
    if (pointerMode) {
      const pointers = report.steps.filter(step => step.type === 'pointer' && step.menuSurface);
      assert(pointers.some(step => step.menuSurface.bounds.height < 36), 'No short menu pointer exercised');
      assert(pointers.some(step => step.point.x >= target.bounds.x + target.bounds.width), 'No menu pointer outside main window exercised');
      report.menuPointerPassed = true;
    }
    const captures = report.steps.filter(step => step.type === 'capture');
    report.menuScreenshotsPassed = captures.length === 3 && captures.every(step => step.available && step.menuCapture === 'included');
    report.status = report.menuScreenshotsPassed ? 'passed' : 'blocked';
    if (!report.menuScreenshotsPassed) report.detail = 'Menu action chain passed, but one or more native menu screenshots were unavailable.';
    exitCode = report.menuScreenshotsPassed ? 0 : 2;
  } catch (error) { report.status = 'failed'; report.detail = String(error).slice(0, 1024); }
  finally {
    indicator?.dispose();
    report.cleanup.pointerClosed = indicator ? await indicator.closed : true;
    lease?.close();
    report.cleanup.menuSessionClosed = lease ? await lease.closed : true;
    if (receiver && !receiverExited) {
      receiver.stdin.end();
      const end = Date.now() + 2000;
      while (!receiverExited && Date.now() < end) await pause(25);
      if (!receiverExited) receiver.kill('SIGTERM');
      const killEnd = Date.now() + 500;
      while (!receiverExited && Date.now() < killEnd) await pause(25);
    }
    report.cleanup.receiverClosed = !receiver || receiverExited;
    if (receiverExited) { try { report.finalState = state(); } catch (error) {
      report.cleanup.stateError = String(error); report.status = 'failed'; exitCode = 1;
    } }
    if (!report.cleanup.pointerClosed || !report.cleanup.menuSessionClosed || !report.cleanup.receiverClosed) { report.status = 'failed'; exitCode = 1; }
    fs.writeFileSync(path.join(runDirectory, 'result.json'), JSON.stringify(report, null, 2));
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    app.exit(exitCode);
  }
}
void main();
