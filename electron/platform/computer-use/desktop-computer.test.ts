import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  app: { isPackaged: false, getAppPath: vi.fn(() => '/isolated/omniflow'), setAccessibilitySupportEnabled: vi.fn() },
  getSources: vi.fn(),
  getMediaAccessStatus: vi.fn(() => 'granted'),
  getPrimaryDisplay: vi.fn(),
  getAllDisplays: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('electron', () => ({
  app: mocks.app,
  desktopCapturer: { getSources: mocks.getSources },
  screen: { getPrimaryDisplay: mocks.getPrimaryDisplay, getAllDisplays: mocks.getAllDisplays },
  systemPreferences: { getMediaAccessStatus: mocks.getMediaAccessStatus },
}));

import {
  captureAgentComputerDisplay,
  captureAgentComputerWindow,
  clickAgentComputerPoint,
  setAgentComputerText,
  scrollAgentComputerControl,
  getAgentComputerTargets,
  getAgentComputerWindows,
  getAgentComputerWindowTarget,
  resolveAgentComputerHelperPath,
  statusAgentComputerClick,
  getAgentComputerParentActivity,
  type AgentComputerDisplay,
  type AgentComputerCandidate,
  type AgentComputerSetTextRequest,
  type AgentComputerScrollRequest,
  type AgentComputerPoint,
  type AgentComputerTarget,
  type AgentComputerSharedWindow,
  type AgentComputerWindowIdentity,
  type AgentComputerObservationScope,
} from './desktop-computer';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
const resourcesPath = '/isolated/OmniFlow.app/Contents/Resources';
const display: AgentComputerDisplay = {
  id: '42', label: 'Isolated screen',
  bounds: { x: -1440, y: 120, width: 1440, height: 900 }, scaleFactor: 2,
};
const point: AgentComputerPoint = {
  x: -800, y: 500, button: 'left', clickCount: 1,
  target: {
    window: { windowId: 84, pid: 31042, processStartedAt: 1_700_000_000_000_000, layer: 0, bounds: { ...display.bounds }, title: 'Isolated window' },
    candidate: { path: [0, 3], role: 'AXButton', title: 'Toggle fixture', bounds: { x: -850, y: 480, width: 100, height: 40 } },
  },
};

function windowTarget(overrides: Partial<AgentComputerTarget> = {}): AgentComputerTarget {
  return {
    ...point.target.window, bounds: { ...point.target.window.bounds },
    candidates: [{ ...point.target.candidate, path: [...point.target.candidate.path], bounds: { ...point.target.candidate.bounds } }],
    ...overrides,
  };
}

function pointWithWindow(fields: Record<string, unknown>): unknown {
  return { ...point, target: { ...point.target, window: { ...point.target.window, ...fields } } };
}

function pointWithCandidate(fields: Record<string, unknown>): unknown {
  return { ...point, target: { ...point.target, candidate: { ...point.target.candidate, ...fields } } };
}

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

function thumbnail(bytes = 'isolated-png', empty = false) {
  return { isEmpty: vi.fn(() => empty), toPNG: vi.fn(() => Buffer.from(bytes)) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function observeTargetReceipt(receipt: unknown) {
  const child = new HelperProcess();
  mocks.spawn.mockReturnValue(child);
  const pending = getAgentComputerTargets(display, new AbortController().signal);
  child.reply(receipt);
  return pending;
}

function sharedWindow(overrides: Partial<AgentComputerSharedWindow> = {}): AgentComputerSharedWindow {
  return { ...point.target.window, applicationLabel: 'Fixture app', windowLabel: 'Fixture window', ...overrides };
}

const pngFixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF7sAAAAASUVORK5CYII=', 'base64');

function captureReceipt(overrides: Record<string, unknown> = {}) {
  return { ok: true, window: point.target.window, pngBase64: pngFixture.toString('base64'), width: 1, height: 1, ...overrides };
}

function windowHelperReceipt(mode: 'windows' | 'target' | 'capture', receipt: unknown) {
  const child = new HelperProcess();
  mocks.spawn.mockReturnValue(child);
  const pending = mode === 'windows' ? getAgentComputerWindows(new AbortController().signal)
    : mode === 'target' ? getAgentComputerWindowTarget(point.target.window, new AbortController().signal)
    : captureAgentComputerWindow(point.target.window, new AbortController().signal);
  child.reply(receipt);
  return pending;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath });
  mocks.app.isPackaged = false;
  mocks.getMediaAccessStatus.mockReturnValue('granted');
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', platformDescriptor);
  if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor);
  else Reflect.deleteProperty(process, 'resourcesPath');
});

