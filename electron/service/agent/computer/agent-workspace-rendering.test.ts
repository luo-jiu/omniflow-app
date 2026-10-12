import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerSharedWindow } from '../../../platform/computer-use';
import { agentRenderingLeases } from './agent-computer-rendering-service-runtime';
import { createAgentRenderingLeaseManager } from './agent-computer-rendering-lease';
import { agentWorkspaceRendering, configureAgentWorkspaceRendering, createAgentWorkspaceRendering } from './agent-workspace-rendering';

const electronMocks = vi.hoisted(() => ({ fromId: vi.fn(), fromWebContents: vi.fn() }));
vi.mock('electron', () => ({ webContents: { fromId: electronMocks.fromId }, BrowserWindow: { fromWebContents: electronMocks.fromWebContents } }));

class Contents extends EventEmitter {
  id = 17;
  destroyed = false;
  throttling = true;
  mainFrame = { processId: 88, routingId: 2 };
  isDestroyed() { return this.destroyed; }
  getBackgroundThrottling = vi.fn(() => this.throttling);
  setBackgroundThrottling = vi.fn((allowed: boolean) => { this.throttling = allowed; });
  destroy() { this.destroyed = true; this.emit('destroyed'); }
}
function fixture() {
  const contents = new Contents();
  const target = { webContents: contents, isDestroyed: vi.fn(() => false), getMediaSourceId: vi.fn(() => 'window:24:0'),
    focus: vi.fn(), show: vi.fn(), moveTop: vi.fn() };
  const getMainWindow = vi.fn(() => target as typeof target | undefined);
  const leases = createAgentRenderingLeaseManager({ processId: 800, ownerWindow: () => getMainWindow(), restoreDelayMs: 0 });
  const keepOwnerRendering = vi.fn(leases.keepOwnerRendering);
  const bridge = createAgentWorkspaceRendering({ getMainWindow, keepOwnerRendering });
  const input = { instanceId: crypto.randomUUID(), ownerScope: { accountScope: 'qa-account', backendScope: 'qa-backend' }, libraryId: 3 };
  const shared: AgentComputerSharedWindow = { windowId: 24, pid: 800, processStartedAt: 1_770_000_000_000, layer: 0,
    bounds: { x: 0, y: 0, width: 800, height: 600 }, applicationLabel: 'Electron', windowLabel: 'OmniFlow' };
  return { contents, target, getMainWindow, leases, keepOwnerRendering, bridge, input, shared };
}
function navigate(contents: Contents, format: 'details' | 'legacy', isMainFrame: boolean, isSameDocument: boolean) {
  if (format === 'details') contents.emit('did-start-navigation', { isMainFrame, isSameDocument });
  else contents.emit('did-start-navigation', {}, 'app://omniflow/#/agent', isSameDocument, isMainFrame, 88, 2);
}
afterEach(() => { configureAgentWorkspaceRendering(() => null); vi.useRealTimers(); });

