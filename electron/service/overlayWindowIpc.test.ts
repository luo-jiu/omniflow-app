import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayWindowController } from './overlayWindowController';

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

import { registerOverlayWindowIpcHandlers } from './overlayWindowIpc';

const REQUEST_A = '00000000-0000-4000-8000-000000000001';
const REQUEST_B = '00000000-0000-4000-8000-000000000002';
const REQUEST_C = '00000000-0000-4000-8000-000000000003';

function createSender() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false });
}

function createController() {
  return {
    ensureReady: vi.fn().mockResolvedValue(undefined),
    markReady: vi.fn(),
    getWindow: vi.fn().mockReturnValue(null),
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

  beforeEach(() => {
    vi.useFakeTimers();
    ipc.handlers.clear();
    ipc.listeners.clear();
    controller = createController();
    sender = createSender();
    registerOverlayWindowIpcHandlers(controller);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function open(requestId: string, owner = sender): Promise<unknown> {
    return ipc.handlers.get('overlay:open')!({ sender: owner }, {
      requestId, type: 'delete-confirm', props: { nodeName: requestId },
    });
  }

  function cancel(requestId: unknown, owner = sender): boolean {
    return ipc.handlers.get('overlay:cancel')!({ sender: owner }, { requestId });
  }

  function resolve(requestId: string) {
    ipc.listeners.get('overlay:host:resolve')!({}, { requestId, result: { type: 'confirm' } });
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
    expect(ipc.handlers.get('overlay:update')!({ sender }, { requestId: REQUEST_A, props: {} })).toBe(false);
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
});
