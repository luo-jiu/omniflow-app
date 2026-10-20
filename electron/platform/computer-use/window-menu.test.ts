import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerWindowIdentity } from './desktop-computer';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('electron', () => ({ app: {}, desktopCapturer: {}, screen: {},
  systemPreferences: { getMediaAccessStatus: () => 'granted' } }));
vi.mock('./desktop-computer', async importOriginal => ({
  ...await importOriginal<typeof import('./desktop-computer')>(),
  resolveAgentComputerHelperPath: () => '/native/omniflow-click',
}));
import { createAgentComputerMenuSession } from './window-menu';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const window: AgentComputerWindowIdentity = { windowId: 81, pid: 31042, processStartedAt: 1700000000000,
  layer: 0, bounds: { x: -800, y: 100, width: 800, height: 600 }, title: 'QA' };
const signal = () => new AbortController().signal;
class Pipe extends EventEmitter { destroy = vi.fn(); }
class Child extends EventEmitter {
  stdin = Object.assign(new Pipe(), { write: vi.fn<(value: string) => boolean>().mockReturnValue(true), end: vi.fn() });
  stdout = new Pipe(); stderr = new Pipe(); kill = vi.fn(() => true);
  reply(value: unknown) { this.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`)); }
}
const snapshot = (requestId = '1', observationId = 'observation-1') => ({ ok: true, requestId, observationId,
  items: [{ itemId: 'item-1', role: 'AXButton', label: '打开菜单', bounds: { x: -750, y: 200, width: 100, height: 30 }, operations: ['open'] }],
  axTree: 'AXButton 打开菜单', truncated: false, menus: [] });
function windowCaptureReceipt(requestId = '1', override: Record<string, unknown> = {}, pngBytes = 24) {
  const png = Buffer.alloc(pngBytes); Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20);
  return { ok: true, requestId, window, width: 800, height: 600, pngBase64: png.toString('base64'), ...override };
}
async function setup(startupSignal = signal(), associatedWindow?: AgentComputerWindowIdentity) {
  const child = new Child(); mocks.spawn.mockReturnValueOnce(child);
  const promise = createAgentComputerMenuSession(window, startupSignal, associatedWindow);
  child.reply({ ok: true, ready: true });
  const lease = await promise;
  return { child, lease };
}
async function observed() {
  const result = await setup();
  const pending = result.lease.observe(signal()); result.child.reply(snapshot()); await pending;
  return result;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); Object.defineProperty(process, 'platform', platform); });

describe('native menu reference session', () => {
  const associatedWindow: AgentComputerWindowIdentity = { ...window, windowId: 82,
    bounds: { x: -800, y: 125, width: 800, height: 575 } };
  it.each([
    { ...associatedWindow, windowId: window.windowId },
    { ...associatedWindow, pid: 1 },
    { ...associatedWindow, processStartedAt: window.processStartedAt + 1 },
    { ...associatedWindow, layer: 101 },
    { ...associatedWindow, bounds: { ...associatedWindow.bounds, x: -801 } },
  ])('rejects an unrelated associated menu window before spawn: %j', async associated => {
    await expect(createAgentComputerMenuSession(window, signal(), associated)).rejects.toThrow();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('freezes one explicit associated surface without granting native pointer elevation', async () => {
    const { child, lease } = await setup(signal(), associatedWindow);
    expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toEqual({ window, associatedWindow });
    const bounds = { x: -750, y: 200, width: 180, height: 220 };
    const pending = lease.observe(signal());
    child.reply({ ...snapshot(), items: [{ itemId: 'item-1', role: 'AXMenuItem', label: '属性',
      bounds: { ...bounds, height: 30 }, operations: ['press'] }], menus: [{ bounds, surface: associatedWindow }] });
    await expect(pending).resolves.toMatchObject({ menus: [{ bounds, surface: associatedWindow }] });
    const pointer = lease.resolvePointer({ observationId: 'observation-1', itemId: 'item-1', operation: 'press' }, signal());
    child.reply({ ok: true, requestId: '2', available: false, reason: 'menu_pointer_unavailable' });
    await expect(pointer).resolves.toMatchObject({ available: false });
    const captured = lease.capture({ observationId: 'observation-1' }, signal());
    const receipt: Record<string, unknown> = windowCaptureReceipt('3'); delete receipt.window;
    child.reply({ ...receipt, available: true, observationId: 'observation-1', bounds: window.bounds,
      captureMethod: 'included-windows', captureScope: 'window-menus', cursorIncluded: false });
    await expect(captured).resolves.toMatchObject({ available: true, menuCapture: 'included', bounds: window.bounds });
    const action = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'press' }, signal());
    child.reply({ ok: true, requestId: '4', event: 'dispatched' }); child.reply({ ok: true, requestId: '4', dispatched: true });
    await action; child.emit('close', 0);
  });
  it('allows native title resolution only when the associated startup title was omitted', async () => {
    const untitled = { ...associatedWindow }; delete untitled.title;
    const { child, lease } = await setup(signal(), untitled);
    const pending = lease.observe(signal());
    child.reply({ ...snapshot(), menus: [{ bounds: { x: -750, y: 200, width: 100, height: 200 },
      surface: { ...associatedWindow, title: 'Native overlay' } }] });
    await expect(pending).resolves.toMatchObject({ menus: [{ surface: { title: 'Native overlay' } }] });
    child.emit('close', 0);
  });
  it.each(['window', 'process', 'start', 'geometry', 'layer', 'title', 'outside-menu'])('rejects an altered associated surface: %s', async change => {
    const { child, lease } = await setup(signal(), associatedWindow);
    const pending = lease.observe(signal());
    const surface = { ...associatedWindow, ...(change === 'window' ? { windowId: 83 } : {}),
      ...(change === 'process' ? { pid: 1 } : {}), ...(change === 'start' ? { processStartedAt: 1 } : {}),
      ...(change === 'geometry' ? { bounds: { ...associatedWindow.bounds, width: 799 } } : {}),
      ...(change === 'layer' ? { layer: 101 } : {}), ...(change === 'title' ? { title: 'Changed' } : {}) };
    child.reply({ ...snapshot(), menus: [{ bounds: { x: change === 'outside-menu' ? -801 : -750,
      y: 200, width: 100, height: 200 }, surface }] });
    await expect(pending).rejects.toThrow('回执无效'); expect(child.kill).toHaveBeenCalled(); child.emit('close', 0);
  });
  it('rejects an associated overlay receipt as an elevated pointer surface', async () => {
    const { child, lease } = await setup(signal(), associatedWindow);
    const bounds = { x: -750, y: 200, width: 100, height: 30 };
    const pending = lease.observe(signal());
    child.reply({ ...snapshot(), items: [{ itemId: 'item-1', role: 'AXMenuItem', label: '属性', bounds, operations: ['press'] }],
      menus: [{ bounds, surface: associatedWindow }] }); await pending;
    const pointer = lease.resolvePointer({ observationId: 'observation-1', itemId: 'item-1', operation: 'press' }, signal());
    child.reply({ ok: true, requestId: '2', available: true, observationId: 'observation-1', itemId: 'item-1',
      point: { x: -700, y: 215 }, menuSurface: associatedWindow });
    await expect(pointer).rejects.toThrow('回执无效'); child.emit('close', 0);
  });
  it('prepares an associated owner cancellation without an AX dispatch acknowledgement', async () => {
    const { child, lease } = await setup(signal(), associatedWindow);
    const observing = lease.observe(signal());
    child.reply({ ...snapshot(), items: [{ itemId: 'item-1', role: 'AXMenu', label: '上下文菜单',
      bounds: { x: -750, y: 200, width: 100, height: 200 }, operations: ['cancel'] }] }); await observing;
    const onDispatched = vi.fn();
    const request = { observationId: 'observation-1', itemId: 'item-1', operation: 'cancel' as const };
    const cancelling = lease.action(request, signal(), onDispatched);
    child.reply({ ok: true, requestId: '2', associatedCancelWindowId: associatedWindow.windowId });
    await expect(cancelling).resolves.toEqual({ associatedCancelWindowId: associatedWindow.windowId });
    expect(onDispatched).not.toHaveBeenCalled();
    await expect(lease.action(request, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(child.kill).not.toHaveBeenCalled(); child.emit('close', 0);
  });
  it.each(['foreign', 'missing-association', 'press', 'menu-item', 'menu-bar', 'extra-field', 'after-ack',
    'zero', 'fraction', 'overflow', 'string', 'null'])('rejects an unsafe owner-cancel marker: %s', async problem => {
    const { child, lease } = await setup(signal(), problem === 'missing-association' ? undefined : associatedWindow);
    const operation = problem === 'press' ? 'press' : 'cancel';
    const observing = lease.observe(signal());
    child.reply({ ...snapshot(), items: [{ itemId: 'item-1', role: problem === 'menu-item' ? 'AXMenuItem'
      : problem === 'menu-bar' ? 'AXMenuBarItem' : 'AXMenu', label: '上下文菜单',
    bounds: { x: -750, y: 200, width: 100, height: 200 }, operations: [operation] }] }); await observing;
    const cancelling = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation }, signal());
    if (problem === 'after-ack') child.reply({ ok: true, requestId: '2', event: 'dispatched' });
    const marker = problem === 'foreign' ? 83 : problem === 'zero' ? 0 : problem === 'fraction' ? 82.5
      : problem === 'overflow' ? 0x100000000 : problem === 'string' ? '82' : problem === 'null' ? null : 82;
    child.reply({ ok: true, requestId: '2', associatedCancelWindowId: marker,
      ...(problem === 'extra-field' ? { dispatched: true } : {}) });
    await expect(cancelling).rejects.toMatchObject({ dispatchState: 'unknown' });
    expect(child.kill).toHaveBeenCalled(); child.emit('close', 0);
  });
  it('keeps ordinary native AX cancellation on the original acknowledged dispatch route', async () => {
    const { child, lease } = await setup();
    const observing = lease.observe(signal());
    child.reply({ ...snapshot(), items: [{ itemId: 'item-1', role: 'AXMenu', label: '菜单',
      bounds: { x: 10, y: 200, width: 100, height: 200 }, operations: ['cancel'] }] }); await observing;
    const onDispatched = vi.fn();
    const cancelling = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'cancel' }, signal(), onDispatched);
    child.reply({ ok: true, requestId: '2', event: 'dispatched' }); child.reply({ ok: true, requestId: '2', dispatched: true });
    await expect(cancelling).resolves.toBeUndefined(); expect(onDispatched).toHaveBeenCalledOnce(); child.emit('close', 0);
  });
  it('settles a cancelled owner preparation as unknown and discards its late marker', async () => {
    const { child, lease } = await setup(signal(), associatedWindow);
    const observing = lease.observe(signal());
    child.reply({ ...snapshot(), items: [{ itemId: 'item-1', role: 'AXMenu', label: '上下文菜单',
      bounds: { x: -750, y: 200, width: 100, height: 200 }, operations: ['cancel'] }] }); await observing;
    const controller = new AbortController(); const onDispatched = vi.fn();
    const cancelling = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'cancel' }, controller.signal, onDispatched);
    const rejection = expect(cancelling).rejects.toMatchObject({ dispatchState: 'unknown' });
    controller.abort(); await rejection;
    child.reply({ ok: true, requestId: '2', associatedCancelWindowId: associatedWindow.windowId });
    expect(onDispatched).not.toHaveBeenCalled(); child.emit('close', 0);
  });
  it('reports a refused unsafe cancellation without implying dispatch', async () => {
    const { child, lease } = await observed();
    const pending = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'open' }, signal());
    child.reply({ ok: false, requestId: '2', dispatched: false,
      error: { code: 'menu_cancel_unavailable', message: 'unavailable' } });
    await expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched', message: '当前菜单不支持安全取消，请重新观察菜单' });
    child.emit('close', 0);
  });
  it('captures the frozen ordinary window on the existing process without requiring or consuming menu IDs', async () => {
    const { child, lease } = await setup();
    const first = lease.captureWindow({}, signal());
    expect(JSON.parse(child.stdin.write.mock.calls.at(-1)![0])).toEqual({ requestId: '1', command: 'captureWindow' });
    child.reply(windowCaptureReceipt());
    await expect(first).resolves.toMatchObject({ cursorIncluded: false, captureMethod: 'independent-window' });
    const observing = lease.observe(signal()); child.reply(snapshot('2')); await observing;
    const second = lease.captureWindow({}, signal()); child.reply(windowCaptureReceipt('3')); await second;
    const action = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'open' }, signal());
    child.reply({ ok: true, requestId: '4', event: 'dispatched' }); child.reply({ ok: true, requestId: '4', dispatched: true });
    await action;
    expect(mocks.spawn).toHaveBeenCalledOnce(); child.emit('close', 0);
  });
  it.each([
    ['changed target', { window: { ...window, windowId: 999 } }],
    ['expanded geometry', { window: { ...window, bounds: { ...window.bounds, width: 900 } } }],
    ['wrong PNG dimensions', { width: 801 }],
    ['extra scope', { captureScope: 'window-menus' }],
    ['unrequested pointer', { cursorIncluded: true, captureMethod: 'included-windows' }],
  ])('rejects an invalid ordinary capture receipt: %s', async (_label, override) => {
    const { child, lease } = await setup(); const pending = lease.captureWindow({}, signal());
    child.reply(windowCaptureReceipt('1', override));
    await expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(child.kill).toHaveBeenCalled(); expect(mocks.spawn).toHaveBeenCalledOnce(); child.emit('close', 0);
  });
  it('uses the ordinary-window pointer containment contract, including strict cursor receipts', async () => {
    const { child, lease } = await setup();
    const pointerWindow = { windowId: 90, pid: 123, processStartedAt: window.processStartedAt,
      layer: 102, bounds: { x: -700, y: 200, width: 35, height: 35 } };
    const calls = child.stdin.write.mock.calls.length;
    await expect(lease.captureWindow({ pointerWindow: { ...pointerWindow,
      bounds: { ...pointerWindow.bounds, x: -10 } } }, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(child.stdin.write).toHaveBeenCalledTimes(calls);
    const pending = lease.captureWindow({ pointerWindow }, signal());
    expect(JSON.parse(child.stdin.write.mock.calls.at(-1)![0])).toEqual({ requestId: '1', command: 'captureWindow', pointerWindow });
    child.reply(windowCaptureReceipt('1', { cursorIncluded: true, captureMethod: 'included-windows' }));
    await expect(pending).resolves.toMatchObject({ cursorIncluded: true, captureMethod: 'included-windows' });
    const malformed = lease.captureWindow({ pointerWindow }, signal());
    child.reply(windowCaptureReceipt('2', { cursorIncluded: true, captureMethod: 'independent-window' }));
    await expect(malformed).rejects.toMatchObject({ dispatchState: 'not-dispatched' }); child.emit('close', 0);
  });
  it('retains the observation after a native capture refusal and never spawns a fallback helper', async () => {
    const { child, lease } = await observed(); const pending = lease.captureWindow({}, signal());
    child.reply({ ok: false, requestId: '2', dispatched: false, error: { code: 'window_capture_failed', message: 'failed' } });
    await expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(child.kill).not.toHaveBeenCalled();
    const action = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'open' }, signal());
    child.reply({ ok: true, requestId: '3', event: 'dispatched' }); child.reply({ ok: true, requestId: '3', dispatched: true }); await action;
    const next = lease.observe(signal()); child.reply(snapshot('4', 'observation-2')); await next;
    expect(mocks.spawn).toHaveBeenCalledOnce(); child.emit('close', 0);
  });
  it('allows the screenshot budget and frame size on the retained connection', async () => {
    const { child, lease } = await setup(); const pending = lease.captureWindow({}, signal());
    await vi.advanceTimersByTimeAsync(6000); expect(child.kill).not.toHaveBeenCalled();
    child.reply(windowCaptureReceipt('1', {}, 300 * 1024));
    await expect(pending).resolves.toMatchObject({ png: expect.any(Buffer) });
    const expired = lease.captureWindow({}, signal());
    const rejection = expect(expired).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    await vi.advanceTimersByTimeAsync(14999); expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await rejection;
    child.reply(windowCaptureReceipt('2')); expect(mocks.spawn).toHaveBeenCalledOnce();
    const captures = child.stdin.write.mock.calls.filter(([line]) => line.includes('captureWindow'));
    expect(captures).toHaveLength(2); child.emit('close', 0);
  });
  it('cancels retained window capture without replay or late publication', async () => {
    const { child, lease } = await setup(); const controller = new AbortController();
    const pending = lease.captureWindow({}, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    controller.abort(); await rejection;
    child.reply(windowCaptureReceipt());
    await expect(lease.captureWindow({}, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(child.stdin.write.mock.calls.filter(([line]) => line.includes('captureWindow'))).toHaveLength(1);
    child.emit('close', 0); await expect(lease.closed).resolves.toBe(true);
  });
  it('starts exactly one fixed helper and keeps only its Run-owned connection alive', async () => {
    const { child, lease } = await setup();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledWith('/native/omniflow-click', ['--window-menu-session'],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toEqual({ window });
    await vi.advanceTimersByTimeAsync(750); expect(child.stdin.write).toHaveBeenLastCalledWith('\n');
    lease.close(); lease.close(); expect(child.kill).toHaveBeenCalledTimes(1);
    let closed: boolean | undefined; void lease.closed.then(value => { closed = value; });
    await Promise.resolve(); expect(closed).toBeUndefined();
    child.emit('exit', 0); await expect(lease.closed).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0); expect(child.listenerCount('exit')).toBe(0);
    expect(child.stdout.listenerCount('data')).toBe(0);
    child.stdin.emit('error', new Error('late EPIPE'));
  });
  it('does not retain a completed tool startup signal as the Run lifetime', async () => {
    const controller = new AbortController(); const { child, lease } = await setup(controller.signal);
    controller.abort(); expect(child.kill).not.toHaveBeenCalled();
    const pending = lease.observe(signal()); child.reply(snapshot());
    await expect(pending).resolves.toMatchObject({ observationId: 'observation-1' }); child.emit('close', 0);
  });
  it('dispatches a declared action exactly once and rejects reuse until a fresh observation', async () => {
    const { child, lease } = await observed(); const onDispatch = vi.fn();
    const action = { observationId: 'observation-1', itemId: 'item-1', operation: 'open' as const };
    const pending = lease.action(action, signal(), onDispatch);
    child.reply({ ok: true, requestId: '2', event: 'dispatched' }); expect(onDispatch).toHaveBeenCalledOnce();
    child.reply({ ok: true, requestId: '2', dispatched: true }); await pending;
    const calls = child.stdin.write.mock.calls.length;
    await expect(lease.action(action, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(child.stdin.write).toHaveBeenCalledTimes(calls); child.emit('close', 0);
  });
  it('resolves a main-window source without consuming its action', async () => {
    const { child, lease } = await observed();
    const action = { observationId: 'observation-1', itemId: 'item-1', operation: 'open' as const };
    const pending = lease.resolvePointer(action, signal());
    child.reply({ ok: true, requestId: '2', available: true, observationId: action.observationId,
      itemId: action.itemId, point: { x: -700, y: 215 } });
    await expect(pending).resolves.toMatchObject({ available: true, point: { x: -700, y: 215 } });
    expect(JSON.parse(child.stdin.write.mock.calls.at(-1)![0])).toEqual({ requestId: '2', command: 'resolvePointer', ...action });
    const dispatched = lease.action(action, signal());
    child.reply({ ok: true, requestId: '3', event: 'dispatched' }); child.reply({ ok: true, requestId: '3', dispatched: true });
    await dispatched; child.emit('close', 0);
  });
  it.each(['valid', 'wrong-id', 'wrong-point', 'wrong-surface', 'missing-surface'])('validates exact menu pointer receipts: %s', async problem => {
    const { child, lease } = await setup();
    const bounds = { x: 10, y: 200, width: 100, height: 32 };
    const surface = { ...window, windowId: 82, layer: 101, bounds };
    const observe = lease.observe(signal());
    child.reply({ ...snapshot(), items: [{ itemId: 'item-1', role: 'AXMenuItem', label: '选择', bounds, operations: ['press'] }],
      menus: [{ bounds, surface }] }); await observe;
    const pending = lease.resolvePointer({ observationId: 'observation-1', itemId: 'item-1', operation: 'press' }, signal());
    child.reply({ ok: true, requestId: '2', available: true, observationId: 'observation-1',
      itemId: problem === 'wrong-id' ? 'another' : 'item-1',
      point: { x: problem === 'wrong-point' ? -700 : 60, y: 216 },
      ...(problem === 'missing-surface' ? {} : { menuSurface: { ...surface, windowId: problem === 'wrong-surface' ? 83 : 82 } }) });
    if (problem === 'valid') await expect(pending).resolves.toMatchObject({ available: true, menuSurface: surface });
    else { await expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched' }); expect(child.kill).toHaveBeenCalled(); }
    child.emit('close', 0);
  });
  it('preserves AX action when the source has no safe visual surface', async () => {
    const { child, lease } = await observed();
    const action = { observationId: 'observation-1', itemId: 'item-1', operation: 'open' as const };
    const pending = lease.resolvePointer(action, signal());
    child.reply({ ok: true, requestId: '2', available: false, reason: 'menu_surface_unavailable' });
    await expect(pending).resolves.toEqual({ available: false, reason: 'menu_surface_unavailable' });
    const dispatched = lease.action(action, signal());
    child.reply({ ok: true, requestId: '3', event: 'dispatched' }); child.reply({ ok: true, requestId: '3', dispatched: true });
    await dispatched; child.emit('close', 0);
  });
  it('revokes old IDs as soon as the next observation starts', async () => {
    const { child, lease } = await observed(); const pending = lease.observe(signal());
    await expect(lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'open' }, signal()))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    child.reply(snapshot('2', 'observation-2')); await pending; child.emit('close', 0);
  });
  it.each([false, true])('settles cancellation after send as unknown, with ACK=%s', async ack => {
    const { child, lease } = await observed(); const controller = new AbortController();
    const pending = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'open' }, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    if (ack) child.reply({ ok: true, requestId: '2', event: 'dispatched' });
    controller.abort(); await rejection;
    child.reply({ ok: true, requestId: '2', dispatched: true });
    child.emit('close', 0); await expect(lease.closed).resolves.toBe(true);
  });
  it('preserves an explicit native refusal before dispatch without inventing success', async () => {
    const { child, lease } = await observed();
    const pending = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'open' }, signal());
    child.reply({ ok: false, requestId: '2', dispatched: false, error: { code: 'stale_menu', message: 'changed' } });
    await expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(child.kill).not.toHaveBeenCalled(); child.emit('close', 0);
  });
  it.each(['missing-ack', 'false-after-ack', 'wrong-request'])('fails closed for %s and preserves unknown', async problem => {
    const { child, lease } = await observed();
    const pending = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'open' }, signal());
    if (problem === 'false-after-ack') child.reply({ ok: true, requestId: '2', event: 'dispatched' });
    child.reply(problem === 'false-after-ack'
      ? { ok: false, requestId: '2', dispatched: false, error: { code: 'bad', message: 'bad' } }
      : { ok: true, requestId: problem === 'wrong-request' ? '3' : '2', dispatched: true });
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    expect(child.kill).toHaveBeenCalled(); child.emit('close', 0);
  });
  it('rejects a menu surface from another process even if its rectangle matches', async () => {
    const { child, lease } = await setup(); const pending = lease.observe(signal());
    child.reply({ ...snapshot(), menus: [{ bounds: window.bounds,
      surface: { ...window, windowId: 82, pid: 1, layer: 101 } }] });
    await expect(pending).rejects.toThrow('回执无效'); expect(child.kill).toHaveBeenCalled(); child.emit('close', 0);
  });
  it.each([0, 24, 102])('rejects a surface outside the native popup profile (layer=%s)', async layer => {
    const { child, lease } = await setup(); const pending = lease.observe(signal());
    child.reply({ ...snapshot(), menus: [{ bounds: window.bounds,
      surface: { ...window, windowId: 82, layer } }] });
    await expect(pending).rejects.toThrow('回执无效'); expect(child.kill).toHaveBeenCalled(); child.emit('close', 0);
  });
  it('reports unavailable menu capture without inventing a screenshot or losing AX', async () => {
    const { child, lease } = await observed(); const pending = lease.capture({ observationId: 'observation-1' }, signal());
    child.reply({ ok: true, requestId: '2', available: false, reason: 'menu_surface_unavailable' });
    await expect(pending).resolves.toEqual({ available: false, reason: 'menu_surface_unavailable' });
    const action = lease.action({ observationId: 'observation-1', itemId: 'item-1', operation: 'open' }, signal());
    child.reply({ ok: true, requestId: '3', event: 'dispatched' }); child.reply({ ok: true, requestId: '3', dispatched: true });
    await action; child.emit('close', 0);
  });
  it.each([false, true])('accepts only the frozen window/menu screenshot union (expanded=%s)', async expanded => {
    const { child, lease } = await setup();
    const menuBounds = { x: -50, y: 200, width: 100, height: 200 };
    const pending = lease.observe(signal());
    child.reply({ ...snapshot(), menus: [{ bounds: menuBounds, surface: { ...window,
      windowId: 82, layer: 101, bounds: menuBounds } }] }); await pending;
    const captured = lease.capture({ observationId: 'observation-1' }, signal());
    const width = expanded ? 900 : 850;
    const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(width, 16); png.writeUInt32BE(600, 20);
    child.reply({ ok: true, requestId: '2', available: true, observationId: 'observation-1',
      bounds: { ...window.bounds, width }, width, height: 600, pngBase64: png.toString('base64'),
      captureMethod: 'included-windows', captureScope: 'window-menus', cursorIncluded: false });
    if (expanded) await expect(captured).rejects.toThrow('回执无效');
    else await expect(captured).resolves.toMatchObject({ available: true, menuCapture: 'included', bounds: { width: 850 } });
    child.emit('close', 0);
  });
  it('allows only the small native pointer to extend the menu capture crop', async () => {
    const { child, lease } = await setup();
    const bounds = { x: 10, y: 100, width: 100, height: 32 };
    const observing = lease.observe(signal());
    child.reply({ ...snapshot(), menus: [{ bounds, surface: { ...window, windowId: 82, layer: 101, bounds } }] }); await observing;
    const pointerWindow = { windowId: 90, pid: 123, processStartedAt: window.processStartedAt,
      layer: 102, bounds: { x: 50, y: 93, width: 35, height: 35 } };
    const capture = lease.capture({ observationId: 'observation-1', pointerWindow }, signal());
    const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(910, 16); png.writeUInt32BE(607, 20);
    child.reply({ ok: true, requestId: '2', available: true, observationId: 'observation-1',
      bounds: { x: -800, y: 93, width: 910, height: 607 }, width: 910, height: 607, pngBase64: png.toString('base64'),
      captureMethod: 'included-windows', captureScope: 'window-menus', cursorIncluded: true });
    await expect(capture).resolves.toMatchObject({ available: true, cursorIncluded: true, bounds: { y: 93, height: 607 } });
    const calls = child.stdin.write.mock.calls.length;
    await expect(lease.capture({ observationId: 'observation-1', pointerWindow: { ...pointerWindow,
      bounds: { x: 2, y: 500, width: 5, height: 5 } } }, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(child.stdin.write).toHaveBeenCalledTimes(calls); child.emit('close', 0);
  });
  it('bounds process shutdown and never changes an unconfirmed result after a late exit', async () => {
    const { child, lease } = await setup(); lease.close();
    await vi.advanceTimersByTimeAsync(600); await expect(lease.closed).resolves.toBe(false);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    child.emit('exit', 0); await expect(lease.closed).resolves.toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects pre-cancelled startup before spawning any process', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(createAgentComputerMenuSession(window, controller.signal)).rejects.toThrow(); expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('holds a failed startup until actual exit and reports unconfirmed cleanup distinctly', async () => {
    const child = new Child(); mocks.spawn.mockReturnValueOnce(child);
    let rejected = false;
    const pending = createAgentComputerMenuSession(window, signal());
    const result = pending.catch(error => { rejected = true; return error; });
    await vi.advanceTimersByTimeAsync(3000); expect(rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(599); expect(rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'AgentComputerMenuSessionCloseError' });
    child.emit('exit', 0); expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves a native startup refusal while awaiting its process exit', async () => {
    const child = new Child(); mocks.spawn.mockReturnValueOnce(child);
    let rejected = false;
    const result = createAgentComputerMenuSession(window, signal()).catch(error => { rejected = true; return error; });
    child.reply({ ok: false, dispatched: false, error: { code: 'target_changed', message: 'Target unavailable' } });
    await Promise.resolve(); expect(rejected).toBe(false);
    child.emit('close', 0);
    expect((await result).message).toContain('target_changed'); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps ownership through startup cancellation until its late process exit', async () => {
    const child = new Child(); mocks.spawn.mockReturnValueOnce(child); const controller = new AbortController();
    let rejected = false;
    const result = createAgentComputerMenuSession(window, controller.signal).catch(error => { rejected = true; return error; });
    controller.abort(); await vi.advanceTimersByTimeAsync(200); expect(rejected).toBe(false);
    child.emit('close', 0); expect(await result).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