describe('visible Workspace drawing registration', () => {
  it('keeps idle rendering without a Session or Run and shares references with Runs and approved captures', () => {
    const f = fixture();
    const token = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    const run = f.leases.keepOwnerRendering(17);
    const capture = f.leases.keepApprovedWindowRendering(f.shared, 17);
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    run(); capture();
    expect(f.contents.throttling).toBe(false); // A terminal Run leaves the visible Workspace drawing.
    expect(f.bridge.unregister(17, f.contents.mainFrame, token)).toBe(true);
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
    expect(f.target.focus).not.toHaveBeenCalled();
    expect(f.target.show).not.toHaveBeenCalled();
    expect(f.target.moveTop).not.toHaveBeenCalled();
    f.bridge.releaseOwner(17);
    expect(f.contents.eventNames()).toEqual([]);
  });

  it('does not end an active Run or capture when the Workspace becomes hidden', () => {
    const f = fixture();
    const token = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    const run = f.leases.keepOwnerRendering(17);
    const capture = f.leases.keepApprovedWindowRendering(f.shared, 17);
    f.bridge.unregister(17, f.contents.mainFrame, token);
    run();
    expect(f.contents.throttling).toBe(false);
    capture();
    expect(f.contents.throttling).toBe(true);
  });

  it.each(['frame', 'sender', 'missing-window', 'destroyed-window', 'destroyed-contents'] as const)(
    'rejects an untrusted %s before acquiring drawing', cause => {
      const f = fixture();
      const sender = cause === 'sender' ? new Contents() : f.contents;
      const frame = cause === 'frame' ? { ...sender.mainFrame } : sender.mainFrame;
      if (cause === 'missing-window') f.getMainWindow.mockReturnValue(undefined);
      if (cause === 'destroyed-window') f.target.isDestroyed.mockReturnValue(true);
      if (cause === 'destroyed-contents') f.contents.destroy();
      expect(() => f.bridge.register(sender, frame, f.input)).toThrow('已失效');
      expect(f.keepOwnerRendering).not.toHaveBeenCalled();
    });

  it('rejects caller-chosen Session or execution grants and invalid main-generated tokens before acquiring drawing', () => {
    const f = fixture();
    expect(() => f.bridge.register(f.contents, f.contents.mainFrame, { ...f.input, sessionId: crypto.randomUUID() })).toThrow();
    const badIds = createAgentWorkspaceRendering({ getMainWindow: f.getMainWindow, keepOwnerRendering: f.keepOwnerRendering, createId: () => 'invalid' });
    expect(() => badIds.register(f.contents, f.contents.mainFrame, f.input)).toThrow();
    expect(f.keepOwnerRendering).not.toHaveBeenCalled();
    expect(f.contents.eventNames()).toEqual([]);
  });

  it('replacement owner/library/instance registration acquires before releasing and late old cleanup cannot release it', () => {
    const f = fixture();
    const previous = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    const current = f.bridge.register(f.contents, f.contents.mainFrame, { ...f.input, instanceId: crypto.randomUUID(), libraryId: 4,
      ownerScope: { accountScope: 'other-account', backendScope: 'other-backend' } });
    expect(current).not.toEqual(previous);
    expect(f.contents.getBackgroundThrottling).toHaveBeenCalledOnce();
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false]]);
    expect(f.bridge.unregister(17, f.contents.mainFrame, previous)).toBe(false);
    expect(f.bridge.unregister(17, f.contents.mainFrame, { ...current, documentGeneration: previous.documentGeneration })).toBe(false);
    expect(f.contents.throttling).toBe(false);
    expect(f.bridge.unregister(17, f.contents.mainFrame, current)).toBe(true);
    expect(f.bridge.unregister(17, f.contents.mainFrame, current)).toBe(false);
    expect(f.contents.throttling).toBe(true);
    f.bridge.releaseOwner(17);
  });

  it.each(['details', 'legacy'] as const)('invalidates real %s document navigation and reissues current registration', format => {
    const f = fixture();
    const old = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    navigate(f.contents, format, true, false);
    expect(f.contents.throttling).toBe(true);
    expect(f.bridge.unregister(17, f.contents.mainFrame, old)).toBe(false);
    const next = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    expect(next).not.toEqual(old);
    expect(f.bridge.unregister(17, f.contents.mainFrame, old)).toBe(false);
    expect(f.contents.throttling).toBe(false);
    f.bridge.releaseOwner(17);
  });

  it.each(['details', 'legacy'] as const)('preserves same-document and child %s navigation', format => {
    const f = fixture();
    const token = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    navigate(f.contents, format, true, true);
    navigate(f.contents, format, false, false);
    expect(f.contents.throttling).toBe(false);
    expect(f.bridge.unregister(17, f.contents.mainFrame, token)).toBe(true);
    f.bridge.releaseOwner(17);
  });

  it('rejects stale frame objects or mutable process/routing IDs without releasing a current token', () => {
    const f = fixture();
    const token = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    expect(() => f.bridge.unregister(17, { ...f.contents.mainFrame }, token)).toThrow('已失效');
    f.contents.mainFrame.processId++;
    expect(() => f.bridge.unregister(17, f.contents.mainFrame, token)).toThrow('已失效');
    f.bridge.releaseOwner(17);
    expect(f.contents.throttling).toBe(true);
  });

  it.each(['navigation', 'crash', 'destroyed', 'release-owner', 'shutdown', 'frame', 'process-id', 'main-window'] as const)(
    'does not publish a half registration when %s happens during acquisition', cause => {
      const f = fixture();
      f.contents.setBackgroundThrottling.mockImplementationOnce(allowed => {
        f.contents.throttling = allowed;
        if (cause === 'navigation') navigate(f.contents, 'details', true, false);
        if (cause === 'crash') f.contents.emit('render-process-gone');
        if (cause === 'destroyed') f.contents.destroy();
        if (cause === 'release-owner') f.bridge.releaseOwner(17);
        if (cause === 'shutdown') f.bridge.shutdown();
        if (cause === 'frame') f.contents.mainFrame = { ...f.contents.mainFrame };
        if (cause === 'process-id') f.contents.mainFrame.processId++;
        if (cause === 'main-window') f.getMainWindow.mockReturnValue(undefined);
      });
      expect(() => f.bridge.register(f.contents, f.contents.mainFrame, f.input)).toThrow('已失效');
      if (cause !== 'destroyed') expect(f.contents.throttling).toBe(true);
      expect(f.contents.eventNames()).toEqual([]);
    });

  it('preserves a current registration if acquiring its replacement fails', () => {
    const f = fixture();
    const token = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    f.keepOwnerRendering.mockImplementationOnce(() => { throw new Error('Acquire failed'); });
    expect(() => f.bridge.register(f.contents, f.contents.mainFrame, f.input)).toThrow('Acquire failed');
    expect(f.contents.throttling).toBe(false);
    expect(f.bridge.unregister(17, f.contents.mainFrame, token)).toBe(true);
    f.bridge.releaseOwner(17);
  });

  it('rolls back initial acquisition errors and removes partial listener registration', () => {
    const f = fixture();
    f.contents.setBackgroundThrottling.mockImplementationOnce(allowed => { f.contents.throttling = allowed; throw new Error('Setter failed'); });
    expect(() => f.bridge.register(f.contents, f.contents.mainFrame, f.input)).toThrow('Setter failed');
    expect(f.contents.throttling).toBe(true);
    expect(f.contents.eventNames()).toEqual([]);
    const on = vi.spyOn(f.contents, 'on');
    on.mockImplementationOnce((event, listener) => { EventEmitter.prototype.on.call(f.contents, event, listener); throw new Error('Listener failed'); });
    expect(() => f.bridge.register(f.contents, f.contents.mainFrame, f.input)).toThrow('Listener failed');
    expect(f.contents.eventNames()).toEqual([]);
    const token = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    expect(f.bridge.unregister(17, f.contents.mainFrame, token)).toBe(true);
    f.bridge.releaseOwner(17);
  });

  it.each(['destroyed', 'render-process-gone', 'release-owner', 'shutdown'] as const)(
    'releases registration on %s and ignores delayed callbacks on a reused contents ID', cause => {
      const f = fixture();
      const token = f.bridge.register(f.contents, f.contents.mainFrame, f.input);
      const delayedDestroy = f.contents.listeners('destroyed')[0] as () => void;
      if (cause === 'destroyed') f.contents.destroy();
      if (cause === 'render-process-gone') f.contents.emit('render-process-gone');
      if (cause === 'release-owner') f.bridge.releaseOwner(17);
      if (cause === 'shutdown') f.bridge.shutdown();
      if (cause !== 'destroyed') expect(f.contents.throttling).toBe(true);
      if (cause === 'shutdown') {
        expect(() => f.bridge.register(f.contents, f.contents.mainFrame, f.input)).toThrow('已失效');
        expect(f.contents.eventNames()).toEqual([]);
        return;
      }
      const replacement = new Contents();
      f.getMainWindow.mockReturnValue({ ...f.target, webContents: replacement });
      const current = f.bridge.register(replacement, replacement.mainFrame, f.input);
      delayedDestroy();
      expect(f.bridge.unregister(17, replacement.mainFrame, token)).toBe(false);
      expect(replacement.throttling).toBe(false);
      expect(f.bridge.unregister(17, replacement.mainFrame, current)).toBe(true);
      f.bridge.releaseOwner(17);
      expect(replacement.eventNames()).toEqual([]);
    });

  it('continues cleanup after one listener removal or release callback throws', () => {
    const f = fixture();
    const release = vi.fn(() => { throw new Error('Release failed'); });
    f.keepOwnerRendering.mockReturnValueOnce(release);
    f.bridge.register(f.contents, f.contents.mainFrame, f.input);
    const remove = vi.spyOn(f.contents, 'removeListener');
    remove.mockImplementationOnce(() => { throw new Error('Remove failed'); });
    expect(() => f.bridge.shutdown()).not.toThrow();
    expect(remove.mock.calls.map(call => call[0])).toEqual(['did-start-navigation', 'render-process-gone', 'destroyed']);
    expect(release).toHaveBeenCalledOnce();
    expect(() => f.bridge.shutdown()).not.toThrow();
    expect(release).toHaveBeenCalledOnce();
  });

  it('the production Workspace singleton shares the same manager as Run and capture references', () => {
    vi.useFakeTimers();
    const f = fixture();
    electronMocks.fromId.mockReturnValue(f.contents);
    electronMocks.fromWebContents.mockReturnValue(f.target);
    configureAgentWorkspaceRendering(() => f.target as unknown as BrowserWindow);
    const token = agentWorkspaceRendering.register(f.contents, f.contents.mainFrame, f.input);
    const run = agentRenderingLeases.keepOwnerRendering(17);
    const capture = agentRenderingLeases.keepApprovedWindowRendering({ ...f.shared, pid: process.pid }, 17);
    run(); capture(); vi.advanceTimersByTime(250);
    expect(f.contents.throttling).toBe(false);
    agentWorkspaceRendering.unregister(17, f.contents.mainFrame, token);
    vi.advanceTimersByTime(250);
    expect(f.contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
    agentWorkspaceRendering.releaseOwner(17);
  });
});
