import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerWindowIdentity } from './desktop-computer';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), app: {
  isPackaged: false, getAppPath: vi.fn(() => '/isolated/omniflow'), setAccessibilitySupportEnabled: vi.fn(),
}, getSources: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('electron', () => ({ app: mocks.app, desktopCapturer: { getSources: mocks.getSources }, screen: {}, systemPreferences: {} }));

import { AgentComputerWindowInputError, getAgentComputerWindowInputStatus, inputAgentComputerWindow,
  type AgentComputerWindowInputRequest } from './window-input';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const window: AgentComputerWindowIdentity = {
  windowId: 81, pid: 31_042, processStartedAt: 1_700_000_000_000_000, layer: 0,
  bounds: { x: -1_440, y: 120, width: 1_440, height: 900 }, title: 'Fixture window',
};
const request: AgentComputerWindowInputRequest = {
  window, profile: 'appkit-fixture-v1', operation: 'rightClick', point: { x: -800, y: 500 },
};
const success = { ok: true, dispatched: true, method: 'CGEventPostToPid', eventCount: 2, releaseSent: true };
const ready = { ok: true, ready: true, profile: 'appkit-fixture-v1', operations: ['shortcut', 'rightClick', 'doubleClick', 'drag'] };
const failure = { ok: false, dispatched: false, error: { code: 'target_changed', message: 'The frozen window changed.' } };

