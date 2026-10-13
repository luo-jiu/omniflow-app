import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerWindowIdentity } from './desktop-computer';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), helperPath: vi.fn(() => '/isolated/native/omniflow-click') }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./desktop-computer', () => ({ resolveAgentComputerHelperPath: mocks.helperPath }));

import { AgentComputerWindowIndicatorCloseError, showAgentComputerWindowIndicator, type AgentComputerWindowIndicatorRequest } from './window-indicator';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const window: AgentComputerWindowIdentity = {
  windowId: 81, pid: 31_042, processStartedAt: 1_700_000_000_000, layer: 0,
  bounds: { x: -1_440, y: 120, width: 1_440, height: 900 }, title: 'Fixture window',
};
const request: AgentComputerWindowIndicatorRequest = { window, operation: 'click', point: { x: -800.5, y: 500.25 } };

class Pipe extends EventEmitter {
  resume = vi.fn();
  destroy = vi.fn();
}
class HelperProcess extends EventEmitter {
  stdout = new Pipe();
  stderr = new Pipe();
  stdin = Object.assign(new Pipe(), { write: vi.fn<(value: string) => boolean>().mockReturnValue(true), end: vi.fn() });
  kill = vi.fn(() => true);
  reply(receipt: unknown = { ok: true, shown: true }) { this.stdout.emit('data', Buffer.from(`${JSON.stringify(receipt)}\n`)); }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.helperPath.mockReturnValue('/isolated/native/omniflow-click');
  vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers();
  Object.defineProperty(process, 'platform', platformDescriptor);
});

function setup(signal = new AbortController().signal, input: AgentComputerWindowIndicatorRequest = request) {
  const child = new HelperProcess(); mocks.spawn.mockReturnValueOnce(child);
  const pending = showAgentComputerWindowIndicator(input, signal);
  return { child, pending };
}

function expectDetached(child: HelperProcess) {
  expect(child.listenerCount('exit')).toBe(0);
  expect(child.listenerCount('close')).toBe(0);
  // Closure-bearing lifecycle listeners are gone, while a shared no-op handler
  // absorbs queued EPIPE/error events until these temporary emitters are GC'd.
  expect(child.listenerCount('error')).toBe(1);
  expect(child.stdin.listenerCount('error')).toBe(1);
  expect(child.stdout.listenerCount('error')).toBe(1);
  expect(child.stdout.listenerCount('data')).toBe(0);
  expect(child.stderr.listenerCount('error')).toBe(1);
  expect(child.listeners('error')[0]).toBe(child.stdin.listeners('error')[0]);
  expect(child.listeners('error')[0]).toBe(child.stdout.listeners('error')[0]);
  expect(child.listeners('error')[0]).toBe(child.stderr.listeners('error')[0]);
}