describe('desktop computer native helper', () => {
  it('resolves only the fixed development or packaged helper location', () => {
    expect(resolveAgentComputerHelperPath()).toBe(path.join('/isolated/omniflow', 'build/native/computer-use', `darwin-${process.arch}`, 'omniflow-click'));
    mocks.app.isPackaged = true;
    expect(resolveAgentComputerHelperPath()).toBe(path.join(resourcesPath, 'computer-use', 'omniflow-click'));
  });

  it('checks existing permission with a fixed status argv and no shell', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = statusAgentComputerClick(new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--status'], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(child.stdin.end).toHaveBeenCalledWith(undefined);
    child.reply({ available: true, accessibilityTrusted: true });
    await expect(pending).resolves.toEqual({ available: true, accessibilityTrusted: true });
    expect(child.stderr.resume).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it('requires boolean status fields instead of coercing a helper claim', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = statusAgentComputerClick(new AbortController().signal);
    child.reply({ available: 'true', accessibilityTrusted: 1 });
    await expect(pending).resolves.toEqual({ available: false, accessibilityTrusted: false });
  });

  it('sends one exact target-bound AXPress request through stdin and requires a dispatch receipt', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = clickAgentComputerPoint(point, new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--click'], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(child.stdin.end).toHaveBeenCalledWith(JSON.stringify(point));
    child.reply({ ok: true, dispatched: true, ...point });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it.each([
    { description: '显示边栏', subrole: 'AXToggle', identifier: 'calculator-sidebar' },
    { description: '', subrole: '', identifier: '' },
    { description: '中'.repeat(85) + 'a', subrole: 'x'.repeat(64), identifier: 'x'.repeat(256) },
  ])('preserves supplied semantic identity in a single native request', async semantics => {
    const selected = { ...point, target: { ...point.target, candidate: { ...point.target.candidate, ...semantics } } };
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = clickAgentComputerPoint(selected, new AbortController().signal);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(selected);
    child.reply({ ok: true, dispatched: true });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(['description', 'subrole', 'identifier'] as const)('rejects an invalid %s before native preflight', async name => {
    for (const value of [undefined, null, 1, [], {}, '\ud800', '\udc00', '\0', '\t', '\n', '\u007f', '\u0085', '\u202e', '\u2066', 'x'.repeat(name === 'subrole' ? 65 : 257)]) {
      await expect(clickAgentComputerPoint(pointWithCandidate({ [name]: value }) as AgentComputerPoint, new AbortController().signal))
        .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    }
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ['right click', { ...point, button: 'right' }],
    ['double click', { ...point, clickCount: 2 }],
    ['right double click', { ...point, button: 'right', clickCount: 2 }],
  ])('rejects an unsupported %s before spawning a helper', async (_label, unsupported) => {
    await expect(clickAgentComputerPoint(unsupported as AgentComputerPoint, new AbortController().signal)).rejects.toMatchObject({
      dispatchState: 'not-dispatched', message: expect.stringContaining('左键单击'),
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['missing target', { x: point.x, y: point.y, button: 'left', clickCount: 1 }],
    ['extra target field', { ...point, target: { ...point.target, executable: '/unexpected' } }],
    ['zero window ID', pointWithWindow({ windowId: 0 })],
    ['overflowing window ID', pointWithWindow({ windowId: 0x100000000 })],
    ['fractional window ID', pointWithWindow({ windowId: 84.5 })],
    ['zero PID', pointWithWindow({ pid: 0 })],
    ['overflowing PID', pointWithWindow({ pid: 0x80000000 })],
    ['missing process identity', pointWithWindow({ processStartedAt: null })],
    ['unsafe process identity', pointWithWindow({ processStartedAt: Number.MAX_SAFE_INTEGER + 1 })],
    ['nonstandard window layer', pointWithWindow({ layer: 1 })],
    ['missing path', pointWithCandidate({ path: undefined })],
    ['non-array path', pointWithCandidate({ path: '0,3' })],
    ['negative path index', pointWithCandidate({ path: [-1] })],
    ['overflowing path index', pointWithCandidate({ path: [64] })],
    ['fractional path index', pointWithCandidate({ path: [0.5] })],
    ['excessive path depth', pointWithCandidate({ path: Array(33).fill(0) })],
    ['non-finite window bounds', pointWithWindow({ bounds: { ...display.bounds, x: Infinity } })],
    ['empty candidate bounds', pointWithCandidate({ bounds: { ...point.target.candidate.bounds, width: 0 } })],
    ['candidate outside window bounds', pointWithCandidate({ bounds: { ...point.target.candidate.bounds, x: 100 } })],
    ['non-finite point', { ...point, x: NaN }],
    ['point left of candidate', { ...point, x: point.target.candidate.bounds.x - 1 }],
    ['point on exclusive right edge', { ...point, x: point.target.candidate.bounds.x + point.target.candidate.bounds.width }],
    ['point on exclusive lower edge', { ...point, y: point.target.candidate.bounds.y + point.target.candidate.bounds.height }],
  ])('rejects %s before spawning a helper', async (_label, invalid) => {
    await expect(clickAgentComputerPoint(invalid as AgentComputerPoint, new AbortController().signal)).rejects.toMatchObject({
      name: 'AgentComputerInputError', dispatchState: 'not-dispatched',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ['unreadable JSON', 'not-json'],
    ['an array', []],
    ['a missing dispatch receipt', { ok: true }],
    ['a missing success receipt', { dispatched: true }],
    ['an inconsistent success receipt', { ok: true, dispatched: false }],
    ['an explicit unknown success receipt', { ok: true, dispatched: 'unknown' }],
  ])('reports unknown click delivery for %s', async (_label, receipt) => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = clickAgentComputerPoint(point, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AgentComputerInputError', dispatchState: 'unknown' });
    child.reply(receipt);
    await rejection;
  });

  it('classifies permission_denied as not dispatched, with actionable Accessibility guidance', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = clickAgentComputerPoint(point, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({
      dispatchState: 'not-dispatched', message: expect.stringContaining('辅助功能'),
    });
    child.reply({ ok: false, error: { code: 'permission_denied' } }, 77);
    await rejection;
  });

  it('preserves explicit non-dispatch errors and treats ambiguous failures as unknown', async () => {
    let attempts = 0;
    for (const [receipt, state] of [
      [{ ok: false, dispatched: false, error: { code: 'invalid_coordinates' } }, 'not-dispatched'],
      [{ ok: false, error: { code: 'unknown_error' } }, 'unknown'],
      [{ ok: false, dispatched: 'unknown', error: { code: 'permission_denied' } }, 'unknown'],
      [{ ok: false, dispatched: 'unknown', error: { code: 'unsupported_action' } }, 'unknown'],
    ] as const) {
      const child = new HelperProcess();
      mocks.spawn.mockReturnValue(child);
      const pending = clickAgentComputerPoint(point, new AbortController().signal);
      const rejection = expect(pending).rejects.toMatchObject({ dispatchState: state });
      child.reply(receipt, 70);
      await rejection;
      expect(child.stdin.end).toHaveBeenCalledOnce();
      expect(mocks.spawn).toHaveBeenCalledTimes(++attempts);
    }
  });

  it('reports an unavailable helper without claiming that a click was dispatched', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = clickAgentComputerPoint(point, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    child.emit('error', new Error('ENOENT /private/helper-location'));
    await rejection;
  });

  it('keeps waiting for the native click receipt after Run cancellation', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = clickAgentComputerPoint(point, controller.signal);
    const settled = vi.fn();
    void pending.then(settled, settled);
    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(child.kill).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    child.reply({ ok: true, dispatched: true });
    await expect(pending).resolves.toBeUndefined();
    expect(settled).toHaveBeenCalledOnce();
  });

  it('preserves an unknown native action after cancellation without retrying it', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = clickAgentComputerPoint(point, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    controller.abort();
    child.reply({ ok: false, dispatched: 'unknown', error: { code: 'permission_denied' } }, 70);
    await rejection;
    expect(child.kill).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('cancels a status check without waiting for a stuck helper', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = statusAgentComputerClick(controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('kills a timed out click and reports unknown delivery rather than retryable non-dispatch', async () => {
    vi.useFakeTimers();
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = clickAgentComputerPoint(point, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown', message: expect.stringContaining('超时') });
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('bounds helper output and does not accept an oversized click receipt', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = clickAgentComputerPoint(point, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    child.stdout.emit('data', Buffer.alloc(4097, 32));
    await rejection;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('never launches a native helper for an already cancelled operation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(clickAgentComputerPoint(point, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

describe('optional parent application activity diagnostic', () => {
  it.each([true, false])('reads a known %s activity using one fixed mode without input or permission APIs', async active => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerParentActivity(new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--parent-activity'], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(child.stdin.end).toHaveBeenCalledWith(undefined);
    child.reply({ ok: true, known: true, active });
    await expect(pending).resolves.toBe(active);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.getMediaAccessStatus).not.toHaveBeenCalled();
  });

  it.each([
    { ok: true, known: false, active: false },
    { ok: true, known: false, active: true },
    { ok: true, known: 'true', active: false },
    { ok: true, known: true, active: 1 },
    { ok: true, known: true, active: null },
    { ok: 1, known: true, active: true },
    { known: true, active: true },
    { ok: true, active: true },
    { ok: true, known: true },
    { ok: true, known: true, active: true, pid: 31042 },
    { ok: true, known: true, active: true, window: {} },
    { ok: true, known: true, active: true, applicationLabel: 'Unexpected app' },
    [], null, 'not-json',
  ])('keeps unknown or malformed receipt %j unknown without another route', async receipt => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerParentActivity(new AbortController().signal);
    child.reply(receipt);
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(['non-mac', 'already-aborted'] as const)('does not spawn for %s', async cause => {
    const controller = new AbortController();
    if (cause === 'non-mac') Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    else controller.abort();
    await expect(getAgentComputerParentActivity(controller.signal)).resolves.toBeUndefined();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('cancels a pending read promptly and ignores a late known receipt', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = getAgentComputerParentActivity(controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledOnce();
    child.reply({ ok: true, known: true, active: true });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('bounds its own timeout to 500ms and ignores a late known receipt', async () => {
    vi.useFakeTimers();
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerParentActivity(new AbortController().signal);
    const settled = vi.fn();
    void pending.then(settled);
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.reply({ ok: true, known: true, active: true });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('accepts exactly 512 bytes of valid output', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerParentActivity(new AbortController().signal);
    child.reply(JSON.stringify({ ok: true, known: true, active: false }).padEnd(512, ' '));
    await expect(pending).resolves.toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills cumulative output over 512 bytes and ignores a later valid receipt', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerParentActivity(new AbortController().signal);
    child.stdout.emit('data', Buffer.alloc(256, 32));
    child.stdout.emit('data', Buffer.alloc(257, 32));
    await expect(pending).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.reply({ ok: true, known: true, active: true });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(['spawn-throws', 'error-event', 'nonzero-exit'] as const)('keeps %s unknown', async cause => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    if (cause === 'spawn-throws') mocks.spawn.mockImplementationOnce(() => { throw new Error('unavailable'); });
    const pending = getAgentComputerParentActivity(new AbortController().signal);
    if (cause === 'error-event') child.emit('error', new Error('unavailable'));
    if (cause === 'nonzero-exit') child.reply({ ok: true, known: true, active: true }, 70);
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });
});

describe('desktop background AX target observation', () => {
  it('enables the host accessibility tree before reading targets, preserving front-to-back blockers', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const targets = [
      windowTarget({ windowId: 90, pid: 0, processStartedAt: null, layer: 8, candidates: [] }),
      windowTarget({ windowId: 91, processStartedAt: null, candidates: [] }),
      windowTarget({ windowId: 92 }),
    ];
    const pending = getAgentComputerTargets(display, new AbortController().signal);
    expect(mocks.app.setAccessibilitySupportEnabled).toHaveBeenCalledOnce();
    expect(mocks.app.setAccessibilitySupportEnabled).toHaveBeenCalledWith(true);
    expect(mocks.app.setAccessibilitySupportEnabled.mock.invocationCallOrder[0]).toBeLessThan(mocks.spawn.mock.invocationCallOrder[0]);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--targets'], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.stdin.end).toHaveBeenCalledWith(JSON.stringify({ displayBounds: display.bounds }));
    child.reply({ ok: true, targets, truncated: false });
    await expect(pending).resolves.toEqual({ targets, truncated: false });
    expect(child.kill).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves truncated=%s without inventing a target or fallback', async truncated => {
    await expect(observeTargetReceipt({ ok: true, targets: [], truncated })).resolves.toEqual({ targets: [], truncated });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('accepts the window and candidate count limits without reordering candidates', async () => {
    const candidates = [[], Array(32).fill(63)].map(path => ({ ...point.target.candidate, path }));
    const targets = Array.from({ length: 64 }, (_, index) => windowTarget({ windowId: 100 + index, candidates }));
    await expect(observeTargetReceipt({ ok: true, targets, truncated: false })).resolves.toEqual({ targets, truncated: false });
  });

  it('measures the cumulative text budget in UTF-8 bytes and accepts exactly 12 KiB', async () => {
    const candidates = Array.from({ length: 48 }, (_, index) => ({
      ...point.target.candidate, path: [index], title: `${'中'.repeat(82)}aa`,
    }));
    const targets = [windowTarget({ title: '', candidates })];
    await expect(observeTargetReceipt({ ok: true, targets, truncated: false })).resolves.toEqual({ targets, truncated: false });
    candidates[47] = { ...candidates[47], title: `${candidates[47].title}a` };
    await expect(observeTargetReceipt({ ok: true, targets: [windowTarget({ title: '', candidates })], truncated: false })).rejects.toMatchObject({
      dispatchState: 'not-dispatched', message: expect.stringContaining('观察回执无效'),
    });
  });

  it('includes every semantic field in the shared candidate text budget', async () => {
    const candidates = Array.from({ length: 48 }, (_, index) => ({
      ...point.target.candidate, path: [index], title: '', description: '中'.repeat(50),
      subrole: 'AXToggle', identifier: 'x'.repeat(90),
    }));
    // 8 role + 150 description + 8 subrole + 90 identifier = 256 bytes each.
    const targets = [windowTarget({ title: '', candidates })];
    await expect(observeTargetReceipt({ ok: true, targets, truncated: false })).resolves.toEqual({ targets, truncated: false });
    candidates[47] = { ...candidates[47], identifier: candidates[47].identifier + 'a' };
    await expect(observeTargetReceipt({ ok: true, targets: [windowTarget({ title: '', candidates })], truncated: false }))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
  });

  it.each([
    ['unreadable JSON', 'not-json'],
    ['an array receipt', []],
    ['missing truncation status', { ok: true, targets: [] }],
    ['non-boolean truncation status', { ok: true, targets: [], truncated: 'false' }],
    ['non-array targets', { ok: true, targets: {}, truncated: false }],
    ['an unexpected receipt field', { ok: true, targets: [], truncated: false, fallback: true }],
    ['duplicate window identities', { ok: true, targets: [windowTarget(), windowTarget()], truncated: false }],
    ['too many windows', { ok: true, targets: Array.from({ length: 65 }, (_, index) => windowTarget({ windowId: 100 + index, candidates: [] })), truncated: false }],
    ['too many candidates', { ok: true, targets: [windowTarget({ candidates: Array.from({ length: 129 }, (_, index) => ({ ...point.target.candidate, path: [Math.floor(index / 64), index % 64] })) })], truncated: false }],
    ['duplicate candidate paths', { ok: true, targets: [windowTarget({ candidates: [point.target.candidate, point.target.candidate] })], truncated: false }],
    ['a nonstandard layer with actionable candidates', { ok: true, targets: [windowTarget({ layer: 1 })], truncated: false }],
    ['an unknown process with actionable candidates', { ok: true, targets: [windowTarget({ processStartedAt: null })], truncated: false }],
    ['a zero PID with actionable candidates', { ok: true, targets: [windowTarget({ pid: 0 })], truncated: false }],
    ['a candidate outside its window', { ok: true, targets: [windowTarget({ candidates: [{ ...point.target.candidate, bounds: { ...point.target.candidate.bounds, x: display.bounds.x - 1 } }] })], truncated: false }],
    ['an invalid window rectangle', { ok: true, targets: [windowTarget({ bounds: { ...display.bounds, width: 0 } })], truncated: false }],
    ['an invalid AX path', { ok: true, targets: [windowTarget({ candidates: [{ ...point.target.candidate, path: [64] }] })], truncated: false }],
    ['an oversized role', { ok: true, targets: [windowTarget({ candidates: [{ ...point.target.candidate, role: 'a'.repeat(65) }] })], truncated: false }],
    ['an oversized UTF-8 title', { ok: true, targets: [windowTarget({ candidates: [{ ...point.target.candidate, title: '中'.repeat(86) }] })], truncated: false }],
    ['a malformed Unicode title', { ok: true, targets: [windowTarget({ title: '\uD800' })], truncated: false }],
  ])('rejects %s without retrying or capturing a fallback screen', async (_label, receipt) => {
    await expect(observeTargetReceipt(receipt)).rejects.toMatchObject({ name: 'AgentComputerInputError', dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it.each([
    { ...display.bounds, width: 0 },
    { ...display.bounds, y: NaN },
    { ...display.bounds, height: 100001 },
  ])('rejects invalid display bounds before enabling accessibility or spawning', async bounds => {
    await expect(getAgentComputerTargets({ ...display, bounds }, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('does not enable accessibility or launch an already cancelled target observation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getAgentComputerTargets(display, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('cancels a pending target observation and ignores its late receipt', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = getAgentComputerTargets(display, controller.signal);
    const settled = vi.fn();
    void pending.then(settled, settled);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    child.reply({ ok: true, targets: [windowTarget()], truncated: false });
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledOnce();
    expect(mocks.app.setAccessibilitySupportEnabled).toHaveBeenCalledOnce();
    expect(mocks.app.setAccessibilitySupportEnabled).toHaveBeenCalledWith(true);
  });

  it('accepts exactly 64 KiB of target stdout across chunks', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerTargets(display, new AbortController().signal);
    const receipt = Buffer.from(JSON.stringify({ ok: true, targets: [windowTarget()], truncated: true }));
    child.stdout.emit('data', receipt);
    child.stdout.emit('data', Buffer.alloc(64 * 1024 - receipt.length, 32));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ targets: [windowTarget()], truncated: true });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.each(['title', 'role'] as const)('preserves a Chinese %s split within a UTF-8 character across stdout chunks', async field => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const targets = [windowTarget({ candidates: [{ ...point.target.candidate, title: '切换目录', role: 'AX按钮' }] })];
    const receipt = Buffer.from(JSON.stringify({ ok: true, targets, truncated: false }));
    const characterOffset = receipt.indexOf(Buffer.from(field === 'title' ? '切' : '按'));
    expect(characterOffset).toBeGreaterThanOrEqual(0);
    const pending = getAgentComputerTargets(display, new AbortController().signal);
    child.stdout.emit('data', receipt.subarray(0, characterOffset + 1));
    child.stdout.emit('data', receipt.subarray(characterOffset + 1));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ targets, truncated: false });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills target observation when stdout exceeds 64 KiB across chunks', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerTargets(display, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    child.stdout.emit('data', Buffer.alloc(64 * 1024, 32));
    expect(child.kill).not.toHaveBeenCalled();
    child.stdout.emit('data', Buffer.from(' '));
    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills a stuck target observation within five seconds without claiming an input dispatch', async () => {
    vi.useFakeTimers();
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerTargets(display, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched', message: expect.stringContaining('超时') });
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('approved window metadata and AX observation', () => {
  it('lists only native window metadata without thumbnails or enabling any AX tree', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const windows = [sharedWindow({ windowId: 91 }), sharedWindow({ windowId: 12 })];
    const pending = getAgentComputerWindows(new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--windows'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(child.stdin.end).toHaveBeenCalledWith(undefined);
    child.reply({ ok: true, windows, truncated: true });
    await expect(pending).resolves.toEqual({ windows, truncated: true });
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.getMediaAccessStatus).not.toHaveBeenCalled();
  });

  it('accepts exactly 12 KiB of window labels, measuring UTF-8 bytes', async () => {
    const windows = Array.from({ length: 24 }, (_, index) => sharedWindow({ windowId: index + 1, title: '', applicationLabel: `${'中'.repeat(85)}a`, windowLabel: 'a'.repeat(256) }));
    await expect(windowHelperReceipt('windows', { ok: true, windows, truncated: false })).resolves.toEqual({ windows, truncated: false });
    windows.push(sharedWindow({ windowId: 25, title: '', applicationLabel: 'a', windowLabel: 'a' }));
    await expect(windowHelperReceipt('windows', { ok: true, windows, truncated: false })).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
  });

  it.each([
    ['wrong root shape', { ok: true, targets: [], truncated: false }],
    ['unknown field', { ok: true, windows: [], truncated: false, screenshot: true }],
    ['missing truncation status', { ok: true, windows: [] }],
    ['duplicate window ID', { ok: true, windows: [sharedWindow(), sharedWindow()], truncated: false }],
    ['more than 64 windows', { ok: true, windows: Array.from({ length: 65 }, (_, index) => sharedWindow({ windowId: index + 1 })), truncated: false }],
    ['unknown process identity', { ok: true, windows: [{ ...sharedWindow(), processStartedAt: null }], truncated: false }],
    ['zero PID', { ok: true, windows: [sharedWindow({ pid: 0 })], truncated: false }],
    ['nonzero layer', { ok: true, windows: [sharedWindow({ layer: 3 })], truncated: false }],
    ['oversized window label', { ok: true, windows: [sharedWindow({ windowLabel: '中'.repeat(86) })], truncated: false }],
    ['empty application label', { ok: true, windows: [sharedWindow({ applicationLabel: '' })], truncated: false }],
    ['an unexpected per-window field', { ok: true, windows: [{ ...sharedWindow(), screenshot: true }], truncated: false }],
  ])('rejects %s without capturing or scanning AX', async (_name, receipt) => {
    await expect(windowHelperReceipt('windows', receipt)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it('reads one frozen window tree without querying display topology or another window target', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerWindowTarget(sharedWindow(), new AbortController().signal);
    expect(child.stdin.end).toHaveBeenCalledWith(JSON.stringify({ window: point.target.window }));
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--window-targets'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    child.reply({ ok: true, target: windowTarget(), truncated: false });
    await expect(pending).resolves.toEqual({ target: windowTarget(), truncated: false });
    expect(mocks.app.setAccessibilitySupportEnabled).toHaveBeenCalledWith(true);
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.getAllDisplays).not.toHaveBeenCalled();
  });

  it('preserves optional semantic presence from observation through native click', async () => {
    const observedCandidate = { ...point.target.candidate, title: '', description: '显示边栏', subrole: '', identifier: 'sidebar-toggle' };
    const target = windowTarget({ candidates: [observedCandidate] });
    const observed = await windowHelperReceipt('target', { ok: true, target, truncated: false });
    expect(observed).toEqual({ target, truncated: false });
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const selected = { ...point, target: { ...point.target, candidate: target.candidates[0] } };
    const pending = clickAgentComputerPoint(selected, new AbortController().signal);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(selected);
    child.reply({ ok: true, dispatched: true });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it.each(['description', 'subrole', 'identifier'] as const)('rejects invalid observed %s without broadening the target', async name => {
    for (const value of [null, 1, [], '\ud800', '\0', '\n', '\u202e', '中'.repeat(name === 'subrole' ? 22 : 86)]) {
      const target = windowTarget({ candidates: [{ ...point.target.candidate, [name]: value }] });
      await expect(windowHelperReceipt('target', { ok: true, target, truncated: false }))
        .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    }
    expect(mocks.spawn).toHaveBeenCalledTimes(8);
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('keeps the single-window scan truncation flag and an empty candidate list', async () => {
    const target = windowTarget({ candidates: [] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: true })).resolves.toEqual({ target, truncated: true });
  });

  it('keeps the bounded AX summary independent from click candidate truncation', async () => {
    const target = windowTarget({ candidates: [] });
    const axTree = 'AXWindow "测试窗口"\n  AXStaticText "你好 😀"\n  AXButton "允许" enabled=true';
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: true, axTree, axTreeTruncated: false }))
      .resolves.toEqual({ target, truncated: true, axTree, axTreeTruncated: false });
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.getAllDisplays).not.toHaveBeenCalled();
  });

  it('preserves an explicit empty AX summary without claiming truncation', async () => {
    const target = windowTarget({ candidates: [] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false, axTree: '', axTreeTruncated: false }))
      .resolves.toEqual({ target, truncated: false, axTree: '', axTreeTruncated: false });
  });

  it('accepts an independent 12 KiB UTF-8 AX budget alongside a full candidate text budget', async () => {
    const candidates = Array.from({ length: 128 }, (_, index) => ({
      ...point.target.candidate, path: [Math.floor(index / 64), index % 64], title: 'a'.repeat(88),
    }));
    candidates[0].title = candidates[0].title.slice(Buffer.byteLength(point.target.window.title!, 'utf8'));
    const target = windowTarget({ candidates });
    const axTree = '中'.repeat(4096);
    expect(candidates.reduce((bytes, candidate) => bytes + Buffer.byteLength(candidate.role + candidate.title, 'utf8'),
      Buffer.byteLength(target.title!, 'utf8'))).toBe(12 * 1024);
    expect(Buffer.byteLength(axTree, 'utf8')).toBe(12 * 1024);
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false, axTree, axTreeTruncated: true }))
      .resolves.toEqual({ target, truncated: false, axTree, axTreeTruncated: true });
  });

  it.each([
    ['missing AX truncation flag', { axTree: 'AXWindow' }],
    ['missing AX text', { axTreeTruncated: false }],
    ['non-string AX text', { axTree: [], axTreeTruncated: false }],
    ['non-boolean AX truncation flag', { axTree: 'AXWindow', axTreeTruncated: 'false' }],
    ['over 12 KiB of UTF-8 AX text', { axTree: '中'.repeat(4096) + 'a', axTreeTruncated: true }],
    ...['\0', '\t', '\r', '\u0001', '\u007f', '\u0085', '\u202e', '\u2066', '\ud800', '\udc00']
      .map(value => ['illegal AX text ' + JSON.stringify(value), { axTree: 'AXWindow' + value, axTreeTruncated: false }] as const),
  ] as const)('rejects %s without another window scan or fallback', async (_name, summary) => {
    await expect(windowHelperReceipt('target', { ok: true, target: windowTarget(), truncated: false, ...summary }))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.getAllDisplays).not.toHaveBeenCalled();
  });

  it('preserves 128 deep candidates within the receipt budget and sends the complete observed click path', async () => {
    const candidates = Array.from({ length: 128 }, (_, index) => ({
      ...point.target.candidate, path: [Math.floor(index / 64), index % 64, ...Array(30).fill(63)],
    }));
    const target = windowTarget({ candidates });
    const receipt = { ok: true, target, truncated: false };
    expect(Buffer.byteLength(JSON.stringify(receipt))).toBeLessThan(64 * 1024);
    const observationChild = new HelperProcess();
    mocks.spawn.mockReturnValue(observationChild);
    const observation = getAgentComputerWindowTarget(point.target.window, new AbortController().signal);
    observationChild.reply(receipt);
    const observed = await observation;
    expect(observed).toEqual({ target, truncated: false });

    const selected = { ...point, target: { window: point.target.window, candidate: observed.target.candidates[127] } };
    const clickChild = new HelperProcess();
    mocks.spawn.mockReturnValue(clickChild);
    const click = clickAgentComputerPoint(selected, new AbortController().signal);
    expect(clickChild.stdin.end).toHaveBeenCalledWith(JSON.stringify(selected));
    clickChild.reply({ ok: true, dispatched: true });
    await expect(click).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it.each([
    ['changed window ID', windowTarget({ windowId: 85 })],
    ['changed PID', windowTarget({ pid: 31043 })],
    ['reused PID with new launch date', windowTarget({ processStartedAt: point.target.window.processStartedAt + 1 })],
    ['changed title', windowTarget({ title: 'Another document' })],
    ['changed geometry', windowTarget({ bounds: { ...display.bounds, width: 1441 } })],
    ['a candidate outside the approved window', windowTarget({ candidates: [{ ...point.target.candidate, bounds: { ...point.target.candidate.bounds, x: display.bounds.x - 1 } }] })],
    ['a path beyond the scan depth limit', windowTarget({ candidates: [{ ...point.target.candidate, path: Array(33).fill(0) }] })],
  ])('rejects %s instead of broadening the shared target', async (_name, target) => {
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false, axTree: 'AXWindow "unapproved"', axTreeTruncated: false }))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it.each([
    { ...point.target.window, processStartedAt: null },
    { ...point.target.window, pid: 0 },
    { ...point.target.window, layer: 1 },
    { ...point.target.window, bounds: { ...display.bounds, height: 0 } },
    { ...point.target.window, extra: true },
  ])('rejects an invalid window before AX enablement, screenshot, or helper launch', async window => {
    await expect(getAgentComputerWindowTarget(window as AgentComputerWindowIdentity, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    await expect(captureAgentComputerWindow(window as AgentComputerWindowIdentity, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });
});

describe('bounded approved-window observation scope', () => {
  const anchor: AgentComputerCandidate = {
    ...point.target.candidate, path: [2, 1, 3], operations: ['press'], enabledState: 'enabled',
    description: 'Local fixture', identifier: 'scope-anchor',
  };

  function scopedReceipt(receipt: unknown, scope: unknown = { anchor, ancestorLevels: 1 }) {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = getAgentComputerWindowTarget(point.target.window, new AbortController().signal, scope as AgentComputerObservationScope);
    child.reply(receipt);
    return pending;
  }

  it.each([0, 1, 2, 3])('resolves %i ancestor levels with the complete frozen anchor and absolute child paths', async ancestorLevels => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const scope = { anchor, ancestorLevels };
    const path = anchor.path.slice(0, anchor.path.length - ancestorLevels);
    const target = windowTarget({ candidates: [anchor, { ...anchor, path: [...path, 5] }] });
    const pending = getAgentComputerWindowTarget(sharedWindow(), new AbortController().signal, scope);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual({ window: point.target.window, scope });
    child.reply({ ok: true, target, truncated: false, scope: { path }, axTree: 'AXGroup', axTreeTruncated: false });
    await expect(pending).resolves.toEqual({ target, truncated: false, scope: { path }, axTree: 'AXGroup', axTreeTruncated: false });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.getAllDisplays).not.toHaveBeenCalled();
  });

  it.each([
    ['missing scope in old helper', {}],
    ['null scope', { scope: null }],
    ['wrong scope path', { scope: { path: [2, 0] } }],
    ['shorter scope path', { scope: { path: [2] } }],
    ['longer scope path', { scope: { path: [2, 1, 3] } }],
    ['invalid index', { scope: { path: [2, 64] } }],
    ['non-integer index', { scope: { path: [2, 1.5] } }],
    ['extra scope field', { scope: { path: [2, 1], anchor } }],
    ['rebased candidate', { scope: { path: [2, 1] }, target: windowTarget({ candidates: [{ ...anchor, path: [3] }] }) }],
    ['shorter candidate path', { scope: { path: [2, 1] }, target: windowTarget({ candidates: [{ ...anchor, path: [2] }] }) }],
    ['outside-prefix candidate', { scope: { path: [2, 1] }, target: windowTarget({ candidates: [{ ...anchor, path: [2, 0, 3] }] }) }],
  ])('rejects %s without falling back to a full-window observation', async (_name, extra) => {
    await expect(scopedReceipt({ ok: true, target: windowTarget({ candidates: [anchor] }), truncated: false, ...extra }))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('rejects an unexpected scoped receipt for an unscoped request', async () => {
    await expect(windowHelperReceipt('target', { ok: true, target: windowTarget(), truncated: false, scope: { path: [] } }))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each<[string, unknown]>([
    ...[-1, 4, 1.5, '1', true, null, undefined].map((ancestorLevels): [string, unknown] => ['invalid ancestor level', { anchor, ancestorLevels }]),
    ['level beyond anchor depth', { anchor: { ...anchor, path: [2] }, ancestorLevels: 2 }],
    ['missing anchor', { ancestorLevels: 1 }],
    ['extra scope field', { anchor, ancestorLevels: 1, root: true }],
    ['first-party anchor', { anchor: { ...anchor, source: 'omniflow' }, ancestorLevels: 1 }],
    ['unknown private profile', { anchor: { ...anchor, identityProfile: 'unknown' }, ancestorLevels: 1 }],
    ['unbound text state', { anchor: { ...anchor, textState: { subrole: null } }, ancestorLevels: 1 }],
    ['outside approved geometry', { anchor: { ...anchor, bounds: { ...anchor.bounds, x: point.target.window.bounds.x - 1 } }, ancestorLevels: 1 }],
    ['malformed candidate', { anchor: { ...anchor, path: [2, 64] }, ancestorLevels: 1 }],
    ['clipped geometry on normal candidate', { anchor: { ...anchor, documentBounds: anchor.bounds }, ancestorLevels: 1 }],
  ])('rejects %s before enabling AX or launching a helper', async (_name, scope) => {
    await expect(getAgentComputerWindowTarget(point.target.window, new AbortController().signal, scope as AgentComputerObservationScope))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it('rejects own or inherited first-party source and getter descriptors without executing them', async () => {
    const getter = vi.fn(() => 'omniflow');
    const anchors = [
      Object.defineProperty({ ...anchor }, 'source', { enumerable: true, get: getter }),
      Object.assign(Object.create(Object.defineProperty({}, 'source', { get: getter })), anchor),
    ];
    for (const candidate of anchors) {
      await expect(getAgentComputerWindowTarget(point.target.window, new AbortController().signal, { anchor: candidate, ancestorLevels: 1 }))
        .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    }
    const scope = Object.defineProperty({ anchor }, 'ancestorLevels', { enumerable: true, get: getter });
    await expect(getAgentComputerWindowTarget(point.target.window, new AbortController().signal, scope as AgentComputerObservationScope))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(getter).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it('freezes scope identity before dispatch despite later input mutation', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const original = { ...anchor, path: [...anchor.path], bounds: { ...anchor.bounds }, operations: [...anchor.operations!] };
    const expected = { ...original, path: [...original.path], bounds: { ...original.bounds }, operations: [...original.operations] };
    const scope = { anchor: original, ancestorLevels: 1 };
    const pending = getAgentComputerWindowTarget(point.target.window, new AbortController().signal, scope);
    original.path[0] = 5; original.bounds.x += 1; original.operations.length = 0; scope.ancestorLevels = 0;
    child.reply({ ok: true, target: windowTarget({ candidates: [expected] }), truncated: false, scope: { path: [2, 1] } });
    await expect(pending).resolves.toMatchObject({ scope: { path: [2, 1] } });
    expect(JSON.parse(child.stdin.end.mock.calls[0][0]).scope).toEqual({ anchor: expected, ancestorLevels: 1 });
  });

  it('kills the sole scoped helper on cancellation and never starts a fallback', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = getAgentComputerWindowTarget(point.target.window, controller.signal, { anchor, ancestorLevels: 0 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });
});

describe('desktop-independent approved window screenshot', () => {
  it('captures one exact native window and strips presentation labels from the request', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = captureAgentComputerWindow(sharedWindow(), new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--window-capture'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(child.stdin.end).toHaveBeenCalledWith(JSON.stringify({ window: point.target.window }));
    child.reply(captureReceipt());
    await expect(pending).resolves.toEqual(pngFixture);
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.getAllDisplays).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.each([
    ['changed window ID', { window: { ...point.target.window, windowId: 1 } }],
    ['changed PID', { window: { ...point.target.window, pid: 1 } }],
    ['changed launch date', { window: { ...point.target.window, processStartedAt: 1 } }],
    ['changed title', { window: { ...point.target.window, title: 'Other title' } }],
    ['changed geometry', { window: { ...point.target.window, bounds: { ...display.bounds, x: 0 } } }],
    ['missing success', { ok: undefined }],
    ['zero dimension', { width: 0 }],
    ['dimension above 2048', { height: 2049 }],
    ['PNG dimensions differing from the receipt', { width: 2 }],
    ['unexpected screenshot field', { sourceId: 'screen:1:0' }],
    ['invalid base64 alphabet', { pngBase64: '****' }],
    ['base64 whitespace', { pngBase64: `${pngFixture.toString('base64')}\n` }],
    ['noncanonical padding bits', { pngBase64: 'AB==' }],
    ['a different image format', { pngBase64: Buffer.alloc(24).toString('base64') }],
  ])('rejects %s without another screenshot source or native retry', async (_name, override) => {
    await expect(windowHelperReceipt('capture', captureReceipt(override))).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it('bounds decoded PNG bytes even when base64 length still fits its rounded limit', async () => {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
    pngFixture.copy(oversized);
    await expect(windowHelperReceipt('capture', captureReceipt({ pngBase64: oversized.toString('base64') }))).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('requires Screen Recording without requesting permission or capturing an alternative screen', async () => {
    mocks.getMediaAccessStatus.mockReturnValue('denied');
    await expect(captureAgentComputerWindow(point.target.window, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched', message: expect.stringContaining('屏幕录制') });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it.each([
    ['window_capture_unavailable', 'macOS 14'],
    ['screen_permission_denied', '屏幕录制'],
  ])('reports %s without falling back to a display screenshot', async (code, guidance) => {
    await expect(windowHelperReceipt('capture', { ok: false, dispatched: false, error: { code } })).rejects.toMatchObject({ dispatchState: 'not-dispatched', message: expect.stringContaining(guidance) });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('allows bounded screenshot JSON beyond the AX metadata output limit', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = captureAgentComputerWindow(point.target.window, new AbortController().signal);
    child.stdout.emit('data', Buffer.from(JSON.stringify(captureReceipt())));
    child.stdout.emit('data', Buffer.alloc(64 * 1024, 32));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual(pngFixture);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills screenshot output exceeding 12 MiB and never accepts its late receipt', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = captureAgentComputerWindow(point.target.window, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    child.stdout.emit('data', Buffer.alloc(12 * 1024 * 1024, 32));
    expect(child.kill).not.toHaveBeenCalled();
    child.stdout.emit('data', Buffer.from(' '));
    await rejection;
    child.reply(captureReceipt());
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('gives the window screenshot 15 seconds and kills a stuck helper', async () => {
    vi.useFakeTimers();
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const pending = captureAgentComputerWindow(point.target.window, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'not-dispatched', message: expect.stringContaining('截图超时') });
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('cancels a pending screenshot promptly and ignores its late native bytes', async () => {
    const child = new HelperProcess();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = captureAgentComputerWindow(point.target.window, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    child.reply(captureReceipt());
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('does not list metadata, enable AX, or start a screenshot after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getAgentComputerWindows(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(getAgentComputerWindowTarget(point.target.window, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(captureAgentComputerWindow(point.target.window, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.getMediaAccessStatus).not.toHaveBeenCalled();
  });
});

describe('desktop screen observation', () => {
  it('selects the source by exact display_id, even when another screen is first', async () => {
    const unrelated = thumbnail('other-screen');
    const selected = thumbnail('selected-screen');
    mocks.getSources.mockResolvedValue([
      { display_id: '1', thumbnail: unrelated },
      { display_id: display.id, thumbnail: selected },
    ]);
    await expect(captureAgentComputerDisplay(display, new AbortController().signal)).resolves.toEqual(Buffer.from('selected-screen'));
    expect(mocks.getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 2048, height: 2048 }, fetchWindowIcons: false });
    expect(unrelated.toPNG).not.toHaveBeenCalled();
    expect(selected.toPNG).toHaveBeenCalledOnce();
    expect(mocks.app.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it('rejects a missing target instead of taking the first available screen', async () => {
    const unrelated = thumbnail();
    mocks.getSources.mockResolvedValue([{ display_id: 'unrelated', thumbnail: unrelated }]);
    await expect(captureAgentComputerDisplay(display, new AbortController().signal)).rejects.toThrow('未能获取此屏幕');
    expect(unrelated.isEmpty).not.toHaveBeenCalled();
    expect(unrelated.toPNG).not.toHaveBeenCalled();
  });

  it('rejects an empty target screenshot without reading another screen', async () => {
    const selected = thumbnail('empty', true);
    const unrelated = thumbnail();
    mocks.getSources.mockResolvedValue([
      { display_id: display.id, thumbnail: selected }, { display_id: 'other', thumbnail: unrelated },
    ]);
    await expect(captureAgentComputerDisplay(display, new AbortController().signal)).rejects.toThrow('未能获取此屏幕');
    expect(selected.toPNG).not.toHaveBeenCalled();
    expect(unrelated.toPNG).not.toHaveBeenCalled();
  });

  it('does not start screen capture when Screen Recording is denied', async () => {
    mocks.getMediaAccessStatus.mockReturnValue('denied');
    await expect(captureAgentComputerDisplay(display, new AbortController().signal)).rejects.toThrow('屏幕录制');
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('rejects promptly while getSources is pending and ignores its late screenshot after abort', async () => {
    const capture = deferred<Array<{ display_id: string; thumbnail: ReturnType<typeof thumbnail> }>>();
    const selected = thumbnail();
    mocks.getSources.mockReturnValue(capture.promise);
    const controller = new AbortController();
    const pending = captureAgentComputerDisplay(display, controller.signal);
    const settled = vi.fn();
    void pending.then(settled, settled);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toHaveBeenCalledOnce();
    await rejection;
    capture.resolve([{ display_id: display.id, thumbnail: selected }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(selected.toPNG).not.toHaveBeenCalled();
  });

  it('fails a stuck screen capture within the 15 second budget', async () => {
    vi.useFakeTimers();
    mocks.getSources.mockReturnValue(new Promise(() => {}));
    const pending = captureAgentComputerDisplay(display, new AbortController().signal);
    const settled = vi.fn();
    void pending.then(settled, settled);
    const rejection = expect(pending).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15000);
    expect(settled).toHaveBeenCalledOnce();
    await rejection;
  });

  it('does not start capture for an already cancelled operation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(captureAgentComputerDisplay(display, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.getSources).not.toHaveBeenCalled();
  });
});


const semanticTextCandidate: AgentComputerCandidate = {
  ...point.target.candidate, role: 'AXTextArea', title: 'Disposable text',
  operations: ['replaceText', 'insertText'], enabledState: 'enabled', textState: { subrole: null, selection: { location: 3, length: 0 } },
};
const semanticScrollCandidate: AgentComputerCandidate = {
  ...point.target.candidate, role: 'AXScrollBar', title: 'Disposable scroll',
  operations: ['scrollUpStep', 'scrollDownStep'], orientation: 'vertical', enabledState: 'enabled',
};
const semanticTextRequest: AgentComputerSetTextRequest = {
  target: { window: point.target.window, candidate: semanticTextCandidate }, operation: 'insertText', text: '中文😀\n\t尾',
};
const semanticScrollRequest: AgentComputerScrollRequest = {
  target: { window: point.target.window, candidate: semanticScrollCandidate }, operation: 'scrollDownStep',
};
const fractionScrollCandidate: AgentComputerCandidate = {
  ...semanticScrollCandidate, operations: ['scrollUpFraction', 'scrollDownFraction'],
  scrollState: { value: 50, minValue: 10, maxValue: 110 },
};
const identifierTextCandidate: AgentComputerCandidate = {
  ...semanticTextCandidate, title: '', identifier: ' text-area-id ', enabledState: 'absent',
  identityProfile: 'native-text-identifier-v1', descriptionDeclared: true,
};
const nativePageButtonCandidate: AgentComputerCandidate = {
  ...point.target.candidate, title: '', subrole: 'AXIncrementPage', operations: ['scrollDownPage'], enabledState: 'absent',
  identityProfile: 'native-scroll-button-v1',
  scrollButtonState: { parentBounds: { x: -1700, y: 100, width: 1100, height: 1100 }, orientation: 'vertical' },
};
function runSemantic(kind: 'text' | 'scroll', signal: AbortSignal) {
  return kind === 'text' ? setAgentComputerText(semanticTextRequest, signal) : scrollAgentComputerControl(semanticScrollRequest, signal);
}

describe('bound native semantic mutations', () => {
  it.each([
    ['vertical', 'AXIncrementPage', 'scrollDownPage'], ['vertical', 'AXDecrementPage', 'scrollUpPage'],
    ['horizontal', 'AXIncrementPage', 'scrollRightPage'], ['horizontal', 'AXDecrementPage', 'scrollLeftPage'],
  ] as const)('preserves the private %s %s page-button profile and dispatches only %s', async (orientation, subrole, operation) => {
    const candidate: AgentComputerCandidate = { ...nativePageButtonCandidate, subrole, operations: [operation],
      scrollButtonState: { ...nativePageButtonCandidate.scrollButtonState!, orientation } };
    const target = windowTarget({ candidates: [candidate] });
    const result = await windowHelperReceipt('target', { ok: true, target, truncated: true });
    expect(result).toEqual({ target, truncated: true });
    expect((result as { target: AgentComputerTarget }).target.candidates[0]).not.toHaveProperty('descriptionDeclared');
    mocks.spawn.mockClear();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const request: AgentComputerScrollRequest = { target: { window: point.target.window, candidate }, operation };
    const pending = scrollAgentComputerControl(request, new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--scroll'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(request);
    child.reply({ ok: true, dispatched: true });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    { identityProfile: undefined }, { identityProfile: null }, { identityProfile: 'unknown' }, { identityProfile: 'native-text-identifier-v1' },
    { scrollButtonState: undefined }, { scrollButtonState: null }, { scrollButtonState: true }, { scrollButtonState: {} },
    { scrollButtonState: { parentBounds: nativePageButtonCandidate.bounds } },
    { scrollButtonState: { orientation: 'vertical' } },
    { scrollButtonState: { parentBounds: nativePageButtonCandidate.bounds, orientation: 'diagonal' } },
    { scrollButtonState: { parentBounds: nativePageButtonCandidate.bounds, orientation: 'vertical', extra: true } },
    { scrollButtonState: { parentBounds: { ...nativePageButtonCandidate.bounds, width: 0 }, orientation: 'vertical' } },
    { scrollButtonState: { parentBounds: { ...nativePageButtonCandidate.bounds, height: -1 }, orientation: 'vertical' } },
    { scrollButtonState: { parentBounds: { ...nativePageButtonCandidate.bounds, x: Infinity }, orientation: 'vertical' } },
    { scrollButtonState: { parentBounds: { ...nativePageButtonCandidate.bounds, y: NaN }, orientation: 'vertical' } },
    { scrollButtonState: { parentBounds: { ...nativePageButtonCandidate.bounds, width: 100001 }, orientation: 'vertical' } },
    { scrollButtonState: { parentBounds: { ...nativePageButtonCandidate.bounds, x: nativePageButtonCandidate.bounds.x + 1 }, orientation: 'vertical' } },
    { scrollButtonState: { parentBounds: { ...nativePageButtonCandidate.bounds, extra: 1 }, orientation: 'vertical' } },
    { scrollButtonState: { parentBounds: nativePageButtonCandidate.bounds, orientation: 'horizontal' } },
    { role: 'AXScrollBar' }, { role: 'AXScrollArea' }, { role: 'AXWebArea' }, { path: [] },
    { subrole: undefined }, { subrole: '' }, { subrole: 'AXIncrementArrow' }, { subrole: 'AXDecrementPage' },
    { operations: undefined }, { operations: [] }, { operations: ['press'] }, { operations: ['press', 'scrollDownPage'] },
    { operations: ['scrollDownPage', 'scrollUpPage'] }, { operations: ['scrollRightPage'] }, { operations: ['scrollDownStep'] },
    { enabledState: undefined }, { enabledState: 'enabled' }, { enabledState: null },
    { description: '' }, { identifier: '' }, { descriptionDeclared: false },
    { textState: { subrole: null } }, { orientation: 'vertical' }, { scrollState: { value: 0, minValue: 0, maxValue: 1 } },
    { documentBounds: { ...nativePageButtonCandidate.bounds, height: 2400 } }, { title: 'unsafe\nname' }, { title: 'unsafe\u202ename' },
  ])('rejects a malformed or broadened native page-button profile in receipts and before launch: %j', async changes => {
    const candidate = { ...nativePageButtonCandidate, ...changes } as AgentComputerCandidate;
    const target = windowTarget({ candidates: [candidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false })).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    mocks.spawn.mockClear();
    await expect(scrollAgentComputerControl({ target: { window: point.target.window, candidate }, operation: 'scrollDownPage' }, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('rejects present undefined cross-profile fields before a native page-button launch', async () => {
    const candidate = { ...nativePageButtonCandidate, descriptionDeclared: undefined };
    await expect(scrollAgentComputerControl({ target: { window: point.target.window, candidate }, operation: 'scrollDownPage' }, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('never exposes a native page-button profile as a general click, text field or other scroll direction', async () => {
    const target = { window: point.target.window, candidate: nativePageButtonCandidate };
    const signal = new AbortController().signal;
    await expect(clickAgentComputerPoint({ ...point, target }, signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    await expect(setAgentComputerText({ target, operation: 'replaceText', text: 'QA' }, signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    for (const operation of ['scrollUpPage', 'scrollDownStep', 'scrollDownFraction'] as const) {
      await expect(scrollAgentComputerControl({ target, operation }, signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    }
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('retains an unknown native page-button receipt without repeating or switching driver modes', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = scrollAgentComputerControl({ target: { window: point.target.window, candidate: nativePageButtonCandidate }, operation: 'scrollDownPage' }, new AbortController().signal);
    child.reply({ ok: false, dispatched: 'unknown', error: { code: 'ax_action_unknown' } }, 70);
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['--scroll']);
  });

  it('retains complete document geometry separately from its visible text viewport', async () => {
    const candidate: AgentComputerCandidate = { ...identifierTextCandidate,
      documentBounds: { ...identifierTextCandidate.bounds, height: 2400 } };
    const target = windowTarget({ candidates: [candidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: true })).resolves.toEqual({ target, truncated: true });
    mocks.spawn.mockClear();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const request: AgentComputerSetTextRequest = { ...semanticTextRequest, target: { ...point.target, candidate } };
    const pending = setAgentComputerText(request, new AbortController().signal);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(request);
    child.reply({ ok: true, dispatched: true });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    { documentBounds: null }, { documentBounds: true }, { documentBounds: {} },
    { documentBounds: identifierTextCandidate.bounds },
    { documentBounds: { ...identifierTextCandidate.bounds, height: 200 } },
    { documentBounds: { ...identifierTextCandidate.bounds, height: 2400, x: identifierTextCandidate.bounds.x + 1 } },
    { documentBounds: { ...identifierTextCandidate.bounds, height: 2400, extra: 1 } },
    { documentBounds: { ...identifierTextCandidate.bounds, height: 2400 }, identityProfile: undefined, descriptionDeclared: undefined },
    { documentBounds: { ...identifierTextCandidate.bounds, height: 2400 }, operations: ['press', 'replaceText'] },
  ])('rejects malformed or unbound document rectangles before native launch: %j', async changes => {
    const candidate = { ...identifierTextCandidate, ...changes } as AgentComputerCandidate;
    const target = windowTarget({ candidates: [candidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false })).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    mocks.spawn.mockClear();
    const request: AgentComputerSetTextRequest = { ...semanticTextRequest, target: { ...point.target, candidate } };
    await expect(setAgentComputerText(request, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([true, false])('retains the private text profile and Description declaration %s', async descriptionDeclared => {
    const candidate = { ...identifierTextCandidate, descriptionDeclared };
    const target = windowTarget({ candidates: [candidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false })).resolves.toEqual({ target, truncated: false });
    mocks.spawn.mockClear();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const request: AgentComputerSetTextRequest = { ...semanticTextRequest, target: { ...point.target, candidate } };
    const pending = setAgentComputerText(request, new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['--set-text']);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(request);
    child.reply({ ok: false, dispatched: 'unknown', error: { code: 'ax_action_unknown' } }, 70);
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    { identityProfile: 'unknown' }, { identityProfile: null }, { identityProfile: undefined },
    { descriptionDeclared: undefined }, { descriptionDeclared: 1 }, { descriptionDeclared: 'true' }, { descriptionDeclared: null },
    { description: '' }, { description: 'unused description' }, { description: null },
    { identifier: undefined }, { identifier: '' }, { identifier: '   ' }, { identifier: '\u00a0' },
    { title: ' ' }, { title: 'named field' }, { role: 'AXTextField' }, { role: 'AXWebArea' },
    { operations: ['press', 'replaceText', 'insertText'] }, { operations: ['press'] },
    { operations: undefined }, { textState: undefined }, { textState: { subrole: 'AXSecureTextField' } },
    { enabledState: undefined },
  ])('rejects malformed text identity profiles in observation and before native launch: %j', async changes => {
    const candidate = { ...identifierTextCandidate, ...changes } as AgentComputerCandidate;
    const target = windowTarget({ candidates: [candidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false }))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    mocks.spawn.mockClear();
    const request: AgentComputerSetTextRequest = { ...semanticTextRequest, target: { ...point.target, candidate } };
    await expect(setAgentComputerText(request, new AbortController().signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('keeps a text-only identifier profile unavailable to AXPress', async () => {
    await expect(clickAgentComputerPoint({ ...point, target: { ...point.target, candidate: identifierTextCandidate } }, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('preserves the private native fraction fingerprint and dispatches one value route', async () => {
    const target = windowTarget({ candidates: [fractionScrollCandidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false })).resolves.toEqual({ target, truncated: false });
    mocks.spawn.mockClear();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const request: AgentComputerScrollRequest = { target: { window: point.target.window, candidate: fractionScrollCandidate }, operation: 'scrollDownFraction' };
    const pending = scrollAgentComputerControl(request, new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['--scroll']);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(request);
    child.reply({ ok: false, dispatched: 'unknown', error: { code: 'ax_action_unknown' } }, 70);
    await expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    null, true, {}, { value: 0, minValue: 0 }, { value: true, minValue: 0, maxValue: 1 },
    { value: 0, minValue: false, maxValue: 1 }, { value: 0, minValue: 0, maxValue: true },
    { value: '0.1', minValue: 0, maxValue: 1 }, { value: NaN, minValue: 0, maxValue: 1 },
    { value: 0, minValue: -Infinity, maxValue: 1 }, { value: 0, minValue: 0, maxValue: Infinity },
    { value: -1, minValue: 0, maxValue: 1 }, { value: 2, minValue: 0, maxValue: 1 },
    { value: 1, minValue: 1, maxValue: 1 }, { value: 0, minValue: 1, maxValue: 0 },
    { value: 0, minValue: -Number.MAX_VALUE, maxValue: Number.MAX_VALUE },
    { value: 0, minValue: 0, maxValue: Number.MIN_VALUE }, { value: 0, minValue: 0, maxValue: 1, extra: 2 },
  ])('refuses an unconfirmed fraction range before helper launch: %j', async scrollState => {
    const request = { target: { window: point.target.window, candidate: { ...fractionScrollCandidate, scrollState } }, operation: 'scrollDownFraction' };
    await expect(scrollAgentComputerControl(request as AgentComputerScrollRequest, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([
    { orientation: 'horizontal' }, { enabledState: 'absent' }, { role: 'AXScrollArea' },
    { operations: ['scrollDownStep'] }, { operations: ['scrollDownFraction'], scrollState: undefined },
  ])('does not advertise malformed fraction capabilities: %j', async changes => {
    const target = windowTarget({ candidates: [{ ...fractionScrollCandidate, ...changes } as AgentComputerCandidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false }))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
  });

  it('accepts one capability pool with text classification, frozen UTF-16 selection and scrollbar orientation', async () => {
    const target = windowTarget({ candidates: [semanticTextCandidate, { ...semanticScrollCandidate, path: [0, 4] }] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false })).resolves.toEqual({ target, truncated: false });
  });

  it.each([
    { operations: [] }, { operations: ['replaceText', 'replaceText'] }, { operations: ['typeKeys'] },
    { operations: ['replaceText'] }, { operations: ['press'], textState: { subrole: null } },
    { operations: ['insertText'], textState: { subrole: null } },
    { operations: ['insertText'], textState: { subrole: null, selection: { location: -1, length: 0 } } },
    { operations: ['insertText'], textState: { subrole: null, selection: { location: Number.MAX_SAFE_INTEGER, length: 1 } } },
    { operations: ['insertText'], textState: { subrole: null, selection: { location: 0, length: 0, text: 'private' } } },
    { operations: ['replaceText'], textState: { subrole: null, value: 'private' } },
    { role: 'AXTextField', operations: ['replaceText'], textState: { subrole: null } },
    { role: 'AXTextField', operations: ['replaceText'], textState: { subrole: 'AXSecureTextField' } },
    { role: 'AXWebArea', operations: ['replaceText'], textState: { subrole: 'AXTextField' } },
    { role: 'AXTextArea', operations: ['replaceText'], textState: { subrole: '\u202e' } },
    { role: 'AXScrollBar', operations: ['scrollDownStep'] },
    { role: 'AXScrollBar', operations: ['scrollDownStep'], orientation: 'horizontal' },
    { role: 'AXSlider', operations: ['scrollDownStep'], orientation: 'vertical' },
    { role: 'AXScrollBar', operations: ['scrollDownPage'], orientation: 'vertical' },
  ])('rejects unsupported or malformed capability fingerprints: %j', async fields => {
    const target = windowTarget({ candidates: [{ ...point.target.candidate, ...fields } as AgentComputerCandidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false })).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
  });

  it('does not turn a non-press text or scroll element into a click', async () => {
    for (const candidate of [semanticTextCandidate, semanticScrollCandidate]) {
      await expect(clickAgentComputerPoint({ ...point, target: { ...point.target, candidate } }, new AbortController().signal))
        .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    }
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('passes exact Unicode and private selection binding through fixed stdin without synthesizing input', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = setAgentComputerText(semanticTextRequest, new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--set-text'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(semanticTextRequest);
    child.reply({ ok: true, dispatched: true });
    await expect(pending).resolves.toBeUndefined();
  });

  it('passes exactly one step with the declared orientation, without an implicit repeat count', async () => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = scrollAgentComputerControl(semanticScrollRequest, new AbortController().signal);
    expect(mocks.spawn).toHaveBeenCalledWith(resolveAgentComputerHelperPath(), ['--scroll'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(JSON.parse(child.stdin.end.mock.calls[0][0])).toEqual(semanticScrollRequest);
    child.reply({ ok: true, dispatched: true });
    await expect(pending).resolves.toBeUndefined();
  });

  it.each([
    { ...semanticTextRequest, text: '\0' }, { ...semanticTextRequest, text: 'a'.repeat(4097) },
    { ...semanticTextRequest, text: '' }, { ...semanticTextRequest, text: '\ud800' },
    { ...semanticTextRequest, operation: 'press' },
    { ...semanticTextRequest, target: point.target },
    { ...semanticTextRequest, target: { ...semanticTextRequest.target, candidate: { ...semanticTextCandidate, textState: { subrole: null } } } },
  ])('refuses an invalid text request before native launch', async request => {
    await expect(setAgentComputerText(request as AgentComputerSetTextRequest, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each(['press', 'replaceText', 'scrollDownPage', 'scrollLeftStep'] as const)('refuses unsupported %s without native launch', async operation => {
    await expect(scrollAgentComputerControl({ ...semanticScrollRequest, operation }, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each(['text', 'scroll'] as const)('settles an in-flight %s once even after ordinary cancellation', async kind => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = runSemantic(kind, controller.signal);
    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
    child.reply({ ok: true, dispatched: true });
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(['text', 'scroll'] as const)('reports unknown %s on timeout and never retries', async kind => {
    vi.useFakeTimers();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const pending = runSemantic(kind, new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(['click', 'text', 'scroll'] as const)('keeps preflight refusal and unknown post-call %s receipts distinct', async kind => {
    for (const [receipt, state] of [
      [{ ok: false, dispatched: false, error: { code: 'target_changed' } }, 'not-dispatched'],
      [{ ok: false, dispatched: 'unknown', error: { code: 'ax_action_unknown' } }, 'unknown'],
      [{ ok: true }, 'unknown'], ['{', 'unknown'],
    ] as const) {
      const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
      const pending = kind === 'click' ? clickAgentComputerPoint(point, new AbortController().signal)
        : runSemantic(kind, new AbortController().signal);
      const rejection = expect(pending).rejects.toMatchObject({ dispatchState: state });
      child.reply(receipt, typeof receipt === 'object' && receipt.ok === false ? 70 : 0);
      await rejection;
    }
    expect(mocks.spawn).toHaveBeenCalledTimes(4);
  });

  it.each(['click', 'text', 'scroll'] as const)('reports post-launch %s process errors as unknown', async kind => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    const signal = new AbortController().signal;
    const pending = kind === 'click' ? clickAgentComputerPoint(point, signal) : runSemantic(kind, signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    child.emit('spawn');
    child.emit('error', new Error('Post-launch process error'));
    await rejection;
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(['click', 'text', 'scroll'] as const)('keeps %s timeout unknown even when killing synchronously emits an error', async kind => {
    vi.useFakeTimers();
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    child.kill.mockImplementation(() => { child.emit('error', new Error('Kill failed')); return false; });
    const signal = new AbortController().signal;
    const pending = kind === 'click' ? clickAgentComputerPoint(point, signal) : runSemantic(kind, signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(['click', 'text', 'scroll'] as const)('keeps excessive %s receipt unknown despite kill errors', async kind => {
    const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
    child.kill.mockImplementation(() => { child.emit('error', new Error('Kill failed')); return false; });
    const signal = new AbortController().signal;
    const pending = kind === 'click' ? clickAgentComputerPoint(point, signal) : runSemantic(kind, signal);
    const rejection = expect(pending).rejects.toMatchObject({ dispatchState: 'unknown' });
    child.stdout.emit('data', Buffer.alloc(4097, 32));
    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });


  it('preserves confirmed AXEnabled absence on native text areas and page scroll areas', async () => {
    const text = { ...semanticTextCandidate, enabledState: 'absent' as const };
    const pages: AgentComputerCandidate = { ...point.target.candidate, path: [0, 4], role: 'AXScrollArea', title: 'QA page area',
      operations: ['scrollDownPage', 'scrollUpPage'], enabledState: 'absent' };
    const target = windowTarget({ candidates: [text, pages] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false })).resolves.toEqual({ target, truncated: false });
    for (const kind of ['text', 'page'] as const) {
      const child = new HelperProcess(); mocks.spawn.mockReturnValue(child);
      const pending = kind === 'text'
        ? setAgentComputerText({ ...semanticTextRequest, target: { ...semanticTextRequest.target, candidate: text } }, new AbortController().signal)
        : scrollAgentComputerControl({ target: { window: point.target.window, candidate: pages }, operation: 'scrollDownPage' }, new AbortController().signal);
      expect(JSON.parse(child.stdin.end.mock.calls[0][0]).target.candidate.enabledState).toBe('absent');
      child.reply({ ok: true, dispatched: true });
      await expect(pending).resolves.toBeUndefined();
    }
  });

  it.each([
    { enabledState: null }, { enabledState: true }, { enabledState: 'disabled' },
    { enabledState: 'absent' }, { enabledState: 'absent', role: 'AXScrollBar', operations: ['scrollDownStep'], orientation: 'vertical' },
    { enabledState: 'absent', role: 'AXTextField', operations: ['replaceText'], textState: { subrole: 'AXSearchField' } },
    { enabledState: 'absent', role: 'AXScrollArea', operations: ['press', 'scrollDownPage'] },
    { enabledState: 'absent', role: 'AXTextArea', operations: ['press', 'replaceText'], textState: { subrole: null } },
  ])('rejects invalid or overly broad AXEnabled absence: %j', async fields => {
    const target = windowTarget({ candidates: [{ ...point.target.candidate, ...fields } as AgentComputerCandidate] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false })).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
  });

  it('does not dispatch semantic operations without a frozen enabled-state fingerprint', async () => {
    const text: AgentComputerCandidate = { ...point.target.candidate, role: 'AXTextArea',
      operations: ['replaceText'], textState: { subrole: null } };
    const pages: AgentComputerCandidate = { ...point.target.candidate, role: 'AXScrollArea', operations: ['scrollDownPage'] };
    await expect(setAgentComputerText({ target: { window: point.target.window, candidate: text }, operation: 'replaceText', text: 'QA' }, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    await expect(scrollAgentComputerControl({ target: { window: point.target.window, candidate: pages }, operation: 'scrollDownPage' }, new AbortController().signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([semanticTextCandidate, semanticScrollCandidate])('does not publish semantic capabilities without a frozen enabled state: $role', async bound => {
    const unbound = { ...bound };
    delete unbound.enabledState;
    const target = windowTarget({ candidates: [unbound] });
    await expect(windowHelperReceipt('target', { ok: true, target, truncated: false }))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
  });

});