class HelperProcess extends EventEmitter {
  stdout = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  stderr = { resume: vi.fn() };
  kill = vi.fn(() => true);
  reply(value: unknown, code = 0) {
    this.stdout.emit('data', Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
    this.emit('close', code);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', platformDescriptor);
});

describe('directed window input adapter', () => {
  it('checks only a frozen window and returns a private profile with explicit capabilities', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerWindowInputStatus(window, new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(expect.stringMatching(/\/omniflow-click$/u), ['--window-input-check'], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual({ window });
    child.reply(ready);
    await expect(pending).resolves.toEqual({ ready: true, profile: 'appkit-fixture-v1', operations: ready.operations });
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it('accepts the exact native-tested TextEdit profile without widening the event route', async () => {
    const check = new HelperProcess(); mocks.spawn.mockReturnValueOnce(check);
    const selectedProfile = 'textedit-415-25f84-v1';
    const checking = getAgentComputerWindowInputStatus(window, new AbortController().signal);
    check.reply({ ...ready, profile: selectedProfile });
    await expect(checking).resolves.toEqual({ ready: true, profile: selectedProfile, operations: ready.operations });
    const child = new HelperProcess(); mocks.spawn.mockReturnValueOnce(child);
    const input = { ...request, profile: selectedProfile };
    const dispatching = inputAgentComputerWindow(input, new AbortController().signal);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(input);
    child.reply(success);
    await expect(dispatching).resolves.toMatchObject({ dispatched: true, releaseSent: true });
    expect(mocks.spawn.mock.calls.map(call => call[1])).toEqual([['--window-input-check'], ['--window-input']]);
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it.each(['target_frontmost', 'user_input_active', 'unsupported_receiver', 'focused_window_mismatch'])('preserves read-only %s refusal with no input capability', async reason => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerWindowInputStatus(window, new AbortController().signal);
    child.reply({ ok: true, ready: false, operations: [], reason });
    await expect(pending).resolves.toEqual({ ready: false, operations: [], reason });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('treats an old helper without the fixed mode as unsupported without another mode', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerWindowInputStatus(window, new AbortController().signal);
    child.reply({ ...failure, error: { code: 'invalid_arguments', message: 'Use a supported fixed helper mode.' } }, 64);
    await expect(pending).resolves.toEqual({ ready: false, operations: [], reason: 'unsupported_receiver' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    { ...ready, profile: 'unknown-v1' }, { ...ready, profile: undefined }, { ...ready, operations: [] },
    { ...ready, operations: ['drag', 'drag'] }, { ...ready, reason: 'unsupported_receiver' }, { ...ready, script: 'click()' },
    { ok: true, ready: false, operations: ['drag'] }, { ok: true, ready: false, operations: [], profile: 'appkit-fixture-v1' },
    { ok: true, ready: false, operations: [], reason: 'dynamic reason' },
  ])('rejects a malformed check receipt %j', async receipt => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerWindowInputStatus(window, new AbortController().signal);
    child.reply(receipt);
    await expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched', releaseState: 'not-required' });
  });

  it('forwards a negative screen point and frozen profile through one PID-directed mode', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow(request, new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), ['--window-input'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(request);
    child.reply(success);
    await expect(pending).resolves.toEqual({ dispatched: true, method: 'CGEventPostToPid', eventCount: 2, releaseSent: true });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('normalizes a finite shortcut without clipboard, focus or arbitrary text', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const input = { window, profile: request.profile, operation: 'shortcut', shortcut: { key: 'a', modifiers: ['shift', 'command', 'command'] } };
    const pending = inputAgentComputerWindow(input as AgentComputerWindowInputRequest, new AbortController().signal);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual({ ...input, shortcut: { key: 'a', modifiers: ['command', 'shift'] } });
    child.reply(success);
    await expect(pending).resolves.toMatchObject({ dispatched: true });
  });

  it.each([
    { ...request, operation: 'doubleClick' as const, count: 4 },
    { ...request, operation: 'drag' as const, endPoint: { x: -600, y: 550 }, durationMs: 500, count: 17 },
  ])('dispatches a bounded $operation sequence', async ({ count, ...input }) => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow(input, new AbortController().signal);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(input);
    child.reply({ ...success, eventCount: count });
    await expect(pending).resolves.toMatchObject({ eventCount: count, releaseSent: true });
  });

  it.each([
    { ...request, profile: 'unchecked' }, { ...request, profile: undefined }, { ...request, operation: 'globalClick' },
    { ...request, point: { x: 0, y: 500 } }, { ...request, point: { x: NaN, y: 500 } },
    { ...request, window: { ...window, bounds: { ...window.bounds, x: 10_000_000 } }, point: { x: 10_000_001, y: 500 } },
    { ...request, point: { x: -800, y: 500, button: 'left' } }, { ...request, durationMs: 500 },
    { ...request, window: { ...window, pid: 0 } }, { ...request, window: { ...window, layer: 1 } },
    { ...request, window: { ...window, processStartedAt: null } },
    { ...request, operation: 'shortcut', point: undefined, shortcut: { key: 'A', modifiers: [] } },
    { window, profile: request.profile, operation: 'shortcut', shortcut: { key: 'a', modifiers: [], text: 'secret' } },
    { window, profile: request.profile, operation: 'shortcut', shortcut: { key: 'a', modifiers: ['meta'] } },
    { ...request, operation: 'drag', endPoint: { x: -600, y: 550 }, durationMs: 1_001 },
    { ...request, operation: 'drag', endPoint: { x: -600, y: 550 }, durationMs: 99 },
    { ...request, operation: 'drag', endPoint: request.point, durationMs: 300 },
  ])('rejects invalid or extra input %j before launching', async input => {
    await expect(inputAgentComputerWindow(input as AgentComputerWindowInputRequest, new AbortController().signal)).rejects.toMatchObject({
      dispatchState: 'not-dispatched', releaseState: 'not-required',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('rejects accessor data without invoking it', async () => {
    const read = vi.fn(() => request.point);
    const input = { ...request }; Object.defineProperty(input, 'point', { enumerable: true, get: read });
    await expect(inputAgentComputerWindow(input, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(read).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([
    '{', { ...success, dispatched: 'unknown' }, { ...success, method: 'CGEventPost' }, { ...success, releaseSent: false },
    { ...success, eventCount: 0 }, { ...success, eventCount: 4 }, { ...success, unexpected: true },
    { ok: false, error: failure.error }, { ...failure, dispatched: 'unknown', releaseSent: true },
  ])('keeps malformed or ambiguous receipt %j unknown with release unconfirmed and no fallback', async receipt => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow(request, new AbortController().signal);
    child.reply(receipt);
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('keeps a complete native preflight refusal uncommitted', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow(request, new AbortController().signal);
    child.reply(failure, 70);
    await expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched', releaseState: 'not-required' });
  });

  it.each([true, false])('retains an unknown action independently of releaseSent=%s', async releaseSent => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow(request, new AbortController().signal);
    child.reply({ ...failure, dispatched: 'unknown', method: 'CGEventPostToPid', eventCount: 2, releaseSent }, 70);
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: releaseSent ? 'confirmed' : 'unconfirmed' });
  });

  it('sends SIGTERM on cancellation and waits for matching up and the dispatched receipt', async () => {
    vi.useFakeTimers();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = inputAgentComputerWindow(request, controller.signal);
    child.emit('spawn'); controller.abort();
    let settled = false; void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(settled).toBe(false);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.reply(success);
    await expect(pending).resolves.toMatchObject({ dispatched: true, releaseSent: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
  });

  it('settles cancelled drag unknown but confirms native up separately', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = inputAgentComputerWindow({ ...request, operation: 'drag', endPoint: { x: -600, y: 550 }, durationMs: 500 }, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'confirmed' });
    controller.abort();
    child.reply({ ...failure, dispatched: 'unknown', error: { code: 'cancelled', message: 'Stopped event sequence.' },
      method: 'CGEventPostToPid', eventCount: 5, releaseSent: true }, 70);
    await rejection;
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
  });

  it('waits at most two seconds for release before hard kill and reports unconfirmed unknown', async () => {
    vi.useFakeTimers();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = inputAgentComputerWindow(request, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed', message: expect.stringContaining('未确认') });
    child.emit('spawn'); controller.abort();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    child.reply(success);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('uses the same graceful release on output overflow and timeout', async () => {
    vi.useFakeTimers();
    for (const kind of ['overflow', 'timeout']) {
      const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
      const pending = inputAgentComputerWindow(request, new AbortController().signal);
      const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
      if (kind === 'overflow') child.stdout.emit('data', Buffer.alloc(4_097));
      else await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
      await vi.advanceTimersByTimeAsync(2_000);
      await rejection;
      expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    }
  });

  it('never starts an already cancelled request or an unsupported platform', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(inputAgentComputerWindow(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    await expect(inputAgentComputerWindow(request, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('cancels a check promptly and ignores its late ready receipt', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = getAgentComputerWindowInputStatus(window, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejection;
    child.reply(ready);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
  });

  it('keeps a synchronous spawn error definitely unstarted', async () => {
    mocks.spawn.mockImplementation(() => { throw new Error('spawn unavailable'); });
    await expect(inputAgentComputerWindow(request, new AbortController().signal)).rejects.toBeInstanceOf(AgentComputerWindowInputError);
    await expect(inputAgentComputerWindow(request, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched', releaseState: 'not-required' });
  });
});
