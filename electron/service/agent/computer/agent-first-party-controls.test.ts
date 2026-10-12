import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { AgentComputerSharedWindow } from '../../../platform/computer-use';
import type { AgentToolMainPreparationIdentity } from '../agent-tool-registry';
import type { FirstPartyControlContext, FirstPartyControlRequest, FirstPartyControlResponse, FirstPartyControlSnapshot } from '../../../../src/shared/computer-use/first-party-control-contract';
import { agentFirstPartyControls, configureAgentFirstPartyControls, createAgentFirstPartyControls, type FirstPartyControlsDependencies } from './agent-first-party-controls';

const electronMocks = vi.hoisted(() => ({ applicationEventListeners: new Map<string, () => void>() }));
vi.mock('electron', () => ({ app: { on: vi.fn((event: string, listener: () => void) => {
  electronMocks.applicationEventListeners.set(event, listener);
}) }, screen: { getCursorScreenPoint: vi.fn(() => ({ x: 3, y: 4 })) } }));
vi.mock('../../../platform/computer-use', () => ({
  getAgentComputerParentActivity: vi.fn(async () => undefined),
  AgentComputerInputError: class extends Error {
    constructor(message: string, readonly dispatchState: 'not-dispatched' | 'unknown') { super(message); }
  },
}));

class Contents extends EventEmitter {
  id = 17;
  destroyed = false;
  zoom = 1;
  mainFrame = { processId: 88, routingId: 2, send: vi.fn<(channel: string, request: FirstPartyControlRequest) => void>() };
  isDestroyed() { return this.destroyed; }
  getZoomFactor() { return this.zoom; }
}
function fixture(verifyRejectedDiagnostic?: FirstPartyControlsDependencies['verifyRejectedDiagnostic'],
  nativeApplicationFocused?: FirstPartyControlsDependencies['nativeApplicationFocused']) {
  const contents = new Contents();
  const target = { webContents: contents, isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => false),
    getMediaSourceId: vi.fn(() => 'window:24:0'), getContentBounds: vi.fn(() => ({ x: 20, y: 40, width: 800, height: 600 })) };
  const getMainWindow = vi.fn(() => target as typeof target | undefined);
  const cursor = vi.fn(() => ({ x: 3, y: 4 }));
  const applicationFocused = vi.fn<() => boolean | undefined>(() => false);
  const log = vi.fn();
  const bridge = createAgentFirstPartyControls({ processId: 800, getMainWindow, cursor, applicationFocused, nativeApplicationFocused, log, verifyRejectedDiagnostic });
  const context: FirstPartyControlContext = { libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'http://localhost:8850' }, sessionId: crypto.randomUUID() };
  const identity: AgentToolMainPreparationIdentity = { ...context, ownerWebContentsId: 17, aiDestinationIdentity: `v1:${'a'.repeat(64)}`,
    callId: 'call', preparedActionId: 'prepared', runCapabilityIdentity: `v3:${'b'.repeat(64)}`, runId: crypto.randomUUID(),
    toolInputHash: `v1:${'c'.repeat(64)}`, toolName: 'computer.observe', toolRegistrationId: 'computer.observe@1', toolRunId: crypto.randomUUID() };
  const window: AgentComputerSharedWindow = { windowId: 24, pid: 800, processStartedAt: 1_770_000_000_000, layer: 0,
    bounds: { x: 10, y: 20, width: 840, height: 650 }, applicationLabel: 'Electron', windowLabel: 'OmniFlow' };
  const snapshot: FirstPartyControlSnapshot = { controlId: 'agent-composer', instanceId: crypto.randomUUID(), revision: 1,
    bounds: { x: 15, y: 25, width: 300, height: 60 }, operations: ['replaceText', 'insertText'],
    state: { kind: 'text', selectionStart: 0, selectionEnd: 0, textLength: 0 } };
  const input = { instanceId: crypto.randomUUID(), context };
  let token = bridge.register(contents, contents.mainFrame, input);
  const controller = new AbortController();
  function reply(request: FirstPartyControlRequest, status: FirstPartyControlResponse['status'], controls = [snapshot]) {
    return bridge.complete(contents.id, contents.mainFrame, { requestId: request.requestId,
      registrationId: request.registrationId, documentGeneration: request.documentGeneration, status,
      ...(status === 'observed' ? { controls } : {}) });
  }
  function handle(kind: FirstPartyControlResponse['status']) {
    contents.mainFrame.send.mockImplementation((_channel, request) => { reply(request, kind); });
  }
  async function observe() {
    handle('observed');
    const observed = await bridge.observe(window, identity, controller.signal);
    return observed!.controls[0];
  }
  function reregister() { token = bridge.register(contents, contents.mainFrame, input); return token; }
  return { bridge, contents, target, getMainWindow, cursor, applicationFocused, log, identity, window, snapshot, input, controller, reply, handle, observe, reregister, get token() { return token; } };
}
function emitNavigation(contents: Contents, format: 'details' | 'legacy', isMainFrame: boolean, isSameDocument: boolean) {
  if (format === 'details') contents.emit('did-start-navigation', { isMainFrame, isSameDocument });
  else contents.emit('did-start-navigation', {}, 'app://omniflow/#/agent?view=chat', isSameDocument, isMainFrame, 88, 2);
}
afterEach(() => { vi.useRealTimers(); });

