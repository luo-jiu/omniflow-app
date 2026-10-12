import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AgentComputerSharedWindow } from '../../../platform/computer-use';
import { createAgentComputerRenderingLease, createAgentRenderingLeaseManager } from './agent-computer-rendering-lease';

class Contents extends EventEmitter {
  destroyed = false;
  throttling = true;
  isDestroyed = vi.fn(() => this.destroyed);
  getBackgroundThrottling = vi.fn(() => this.throttling);
  setBackgroundThrottling = vi.fn((allowed: boolean) => { this.throttling = allowed; });

  destroy() { this.destroyed = true; this.emit('destroyed'); }
}

function fixture() {
  const contents = new Contents();
  const owner = { isDestroyed: vi.fn(() => false), getMediaSourceId: vi.fn(() => 'window:24:0'), webContents: contents };
  const dependencies = { processId: 800, ownerWindow: vi.fn(() => owner) };
  const keepRendering = createAgentComputerRenderingLease(dependencies);
  const window: AgentComputerSharedWindow = { windowId: 24, pid: 800, processStartedAt: 1_770_000_000_000, layer: 0,
    bounds: { x: 0, y: 0, width: 1920, height: 1200 }, applicationLabel: 'Electron', windowLabel: 'OmniFlow' };
  return { contents, owner, dependencies, keepRendering, window };
}

describe('approved owner window rendering lease', () => {
  it('keeps concurrent leases on the same WebContents rendering and restores its original setting only after the final release', () => {
    const f = fixture();
    const first = f.keepRendering(f.window, 17);
    const second = f.keepRendering(f.window, 17);
    expect(f.dependencies.ownerWindow).toHaveBeenCalledWith(17);
    expect(f.contents.getBackgroundThrottling).toHaveBeenCalledOnce();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    first(); first();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    second(); second();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
    expect(f.contents.listenerCount('destroyed')).toBe(0);
  });

  it('preserves an owner whose original throttling was already disabled', () => {
    const f = fixture();
    f.contents.throttling = false;
    f.keepRendering(f.window, 17)();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [false]]);
    expect(f.contents.throttling).toBe(false);
  });

  it.each(['external-process', 'different-window', 'unknown-window-id', 'destroyed-window', 'destroyed-contents'] as const)('never changes throttling for an %s target', state => {
      const f = fixture();
      if (state === 'external-process') f.window.pid = 801;
      if (state === 'different-window') f.window.windowId = 25;
      if (state === 'unknown-window-id') f.owner.getMediaSourceId.mockReturnValue('screen:24:0');
      if (state === 'destroyed-window') f.owner.isDestroyed.mockReturnValue(true);
      if (state === 'destroyed-contents') f.contents.destroy();
      const release = f.keepRendering(f.window, 17);
      release(); release();
      expect(f.contents.getBackgroundThrottling).not.toHaveBeenCalled();
      expect(f.contents.setBackgroundThrottling).not.toHaveBeenCalled();
      if (state === 'external-process') expect(f.dependencies.ownerWindow).not.toHaveBeenCalled();
  });

  it('does nothing when the owner no longer has a live window', () => {
    const ownerWindow = vi.fn(() => undefined);
    const keepRendering = createAgentComputerRenderingLease({ processId: 800, ownerWindow });
    expect(() => keepRendering(fixture().window, 17)()).not.toThrow();
    expect(ownerWindow).toHaveBeenCalledWith(17);
  });

  it('does not let late releases of a destroyed WebContents change a replacement window', () => {
    const f = fixture();
    const first = f.keepRendering(f.window, 17);
    const second = f.keepRendering(f.window, 17);
    f.contents.destroy();
    const replacement = new Contents();
    f.dependencies.ownerWindow.mockReturnValue({ ...f.owner, webContents: replacement });
    const current = f.keepRendering(f.window, 17);
    first(); second();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    expect(replacement.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    current();
    expect(replacement.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
  });

  it('does not let an already released callback end a newer lease on the same contents', () => {
    const f = fixture();
    const old = f.keepRendering(f.window, 17);
    old();
    const current = f.keepRendering(f.window, 17);
    old();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true], [false]]);
    current();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true], [false], [true]]);
  });

  it('keeps restoration failures from interrupting cleanup or retaining a live lease entry', () => {
    const f = fixture();
    const release = f.keepRendering(f.window, 17);
    f.contents.setBackgroundThrottling.mockImplementationOnce(() => { throw new Error('Window disappeared'); });
    expect(release).not.toThrow();
    expect(release).not.toThrow();
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    f.keepRendering(f.window, 17)();
    expect(f.contents.getBackgroundThrottling).toHaveBeenCalledTimes(2);
  });

  it('does not retain a lease or change rendering when its original setting cannot be read', () => {
    const f = fixture();
    f.contents.getBackgroundThrottling.mockImplementationOnce(() => { throw new Error('Original setting unavailable'); });
    expect(() => f.keepRendering(f.window, 17)).toThrow('Original setting unavailable');
    expect(f.contents.setBackgroundThrottling).not.toHaveBeenCalled();
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    f.keepRendering(f.window, 17)();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
  });

  it('rolls back an acquisition setter that changes the setting before throwing', () => {
    const f = fixture();
    f.contents.setBackgroundThrottling.mockImplementationOnce(allowed => {
      f.contents.throttling = allowed;
      throw new Error('Acquisition failed after changing rendering');
    });
    expect(() => f.keepRendering(f.window, 17)).toThrow('Acquisition failed after changing rendering');
    expect(f.contents.throttling).toBe(true);
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    f.keepRendering(f.window, 17)();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true], [false], [true]]);
  });

  it('removes a listener registered by a failing acquisition without changing rendering', () => {
    const f = fixture();
    const once = vi.spyOn(f.contents, 'once');
    once.mockImplementationOnce((event, listener) => {
      f.contents.on(event, listener);
      throw new Error('Listener registration failed');
    });
    expect(() => f.keepRendering(f.window, 17)).toThrow('Listener registration failed');
    expect(f.contents.throttling).toBe(true);
    expect(f.contents.setBackgroundThrottling).not.toHaveBeenCalled();
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    f.keepRendering(f.window, 17)();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
  });
});

