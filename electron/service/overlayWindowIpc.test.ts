import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayWindowController } from './overlayWindowController';
import type { BrowserWindow } from 'electron';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, payload: any) => any>(),
  listeners: new Map<string, (event: any, payload: any) => void>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, callback: any) => ipc.handlers.set(channel, callback),
    on: (channel: string, callback: any) => ipc.listeners.set(channel, callback),
  },
}));

import { registerOverlayWindowIpcHandlers, type OverlayWindowMainAccess } from './overlayWindowIpc';

const REQUEST_A = '00000000-0000-4000-8000-000000000001';
const REQUEST_B = '00000000-0000-4000-8000-000000000002';
const REQUEST_C = '00000000-0000-4000-8000-000000000003';

let nextSenderId = 0;
function createSender() {
  const id = ++nextSenderId;
  return Object.assign(new EventEmitter(), { id, mainFrame: { processId: id + 100, routingId: id + 200 }, isDestroyed: () => false });
}

function createWindow() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: createSender(),
    getMediaSourceId: () => 'window:100:0', getParentWindow: () => null }) as unknown as BrowserWindow;
}

function eventFor(sender: ReturnType<typeof createSender>) {
  return { sender, senderFrame: sender.mainFrame };
}

function createController() {
  return {
    ensureReady: vi.fn().mockResolvedValue(undefined),
    markReady: vi.fn(),
    getWindow: vi.fn().mockReturnValue(createWindow()),
    showSpec: vi.fn(),
    updateSpec: vi.fn(),
    dismissSpec: vi.fn(),
    setClickThrough: vi.fn(),
    hideIdle: vi.fn(),
    restoreActive: vi.fn(),
    syncBoundsFromMain: vi.fn(),
    destroy: vi.fn(),
  } satisfies OverlayWindowController;
}

