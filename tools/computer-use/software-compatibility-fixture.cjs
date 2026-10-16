/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';
// Electron-only, reached exactly once through safe-fixture-entry.cjs. No GUI is created.
if (!process.versions.electron || process.type !== 'browser'
    || process.env.OMNIFLOW_GUI_FIXTURE_CHILD !== '1' || process.env.OMNIFLOW_GUI_FIXTURE_DEPTH !== '1'
    || !process.env.OMNIFLOW_GUI_FIXTURE_TOKEN
    || process.argv.at(-1) !== `--fixture-token=${process.env.OMNIFLOW_GUI_FIXTURE_TOKEN}`
    || typeof process.send !== 'function') throw new Error('Software compatibility fixture requires the safe Node supervisor.');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, session, systemPreferences } = require('electron');
const runDirectory = process.env.OMNIFLOW_SOFTWARE_COMPATIBILITY_RUN_DIR;
const mode = process.env.OMNIFLOW_SOFTWARE_COMPATIBILITY_MODE;
const selectedId = process.env.OMNIFLOW_SOFTWARE_COMPATIBILITY_WINDOW_ID;
assert(runDirectory && path.isAbsolute(runDirectory));
assert(['list', 'plan'].includes(mode) && selectedId === '' || mode === 'window' && /^[1-9][0-9]{0,9}$/.test(selectedId || '')
  && Number(selectedId) <= 0xffffffff, 'Invalid software compatibility mode or window selector');
app.setPath('userData', path.join(runDirectory, 'user-data'));
app.setPath('sessionData', path.join(runDirectory, 'session-data'));
app.setAppPath(path.resolve(__dirname, '../..'));
app.setName('OmniFlow isolated software compatibility');
app.on('window-all-closed', () => {});

