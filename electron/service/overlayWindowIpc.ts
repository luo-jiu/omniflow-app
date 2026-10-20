import { ipcMain, type BrowserWindow, type WebContents, type WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { OverlayWindowController } from './overlayWindowController';
import type {
  OverlayCancelPayload,
  OverlayDismissFromRendererPayload,
  OverlayOpenPayload,
  OverlayResolvePayload,
  OverlaySpec,
  OverlayUpdatePayload,
} from './overlayWindowTypes';

const OVERLAY_REQUEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const OVERLAY_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Pending = {
  requestId: string;
  type: string;
  props: unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  senderContents: WebContents;
  senderFrame: WebFrameMain;
  frameProcessId: number;
  frameRoutingId: number;
  senderDestroyedListener: () => void;
  senderNavigationListener: (...args: unknown[]) => void;
  senderGoneListener: () => void;
  hostWindow?: BrowserWindow;
  timeoutTimer: ReturnType<typeof setTimeout>;
};

/** Main-only access to the existing request owner, never renderer IPC. */
export interface OverlayWindowMainAccess {
  dismissCurrent(frozenToken: object): boolean;
  read(): {
    epoch: number;
    promotion: number;
    queueLength: number;
    current?: {
      token: object;
      requestId: string;
      type: string;
      senderContents: WebContents;
      senderFrame: WebFrameMain;
      frameProcessId: number;
      frameRoutingId: number;
      hostWindow?: BrowserWindow;
    };
    host?: {
      window: BrowserWindow;
      mediaSourceId: string;
      contents: WebContents;
      frame: WebFrameMain;
      frameProcessId: number;
      frameRoutingId: number;
      ready: boolean;
    };
  };
}

function mainFrameNavigation(args: unknown[]): boolean {
  const details = args[0] as { isMainFrame?: boolean } | undefined;
  return details?.isMainFrame === true || args[3] === true;
}

export function registerOverlayWindowIpcHandlers(controller: OverlayWindowController): OverlayWindowMainAccess {
  let currentRequest: Pending | null = null;
  const queue: Pending[] = [];
  let epoch = 0;
  let promotion = 0;
  let host: NonNullable<ReturnType<OverlayWindowMainAccess['read']>['host']> & { cleanup(): void } | undefined;

  function cleanupPending(pending: Pending) {
    clearTimeout(pending.timeoutTimer);
    pending.senderContents.removeListener('destroyed', pending.senderDestroyedListener);
    pending.senderContents.removeListener('did-start-navigation', pending.senderNavigationListener);
    pending.senderContents.removeListener('render-process-gone', pending.senderGoneListener);
  }

  function cancelAll(reason: string) {
    const pending = [...(currentRequest ? [currentRequest] : []), ...queue];
    queue.length = 0;
    const current = currentRequest;
    currentRequest = null;
    epoch++;
    if (current) controller.dismissSpec({ requestId: current.requestId });
    for (const request of pending) rejectAndDrop(request, new Error(reason));
    if (current) {
      controller.setClickThrough(true);
      controller.hideIdle();
    }
  }

  // Observe only controller-owned windows. Reading a capability never installs listeners.
  function observeHost() {
    const window = controller.getWindow();
    if (!window || window.isDestroyed() || host?.window === window) return;
    if (host && currentRequest?.hostWindow === host.window) cancelAll('overlay host replaced');
    host?.cleanup();
    epoch++;
    const contents = window.webContents;
    const parentContents = window.getParentWindow()?.webContents;
    const parentNavigation = (...args: unknown[]) => {
      if (host?.window === window && mainFrameNavigation(args)) cancelAll('overlay parent navigated');
    };
    const parentGone = () => {
      if (host?.window === window) cancelAll('overlay parent unavailable');
    };
    const navigation = (...args: unknown[]) => {
      if (!mainFrameNavigation(args) || host?.window !== window) return;
      const wasReady = host.ready;
      host.ready = false;
      epoch++;
      // Initial loading may still be satisfying showSpec's ensureReady. Later
      // navigation must not leave requests waiting on an obsolete host frame.
      if (wasReady) cancelAll('overlay host navigated');
    };
    const gone = () => {
      if (host?.window !== window) return;
      host.ready = false;
      cancelAll('overlay host unavailable');
    };
    const closed = () => {
      gone();
      if (host?.window === window) host.cleanup();
    };
    host = { window, mediaSourceId: window.getMediaSourceId(), contents, frame: contents.mainFrame,
      frameProcessId: contents.mainFrame.processId, frameRoutingId: contents.mainFrame.routingId, ready: false,
      cleanup: () => {
        contents.removeListener('did-start-navigation', navigation);
        contents.removeListener('render-process-gone', gone);
        contents.removeListener('destroyed', gone);
        window.removeListener('closed', closed);
        parentContents?.removeListener('did-start-navigation', parentNavigation);
        parentContents?.removeListener('render-process-gone', parentGone);
        parentContents?.removeListener('destroyed', parentGone);
      } };
    contents.on('did-start-navigation', navigation);
    contents.on('render-process-gone', gone);
    contents.on('destroyed', gone);
    window.on('closed', closed);
    parentContents?.on('did-start-navigation', parentNavigation);
    parentContents?.on('render-process-gone', parentGone);
    parentContents?.on('destroyed', parentGone);
  }

  function isOwner(pending: Pending, event: { sender: WebContents; senderFrame: WebFrameMain | null }): boolean {
    try {
      return !event.sender.isDestroyed() && pending.senderContents === event.sender
        && pending.senderFrame === event.senderFrame && event.senderFrame === event.sender.mainFrame
        && pending.frameProcessId === event.senderFrame.processId && pending.frameRoutingId === event.senderFrame.routingId;
    } catch { return false; }
  }

  function isHost(event: { sender: WebContents; senderFrame: WebFrameMain | null }, ready = true): boolean {
    try {
      const window = controller.getWindow();
      return !!host && (!ready || host.ready) && host.window === window && !window.isDestroyed()
        && !event.sender.isDestroyed() && event.sender === window.webContents && host.contents === event.sender
        && event.senderFrame === event.sender.mainFrame && (!ready || host.frame === event.senderFrame)
        && (!ready || host.frameProcessId === event.senderFrame.processId && host.frameRoutingId === event.senderFrame.routingId);
    } catch { return false; }
  }

  function promote(next: Pending) {
    epoch++;
    promotion++;
    currentRequest = next;
    controller.setClickThrough(false);
    const spec: OverlaySpec = {
      requestId: next.requestId,
      type: next.type,
      props: next.props,
    };
    controller.showSpec(spec);
    observeHost();
    next.hostWindow = controller.getWindow() ?? undefined;
  }

  function advanceQueueOrIdle() {
    const next = queue.shift();
    if (next) {
      promote(next);
    } else {
      currentRequest = null;
      epoch++;
      controller.setClickThrough(true);
      controller.hideIdle();
    }
  }

  function rejectAndDrop(pending: Pending, reason: Error) {
    cleanupPending(pending);
    pending.reject(reason);
  }

  function handleSenderUnavailable(pending: Pending, reason: string) {
    if (currentRequest === pending) {
      epoch++;
      controller.dismissSpec({ requestId: pending.requestId });
      rejectAndDrop(pending, new Error(reason));
      advanceQueueOrIdle();
      return;
    }
    const index = queue.indexOf(pending);
    if (index >= 0) {
      epoch++;
      queue.splice(index, 1);
      rejectAndDrop(pending, new Error(reason));
    }
  }

  function handleTimeout(pending: Pending) {
    handleSenderUnavailable(pending, 'overlay request timed out');
  }

  function findPending(requestId: string): Pending | null {
    if (currentRequest?.requestId === requestId) {
      return currentRequest;
    }
    return queue.find((pending) => pending.requestId === requestId) ?? null;
  }

  function cancelPending(pending: Pending): boolean {
    const isCurrent = currentRequest === pending;
    const queuedIndex = queue.indexOf(pending);
    if (!isCurrent && queuedIndex < 0) return false;
    epoch++;
    if (isCurrent) controller.dismissSpec({ requestId: pending.requestId });
    else queue.splice(queuedIndex, 1);
    cleanupPending(pending);
    pending.resolve({ type: 'cancel' });
    if (isCurrent) advanceQueueOrIdle();
    return true;
  }

  ipcMain.handle('overlay:open', async (event, payload: OverlayOpenPayload) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed()) {
      throw new Error('invalid overlay sender frame');
    }
    const requestedId = String(payload?.requestId || '').trim();
    if (requestedId && !OVERLAY_REQUEST_ID_PATTERN.test(requestedId)) {
      throw new Error('invalid overlay request id');
    }
    const requestId = requestedId || randomUUID();
    if (findPending(requestId)) {
      throw new Error('overlay request id already exists');
    }
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        requestId,
        type: payload?.type,
        props: payload?.props,
        resolve,
        reject,
        senderContents: event.sender,
        senderFrame: event.senderFrame!,
        frameProcessId: event.senderFrame!.processId,
        frameRoutingId: event.senderFrame!.routingId,
        senderDestroyedListener: () => handleSenderUnavailable(pending, 'overlay sender destroyed'),
        senderNavigationListener: (...args) => {
          if (mainFrameNavigation(args)) handleSenderUnavailable(pending, 'overlay sender navigated');
        },
        senderGoneListener: () => handleSenderUnavailable(pending, 'overlay sender unavailable'),
        timeoutTimer: setTimeout(() => handleTimeout(pending), OVERLAY_REQUEST_TIMEOUT_MS),
      };
      event.sender.once('destroyed', pending.senderDestroyedListener);
      event.sender.on('did-start-navigation', pending.senderNavigationListener);
      event.sender.on('render-process-gone', pending.senderGoneListener);

      if (currentRequest) {
        epoch++;
        queue.push(pending);
      } else {
        promote(pending);
      }
    });
  });

  ipcMain.handle('overlay:update', (event, payload: OverlayUpdatePayload) => {
    const requestId = String(payload?.requestId || '').trim();
    if (!requestId) return false;
    const pending = findPending(requestId);
    if (!pending || !isOwner(pending, event)) return false;

    epoch++;
    pending.props = payload.props;
    if (currentRequest === pending) {
      controller.updateSpec({ requestId, props: payload.props });
    }
    return true;
  });

  ipcMain.handle('overlay:cancel', (event, payload: OverlayCancelPayload) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
    if (!OVERLAY_REQUEST_ID_PATTERN.test(requestId)) return false;
    const pending = findPending(requestId);
    if (!pending || !isOwner(pending, event)) return false;

    return cancelPending(pending);
  });

  ipcMain.on('overlay:host:resolve', (event, payload: OverlayResolvePayload) => {
    if (!currentRequest || currentRequest.requestId !== payload?.requestId || !isHost(event)
      || currentRequest.hostWindow !== host?.window) return;
    epoch++;
    const pending = currentRequest;
    cleanupPending(pending);
    pending.resolve(payload.result);
    advanceQueueOrIdle();
  });

  ipcMain.on('overlay:host:ready', (event) => {
    observeHost();
    if (!isHost(event, false)) return;
    host!.frame = event.senderFrame!;
    host!.frameProcessId = event.senderFrame!.processId;
    host!.frameRoutingId = event.senderFrame!.routingId;
    host!.ready = true;
    epoch++;
    controller.markReady(event.sender);
  });

  ipcMain.on('overlay:host:dismiss', (event, payload: OverlayDismissFromRendererPayload) => {
    if (!currentRequest || currentRequest.requestId !== payload?.requestId || !isHost(event)
      || currentRequest.hostWindow !== host?.window) return;
    epoch++;
    const pending = currentRequest;
    cleanupPending(pending);
    // Treat dismiss as a cancel result
    pending.resolve({ type: 'cancel', reason: payload.reason ?? 'dismiss' });
    advanceQueueOrIdle();
  });
  return Object.freeze({
    dismissCurrent: (frozenToken: object) => {
      const pending = currentRequest;
      if (!pending || pending !== frozenToken || !host || pending.hostWindow !== host.window
        || !isOwner(pending, { sender: pending.senderContents, senderFrame: pending.senderFrame })
        || !isHost({ sender: host.contents, senderFrame: host.frame })) return false;
      return cancelPending(pending);
    },
    read: () => ({ epoch, promotion, queueLength: queue.length,
    ...(currentRequest ? { current: { token: currentRequest, requestId: currentRequest.requestId, type: currentRequest.type,
      senderContents: currentRequest.senderContents, senderFrame: currentRequest.senderFrame,
      frameProcessId: currentRequest.frameProcessId, frameRoutingId: currentRequest.frameRoutingId,
      hostWindow: currentRequest.hostWindow } } : {}),
    ...(host ? { host: { window: host.window, mediaSourceId: host.mediaSourceId, contents: host.contents, frame: host.frame,
      frameProcessId: host.frameProcessId, frameRoutingId: host.frameRoutingId, ready: host.ready } } : {}),
  }) });
}
