import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerWindowIdentity } from './desktop-computer';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), helperPath: vi.fn(() => '/isolated/native/omniflow-click') }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./desktop-computer', () => ({ resolveAgentComputerHelperPath: mocks.helperPath }));

import { showAgentComputerWindowIndicator, type AgentComputerWindowIndicatorRequest } from './window-indicator';

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

describe('bounded visual window indicator adapter', () => {
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
    expect(child.stdin.end).not.toHaveBeenCalled();
    lease.dispose(); lease.dispose();
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.emit('close', 0);
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
    expect((await showAgentComputerWindowIndicator(input as AgentComputerWindowIndicatorRequest, new AbortController().signal)).shown).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('refuses getters and symbol fields without evaluating request code', async () => {
    const read = vi.fn(() => request.point);
    const input = { ...request }; Object.defineProperty(input, 'point', { enumerable: true, get: read });
    expect((await showAgentComputerWindowIndicator(input, new AbortController().signal)).shown).toBe(false);
    expect((await showAgentComputerWindowIndicator({ ...request, [Symbol('input')]: true }, new AbortController().signal)).shown).toBe(false);
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
    expect((await pending).shown).toBe(false);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
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
    await vi.advanceTimersByTimeAsync(300);
    expectDetached(child);
  });

  it('times out startup at one second and cannot be revived by a late ready line', async () => {
    const { child, pending } = setup();
    await vi.advanceTimersByTimeAsync(999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).shown).toBe(false);
    child.reply();
    await vi.advanceTimersByTimeAsync(300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expectDetached(child);
  });

  it('caps the entire lease lifetime at three seconds from spawn, including startup', async () => {
    const { child, pending } = setup();
    await vi.advanceTimersByTimeAsync(900); child.reply();
    const lease = await pending;
    await vi.advanceTimersByTimeAsync(2_099); expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    lease.dispose(); await vi.advanceTimersByTimeAsync(300); lease.dispose();
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.stdout.destroy).toHaveBeenCalledOnce();
    expectDetached(child);
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
    expect((await pending).shown).toBe(false);
    expect(child.kill).not.toHaveBeenCalled(); expectDetached(child);
    mocks.spawn.mockImplementationOnce(() => { throw new Error('missing helper'); });
    expect((await showAgentComputerWindowIndicator(request, new AbortController().signal)).shown).toBe(false);
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

  it('rejects cancellation immediately, closes the helper and ignores late readiness', async () => {
    const controller = new AbortController(); const { child, pending } = setup(controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejection;
    expect(child.stdin.end).toHaveBeenCalledOnce(); expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.reply(); await vi.advanceTimersByTimeAsync(300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]); expectDetached(child);
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
    child.reply(); controller.abort(); await rejection;
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]); child.emit('close', 0); expectDetached(child);
  });

  it('handles a close synchronously triggered by EOF without subsequently signalling a closed child', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    child.stdin.end.mockImplementationOnce(() => { child.emit('close', 0); });
    lease.dispose(); await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).not.toHaveBeenCalled(); expectDetached(child);
  });

  it.each(['close', 'hard-kill'] as const)('absorbs queued errors from every terminated emitter after %s without resurrecting or signalling again', async ending => {
    const controller = new AbortController(); const { child, pending } = setup(controller.signal);
    if (ending === 'close') child.emit('close', 0);
    else await vi.advanceTimersByTimeAsync(1_300);
    const lease = await pending;
    expect(lease.shown).toBe(false);
    const signalsBefore = child.kill.mock.calls.slice();
    for (const emitter of [child, child.stdin, child.stdout, child.stderr]) {
      expect(() => emitter.emit('error', new Error('late queued EPIPE'))).not.toThrow();
    }
    child.reply(); child.emit('close', 0); controller.abort(); lease.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill.mock.calls).toEqual(signalsBefore);
    expectDetached(child);
  });

  it('absorbs errors synchronously emitted by destroy and later queued errors after an accepted lease is hard-killed', async () => {
    const { child, pending } = setup(); child.reply(); const lease = await pending;
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.destroy.mockImplementationOnce(() => { stream.emit('error', new Error('destroy EPIPE')); });
    }
    lease.dispose(); await vi.advanceTimersByTimeAsync(300);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    for (const emitter of [child, child.stdin, child.stdout, child.stderr]) {
      expect(() => emitter.emit('error', new Error('queued EPIPE'))).not.toThrow();
    }
    lease.dispose(); child.emit('close', 0);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expectDetached(child);
  });

  it('does not launch unsupported platforms or requests that were already aborted', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    expect((await showAgentComputerWindowIndicator(request, new AbortController().signal)).shown).toBe(false);
    const controller = new AbortController(); controller.abort('explicit stop');
    await expect(showAgentComputerWindowIndicator(request, controller.signal)).rejects.toBe('explicit stop');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