const controller = new AbortController();
const report = { mode: `software-compatibility-${mode}`, readOnly: mode !== 'plan', phases: {}, cleanup: { menuSessionClosed: true, pointerClosed: true } };
const label = value => String(value || '').slice(0, 160);
const browserName = /\b(?:chrome|chromium|safari|edge|firefox|brave|opera|vivaldi|arc|zen|orion|browser)\b|浏览器/iu;
const isBrowser = window => browserName.test(window.applicationLabel);
const writeJSON = (filename, value) => fs.writeFileSync(path.join(runDirectory, filename), JSON.stringify(value, null, 2), { mode: 0o600 });
function capabilities(items) {
  const counts = new Map();
  for (const item of items) for (const operation of item.operations || []) counts.set(operation, (counts.get(operation) || 0) + 1);
  return Object.fromEntries(counts);
}
function roles(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.role, (counts.get(item.role) || 0) + 1);
  return Object.fromEntries(counts);
}
function shape(value, required, optional = []) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected a plan object');
  assert(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'Unknown or missing plan field');
}
function planText(value, maximum = 256, empty = false) {
  assert(typeof value === 'string' && (empty || value.length > 0) && Buffer.byteLength(value, 'utf8') <= maximum, 'Invalid bounded plan string');
}
function readPlan() {
  const source = fs.readFileSync(path.join(runDirectory, 'plan.json'), 'utf8');
  assert(Buffer.byteLength(source, 'utf8') <= 16 * 1024, 'Plan exceeds 16 KiB');
  const plan = JSON.parse(source);
  shape(plan, ['windowId', 'applicationLabel', 'windowLabel', 'steps'], ['pointer', 'title']);
  assert(Number.isSafeInteger(plan.windowId) && plan.windowId > 0 && plan.windowId <= 0xffffffff);
  planText(plan.applicationLabel); planText(plan.windowLabel);
  if ('title' in plan) planText(plan.title, 256, true);
  assert(plan.pointer === undefined || typeof plan.pointer === 'boolean');
  assert(Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.length <= 6, 'Plan must contain one to six explicit steps');
  for (const step of plan.steps) {
    const expected = ['expectedText'];
    if (step.kind === 'menuCancel') {
      shape(step, ['kind']);
    } else if (step.kind === 'menu') {
      shape(step, ['kind', 'label', 'operation'], ['role', ...expected]);
      planText(step.label); if ('role' in step) planText(step.role, 64);
      assert(['open', 'press', 'cancel'].includes(step.operation), 'Unknown menu operation');
    } else {
      assert(['click', 'setText', 'scroll'].includes(step.kind), 'Unknown plan action');
      shape(step, ['kind', 'candidate', ...(step.kind === 'click' ? [] : ['operation']), ...(step.kind === 'setText' ? ['text'] : [])], expected);
      shape(step.candidate, ['role'], ['title', 'description', 'subrole', 'identifier', 'identityProfile', 'path']);
      assert(Object.keys(step.candidate).length >= 2, 'Candidate needs a role and an explicit semantic selector');
      for (const [key, value] of Object.entries(step.candidate)) {
        if (key === 'path') assert(Array.isArray(value) && value.length <= 32
          && value.every(index => Number.isSafeInteger(index) && index >= 0), 'Invalid explicit AX path');
        else planText(value, 256, true);
      }
      planText(step.candidate.role, 64);
      if (step.kind === 'setText') {
        assert(['replaceText', 'insertText'].includes(step.operation));
        planText(step.text, 16_384, step.operation === 'replaceText');
        assert([...step.text].length <= 4096, 'Text step exceeds production 4096 Unicode scalar limit');
      }
      if (step.kind === 'scroll') assert(['scrollUpPage', 'scrollDownPage', 'scrollLeftPage', 'scrollRightPage'].includes(step.operation), 'Unknown scroll operation');
    }
    if ('expectedText' in step) planText(step.expectedText, 1024);
  }
  return plan;
}
function exactIdentity(window) {
  const { windowId, pid, processStartedAt, layer, bounds, title } = window;
  return { windowId, pid, processStartedAt, layer, bounds, ...(title === undefined ? {} : { title }) };
}
async function executePlan(api, target, plan, resources) {
  let window = exactIdentity(target);
  async function refreshWindow(receipt, phase, signal) {
    const discovery = await api.getAgentComputerWindows(signal);
    const current = discovery.windows.find(item => item.windowId === target.windowId);
    assert(current && ['windowId', 'pid', 'processStartedAt', 'layer', 'title'].every(key => current[key] === target[key]),
      'Original window identity changed or disappeared; no replacement was chosen');
    const geometryChanged = ['x', 'y', 'width', 'height'].some(key => current.bounds[key] !== window.bounds[key]);
    if (geometryChanged) {
      receipt.geometryChanged = true;
      if (!(receipt.geometryChangedAt ||= []).includes(phase)) receipt.geometryChangedAt.push(phase);
      if (resources.indicator) {
        resources.indicator.dispose(); report.cleanup.pointerClosed = await resources.indicator.closed;
        assert(report.cleanup.pointerClosed, 'Old pointer closure was not confirmed after window geometry changed');
        resources.indicator = undefined;
      }
      if (resources.lease) {
        resources.lease.close(); report.cleanup.menuSessionClosed = await resources.lease.closed;
        assert(report.cleanup.menuSessionClosed, 'Old menu capture ownership did not close after window geometry changed');
        resources.lease = undefined;
      }
    }
    window = exactIdentity(current);
  }
  async function observeStableWindow(receipt, phase) {
    controller.signal.throwIfAborted();
    const readController = new AbortController();
    const cancelRead = () => readController.abort();
    controller.signal.addEventListener('abort', cancelRead, { once: true });
    // Production AX scanning plus its summary can legitimately exceed 2s on
    // live process tables. Keep one bounded read budget under the outer 38s run.
    const timer = setTimeout(cancelRead, 6500);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        let previous; let stable = 0;
        while (stable < 3) {
          readController.signal.throwIfAborted();
          await refreshWindow(receipt, phase, readController.signal);
          const geometry = JSON.stringify(window.bounds);
          stable = geometry === previous ? stable + 1 : 1;
          previous = geometry;
          if (stable < 3) await new Promise(resolve => setTimeout(resolve, 80));
        }
        readController.signal.throwIfAborted();
        try { return await api.getAgentComputerWindowTarget(window, readController.signal); }
        catch (error) {
          if (phase !== 'after' || attempt > 0 || error?.dispatchState !== 'not-dispatched' || readController.signal.aborted) throw error;
          receipt.observationRetries = 1;
        }
      }
    } catch (error) {
      receipt.errorStage = phase === 'after' ? 'readAfterAction' : 'readBeforeAction';
      throw error;
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', cancelRead);
    }
  }
  async function captureOrdinary(pointer) {
    if (resources.lease) return resources.lease.captureWindow(pointer ? { pointerWindow: pointer } : {}, controller.signal);
    if (pointer) return api.captureAgentComputerWindowWithPointer(window, controller.signal, pointer);
    return { png: await api.captureAgentComputerWindow(window, controller.signal), cursorIncluded: false };
  }
  report.steps = [];
  for (const [index, step] of plan.steps.entries()) {
    controller.signal.throwIfAborted();
    const prefix = `step-${String(index + 1).padStart(2, '0')}`;
    const menuStep = step.kind === 'menu' || step.kind === 'menuCancel';
    const receipt = { kind: step.kind, operation: step.kind === 'click' ? 'press' : step.kind === 'menuCancel' ? 'cancel' : step.operation, dispatched: false };
    report.steps.push(receipt);
    const before = await observeStableWindow(receipt, 'before');
    writeJSON(`${prefix}-before-ax.json`, before);
    let candidate; let menuObservation; let menuRequest; let pointerPlan;
    if (menuStep) {
      if (step.kind === 'menuCancel') assert(resources.openedMenu, 'Menu cancellation requires a successful open in this plan');
      resources.lease ||= await api.createAgentComputerMenuSession(window, controller.signal);
      menuObservation = await resources.lease.observe(controller.signal);
      writeJSON(`${prefix}-before-menu.json`, menuObservation);
      const matches = menuObservation.items.filter(item => (step.kind === 'menuCancel' ? item.role === 'AXMenu'
        : item.label === step.label && (step.role === undefined || item.role === step.role)) && item.operations.includes(receipt.operation));
      assert.equal(matches.length, 1, 'Explicit menu selector must match one currently capable item');
      menuRequest = { observationId: menuObservation.observationId, itemId: matches[0].itemId, operation: receipt.operation };
      receipt.label = label(matches[0].label);
      if (plan.pointer && step.kind !== 'menuCancel') {
        const resolved = await resources.lease.resolvePointer(menuRequest, controller.signal);
        assert(resolved.available, `Menu pointer unavailable: ${resolved.reason}`);
        pointerPlan = { window, operation: 'click', point: resolved.point, ...(resolved.menuSurface ? { menuSurface: resolved.menuSurface } : {}) };
      }
    } else {
      const matches = before.target.candidates.filter(item => Object.entries(step.candidate).every(([key, value]) => key === 'path'
        ? Array.isArray(item.path) && item.path.length === value.length && item.path.every((index, offset) => index === value[offset])
        : item[key] === value)
        && item.operations?.includes(receipt.operation));
      assert.equal(matches.length, 1, 'Explicit candidate selector must match one currently capable item');
      candidate = matches[0]; receipt.label = label(candidate.title || candidate.description || candidate.identifier || candidate.subrole);
      if (plan.pointer) pointerPlan = { window, operation: 'click',
        point: { x: candidate.bounds.x + candidate.bounds.width / 2, y: candidate.bounds.y + candidate.bounds.height / 2 } };
    }
    if (pointerPlan) {
      try {
        if (resources.indicator) assert(await resources.indicator.update(pointerPlan), 'Pointer update failed before dispatch');
        else { resources.indicator = await api.showAgentComputerWindowIndicator(pointerPlan, controller.signal); assert(resources.indicator.shown, 'Pointer did not show before dispatch'); }
        resources.pointerMenuSurface = Boolean(pointerPlan.menuSurface);
        const pointer = await resources.indicator.snapshot();
        assert(pointer, 'Pointer snapshot unavailable before dispatch');
        receipt.pointerShown = true;
        const capture = pointerPlan.menuSurface
          ? await resources.lease.capture({ observationId: menuObservation.observationId, pointerWindow: pointer }, controller.signal)
          : await captureOrdinary(pointer);
        assert(capture.available !== false && capture.cursorIncluded, 'Native pointer capture unavailable before dispatch');
        fs.writeFileSync(path.join(runDirectory, `${prefix}-before.png`), capture.png, { mode: 0o600 });
        receipt.pointerArtifact = `${prefix}-before.png`;
      } catch (error) {
        receipt.pointerError = String(error).slice(0, 512);
        report.artifactFailures = (report.artifactFailures || 0) + 1;
        if (error?.name === 'AgentComputerWindowIndicatorCloseError') throw error;
        if (resources.indicator) {
          resources.indicator.dispose(); report.cleanup.pointerClosed = await resources.indicator.closed;
          assert(report.cleanup.pointerClosed, 'Pointer closure was not confirmed before AX dispatch');
          resources.indicator = undefined;
        }
        controller.signal.throwIfAborted();
      }
    }
    if (menuStep) {
      try {
        await resources.lease.action(menuRequest, controller.signal, () => {
          receipt.dispatched = true;
          if (receipt.operation === 'open') resources.openedMenu = true;
        });
      } catch (error) {
        if (receipt.operation === 'open' && error?.dispatchState === 'unknown') resources.openedMenu = true;
        throw error;
      }
      assert(receipt.dispatched, 'Menu action did not confirm dispatch');
    } else {
      if (step.kind === 'click') await api.clickAgentComputerPoint({
        x: candidate.bounds.x + candidate.bounds.width / 2, y: candidate.bounds.y + candidate.bounds.height / 2,
        button: 'left', clickCount: 1, target: { window, candidate } }, controller.signal);
      else if (step.kind === 'setText') await api.setAgentComputerText({ target: { window, candidate }, operation: step.operation, text: step.text }, controller.signal);
      else await api.scrollAgentComputerControl({ target: { window, candidate }, operation: step.operation }, controller.signal);
      receipt.dispatched = true;
    }
    const after = await observeStableWindow(receipt, 'after');
    writeJSON(`${prefix}-after-ax.json`, after);
    receipt.axArtifact = `${prefix}-after-ax.json`;
    receipt.candidateCount = after.target.candidates.length;
    if (resources.lease) {
      menuObservation = await resources.lease.observe(controller.signal);
      writeJSON(`${prefix}-after-menu.json`, menuObservation);
      receipt.menuArtifact = `${prefix}-after-menu.json`;
      receipt.menuCount = menuObservation.menus.length;
      receipt.menuObservationTruncated = menuObservation.truncated;
      if (step.kind === 'menuCancel') receipt.menuClosureProven = !menuObservation.truncated && receipt.menuCount === 0;
      if (!menuObservation.truncated && !receipt.menuCount) resources.openedMenu = false;
    }
    if (step.expectedText !== undefined) {
      receipt.expectedTextFound = (after.axTree || '').includes(step.expectedText) || (menuObservation?.axTree || '').includes(step.expectedText);
      assert(receipt.expectedTextFound, 'Expected text was absent from the fresh AX observation');
    }
    try {
      // Mirror the Run owner: a former menu pointer cannot enter a plain
      // window image merely because the closed menu was inside that window.
      const pointer = menuObservation?.menus.length || !resources.pointerMenuSurface ? await resources.indicator?.snapshot() : undefined;
      let png;
      if (menuObservation?.menus.length) {
        const captured = await resources.lease.capture({ observationId: menuObservation.observationId, ...(pointer ? { pointerWindow: pointer } : {}) }, controller.signal);
        assert(captured.available, `Menu capture unavailable after action: ${captured.reason}`);
        png = captured.png; receipt.cursorIncluded = captured.cursorIncluded;
      } else {
        const captured = await captureOrdinary(pointer);
        png = captured.png; receipt.cursorIncluded = captured.cursorIncluded;
      }
      fs.writeFileSync(path.join(runDirectory, `${prefix}-after.png`), png, { mode: 0o600 });
      receipt.captureArtifact = `${prefix}-after.png`;
    } catch (error) {
      receipt.captureError = String(error).slice(0, 512);
      report.artifactFailures = (report.artifactFailures || 0) + 1;
      controller.signal.throwIfAborted();
    }
    // Preserve the final image even when a partial AX read cannot prove menu
    // closure. The batch remains failed; independent visual checks stay possible.
    if (step.kind === 'menuCancel') assert(receipt.menuClosureProven, 'Menu cancellation did not prove the observed menus closed');
    receipt.completed = true;
  }
}
async function phase(name, read) {
  controller.signal.throwIfAborted();
  const started = Date.now();
  try { report.phases[name] = { ok: true, ...await read(), elapsedMs: Date.now() - started }; }
  catch (error) {
    report.phases[name] = { ok: false, error: String(error).slice(0, 512), elapsedMs: Date.now() - started };
    if (error?.name === 'AgentComputerMenuSessionCloseError') report.cleanup.menuSessionClosed = false;
    controller.signal.throwIfAborted();
    if (error?.name === 'AgentComputerMenuSessionCloseError' || !report.cleanup.menuSessionClosed) throw error;
  }
}