describe('first-party main control transport', () => {
  it('maps CSS bounds using trusted content geometry and zoom, then verifies and dispatches once', async () => {
    const f = fixture();
    f.contents.zoom = 2;
    const bound = await f.observe();
    expect(bound.bounds).toEqual({ x: 50, y: 90, width: 600, height: 120 });
    const first = f.contents.mainFrame.send.mock.calls[0];
    expect(first[0]).toBe('agent:computer-controls:requested');
    expect(first[1]).toMatchObject({ kind: 'observe', ...f.token, context: f.input.context, runId: f.identity.runId });
    f.handle('verified');
    await f.bridge.verify(f.window, f.identity, bound, 'replaceText', f.controller.signal);
    f.handle('applied');
    await f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '中文😀\n第二行', f.controller.signal);
    expect(f.contents.mainFrame.send.mock.calls[2][1]).toMatchObject({ kind: 'dispatch', operation: 'replaceText', text: '中文😀\n第二行', snapshot: f.snapshot });
    expect(f.contents.mainFrame.send).toHaveBeenCalledTimes(3);
    expect(f.log).toHaveBeenCalledOnce();
    expect(f.log).toHaveBeenCalledWith({ focusKnownBefore: true, focusKnownAfter: true,
      targetFocusedBefore: false, targetFocusedAfter: false, applicationFocusKnownBefore: true, applicationFocusKnownAfter: true,
      applicationFocusedBefore: false, applicationFocusedAfter: false,
      nativeApplicationFocusKnownBefore: false, nativeApplicationFocusKnownAfter: false,
      nativeApplicationFocusedBefore: false, nativeApplicationFocusedAfter: false,
      pointerKnownBefore: true, pointerKnownAfter: true, pointerMoved: false });
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('中文');
  });

  it.each(['foreign-pid', 'different-window', 'different-owner', 'missing-window', 'non-main-layer', 'no-registration', 'session', 'library', 'account', 'backend'] as const)('does not observe a %s target', async cause => {
      const f = fixture();
      if (cause === 'foreign-pid') f.window.pid++;
      if (cause === 'different-window') f.window.windowId++;
      if (cause === 'different-owner') f.identity = { ...f.identity, ownerWebContentsId: 18 };
      if (cause === 'missing-window') f.getMainWindow.mockReturnValue(undefined);
      if (cause === 'non-main-layer') f.window.layer = 1;
      if (cause === 'no-registration') f.bridge.unregister(f.contents.id, f.contents.mainFrame, f.token);
      if (cause === 'session') f.identity = { ...f.identity, sessionId: crypto.randomUUID() };
      if (cause === 'library') f.identity = { ...f.identity, libraryId: 4 };
      if (cause === 'account') f.identity = { ...f.identity, ownerScope: { ...f.identity.ownerScope, accountScope: 'user:8' } };
      if (cause === 'backend') f.identity = { ...f.identity, ownerScope: { ...f.identity.ownerScope, backendScope: 'other' } };
      expect(await f.bridge.observe(f.window, f.identity, f.controller.signal)).toBeUndefined();
      expect(f.contents.mainFrame.send).not.toHaveBeenCalled();
    });

  it('rejects registration and responses from a child or stale main frame', async () => {
    const f = fixture();
    const child = { ...f.contents.mainFrame, routingId: 7 };
    expect(() => f.bridge.register(f.contents, child, f.input)).toThrow();
    const pending = f.bridge.observe(f.window, f.identity, f.controller.signal);
    const request = f.contents.mainFrame.send.mock.calls[0][1];
    const response = { ...f.token, requestId: request.requestId, status: 'observed', controls: [f.snapshot] };
    expect(() => f.bridge.complete(18, f.contents.mainFrame, response)).toThrow();
    expect(() => f.bridge.complete(17, child, response)).toThrow();
    expect(f.bridge.complete(17, f.contents.mainFrame, response)).toBe(true);
    await pending;
    expect(() => f.bridge.complete(17, f.contents.mainFrame, response)).toThrow();
    f.contents.mainFrame = { ...f.contents.mainFrame, processId: 89 };
    await expect(f.bridge.observe(f.window, f.identity, f.controller.signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
  });

  it('old cleanup and old references cannot invalidate or mutate a replacement registration', async () => {
    const f = fixture();
    const bound = await f.observe();
    const old = f.token;
    const next = f.reregister();
    expect(next).not.toEqual(old);
    expect(f.bridge.unregister(17, f.contents.mainFrame, old)).toBe(false);
    await expect(f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(await f.bridge.observe(f.window, f.identity, f.controller.signal)).toMatchObject(next);
  });

  it.each(['outside-content', 'outside-window', 'content-moved', 'zoom-changed'] as const)('rejects %s geometry before dispatch', async cause => {
    const f = fixture();
    const bound = await f.observe();
    if (cause === 'outside-content') f.snapshot.bounds.x = 700;
    if (cause === 'outside-window') f.window.bounds.width = 100;
    if (cause === 'content-moved') f.target.getContentBounds.mockReturnValue({ x: 30, y: 40, width: 800, height: 600 });
    if (cause === 'zoom-changed') f.contents.zoom = 1.25;
    if (cause === 'outside-content' || cause === 'outside-window') {
      await expect(f.bridge.observe(f.window, f.identity, f.controller.signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    } else {
      await expect(f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
      expect(f.contents.mainFrame.send).toHaveBeenCalledOnce();
    }
  });

  it.each(['main-navigation', 'process-gone', 'destroyed', 'unregister', 'release-owner', 'release-run', 'abort', 'send-throws'] as const)('classifies %s after a dispatch as unknown and never resends', async cause => {
      const f = fixture();
      const bound = await f.observe();
      f.contents.mainFrame.send.mockImplementation(() => { if (cause === 'send-throws') throw new Error('transport'); });
      const action = f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal);
      const assertion = expect(action).rejects.toMatchObject({ dispatchState: 'unknown' });
      if (cause === 'main-navigation') f.contents.emit('did-start-navigation', { isMainFrame: true });
      if (cause === 'process-gone') f.contents.emit('render-process-gone');
      if (cause === 'destroyed') { f.contents.destroyed = true; f.contents.emit('destroyed'); }
      if (cause === 'unregister') f.bridge.unregister(17, f.contents.mainFrame, f.token);
      if (cause === 'release-owner') f.bridge.releaseOwner(17);
      if (cause === 'release-run') f.bridge.releaseRun(f.identity.runId);
      if (cause === 'abort') f.controller.abort();
      await assertion;
      expect(f.contents.mainFrame.send).toHaveBeenCalledTimes(2);
    });

  it.each(['details', 'legacy'] as const)('keeps %s same-document navigation registered, including pending dispatches', async format => {
    const f = fixture();
    const bound = await f.observe();
    const token = f.token;
    emitNavigation(f.contents, format, true, true);
    f.handle('verified');
    await f.bridge.verify(f.window, f.identity, bound, 'replaceText', f.controller.signal);
    f.contents.mainFrame.send.mockImplementation(() => undefined);
    const action = f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal);
    const request = f.contents.mainFrame.send.mock.calls[2][1];
    emitNavigation(f.contents, format, true, true);
    expect(f.reply(request, 'applied')).toBe(true);
    await action;
    const current = await f.observe();
    expect(current).toMatchObject(token);
    expect(f.token).toEqual(token);
  });

  it.each(['details', 'legacy'] as const)('invalidates %s real-document navigation and pending dispatches', async format => {
    const f = fixture();
    const bound = await f.observe();
    const token = f.token;
    f.contents.mainFrame.send.mockImplementation(() => undefined);
    const action = f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal);
    const assertion = expect(action).rejects.toMatchObject({ dispatchState: 'unknown' });
    emitNavigation(f.contents, format, true, false);
    await assertion;
    expect(await f.bridge.observe(f.window, f.identity, f.controller.signal)).toBeUndefined();
    f.reregister();
    expect(f.token.documentGeneration).not.toBe(token.documentGeneration);
    await expect(f.bridge.verify(f.window, f.identity, bound, 'replaceText', f.controller.signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    const current = await f.observe();
    expect(current).toMatchObject(f.token);
  });

  it.each(['session', 'library', 'account', 'backend'] as const)('still rejects a changed %s context after same-document navigation', async cause => {
    const f = fixture();
    const bound = await f.observe();
    emitNavigation(f.contents, 'details', true, true);
    if (cause === 'session') f.identity = { ...f.identity, sessionId: crypto.randomUUID() };
    if (cause === 'library') f.identity = { ...f.identity, libraryId: 4 };
    if (cause === 'account') f.identity = { ...f.identity, ownerScope: { ...f.identity.ownerScope, accountScope: 'user:8' } };
    if (cause === 'backend') f.identity = { ...f.identity, ownerScope: { ...f.identity.ownerScope, backendScope: 'http://localhost:8851' } };
    expect(await f.bridge.observe(f.window, f.identity, f.controller.signal)).toBeUndefined();
    await expect(f.bridge.verify(f.window, f.identity, bound, 'replaceText', f.controller.signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(f.contents.mainFrame.send).toHaveBeenCalledOnce();
    expect(f.bridge.unregister(f.contents.id, f.contents.mainFrame, f.token)).toBe(true);
    f.input.context = { libraryId: f.identity.libraryId, ownerScope: f.identity.ownerScope, sessionId: f.identity.sessionId };
    f.reregister();
    f.handle('observed');
    expect(await f.bridge.observe(f.window, f.identity, f.controller.signal)).toMatchObject(f.token);
  });

  it('keeps child-frame navigation independent and invalidates legacy main-frame navigation', async () => {
    const f = fixture();
    f.contents.emit('did-start-navigation', { isMainFrame: false });
    await f.observe();
    f.contents.emit('did-start-navigation', {}, 'url', false, true, 88, 2);
    expect(await f.bridge.observe(f.window, f.identity, f.controller.signal)).toBeUndefined();
    f.reregister();
    await f.observe();
  });

  it('classifies only a definite renderer rejection as not dispatched', async () => {
    const f = fixture();
    const bound = await f.observe();
    f.handle('rejected');
    await expect(f.bridge.verify(f.window, f.identity, bound, 'replaceText', f.controller.signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    await expect(f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    f.handle('unknown');
    await expect(f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal)).rejects.toMatchObject({ dispatchState: 'unknown' });
  });

  it('does not add an observation after rejected verification when diagnostics are disabled', async () => {
    const f = fixture();
    const bound = await f.observe();
    f.handle('rejected');
    await expect(f.bridge.verify(f.window, f.identity, bound, 'replaceText', f.controller.signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(f.contents.mainFrame.send.mock.calls.map(([, request]) => request.kind)).toEqual(['observe', 'verify']);
  });

  it('diagnoses a rejected scroll with one read-only observation and fixed differences, without dispatch or private identifiers', async () => {
    const diagnostic = vi.fn();
    const f = fixture(diagnostic);
    f.snapshot.controlId = 'agent-conversation';
    f.snapshot.operations = ['scrollDownPage'];
    f.snapshot.state = { kind: 'scroll', top: 20, clientHeight: 60, scrollHeight: 300 };
    const bound = await f.observe();
    const changed: FirstPartyControlSnapshot = { ...f.snapshot, revision: 2,
      bounds: { ...f.snapshot.bounds, x: f.snapshot.bounds.x + 1 }, operations: ['scrollDownStep'],
      state: { kind: 'scroll', top: 50, clientHeight: 60, scrollHeight: 360 } };
    f.contents.mainFrame.send.mockImplementation((_channel, request) => {
      f.reply(request, request.kind === 'verify' ? 'rejected' : 'observed', [changed]);
    });
    await expect(f.bridge.verify(f.window, f.identity, bound, 'scrollDownPage', f.controller.signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(f.contents.mainFrame.send.mock.calls.map(([, request]) => request.kind)).toEqual(['observe', 'verify', 'observe']);
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledWith({ available: true, revisionChanged: true, boundsChanged: true,
      stateChanged: true, operationsChanged: true, registrationChanged: false,
      scrollBefore: { top: 20, clientHeight: 60, scrollHeight: 300 },
      scrollAfter: { top: 50, clientHeight: 60, scrollHeight: 360 } });
    const serialized = JSON.stringify(diagnostic.mock.calls);
    for (const value of [f.token.registrationId, f.token.documentGeneration, f.snapshot.instanceId, f.identity.runId,
      f.identity.sessionId, f.identity.ownerScope.accountScope, f.identity.ownerScope.backendScope]) expect(serialized).not.toContain(value);
  });

  it('reports only a registration difference when a replacement registration appears after rejection', async () => {
    const diagnostic = vi.fn();
    const f = fixture(diagnostic);
    const bound = await f.observe();
    f.contents.mainFrame.send.mockImplementation((_channel, request) => {
      if (request.kind === 'verify') { f.reply(request, 'rejected'); f.reregister(); }
      else f.reply(request, 'observed');
    });
    await expect(f.bridge.verify(f.window, f.identity, bound, 'replaceText', f.controller.signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(diagnostic).toHaveBeenCalledWith({ available: true, revisionChanged: false, boundsChanged: false,
      stateChanged: false, operationsChanged: false, registrationChanged: true });
    expect(f.contents.mainFrame.send.mock.calls.map(([, request]) => request.kind)).toEqual(['observe', 'verify', 'observe']);
  });

  it.each(['observe-rejected', 'observe-throws', 'logger-throws', 'cancelled'] as const)('preserves definite rejection when %s interrupts the optional diagnostic', async cause => {
    const diagnostic = vi.fn<NonNullable<FirstPartyControlsDependencies['verifyRejectedDiagnostic']>>(() => {
      if (cause === 'logger-throws') throw new Error('diagnostic logger');
    });
    const f = fixture(diagnostic);
    const bound = await f.observe();
    f.contents.mainFrame.send.mockImplementation((_channel, request) => {
      if (request.kind === 'verify') {
        f.reply(request, 'rejected');
        if (cause === 'cancelled') f.controller.abort();
      } else if (cause === 'observe-throws') throw new Error('diagnostic transport');
      else f.reply(request, cause === 'observe-rejected' ? 'rejected' : 'observed');
    });
    await expect(f.bridge.verify(f.window, f.identity, bound, 'replaceText', f.controller.signal))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(diagnostic.mock.calls[0][0]).toMatchObject({ available: cause === 'logger-throws' });
    expect(f.contents.mainFrame.send.mock.calls.every(([, request]) => request.kind !== 'dispatch')).toBe(true);
    expect(f.contents.mainFrame.send).toHaveBeenCalledTimes(cause === 'cancelled' ? 2 : 3);
  });

  it('a timeout after dispatch is unknown; an aborted call before send is not dispatched', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const bound = await f.observe();
    f.contents.mainFrame.send.mockImplementation(() => undefined);
    const action = f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal);
    const assertion = expect(action).rejects.toMatchObject({ dispatchState: 'unknown' });
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    f.controller.abort();
    await expect(f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal)).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(f.contents.mainFrame.send).toHaveBeenCalledTimes(2);
  });

  it('rejects an expired receipt even when the event loop has not run the timeout callback', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const bound = await f.observe();
    f.contents.mainFrame.send.mockImplementation(() => undefined);
    const action = f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', 'x', f.controller.signal);
    const assertion = expect(action).rejects.toMatchObject({ dispatchState: 'unknown' });
    const request = f.contents.mainFrame.send.mock.calls[1][1];
    vi.setSystemTime(request.expiresAt);
    expect(() => f.reply(request, 'applied')).toThrow();
    await assertion;
    expect(() => f.reply(request, 'applied')).toThrow();
  });

  it('rejects unknown controls, undeclared operations and response kind changes', async () => {
    const f = fixture();
    const pending = f.bridge.observe(f.window, f.identity, f.controller.signal);
    const request = f.contents.mainFrame.send.mock.calls[0][1];
    expect(() => f.reply(request, 'applied')).toThrow();
    expect(() => f.bridge.complete(17, f.contents.mainFrame, { ...f.token, requestId: request.requestId, status: 'observed',
      controls: [{ ...f.snapshot, controlId: '__proto__' }] })).toThrow();
    f.reply(request, 'observed');
    const bound = (await pending)!.controls[0];
    await expect(f.bridge.verify(f.window, f.identity, bound, 'press', f.controller.signal)).rejects.toThrow();
    expect(f.contents.mainFrame.send).toHaveBeenCalledOnce();
  });

  it('releases owner listeners and records only bounded booleans even when diagnostics fail', async () => {
    const f = fixture();
    const bound = await f.observe();
    f.cursor.mockImplementation(() => { throw new Error('unavailable'); });
    f.target.isFocused.mockImplementation(() => { throw new Error('unavailable'); });
    f.applicationFocused.mockImplementation(() => { throw new Error('unavailable'); });
    f.handle('applied');
    await f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '', f.controller.signal);
    expect(f.log.mock.calls[0][0]).toEqual({ focusKnownBefore: false, focusKnownAfter: false,
      targetFocusedBefore: false, targetFocusedAfter: false, applicationFocusKnownBefore: false, applicationFocusKnownAfter: false,
      applicationFocusedBefore: false, applicationFocusedAfter: false,
      nativeApplicationFocusKnownBefore: false, nativeApplicationFocusKnownAfter: false,
      nativeApplicationFocusedBefore: false, nativeApplicationFocusedAfter: false,
      pointerKnownBefore: false, pointerKnownAfter: false, pointerMoved: false });
    f.bridge.releaseOwner(17);
    expect(f.contents.eventNames()).toEqual([]);
    f.reregister();
    expect(f.contents.listenerCount('destroyed')).toBe(1);
  });

  it('distinguishes a window retaining focus from an inactive application without changing the dispatch receipt', async () => {
    const f = fixture();
    const bound = await f.observe();
    f.target.isFocused.mockReturnValue(true);
    f.handle('applied');
    await f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '', f.controller.signal);
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({ focusKnownBefore: true, focusKnownAfter: true,
      targetFocusedBefore: true, targetFocusedAfter: true, applicationFocusKnownBefore: true, applicationFocusKnownAfter: true,
      applicationFocusedBefore: false, applicationFocusedAfter: false }));
    expect(f.contents.mainFrame.send.mock.calls.map(([, request]) => request.kind)).toEqual(['observe', 'dispatch']);
  });

  it('keeps application focus unknown before an optional getter has a known observation', async () => {
    const f = fixture();
    const bound = await f.observe();
    f.applicationFocused.mockReturnValue(undefined);
    f.handle('applied');
    await f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '', f.controller.signal);
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({ applicationFocusKnownBefore: false,
      applicationFocusKnownAfter: false, applicationFocusedBefore: false, applicationFocusedAfter: false }));
  });

  it('keeps fresh native activity separate from a stale Electron event and retained window focus', async () => {
    const native = vi.fn(async () => false);
    const f = fixture(undefined, native);
    const bound = await f.observe();
    f.applicationFocused.mockReturnValue(true);
    f.target.isFocused.mockReturnValue(true);
    f.handle('applied');
    await f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '', f.controller.signal);
    expect(native).toHaveBeenCalledTimes(2);
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({
      applicationFocusedBefore: true, applicationFocusedAfter: true,
      targetFocusedBefore: true, targetFocusedAfter: true,
      nativeApplicationFocusKnownBefore: true, nativeApplicationFocusKnownAfter: true,
      nativeApplicationFocusedBefore: false, nativeApplicationFocusedAfter: false }));
    expect(f.contents.mainFrame.send.mock.calls.map(([, request]) => request.kind)).toEqual(['observe', 'dispatch']);
  });

  it('does not dispatch when cancelled during the optional native query', async () => {
    let resolveBefore!: (focus: boolean) => void;
    const native = vi.fn<NonNullable<FirstPartyControlsDependencies['nativeApplicationFocused']>>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveBefore = resolve; }))
      .mockResolvedValue(false);
    const f = fixture(undefined, native);
    const bound = await f.observe();
    f.handle('applied');
    const action = f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '', f.controller.signal);
    const assertion = expect(action).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(f.contents.mainFrame.send).toHaveBeenCalledOnce();
    f.controller.abort();
    resolveBefore(false);
    await assertion;
    expect(f.contents.mainFrame.send).toHaveBeenCalledOnce();
    expect(native.mock.calls[0][0].aborted).toBe(true);
    expect(native.mock.calls[1][0].aborted).toBe(false);
  });

  it.each(['navigation', 'registration', 'window'] as const)('revalidates %s after native query latency before dispatch', async cause => {
    let resolveBefore!: (focus: boolean) => void;
    const native = vi.fn<NonNullable<FirstPartyControlsDependencies['nativeApplicationFocused']>>()
      .mockImplementation(() => new Promise(resolve => { resolveBefore = resolve; }));
    const f = fixture(undefined, native);
    const bound = await f.observe();
    f.handle('applied');
    const action = f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '', f.controller.signal);
    const assertion = expect(action).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    if (cause === 'navigation') emitNavigation(f.contents, 'details', true, false);
    if (cause === 'registration') f.reregister();
    if (cause === 'window') f.target.getMediaSourceId.mockReturnValue('window:25:0');
    resolveBefore(false);
    await assertion;
    expect(f.contents.mainFrame.send).toHaveBeenCalledOnce();
    expect(native).toHaveBeenCalledOnce();
  });

  it.each(['applied', 'rejected', 'unknown', 'cancelled'] as const)('preserves %s settlement when post native diagnostics fail', async status => {
    const native = vi.fn<NonNullable<FirstPartyControlsDependencies['nativeApplicationFocused']>>()
      .mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('unavailable'));
    const f = fixture(undefined, native);
    const bound = await f.observe();
    f.contents.mainFrame.send.mockImplementation((_channel, request) => {
      if (status === 'cancelled') f.controller.abort();
      else f.reply(request, status);
    });
    const action = f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '', f.controller.signal);
    if (status === 'applied') await expect(action).resolves.toBeUndefined();
    else await expect(action).rejects.toMatchObject({ dispatchState: status === 'rejected' ? 'not-dispatched' : 'unknown' });
    expect(native).toHaveBeenCalledTimes(2);
    expect(native.mock.calls[1][0]).not.toBe(f.controller.signal);
    expect(native.mock.calls[1][0].aborted).toBe(false);
    expect(f.contents.mainFrame.send.mock.calls.map(([, request]) => request.kind)).toEqual(['observe', 'dispatch']);
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({ nativeApplicationFocusKnownBefore: true,
      nativeApplicationFocusKnownAfter: false, nativeApplicationFocusedBefore: false, nativeApplicationFocusedAfter: false }));
  });

  it('does not turn a failed native pre-query into cached activity or an input failure', async () => {
    const native = vi.fn<NonNullable<FirstPartyControlsDependencies['nativeApplicationFocused']>>()
      .mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(false);
    const f = fixture(undefined, native);
    const bound = await f.observe();
    f.applicationFocused.mockReturnValue(true);
    f.handle('applied');
    await f.bridge.dispatch(f.window, f.identity, bound, 'replaceText', '', f.controller.signal);
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({ nativeApplicationFocusKnownBefore: false,
      nativeApplicationFocusKnownAfter: true, nativeApplicationFocusedBefore: false, nativeApplicationFocusedAfter: false,
      applicationFocusedBefore: true, applicationFocusedAfter: true }));
  });

  it('observes singleton application activity as unknown, active and inactive using read-only Electron events', async () => {
    const f = fixture();
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    configureAgentFirstPartyControls(() => f.target as unknown as BrowserWindow);
    try {
      agentFirstPartyControls.register(f.contents, f.contents.mainFrame, f.input);
      f.window.pid = process.pid;
      f.contents.mainFrame.send.mockImplementation((_channel, request) => {
        agentFirstPartyControls.complete(f.contents.id, f.contents.mainFrame, { requestId: request.requestId,
          registrationId: request.registrationId, documentGeneration: request.documentGeneration,
          status: request.kind === 'observe' ? 'observed' : 'applied', ...(request.kind === 'observe' ? { controls: [f.snapshot] } : {}) });
      });
      for (const focus of [undefined, true, false]) {
        if (focus !== undefined) electronMocks.applicationEventListeners.get(focus ? 'did-become-active' : 'did-resign-active')!();
        const observed = await agentFirstPartyControls.observe(f.window, f.identity, f.controller.signal);
        await agentFirstPartyControls.dispatch(f.window, f.identity, observed!.controls[0], 'replaceText', '', f.controller.signal);
        expect(log).toHaveBeenLastCalledWith('first-party-control-dispatch', expect.objectContaining({
          applicationFocusKnownBefore: focus !== undefined, applicationFocusKnownAfter: focus !== undefined,
          applicationFocusedBefore: focus === true, applicationFocusedAfter: focus === true }));
      }
    } finally {
      agentFirstPartyControls.releaseOwner(f.contents.id);
      configureAgentFirstPartyControls(() => null);
      log.mockRestore();
    }
  });
});
