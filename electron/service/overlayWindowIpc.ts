import { ipcMain, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { OverlayWindowController } from './overlayWindowController';
import type {
  OverlayDismissFromRendererPayload,
  OverlayOpenPayload,
  OverlayResolvePayload,
  OverlaySpec,
} from './overlayWindowTypes';

const OVERLAY_REQUEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

type Pending = {
  requestId: string;
  type: string;
  props: unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  senderContents: WebContents;
  senderDestroyedListener: () => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
};

export function registerOverlayWindowIpcHandlers(controller: OverlayWindowController) {
  let currentRequest: Pending | null = null;
  const queue: Pending[] = [];

  function cleanupPending(pending: Pending) {
    clearTimeout(pending.timeoutTimer);
    if (!pending.senderContents.isDestroyed()) {
      pending.senderContents.removeListener('destroyed', pending.senderDestroyedListener);
    }
  }

  function promote(next: Pending) {
    currentRequest = next;
    controller.setClickThrough(false);
    const spec: OverlaySpec = {
      requestId: next.requestId,
      type: next.type,
      props: next.props,
    };
    controller.showSpec(spec);
  }

  function advanceQueueOrIdle() {
    const next = queue.shift();
    if (next) {
      promote(next);
    } else {
      currentRequest = null;
      controller.setClickThrough(true);
      controller.hideIdle();
    }
  }

  function rejectAndDrop(pending: Pending, reason: Error) {
    cleanupPending(pending);
    pending.reject(reason);
  }

  function handleSenderDestroyed(pending: Pending) {
    if (currentRequest === pending) {
      controller.dismissSpec({ requestId: pending.requestId });
      rejectAndDrop(pending, new Error('overlay sender destroyed'));
      advanceQueueOrIdle();
      return;
    }
    const index = queue.indexOf(pending);
    if (index >= 0) {
      queue.splice(index, 1);
      rejectAndDrop(pending, new Error('overlay sender destroyed'));
    }
  }

  function handleTimeout(pending: Pending) {
    if (currentRequest === pending) {
      controller.dismissSpec({ requestId: pending.requestId });
      rejectAndDrop(pending, new Error('overlay request timed out'));
      advanceQueueOrIdle();
      return;
    }
    const index = queue.indexOf(pending);
    if (index >= 0) {
      queue.splice(index, 1);
      rejectAndDrop(pending, new Error('overlay request timed out'));
    }
  }

  ipcMain.handle('overlay:open', async (event, payload: OverlayOpenPayload) => {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        requestId,
        type: payload?.type,
        props: payload?.props,
        resolve,
        reject,
        senderContents: event.sender,
        senderDestroyedListener: () => handleSenderDestroyed(pending),
        timeoutTimer: setTimeout(() => handleTimeout(pending), OVERLAY_REQUEST_TIMEOUT_MS),
      };
      event.sender.once('destroyed', pending.senderDestroyedListener);

      if (currentRequest) {
        queue.push(pending);
      } else {
        promote(pending);
      }
    });
  });

  ipcMain.on('overlay:host:resolve', (_event, payload: OverlayResolvePayload) => {
    if (!currentRequest || currentRequest.requestId !== payload?.requestId) return;
    const pending = currentRequest;
    cleanupPending(pending);
    pending.resolve(payload.result);
    advanceQueueOrIdle();
  });

  ipcMain.on('overlay:host:ready', (event) => {
    controller.markReady(event.sender);
  });

  ipcMain.on('overlay:host:dismiss', (_event, payload: OverlayDismissFromRendererPayload) => {
    if (!currentRequest || currentRequest.requestId !== payload?.requestId) return;
    const pending = currentRequest;
    cleanupPending(pending);
    // Treat dismiss as a cancel result
    pending.resolve({ type: 'cancel', reason: payload.reason ?? 'dismiss' });
    advanceQueueOrIdle();
  });

}