describe('shared owner Run and approved-window rendering manager', () => {
  function manager() {
    const f = fixture();
    const timers: { restore: () => void; delay: number; cancel: ReturnType<typeof vi.fn> }[] = [];
    const scheduleRestore = vi.fn((restore: () => void, delay: number) => {
      const cancel = vi.fn();
      timers.push({ restore, delay, cancel });
      return cancel;
    });
    const leases = createAgentRenderingLeaseManager({ ...f.dependencies, scheduleRestore });
    return { ...f, timers, scheduleRestore, leases };
  }

  it.each(['owner-first', 'capture-first'] as const)('shares original settings and only drains after the last reference: %s', order => {
    const f = manager();
    const owner = f.leases.keepOwnerRendering(17);
    const capture = f.leases.keepApprovedWindowRendering(f.window, 17);
    expect(f.contents.getBackgroundThrottling).toHaveBeenCalledOnce();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    const [first, last] = order === 'owner-first' ? [owner, capture] : [capture, owner];
    first(); first();
    expect(f.scheduleRestore).not.toHaveBeenCalled();
    last(); last();
    expect(f.scheduleRestore).toHaveBeenCalledOnce();
    expect(f.timers[0].delay).toBe(250);
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    f.timers[0].restore();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    expect(f.contents.listenerCount('render-process-gone')).toBe(0);
  });

  it('keeps another owner Run alive when a shared target is released or an external target is selected', () => {
    const f = manager();
    const firstRun = f.leases.keepOwnerRendering(17);
    const secondRun = f.leases.keepOwnerRendering(17);
    f.leases.keepApprovedWindowRendering(f.window, 17)();
    f.leases.keepApprovedWindowRendering({ ...f.window, pid: 801 }, 17)();
    firstRun();
    expect(f.scheduleRestore).not.toHaveBeenCalled();
    secondRun();
    expect(f.scheduleRestore).toHaveBeenCalledOnce();
    f.timers[0].restore();
    expect(f.contents.throttling).toBe(true);
  });

  it('cancels pending restoration on reacquisition and does not recapture false as the original value', () => {
    const f = manager();
    f.leases.keepOwnerRendering(17)();
    const next = f.leases.keepOwnerRendering(17);
    expect(f.timers[0].cancel).toHaveBeenCalledOnce();
    expect(f.contents.getBackgroundThrottling).toHaveBeenCalledOnce();
    f.timers[0].restore(); // A cancelled scheduler can deliver a late callback.
    expect(f.contents.throttling).toBe(false);
    next();
    f.timers[0].restore();
    expect(f.contents.throttling).toBe(false);
    f.timers[1].restore();
    expect(f.contents.throttling).toBe(true);
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
  });

  it.each(['destroyed', 'render-process-gone'] as const)('closes live references and pending drains on %s without touching a replacement', event => {
    const f = manager();
    const live = f.leases.keepOwnerRendering(17);
    live();
    if (event === 'destroyed') f.contents.destroy();
    else f.contents.emit(event);
    expect(f.timers[0].cancel).toHaveBeenCalledOnce();
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    expect(f.contents.listenerCount('render-process-gone')).toBe(0);
    const replacement = new Contents();
    f.dependencies.ownerWindow.mockReturnValue({ ...f.owner, webContents: replacement });
    const next = f.leases.keepOwnerRendering(17);
    live(); f.timers[0].restore();
    expect(replacement.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    next(); f.timers[1].restore();
    expect(replacement.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
  });

  it('restores a still-live contents immediately on renderer crash even while Runs retain references', () => {
    const f = manager();
    const first = f.leases.keepOwnerRendering(17);
    const second = f.leases.keepApprovedWindowRendering(f.window, 17);
    f.contents.emit('render-process-gone');
    first(); second();
    expect(f.scheduleRestore).not.toHaveBeenCalled();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
    expect(f.contents.listenerCount('destroyed')).toBe(0);
  });

  it('preserves originally disabled throttling through owner and capture references', () => {
    const f = manager();
    f.contents.throttling = false;
    const owner = f.leases.keepOwnerRendering(17);
    const capture = f.leases.keepApprovedWindowRendering(f.window, 17);
    owner(); capture(); f.timers[0].restore();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [false]]);
  });

  it('falls back to immediate restoration if scheduling fails and does not leak its entry', () => {
    const f = manager();
    f.scheduleRestore.mockImplementationOnce(() => { throw new Error('Scheduling failed'); });
    expect(() => f.leases.keepOwnerRendering(17)()).not.toThrow();
    expect(f.contents.throttling).toBe(true);
    const next = f.leases.keepOwnerRendering(17);
    expect(f.contents.getBackgroundThrottling).toHaveBeenCalledTimes(2);
    next(); f.timers[0].restore();
    expect(f.contents.throttling).toBe(true);
  });

  it('closes the drain before a restoration error without replacing the operation result', () => {
    const f = manager();
    f.leases.keepOwnerRendering(17)();
    f.contents.setBackgroundThrottling.mockImplementationOnce(() => { throw new Error('Restoration failed'); });
    expect(f.timers[0].restore).not.toThrow();
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    f.leases.keepOwnerRendering(17)();
    expect(f.contents.getBackgroundThrottling).toHaveBeenCalledTimes(2);
  });

  it.each([-1, 1_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an unbounded restoration delay %s', restoreDelayMs => {
    expect(() => createAgentRenderingLeaseManager({ ...fixture().dependencies, restoreDelayMs })).toThrow('bounded');
  });

  it.each([0, -1, 1.5, Number.NaN])('does not resolve an invalid owner identity %s', owner => {
    const f = manager();
    f.leases.keepOwnerRendering(owner)();
    expect(f.dependencies.ownerWindow).not.toHaveBeenCalled();
    expect(f.contents.setBackgroundThrottling).not.toHaveBeenCalled();
  });
});