async function main() {
  let lease; let exitCode = 1;
  const resources = {};
  const cancel = () => controller.abort();
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  // Leave time for bounded lease shutdown before the independent 45-second watchdog.
  const deadline = setTimeout(cancel, 38_000);
  try {
    const plan = mode === 'plan' ? readPlan() : undefined;
    await app.whenReady(); app.setActivationPolicy('accessory');
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const api = require(path.join(runDirectory, 'platform.cjs'));
    report.permissions = { screen: systemPreferences.getMediaAccessStatus('screen'), requested: false };
    const discovery = await api.getAgentComputerWindows(controller.signal);
    writeJSON('windows.json', discovery);
    report.discovery = { count: discovery.windows.length, truncated: discovery.truncated };
    if (mode === 'list') {
      // Window IDs are selectors only. Process identity, geometry and AX values stay local.
      report.windows = discovery.windows.map(window => ({ windowId: window.windowId,
        applicationLabel: label(window.applicationLabel), windowLabel: label(window.windowLabel), browserExcluded: isBrowser(window) }));
      report.status = 'passed'; exitCode = 0; return;
    }
    const target = discovery.windows.find(window => window.windowId === (plan?.windowId ?? Number(selectedId)));
    if (!target) { report.status = 'blocked'; report.detail = 'Selected window is no longer present; no replacement was chosen.'; exitCode = 2; return; }
    report.application = { applicationLabel: label(target.applicationLabel), windowLabel: label(target.windowLabel) };
    if (plan) assert(target.applicationLabel === plan.applicationLabel && target.windowLabel === plan.windowLabel
      && (plan.title === undefined || target.title === plan.title), 'Plan application/window identity labels changed');
    if (isBrowser(target)) {
      report.status = 'blocked'; report.detail = 'Browser application excluded by discovery metadata; no AX, menu, input or capture probe ran.'; exitCode = 2; return;
    }
    const accessibility = await api.statusAgentComputerClick(controller.signal);
    report.permissions.accessibility = accessibility;
    if (!accessibility.available || !accessibility.accessibilityTrusted || report.permissions.screen !== 'granted') {
      report.status = 'blocked'; report.detail = 'Existing macOS access is unavailable; no new permission was requested.'; exitCode = 2; return;
    }
    if (plan) {
      await executePlan(api, target, plan, resources);
      report.actionsPassed = true;
      report.status = report.artifactFailures ? 'failed' : 'passed'; exitCode = report.artifactFailures ? 1 : 0; return;
    }
    // Every production call receives the same discovery identity. Never retarget after a failure.
    await phase('ax', async () => {
      const observation = await api.getAgentComputerWindowTarget(target, controller.signal);
      writeJSON('window-ax.json', observation);
      const items = observation.target.candidates;
      return { candidateCount: items.length, roles: roles(items), capabilities: capabilities(items),
        truncated: observation.truncated, axTreeTruncated: observation.axTreeTruncated ?? null,
        axTreeBytes: Buffer.byteLength(observation.axTree || '', 'utf8'), artifact: 'window-ax.json',
        sample: items.slice(0, 24).map(item => ({ role: item.role, label: label(item.title), operations: item.operations || [] })) };
    });
    await phase('menus', async () => {
      lease = await api.createAgentComputerMenuSession(target, controller.signal);
      let observation;
      try {
        observation = await lease.observe(controller.signal);
        writeJSON('menu-ax.json', observation);
      } finally {
        lease.close(); report.cleanup.menuSessionClosed = await lease.closed;
        if (report.cleanup.menuSessionClosed) lease = undefined;
      }
      if (!report.cleanup.menuSessionClosed) throw new Error('Menu helper closure was not confirmed; later probes were stopped.');
      return { itemCount: observation.items.length, menuCount: observation.menus.length,
        mappedSurfaceCount: observation.menus.filter(menu => menu.surface).length,
        roles: roles(observation.items), capabilities: capabilities(observation.items), truncated: observation.truncated,
        axTreeBytes: Buffer.byteLength(observation.axTree, 'utf8'), artifact: 'menu-ax.json',
        sample: observation.items.slice(0, 24).map(item => ({ role: item.role, label: label(item.label), operations: item.operations })) };
    });
    await phase('inputReadiness', async () => api.getAgentComputerWindowInputStatus(target, controller.signal));
    await phase('capture', async () => {
      const png = await api.captureAgentComputerWindow(target, controller.signal);
      fs.writeFileSync(path.join(runDirectory, 'window.png'), png, { mode: 0o600 });
      return { bytes: png.length, artifact: 'window.png', captureScope: 'selected-window' };
    });
    report.status = Object.values(report.phases).every(value => value.ok) ? 'passed' : 'failed';
    exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) {
    report.status = 'failed'; report.detail = String(error).slice(0, 1024); exitCode = 1;
    if (report.steps?.at(-1)?.errorStage) report.errorStage = report.steps.at(-1).errorStage;
    if (error?.dispatchState) report.dispatchState = error.dispatchState;
    if (error?.name === 'AgentComputerMenuSessionCloseError') report.cleanup.menuSessionClosed = false;
    if (error?.name === 'AgentComputerWindowIndicatorCloseError') report.cleanup.pointerClosed = false;
  }
  finally {
    clearTimeout(deadline);
    if (resources.indicator) { resources.indicator.dispose(); report.cleanup.pointerClosed = await resources.indicator.closed; }
    if (resources.lease) { resources.lease.close(); report.cleanup.menuSessionClosed = await resources.lease.closed; }
    if (lease) { lease.close(); report.cleanup.menuSessionClosed = await lease.closed; }
    if (mode === 'plan') report.cleanup.menuMayRemainOpen = resources.openedMenu === true;
    if (!report.cleanup.menuSessionClosed || !report.cleanup.pointerClosed) { report.status = 'failed'; exitCode = 1; }
    writeJSON('result.json', report);
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    app.exit(exitCode);
  }
}

void main();
