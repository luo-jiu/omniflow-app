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
const focusToken = 'a'.repeat(64);
const ready = { ok: true, ready: true, profile: 'appkit-fixture-v1', operations: ['shortcut', 'rightClick', 'doubleClick', 'drag'] };
const failure = { ok: false, dispatched: false, error: { code: 'target_changed', message: 'The frozen window changed.' } };

class HelperProcess extends EventEmitter {
  stdout = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  stderr = { resume: vi.fn() };
  progress = new EventEmitter();
  stdio = [this.stdin, this.stdout, this.stderr, this.progress];
  kill = vi.fn(() => true);
  pointer(...events: unknown[]) {
    this.progress.emit('data', Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n'));
  }
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
  it.each([
    { operations: ['typeText'] },
    { operations: ['typeText'], focusToken: 'A'.repeat(64) },
    { operations: ['typeText'], focusToken: 'a'.repeat(63) },
    { operations: ['click'], focusToken },
    { operations: [], ready: false, focusToken },
  ])('rejects missing, malformed or inapplicable private focus receipts %j', async receipt => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerWindowInputStatus(window, new AbortController().signal);
    child.reply({ ok: true, ready: true, profile: 'directed-v1', ...receipt });
    await expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched', releaseState: 'not-required' });
  });

  it.each([
    { operation: 'typeText', text: 'x' },
    { operation: 'typeText', text: 'x', focusToken: 'z'.repeat(64) },
    { operation: 'click', point: request.point, focusToken },
    { operation: 'shortcut', shortcut: { key: 'a', modifiers: [] }, focusToken },
  ])('rejects missing or unexpected text receiver binding before dispatch %j', async operation => {
    await expect(inputAgentComputerWindow({ window, profile: 'directed-v1', ...operation } as AgentComputerWindowInputRequest,
      new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('accepts a generic directed receiver only with its explicit seven-operation readiness receipt', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerWindowInputStatus(window, new AbortController().signal);
    const operations = ['shortcut', 'rightClick', 'doubleClick', 'drag', 'click', 'typeText', 'scroll'];
    child.reply({ ok: true, ready: true, profile: 'directed-v1', operations, focusToken });
    await expect(pending).resolves.toEqual({ ready: true, profile: 'directed-v1', operations, focusToken });
  });

  it.each([
    { operation: 'click', point: request.point, eventCount: 2 },
    { operation: 'scroll', point: request.point, deltaX: 0, deltaY: -400, eventCount: 1 },
    { operation: 'typeText', text: '界🌟\r\n\t'.repeat(6), eventCount: 4 },
    { operation: 'typeText', text: '🌟'.repeat(4096), eventCount: 820 },
  ] as const)('dispatches bounded $operation through the same exact-window helper contract', async fields => {
    const { eventCount, ...operation } = fields;
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const input = { window, profile: 'directed-v1', ...operation, ...(operation.operation === 'typeText' ? { focusToken } : {}) };
    const pending = inputAgentComputerWindow(input, new AbortController().signal);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(input);
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['--window-input']);
    child.reply({ ...success, eventCount });
    await expect(pending).resolves.toEqual({ dispatched: true, method: 'CGEventPostToPid', eventCount, releaseSent: true });
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it.each([
    { operation: 'typeText', text: '' }, { operation: 'typeText', text: '\ud800' },
    { operation: 'typeText', text: 'x'.repeat(4097) }, { operation: 'typeText', text: 'x\0' },
    { operation: 'typeText', text: 'x', point: request.point },
    { operation: 'click', point: request.point, text: 'private' },
    { operation: 'scroll', point: request.point, deltaX: 0, deltaY: 0 },
    { operation: 'scroll', point: request.point, deltaX: 0, deltaY: -1001 },
    { operation: 'scroll', point: request.point, deltaX: 0.1, deltaY: -100 },
  ])('rejects malformed new input before spawning a helper', async operation => {
    await expect(inputAgentComputerWindow({ window, profile: 'directed-v1', ...operation, ...(operation.operation === 'typeText' ? { focusToken } : {}) } as AgentComputerWindowInputRequest,
      new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched', releaseState: 'not-required' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([
    { operation: { operation: 'scroll', point: request.point, deltaX: 1, deltaY: 0 }, eventCount: 2 },
    { operation: { operation: 'typeText', text: '🌟'.repeat(11) }, eventCount: 2 },
    { operation: { operation: 'typeText', text: 'x' }, eventCount: 820 },
    { operation: { operation: 'click', point: request.point }, eventCount: 820 },
  ])('keeps operation-specific event counts and treats contradictory success as unknown', async ({ operation, eventCount }) => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow({ window, profile: 'directed-v1', ...operation, ...(operation.operation === 'typeText' ? { focusToken } : {}) } as AgentComputerWindowInputRequest,
      new AbortController().signal);
    child.reply({ ...success, eventCount });
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
  });

  it('extends only Unicode text helper execution beyond the existing five-second deadline', async () => {
    vi.useFakeTimers();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow({ window, profile: 'directed-v1', operation: 'typeText', text: '中文', focusToken }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(child.kill).not.toHaveBeenCalled();
    child.reply(success);
    await expect(pending).resolves.toMatchObject({ dispatched: true, releaseSent: true });
  });

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

  it('keeps the main-only right-click completion association and its observed handoff separate from the receiver', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const completionWindow = { ...window, windowId: 82 };
    const input = { ...request, profile: 'directed-v1', completionWindow };
    const pending = inputAgentComputerWindow(input, new AbortController().signal);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(input);
    child.reply({ ...success, completionWindowId: 82 });
    await expect(pending).resolves.toEqual({ dispatched: true, method: 'CGEventPostToPid', eventCount: 2,
      releaseSent: true, completionWindowId: 82 });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    { profile: 'appkit-fixture-v1' }, { operation: 'click' }, { operation: 'doubleClick' },
    { completionWindow: { ...window, windowId: window.windowId } },
    { completionWindow: { ...window, windowId: 82, pid: window.pid + 1 } },
    { completionWindow: { ...window, windowId: 82, processStartedAt: window.processStartedAt! + 1 } },
    { completionWindow: { ...window, windowId: 82, layer: 102 } },
    { completionWindow: { ...window, windowId: 82, bounds: { ...window.bounds, x: window.bounds.x - 1 } } },
    { completionWindow: undefined },
  ])('rejects an unbound or inapplicable completion association before spawning %j', async changed => {
    const input = { ...request, profile: 'directed-v1', completionWindow: { ...window, windowId: 82 }, ...changed };
    await expect(inputAgentComputerWindow(input as AgentComputerWindowInputRequest, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched', releaseState: 'not-required' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([82, 0, -1, '82'])('refuses unsolicited completion receipt %j without admitting another receiver', async completionWindowId => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow({ ...request, profile: 'directed-v1' }, new AbortController().signal);
    child.reply({ ...success, completionWindowId });
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
  });

  it('refuses a handoff receipt for a different completion window', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = inputAgentComputerWindow({ ...request, profile: 'directed-v1', completionWindow: { ...window, windowId: 82 } },
      new AbortController().signal);
    child.reply({ ...success, completionWindowId: 83 });
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
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

  it('streams split and coalesced posted pointer frames on fd3 without changing the final receipt', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const feedback = vi.fn();
    const input = { ...request, operation: 'drag' as const, endPoint: { x: -600, y: 550 }, durationMs: 100 };
    const pending = inputAgentComputerWindow(input, new AbortController().signal, feedback);
    expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), ['--window-input'], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: { ...process.env, OMNIFLOW_WINDOW_INPUT_POINTER_FD: '3' },
    });
    const down = { phase: 'down', point: input.point, sequence: 1 };
    const move = { phase: 'move', point: { x: -725.5, y: 512.25 }, sequence: 2 };
    const up = { phase: 'up', point: move.point, sequence: 3 };
    const first = Buffer.from(JSON.stringify(down) + '\n');
    child.progress.emit('data', first.subarray(0, 12));
    expect(feedback).not.toHaveBeenCalled();
    child.progress.emit('data', Buffer.concat([first.subarray(12), Buffer.from(JSON.stringify(move) + '\n' + JSON.stringify(up) + '\n')]));
    expect(feedback.mock.calls.map(call => call[0])).toEqual([down, move, up]);
    child.reply({ ...success, eventCount: 10 });
    await expect(pending).resolves.toEqual({ dispatched: true, method: 'CGEventPostToPid', eventCount: 10, releaseSent: true });
    child.pointer({ ...down, sequence: 4 });
    expect(feedback).toHaveBeenCalledTimes(3);
  });

  it.each([
    { phase: 'up', point: request.point, sequence: 1 },
    { phase: 'move', point: request.point, sequence: 1 },
    { phase: 'down', point: request.point, sequence: 2 },
    { phase: 'down', point: request.point, sequence: 1.5 },
    { phase: 'down', point: { x: 0, y: 500 }, sequence: 1 },
    { phase: 'down', point: { x: -801, y: 500 }, sequence: 1 },
    { phase: 'down', point: { x: -800, y: null }, sequence: 1 },
    { phase: 'down', point: { ...request.point, extra: 1 }, sequence: 1 },
    { phase: 'down', point: request.point, sequence: 1, extra: true },
    { phase: 'click', point: request.point, sequence: 1 },
  ])('silences malformed pointer feedback %j independently of the final input result', async event => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const feedback = vi.fn();
    const pending = inputAgentComputerWindow(request, new AbortController().signal, feedback);
    child.pointer(event);
    child.pointer({ phase: 'down', point: request.point, sequence: 1 });
    expect(feedback).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    child.reply(success);
    await expect(pending).resolves.toMatchObject({ releaseSent: true });
  });

  it.each([
    { phase: 'down', point: request.point, sequence: 2 },
    { phase: 'move', point: request.point, sequence: 2 },
    { phase: 'up', point: { x: -799, y: 500 }, sequence: 2 },
    { phase: 'up', point: request.point, sequence: 3 },
  ])('checks phase, location and sequence after down for %j', async event => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const feedback = vi.fn();
    const pending = inputAgentComputerWindow(request, new AbortController().signal, feedback);
    child.pointer({ phase: 'down', point: request.point, sequence: 1 }, event,
      { phase: 'up', point: request.point, sequence: 2 });
    expect(feedback).toHaveBeenCalledTimes(1);
    child.reply(success);
    await expect(pending).resolves.toMatchObject({ releaseSent: true });
  });

  it('permits both double-click pairs but bounds feedback to the approved operation', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const feedback = vi.fn();
    const pending = inputAgentComputerWindow({ ...request, operation: 'doubleClick' }, new AbortController().signal, feedback);
    const events = ['down', 'up', 'down', 'up'].map((phase, index) => ({ phase, point: request.point, sequence: index + 1 }));
    child.pointer(...events, { phase: 'down', point: request.point, sequence: 5 });
    expect(feedback.mock.calls.map(call => call[0])).toEqual(events);
    child.reply({ ...success, eventCount: 4 });
    await expect(pending).resolves.toMatchObject({ eventCount: 4 });
  });

  it.each(['frame', 'total', 'invalid-json', 'error', 'end'] as const)('drains %s feedback failure without killing input or changing receipt classification', async kind => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const feedback = vi.fn();
    const pending = inputAgentComputerWindow(request, new AbortController().signal, feedback);
    if (kind === 'error') child.progress.emit('error', new Error('EPIPE'));
    else if (kind === 'end') { child.progress.emit('data', Buffer.from('{')); child.progress.emit('end'); }
    else child.progress.emit('data', Buffer.from(kind === 'frame' ? ' '.repeat(257) : kind === 'total' ? ' '.repeat(16_385) : '{\n'));
    child.pointer({ phase: 'down', point: request.point, sequence: 1 });
    expect(feedback).not.toHaveBeenCalled();
    expect(child.progress.listenerCount('data')).toBe(1);
    expect(child.kill).not.toHaveBeenCalled();
    child.reply({ ...failure, dispatched: 'unknown', method: 'CGEventPostToPid', eventCount: 2, releaseSent: true }, 70);
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'confirmed' });
  });

  it('keeps callback errors isolated and drains later frames through paired release', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const feedback = vi.fn(() => { throw new Error('indicator gone'); });
    const pending = inputAgentComputerWindow(request, new AbortController().signal, feedback);
    child.pointer({ phase: 'down', point: request.point, sequence: 1 }, { phase: 'up', point: request.point, sequence: 2 });
    expect(feedback).toHaveBeenCalledOnce();
    expect(child.progress.listenerCount('data')).toBe(1);
    expect(child.kill).not.toHaveBeenCalled();
    child.reply(success);
    await expect(pending).resolves.toMatchObject({ releaseSent: true });
  });

  it('drops feedback immediately on cancellation but still waits for and preserves the native release receipt', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const feedback = vi.fn();
    const controller = new AbortController();
    const pending = inputAgentComputerWindow(request, controller.signal, feedback);
    child.pointer({ phase: 'down', point: request.point, sequence: 1 });
    controller.abort();
    child.pointer({ phase: 'up', point: request.point, sequence: 2 });
    expect(feedback).toHaveBeenCalledOnce();
    expect(child.progress.listenerCount('data')).toBe(1);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.reply(success);
    await expect(pending).resolves.toMatchObject({ dispatched: true, releaseSent: true });
  });

  it('rejects pointer feedback for a keyboard-only shortcut without affecting its receipt', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const feedback = vi.fn();
    const pending = inputAgentComputerWindow({ window, profile: request.profile, operation: 'shortcut',
      shortcut: { key: 'escape', modifiers: [] } }, new AbortController().signal, feedback);
    child.pointer({ phase: 'down', point: request.point, sequence: 1 });
    expect(feedback).not.toHaveBeenCalled();
    child.reply(success);
    await expect(pending).resolves.toMatchObject({ releaseSent: true });
  });
});