describe('overlay session cancellation IPC', () => {
  let controller: ReturnType<typeof createController>;
  let sender: ReturnType<typeof createSender>;
  let access: OverlayWindowMainAccess;

  function hostEvent() {
    const sender = controller.getWindow()!.webContents;
    return { sender, senderFrame: sender.mainFrame };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    ipc.handlers.clear();
    ipc.listeners.clear();
    controller = createController();
    sender = createSender();
    access = registerOverlayWindowIpcHandlers(controller);
    ipc.listeners.get('overlay:host:ready')!(hostEvent(), undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function open(requestId: string, owner = sender): Promise<unknown> {
    return ipc.handlers.get('overlay:open')!(eventFor(owner), {
      requestId, type: 'delete-confirm', props: { nodeName: requestId },
    });
  }

  function cancel(requestId: unknown, owner = sender): boolean {
    return ipc.handlers.get('overlay:cancel')!(eventFor(owner), { requestId });
  }

  function resolve(requestId: string) {
    ipc.listeners.get('overlay:host:resolve')!(hostEvent(), { requestId, result: { type: 'confirm' } });
  }

  it('dismisses an active request, settles it as cancel and releases its timer and sender listener', async () => {
    const result = open(REQUEST_A);
    expect(sender.listenerCount('destroyed')).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    expect(cancel(REQUEST_A)).toBe(true);
    await expect(result).resolves.toEqual({ type: 'cancel' });
    expect(controller.dismissSpec).toHaveBeenCalledWith({ requestId: REQUEST_A });
    expect(controller.setClickThrough).toHaveBeenLastCalledWith(true);
    expect(controller.hideIdle).toHaveBeenCalledTimes(1);
    expect(sender.listenerCount('destroyed')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    expect(cancel(REQUEST_A)).toBe(false);
    expect(ipc.handlers.get('overlay:update')!(eventFor(sender), { requestId: REQUEST_A, props: {} })).toBe(false);
    expect(controller.dismissSpec).toHaveBeenCalledTimes(1);
  });

  it('advances to the next request and ignores a canceled request’s late result', async () => {
    const first = open(REQUEST_A);
    const next = open(REQUEST_B);
    expect(cancel(REQUEST_A)).toBe(true);
    await expect(first).resolves.toEqual({ type: 'cancel' });
    expect(controller.showSpec.mock.calls.map(([value]) => value.requestId)).toEqual([REQUEST_A, REQUEST_B]);
    expect(controller.hideIdle).not.toHaveBeenCalled();

    resolve(REQUEST_A);
    expect(controller.hideIdle).not.toHaveBeenCalled();
    expect(cancel(REQUEST_B)).toBe(true);
    await expect(next).resolves.toEqual({ type: 'cancel' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dismisses only the frozen current token through the existing cancel lifecycle', async () => {
    const result = open(REQUEST_A);
    const token = access.read().current!.token;
    const epoch = access.read().epoch;
    expect(access.dismissCurrent({})).toBe(false);
    expect(access.read().epoch).toBe(epoch);
    expect(controller.dismissSpec).not.toHaveBeenCalled();
    expect(access.dismissCurrent(token)).toBe(true);
    await expect(result).resolves.toEqual({ type: 'cancel' });
    expect(access.read().current).toBeUndefined();
    expect(controller.dismissSpec).toHaveBeenCalledOnce();
    expect(controller.dismissSpec).toHaveBeenCalledWith({ requestId: REQUEST_A });
    expect(controller.hideIdle).toHaveBeenCalledOnce();
    expect(sender.listenerCount('destroyed')).toBe(0);
    expect(sender.listenerCount('did-start-navigation')).toBe(0);
    expect(sender.listenerCount('render-process-gone')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(access.dismissCurrent(token)).toBe(false);
  });

  it('never lets an old token dismiss a promoted request or reused request id', async () => {
    const first = open(REQUEST_A);
    const token = access.read().current!.token;
    const queued = open(REQUEST_B);
    expect(access.dismissCurrent(token)).toBe(true);
    await first;
    expect(access.read().current?.requestId).toBe(REQUEST_B);
    expect(access.dismissCurrent(token)).toBe(false);
    cancel(REQUEST_B); await queued;
    const replacement = open(REQUEST_A);
    expect(access.dismissCurrent(token)).toBe(false);
    expect(access.read().current?.requestId).toBe(REQUEST_A);
    cancel(REQUEST_A); await replacement;
  });

  it.each(['owner-frame', 'host-frame', 'host-replacement'] as const)('refuses a frozen token after %s changes', async change => {
    const result = open(REQUEST_A);
    const token = access.read().current!.token;
    if (change === 'owner-frame') sender.mainFrame.routingId++;
    if (change === 'host-frame') controller.getWindow()!.webContents.mainFrame.routingId++;
    if (change === 'host-replacement') controller.getWindow.mockReturnValue(createWindow());
    expect(access.dismissCurrent(token)).toBe(false);
    expect(controller.dismissSpec).not.toHaveBeenCalled();
    // The owner still settles through the already-authorized renderer path.
    if (change === 'owner-frame') sender.mainFrame.routingId--;
    expect(cancel(REQUEST_A)).toBe(true);
    await expect(result).resolves.toEqual({ type: 'cancel' });
  });

  it('removes only the queued request without dismissing or replacing the active request', async () => {
    const current = open(REQUEST_A);
    const canceled = open(REQUEST_B);
    const later = open(REQUEST_C);
    expect(cancel(REQUEST_B)).toBe(true);
    await expect(canceled).resolves.toEqual({ type: 'cancel' });
    expect(controller.showSpec).toHaveBeenCalledTimes(1);
    expect(controller.dismissSpec).not.toHaveBeenCalled();
    expect(controller.hideIdle).not.toHaveBeenCalled();
    expect(controller.setClickThrough.mock.calls).toEqual([[false]]);
    expect(sender.listenerCount('destroyed')).toBe(2);
    expect(vi.getTimerCount()).toBe(2);

    resolve(REQUEST_A);
    await expect(current).resolves.toEqual({ type: 'confirm' });
    expect(controller.showSpec.mock.calls.map(([value]) => value.requestId)).toEqual([REQUEST_A, REQUEST_C]);
    expect(cancel(REQUEST_C)).toBe(true);
    await expect(later).resolves.toEqual({ type: 'cancel' });
  });

  it('rejects cancellation by another sender for both active and queued requests', async () => {
    const foreign = createSender();
    const first = open(REQUEST_A);
    const next = open(REQUEST_B);
    expect(cancel(REQUEST_A, foreign)).toBe(false);
    expect(cancel(REQUEST_B, foreign)).toBe(false);
    expect(controller.dismissSpec).not.toHaveBeenCalled();
    expect(controller.showSpec).toHaveBeenCalledTimes(1);
    expect(sender.listenerCount('destroyed')).toBe(2);

    cancel(REQUEST_B);
    cancel(REQUEST_A);
    await expect(first).resolves.toEqual({ type: 'cancel' });
    await expect(next).resolves.toEqual({ type: 'cancel' });
  });

  it('returns false for malformed, missing and already settled requests', async () => {
    for (const requestId of [undefined, null, 7, {}, '', 'invalid', REQUEST_C]) {
      expect(cancel(requestId)).toBe(false);
    }
    const result = open(REQUEST_A);
    resolve(REQUEST_A);
    await expect(result).resolves.toEqual({ type: 'confirm' });
    expect(cancel(REQUEST_A)).toBe(false);
    expect(controller.dismissSpec).not.toHaveBeenCalled();
  });

  it('does not cancel a different request after the original sender is destroyed', async () => {
    const first = open(REQUEST_A);
    const rejected = expect(first).rejects.toThrow('overlay sender destroyed');
    const anotherSender = createSender();
    const next = open(REQUEST_B, anotherSender);
    sender.emit('destroyed');
    await rejected;
    expect(cancel(REQUEST_A)).toBe(false);
    expect(cancel(REQUEST_B)).toBe(false);
    expect(controller.showSpec.mock.calls.map(([value]) => value.requestId)).toEqual([REQUEST_A, REQUEST_B]);

    expect(cancel(REQUEST_B, anotherSender)).toBe(true);
    await expect(next).resolves.toEqual({ type: 'cancel' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('exposes only the current request owner with monotonically invalidated epochs', async () => {
    const idle = access.read();
    const result = open(REQUEST_A);
    const current = access.read();
    expect(current.promotion).toBe(idle.promotion + 1);
    expect(current.epoch).toBe(idle.epoch + 1);
    expect(current.current).toMatchObject({ requestId: REQUEST_A, senderContents: sender, senderFrame: sender.mainFrame,
      frameProcessId: sender.mainFrame.processId, frameRoutingId: sender.mainFrame.routingId,
      hostWindow: controller.getWindow() });
    expect(ipc.handlers.get('overlay:update')!(eventFor(sender), { requestId: REQUEST_A, props: {} })).toBe(true);
    expect(access.read().epoch).toBeGreaterThan(current.epoch);
    expect(access.read().current!.token).toBe(current.current!.token);
    expect(access.read().promotion).toBe(current.promotion);
    cancel(REQUEST_A);
    await result;
    expect(access.read().current).toBeUndefined();
    const replacement = open(REQUEST_A);
    expect(access.read().current!.token).not.toBe(current.current!.token);
    cancel(REQUEST_A);
    await replacement;
  });

  it('rejects subframe open and owner update/cancel from a different frame generation', async () => {
    await expect(ipc.handlers.get('overlay:open')!({ sender, senderFrame: { ...sender.mainFrame } }, {
      requestId: REQUEST_A, type: 'delete-confirm',
    })).rejects.toThrow('invalid overlay sender frame');
    const result = open(REQUEST_A);
    const baseline = access.read().epoch;
    const foreignFrame = { sender, senderFrame: { ...sender.mainFrame } };
    expect(ipc.handlers.get('overlay:update')!(foreignFrame, { requestId: REQUEST_A, props: {} })).toBe(false);
    expect(ipc.handlers.get('overlay:cancel')!(foreignFrame, { requestId: REQUEST_A })).toBe(false);
    sender.mainFrame.routingId++;
    expect(cancel(REQUEST_A)).toBe(false);
    expect(access.read().epoch).toBe(baseline);
    resolve(REQUEST_A);
    await result;
  });

  it.each(['did-start-navigation', 'render-process-gone'] as const)('cancels all old owner pending requests on %s', async event => {
    const first = open(REQUEST_A);
    const next = open(REQUEST_B);
    const rejectedFirst = expect(first).rejects.toThrow(event === 'did-start-navigation' ? 'navigated' : 'unavailable');
    const rejectedNext = expect(next).rejects.toThrow(event === 'did-start-navigation' ? 'navigated' : 'unavailable');
    sender.emit(event, { isMainFrame: true });
    await rejectedFirst; await rejectedNext;
    expect(access.read().current).toBeUndefined();
    expect(access.read().queueLength).toBe(0);
    expect(sender.listenerCount('did-start-navigation')).toBe(0);
    expect(sender.listenerCount('render-process-gone')).toBe(0);
    expect(sender.listenerCount('destroyed')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a request on subframe navigation and ignores forged host replies and readiness', async () => {
    const result = open(REQUEST_A);
    const baseline = access.read().epoch;
    sender.emit('did-start-navigation', {}, 'about:blank', false, false);
    ipc.listeners.get('overlay:host:resolve')!(eventFor(sender), { requestId: REQUEST_A, result: { type: 'confirm' } });
    ipc.listeners.get('overlay:host:dismiss')!(eventFor(sender), { requestId: REQUEST_A });
    const host = hostEvent();
    ipc.listeners.get('overlay:host:resolve')!({ ...host, senderFrame: { ...host.senderFrame } }, {
      requestId: REQUEST_A, result: { type: 'confirm' },
    });
    controller.markReady.mockClear();
    ipc.listeners.get('overlay:host:ready')!(eventFor(sender), undefined);
    expect(controller.markReady).not.toHaveBeenCalled();
    expect(access.read().epoch).toBe(baseline);
    expect(access.read().current?.requestId).toBe(REQUEST_A);
    resolve(REQUEST_A);
    await expect(result).resolves.toEqual({ type: 'confirm' });
  });

  it.each(['did-start-navigation', 'render-process-gone', 'destroyed'] as const)('cancels active and queued work on host %s', async event => {
    const first = open(REQUEST_A);
    const next = open(REQUEST_B);
    const rejectedFirst = expect(first).rejects.toThrow(/overlay host/);
    const rejectedNext = expect(next).rejects.toThrow(/overlay host/);
    const before = access.read().epoch;
    controller.getWindow()!.webContents.emit(event, { isMainFrame: true });
    await rejectedFirst; await rejectedNext;
    expect(access.read().current).toBeUndefined();
    expect(access.read().host?.ready).toBe(false);
    expect(access.read().epoch).toBeGreaterThan(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels requests bound to a replaced host and removes old host lifecycle listeners', async () => {
    const old = controller.getWindow()!;
    const result = open(REQUEST_A);
    const rejected = expect(result).rejects.toThrow('overlay host replaced');
    controller.getWindow.mockReturnValue(createWindow());
    ipc.listeners.get('overlay:host:ready')!(hostEvent(), undefined);
    await rejected;
    expect(old.webContents.listenerCount('did-start-navigation')).toBe(0);
    expect(old.listenerCount('closed')).toBe(0);
    expect(access.read().host?.window).toBe(controller.getWindow());
    expect(access.read().current).toBeUndefined();
  });
});