describe('Run-owned persistent visual window indicator adapter', () => {
  it('writes one fixed request line and keeps stdin alive until the returned lease closes', async () => {
    const { child, pending } = setup();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledWith('/isolated/native/omniflow-click', ['--window-indicator'], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(child.stdin.write).toHaveBeenCalledOnce();
    expect(child.stdin.write).toHaveBeenCalledWith(`${JSON.stringify(request)}\n`);
    expect(child.stdin.end).not.toHaveBeenCalled();
    child.reply();
    const lease = await pending;
    expect(lease.shown).toBe(true);
    let closed: boolean | undefined;
    void lease.closed.then(value => { closed = value; });
    await Promise.resolve(); expect(closed).toBeUndefined();
    expect(child.stdin.end).not.toHaveBeenCalled();
    lease.dispose(); lease.dispose();
    expect(lease.shown).toBe(false);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await Promise.resolve(); expect(closed).toBeUndefined();
    child.emit('close', 0);
    await expect(lease.closed).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    expectDetached(child);
  });

  it.each(['click', 'rightClick', 'doubleClick', 'drag'] as const)('serializes only the finite %s pointer intent', async operation => {
    const input = { ...request, operation, ...(operation === 'drag' ? { endPoint: { x: -600, y: 550 } } : {}) };
    const { child, pending } = setup(undefined, input);
    expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toEqual(input);
    child.reply();
    expect((await pending).shown).toBe(true);
    child.emit('close', 0);
    expectDetached(child);
  });

  it.each(['click', 'rightClick', 'doubleClick', 'drag'] as const)('forwards only a canonical visual accent for %s', async operation => {
    const input = { ...request, operation, accentColor: '#5A9E7C',
      ...(operation === 'drag' ? { endPoint: { x: -600, y: 550 } } : {}) };
    const { child, pending } = setup(undefined, input);
    expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toEqual({ ...input, accentColor: '#5a9e7c' });
    child.reply(); (await pending).dispose(); child.emit('close', 0); expectDetached(child);
  });

  it.each([undefined, null, true, 123456, {}, '#fff', '5a9e7c', '#12345678', '#12345g',
    ' #123456', '#123456\n', 'red', 'rgb(1,2,3)', 'var(--primary-color)', '#１２３４５６'])('declines an invalid visual accent before spawning (%j)', async accentColor => {
    const lease = await showAgentComputerWindowIndicator({ ...request, accentColor } as AgentComputerWindowIndicatorRequest, new AbortController().signal);
    expect(lease.shown).toBe(false); await expect(lease.closed).resolves.toBe(true);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('ACKs a visual color update within the same frozen window without a new helper', async () => {
    const { child, pending } = setup(undefined, { ...request, accentColor: '#5a9e7c' });
    child.reply(); const lease = await pending;
    const updating = lease.update!({ ...request, accentColor: '#AABBCC' });
    expect(child.stdin.write).toHaveBeenLastCalledWith(`${JSON.stringify({ ...request, accentColor: '#aabbcc' })}\n`);
    child.reply(); await expect(updating).resolves.toBe(true);
    expect(mocks.spawn).toHaveBeenCalledOnce(); expect(lease.shown).toBe(true);
    lease.dispose(); child.emit('close', 0); await expect(lease.closed).resolves.toBe(true); expectDetached(child);
  });

  it('rebuilds the exact identity and strips public discovery labels without forwarding private fields', async () => {
    const input = { ...request, window: { ...window, applicationLabel: 'TextEdit', windowLabel: 'Fixture' } };
    const { child, pending } = setup(undefined, input);
    expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toEqual(request);
    child.reply(); (await pending).dispose(); child.emit('close', 0);
  });

  it.each([
    { ...request, label: 'arbitrary text' }, { ...request, operation: 'shortcut' }, { ...request, script: 'activate()' },
    { ...request, endPoint: { x: -700, y: 600 } }, { ...request, point: { x: 0, y: 500 } },
    { ...request, point: { x: -800, y: 1_020 } }, { ...request, point: { x: NaN, y: 500 } },
    { ...request, point: { x: -800, y: 500, button: 'left' } },
    { ...request, window: { ...window, windowId: 0 } }, { ...request, window: { ...window, pid: 0 } },
    { ...request, window: { ...window, processStartedAt: Infinity } }, { ...request, window: { ...window, layer: 1 } },
    { ...request, window: { ...window, title: '\u202efake' } }, { ...request, window: { ...window, title: '\uD800' } },
    { ...request, window: { ...window, candidate: { nativeIdentifier: 'private' } } },
    { ...request, window: { ...window, bounds: { ...window.bounds, width: 0 } } },
    { ...request, window: { ...window, bounds: { ...window.bounds, x: 10_000_001 } } },
    { ...request, operation: 'drag' }, { ...request, operation: 'drag', endPoint: request.point },
    { ...request, operation: 'drag', endPoint: { x: -700, y: 600 }, durationMs: 500 },
  ])('leaves malformed or expanded input inert before spawning (%j)', async input => {
    const lease = await showAgentComputerWindowIndicator(input as AgentComputerWindowIndicatorRequest, new AbortController().signal);
    expect(lease.shown).toBe(false);
    await expect(lease.closed).resolves.toBe(true);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('refuses getters and symbol fields without evaluating request code', async () => {
    const read = vi.fn(() => request.point);
    const input = { ...request }; Object.defineProperty(input, 'point', { enumerable: true, get: read });
    expect((await showAgentComputerWindowIndicator(input, new AbortController().signal)).shown).toBe(false);
    expect((await showAgentComputerWindowIndicator({ ...request, [Symbol('input')]: true }, new AbortController().signal)).shown).toBe(false);
    const colorInput = { ...request }; Object.defineProperty(colorInput, 'accentColor', { enumerable: true, get: read });
    expect((await showAgentComputerWindowIndicator(colorInput, new AbortController().signal)).shown).toBe(false);
    expect(read).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('accepts a split status line without closing the independent lease', async () => {
    const { child, pending } = setup();
    child.stdout.emit('data', Buffer.from('{"ok":true,'));
    let settled = false; void pending.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    child.stdout.emit('data', Buffer.from('"shown":true}\n'));
    expect((await pending).shown).toBe(true);
    child.emit('close', 0); expectDetached(child);
  });

  it.each([{ ok: true, shown: false }, { ok: false, shown: true }, { ok: true, shown: 'true' },
    { ok: true, shown: true, pid: window.pid }, {}, null])('cleans a refused or invalid status (%j) without an action error', async receipt => {
    const { child, pending } = setup();
    child.reply(receipt);
    const lease = await pending;
    expect(lease.shown).toBe(false);
    let closed: boolean | undefined;
    void lease.closed.then(value => { closed = value; });
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(closed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    await expect(lease.closed).resolves.toBe(false);
    expectDetached(child);
  });

  it.each([
    Buffer.from('{\n'), Buffer.from('{"ok":true,"shown":true}\n{"ok":true,"shown":true}\n'),
    Buffer.concat([Buffer.from('{"ok":true,"shown":true,"x":"'), Buffer.from([0xff]), Buffer.from('"}\n')]),
    Buffer.alloc(513, 32),
  ])('bounds malformed, ambiguous, non-UTF8 or excessive output before accepting readiness', async bytes => {
    const { child, pending } = setup();
    child.stdout.emit('data', bytes);
    expect((await pending).shown).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expectDetached(child);
  });

  it('times out startup at one second and cannot be revived by a late ready line', async () => {
    const { child, pending } = setup();
    await vi.advanceTimersByTimeAsync(999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const lease = await pending;
    expect(lease.shown).toBe(false);
    child.reply();
    await vi.advanceTimersByTimeAsync(300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    await vi.advanceTimersByTimeAsync(300);
    await expect(lease.closed).resolves.toBe(false);
    expectDetached(child);
  });

  it('remains shown beyond three seconds and sends heartbeats until explicit disposal', async () => {
    const { child, pending } = setup();
    await vi.advanceTimersByTimeAsync(900); child.reply();
    const lease = await pending;
    let closed: boolean | undefined;
    void lease.closed.then(value => { closed = value; });
    await vi.advanceTimersByTimeAsync(6_500);
    expect(lease.shown).toBe(true);
    expect(closed).toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.stdin.write.mock.calls.map(([line]) => line)).toEqual([`${JSON.stringify(request)}\n`, ...Array<string>(6).fill('\n')]);
    lease.dispose();
    expect(lease.shown).toBe(false);
    const writesAtDisposal = child.stdin.write.mock.calls.length;
    child.emit('close', 0);
    await vi.advanceTimersByTimeAsync(5_000); lease.dispose();
    expect(child.stdin.write).toHaveBeenCalledTimes(writesAtDisposal);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.stdout.destroy).toHaveBeenCalledOnce();
    await expect(lease.closed).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expectDetached(child);
  });

  it.each(['click', 'rightClick', 'doubleClick', 'drag'] as const)('updates the same live surface to a %s arrow only after a native ACK', async operation => {
    const { child, pending } = setup(); child.reply();
    const lease = await pending;
    const next: AgentComputerWindowIndicatorRequest = { ...request, operation, point: { x: -700, y: 600 },
      ...(operation === 'drag' ? { endPoint: { x: -600, y: 650 } } : {}) };
    const updating = lease.update!(next);
    let accepted: boolean | undefined;
    void updating.then(value => { accepted = value; });
    await vi.advanceTimersByTimeAsync(999);
    expect(accepted).toBeUndefined();
    expect(child.stdin.write).toHaveBeenLastCalledWith(`${JSON.stringify(next)}\n`);
    child.reply();
    await expect(updating).resolves.toBe(true);
    expect(lease.shown).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.stdin.write).toHaveBeenLastCalledWith('\n');
    expect(child.kill).not.toHaveBeenCalled();
    lease.dispose(); child.emit('close', 0);
    await expect(lease.closed).resolves.toBe(true); expectDetached(child);
  });

  it('rejects a concurrent update without replacing or cancelling the pending native ACK', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    const next = { ...request, point: { x: -700, y: 600 } };
    const first = lease.update!(next);
    await expect(lease.update!({ ...request, point: { x: -600, y: 600 } })).resolves.toBe(false);
    expect(child.stdin.write).toHaveBeenCalledTimes(2);
    expect(lease.shown).toBe(true); expect(child.kill).not.toHaveBeenCalled();
    child.reply(); await expect(first).resolves.toBe(true);
    const following = lease.update!({ ...request, point: { x: -600, y: 600 } });
    child.reply(); await expect(following).resolves.toBe(true);
    lease.dispose(); child.emit('close', 0); expectDetached(child);
  });

  it('accepts the same window identity with reordered bounds and strips discovery labels on update', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    const next = { ...request, point: { x: -700, y: 600 }, window: { ...window,
      applicationLabel: 'TextEdit', windowLabel: 'Fixture',
      bounds: { height: window.bounds.height, width: window.bounds.width, y: window.bounds.y, x: window.bounds.x } } };
    const updating = lease.update!(next);
    expect(JSON.parse(child.stdin.write.mock.calls[1][0])).toEqual({ ...request, point: next.point });
    child.reply(); await expect(updating).resolves.toBe(true);
    expect(lease.shown).toBe(true); expect(child.kill).not.toHaveBeenCalled();
    lease.dispose(); child.emit('close', 0); expectDetached(child);
  });

  it.each(['windowId', 'pid', 'processStartedAt', 'title', 'bounds'] as const)('refuses an update to a changed frozen %s and retains exit confirmation', async field => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    const changed = { ...window, bounds: { ...window.bounds } };
    if (field === 'windowId') changed.windowId += 1;
    if (field === 'pid') changed.pid += 1;
    if (field === 'processStartedAt') changed.processStartedAt += 1;
    if (field === 'title') changed.title = 'Another document';
    if (field === 'bounds') changed.bounds.x -= 1;
    await expect(lease.update!({ ...request, window: changed })).resolves.toBe(false);
    expect(lease.shown).toBe(false);
    expect(child.stdin.write).toHaveBeenCalledOnce();
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    let closed: boolean | undefined; void lease.closed.then(value => { closed = value; });
    await Promise.resolve(); expect(closed).toBeUndefined();
    child.emit('close', 0); await expect(lease.closed).resolves.toBe(true);
    await expect(lease.update!(request)).resolves.toBe(false);
    expectDetached(child);
  });

  it.each([
    { ...request, operation: 'shortcut' }, { ...request, label: 'visible text' },
    { ...request, point: { x: Infinity, y: 500 } }, { ...request, point: { x: 0, y: 500 } },
    { ...request, operation: 'drag' }, { ...request, endPoint: { x: -700, y: 600 } },
    { ...request, accentColor: 'var(--primary-color)' }, { ...request, accentColor: '#123456\n' },
  ])('closes instead of forwarding an illegal update (%j)', async input => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    await expect(lease.update!(input as AgentComputerWindowIndicatorRequest)).resolves.toBe(false);
    expect(child.stdin.write).toHaveBeenCalledOnce(); expect(lease.shown).toBe(false);
    child.emit('exit', 0); await expect(lease.closed).resolves.toBe(true); expectDetached(child);
  });

  it('does not evaluate getters in an update request', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    const read = vi.fn(() => request.point);
    const input = { ...request }; Object.defineProperty(input, 'point', { enumerable: true, get: read });
    await expect(lease.update!(input)).resolves.toBe(false);
    expect(read).not.toHaveBeenCalled(); expect(child.stdin.write).toHaveBeenCalledOnce();
    child.emit('close', 0); expectDetached(child);
  });

  it('times out an unacknowledged update and ignores a late ACK without reviving its lease', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    const updating = lease.update!({ ...request, point: { x: -700, y: 600 } });
    let accepted: boolean | undefined; void updating.then(value => { accepted = value; });
    await vi.advanceTimersByTimeAsync(999);
    expect(accepted).toBeUndefined(); expect(lease.shown).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await expect(updating).resolves.toBe(false); expect(lease.shown).toBe(false);
    child.reply();
    await expect(lease.update!(request)).resolves.toBe(false);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(600);
    await expect(lease.closed).resolves.toBe(false);
    child.emit('close', 0); child.reply();
    await expect(lease.closed).resolves.toBe(false);
    expect(lease.shown).toBe(false); expectDetached(child);
  });

  it.each(['abort', 'dispose', 'exit', 'close'] as const)('settles a pending update on %s while keeping closure evidence separate', async ending => {
    const controller = new AbortController(); const { child, pending } = setup(controller.signal);
    child.reply(); const lease = await pending;
    const updating = lease.update!({ ...request, point: { x: -700, y: 600 } });
    let closed: boolean | undefined; void lease.closed.then(value => { closed = value; });
    if (ending === 'abort') controller.abort();
    else if (ending === 'dispose') lease.dispose();
    else child.emit(ending, 0);
    await expect(updating).resolves.toBe(false);
    expect(lease.shown).toBe(false);
    if (ending === 'abort' || ending === 'dispose') {
      expect(closed).toBeUndefined();
      expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
      child.emit('close', 0);
    } else expect(child.kill).not.toHaveBeenCalled();
    await expect(lease.closed).resolves.toBe(true);
    child.reply(); await vi.advanceTimersByTimeAsync(5_000);
    expect(vi.getTimerCount()).toBe(0); expectDetached(child);
  });

  it.each([511, 512])('applies the %i-byte ACK budget to each update, including split lines', async length => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    const updating = lease.update!({ ...request, point: { x: -700, y: 600 } });
    const line = Buffer.from('{"ok":true,"shown":true}\n');
    const bytes = Buffer.concat([Buffer.alloc(length - line.length, 32), line]);
    child.stdout.emit('data', bytes.subarray(0, 300));
    child.stdout.emit('data', bytes.subarray(300));
    await expect(updating).resolves.toBe(length === 511);
    expect(lease.shown).toBe(length === 511);
    lease.dispose(); child.emit('close', 0); expectDetached(child);
  });

  it('accepts repeated ACKed updates and heartbeats without a cumulative output lifetime limit', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    for (let index = 0; index < 50; index += 1) {
      const updating = lease.update!({ ...request, point: { x: -700 + index, y: 600 } });
      child.stdout.emit('data', Buffer.from('{"ok":true,'));
      child.stdout.emit('data', Buffer.from('"shown":true}\n'));
      await expect(updating).resolves.toBe(true);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(lease.shown).toBe(true); expect(child.kill).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(child.stdin.write.mock.calls.filter(([line]) => line === '\n')).toHaveLength(5);
    expect(child.stdin.write.mock.calls.filter(([line]) => line !== '\n')).toHaveLength(51);
    lease.dispose(); child.emit('close', 0); expectDetached(child);
  });

  it.each([{ ok: true, shown: false }, { ok: false, shown: true }, { ok: true, shown: true, extra: true }])('settles refused or invalid update ACKs (%j) without hanging', async receipt => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    const updating = lease.update!({ ...request, point: { x: -700, y: 600 } });
    child.reply(receipt);
    await expect(updating).resolves.toBe(false); expect(lease.shown).toBe(false);
    child.emit('close', 0); await expect(lease.closed).resolves.toBe(true); expectDetached(child);
  });

  it.each(['startup', 'heartbeat', 'update'] as const)('closes on %s input backpressure without mistaking TERM for closure', async stage => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValueOnce(child);
    if (stage === 'startup') child.stdin.write.mockReturnValueOnce(false);
    const pending = showAgentComputerWindowIndicator(request, new AbortController().signal);
    if (stage !== 'startup') child.reply();
    const lease = await pending;
    if (stage === 'heartbeat') {
      child.stdin.write.mockReturnValueOnce(false); await vi.advanceTimersByTimeAsync(1_000);
    } else if (stage === 'update') {
      child.stdin.write.mockReturnValueOnce(false);
      await expect(lease.update!({ ...request, point: { x: -700, y: 600 } })).resolves.toBe(false);
    }
    expect(lease.shown).toBe(false); expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    let closed: boolean | undefined; void lease.closed.then(value => { closed = value; });
    await Promise.resolve(); expect(closed).toBeUndefined();
    child.reply(); child.emit('close', 0);
    await expect(lease.closed).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(5_000); expect(vi.getTimerCount()).toBe(0); expectDetached(child);
  });

  it.each(['\n', '{"ok":true,"shown":true}\n', '{"ok":'])('closes on unsolicited stdout with no outstanding native request (%j)', async bytes => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    child.stdout.emit('data', Buffer.from(bytes));
    expect(lease.shown).toBe(false); expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.emit('close', 0); await expect(lease.closed).resolves.toBe(true); expectDetached(child);
  });

  it('stops excessive post-ready output and drains the pipes without extending its lifetime', async () => {
    const { child, pending } = setup(); child.reply();
    const lease = await pending;
    child.stdout.emit('data', Buffer.alloc(512, 32));
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.stdout.emit('data', Buffer.alloc(1_000_000));
    lease.dispose(); child.emit('close', 0);
    expectDetached(child);
    expect(child.stdout.resume).toHaveBeenCalledOnce();
  });

  it('treats early close and synchronous spawn failure as absent visual feedback', async () => {
    const { child, pending } = setup(); child.emit('close', 64);
    const early = await pending;
    expect(early.shown).toBe(false);
    await expect(early.closed).resolves.toBe(true);
    expect(child.kill).not.toHaveBeenCalled(); expectDetached(child);
    mocks.spawn.mockImplementationOnce(() => { throw new Error('missing helper'); });
    const absent = await showAgentComputerWindowIndicator(request, new AbortController().signal);
    expect(absent.shown).toBe(false);
    await expect(absent.closed).resolves.toBe(true);
  });

  it.each(['parent', 'stdin', 'stdout', 'stderr'] as const)('handles %s errors, EPIPE and repeated disposal without leaking listeners', async source => {
    const { child, pending } = setup();
    const emitter = source === 'parent' ? child : child[source];
    emitter.emit('error', new Error('EPIPE'));
    expect((await pending).shown).toBe(false);
    child.stdin.emit('error', new Error('EPIPE'));
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.emit('close', 1); await vi.advanceTimersByTimeAsync(3_300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]); expectDetached(child);
  });

  it('retains the execution barrier after startup cancellation until actual exit and ignores late readiness', async () => {
    const controller = new AbortController(); const { child, pending } = setup(controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    let finished = false; void pending.then(() => { finished = true; }, () => { finished = true; });
    controller.abort();
    expect(child.stdin.end).toHaveBeenCalledOnce(); expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.reply(); await vi.advanceTimersByTimeAsync(300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(finished).toBe(false);
    child.emit('exit', null, 'SIGKILL'); await rejection; expectDetached(child);
  });

  it('also observes abort after readiness and removes its signal listener when the lease is disposed', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const { child, pending } = setup(controller.signal); child.reply();
    const lease = await pending; controller.abort();
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    lease.dispose(); child.emit('close', 0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expectDetached(child);
  });

  it('does not return a lease when ready and abort race within the same turn', async () => {
    const controller = new AbortController(); const { child, pending } = setup(controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    child.reply(); controller.abort();
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]); child.emit('close', 0);
    await rejection; expectDetached(child);
  });

  it('reports unconfirmed startup-cancel cleanup distinctly after the full bounded wait, with no late revival', async () => {
    const controller = new AbortController(); const { child, pending } = setup(controller.signal);
    const rejection = expect(pending).rejects.toBeInstanceOf(AgentComputerWindowIndicatorCloseError);
    let finished = false; void pending.then(() => { finished = true; }, () => { finished = true; });
    controller.abort(); child.reply();
    await vi.advanceTimersByTimeAsync(599); expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await rejection;
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    child.emit('exit', 0); child.reply(); controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledTimes(2); expectDetached(child);
  });

  it('handles a close synchronously triggered by EOF without subsequently signalling a closed child', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    child.stdin.end.mockImplementationOnce(() => { child.emit('close', 0); });
    lease.dispose(); await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).not.toHaveBeenCalled(); expectDetached(child);
  });

  it.each(['exit', 'close'] as const)('confirms real %s during the bounded wait after KILL and releases every lifecycle resource', async event => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    lease.dispose();
    await vi.advanceTimersByTimeAsync(300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    let confirmed: boolean | undefined;
    void lease.closed.then(value => { confirmed = value; });
    await vi.advanceTimersByTimeAsync(299);
    expect(confirmed).toBeUndefined();
    child.emit(event, null, 'SIGKILL');
    await expect(lease.closed).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.stdin.destroy).toHaveBeenCalledOnce();
    expect(child.stdout.destroy).toHaveBeenCalledOnce();
    expect(child.stderr.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0); expectDetached(child);
  });

  it.each(['refused', 'invalid', 'error'] as const)('retains the spawned %s child closure even when the intention was never shown', async failure => {
    const { child, pending } = setup();
    if (failure === 'refused') child.reply({ ok: true, shown: false });
    else if (failure === 'invalid') child.reply({ ok: true });
    else child.emit('error', new Error('spawn or pipe error'));
    const lease = await pending;
    expect(lease.shown).toBe(false);
    let confirmed: boolean | undefined;
    void lease.closed.then(value => { confirmed = value; });
    await Promise.resolve(); expect(confirmed).toBeUndefined();
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.emit('exit', 1);
    await expect(lease.closed).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0); expectDetached(child);
  });

  it('never upgrades an unconfirmed KILL to closed after its bounded deadline or a late exit', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    child.kill.mockImplementation(() => { throw new Error('signal rejected'); });
    lease.dispose();
    await vi.advanceTimersByTimeAsync(599);
    let confirmed: boolean | undefined;
    void lease.closed.then(value => { confirmed = value; });
    await Promise.resolve(); expect(confirmed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await expect(lease.closed).resolves.toBe(false);
    child.reply(); child.emit('exit', 0); child.emit('close', 0); lease.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(lease.closed).resolves.toBe(false);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(vi.getTimerCount()).toBe(0); expectDetached(child);
  });

  it.each(['close', 'hard-kill'] as const)('absorbs queued errors from every terminated emitter after %s without resurrecting or signalling again', async ending => {
    const controller = new AbortController(); const { child, pending } = setup(controller.signal);
    if (ending === 'close') child.emit('close', 0);
    else await vi.advanceTimersByTimeAsync(1_600);
    const lease = await pending;
    expect(lease.shown).toBe(false);
    await expect(lease.closed).resolves.toBe(ending === 'close');
    const signalsBefore = child.kill.mock.calls.slice();
    for (const emitter of [child, child.stdin, child.stdout, child.stderr]) {
      expect(() => emitter.emit('error', new Error('late queued EPIPE'))).not.toThrow();
    }
    child.reply(); child.emit('close', 0); controller.abort(); lease.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(lease.closed).resolves.toBe(ending === 'close');
    expect(child.kill.mock.calls).toEqual(signalsBefore);
    expectDetached(child);
  });

  it('absorbs errors synchronously emitted by destroy and later queued errors after an accepted lease is hard-killed', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.destroy.mockImplementationOnce(() => { stream.emit('error', new Error('destroy EPIPE')); });
    }
    lease.dispose(); await vi.advanceTimersByTimeAsync(600);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    await expect(lease.closed).resolves.toBe(false);
    for (const emitter of [child, child.stdin, child.stdout, child.stderr]) {
      expect(() => emitter.emit('error', new Error('queued EPIPE'))).not.toThrow();
    }
    lease.dispose(); child.emit('close', 0);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expectDetached(child);
  });

  it('does not launch unsupported platforms or requests that were already aborted', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const unsupported = await showAgentComputerWindowIndicator(request, new AbortController().signal);
    expect(unsupported.shown).toBe(false);
    await expect(unsupported.closed).resolves.toBe(true);
    const controller = new AbortController(); controller.abort('explicit stop');
    await expect(showAgentComputerWindowIndicator(request, controller.signal)).rejects.toBe('explicit stop');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
