import type { AgentComputerSharedWindow } from '../../../platform/computer-use';

interface RenderingContents {
  isDestroyed(): boolean;
  getBackgroundThrottling(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
  once(event: 'destroyed' | 'render-process-gone', listener: () => void): unknown;
  removeListener(event: 'destroyed' | 'render-process-gone', listener: () => void): unknown;
}

interface RenderingWindow {
  isDestroyed(): boolean;
  getMediaSourceId(): string;
  webContents: RenderingContents;
}

interface RenderingLease {
  originalThrottling: boolean;
  references: number;
  closed: boolean;
  destroyed: () => void;
  restoreGeneration: number;
  cancelRestore?: () => void;
}

interface RenderingLeaseDependencies {
  processId: number;
  ownerWindow(ownerWebContentsId: number): RenderingWindow | undefined;
  restoreDelayMs?: number;
  scheduleRestore?(restore: () => void, delayMs: number): () => void;
}

/** Visible Workspace, Run UI and approved captures share one rendering policy per contents. */
export function createAgentRenderingLeaseManager(dependencies: RenderingLeaseDependencies) {
  const restoreDelayMs = dependencies.restoreDelayMs ?? 250;
  if (!Number.isSafeInteger(restoreDelayMs) || restoreDelayMs < 0 || restoreDelayMs > 1_000) {
    throw new Error('Agent rendering restoration delay must be bounded');
  }
  const scheduleRestore = dependencies.scheduleRestore ?? ((restore: () => void, delayMs: number) => {
    const timer = setTimeout(restore, delayMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  });
  const leases = new Map<RenderingContents, RenderingLease>();
  function cancelRestoration(lease: RenderingLease): void {
    lease.restoreGeneration += 1;
    const cancel = lease.cancelRestore;
    lease.cancelRestore = undefined;
    try { cancel?.(); }
    catch { /* Cleanup cannot replace an authoritative Run or Tool result. */ }
  }
  function restore(contents: RenderingContents, lease: RenderingLease): void {
    if (lease.closed || lease.references > 0 || leases.get(contents) !== lease) return;
    lease.closed = true;
    leases.delete(contents);
    cancelRestoration(lease);
    try {
      contents.removeListener('destroyed', lease.destroyed);
      contents.removeListener('render-process-gone', lease.destroyed);
    }
    catch { /* A destroyed contents may no longer accept listener cleanup. */ }
    if (!contents.isDestroyed()) {
      try { contents.setBackgroundThrottling(lease.originalThrottling); }
      catch { /* Restoration cannot interrupt Run cleanup. */ }
    }
  }
  function acquire(contents: RenderingContents): () => void {
    if (contents.isDestroyed()) return () => undefined;
    let lease = leases.get(contents);
    if (!lease) {
      lease = { originalThrottling: contents.getBackgroundThrottling(), references: 0, closed: false,
        destroyed: () => undefined, restoreGeneration: 0 };
      const current = lease;
      current.destroyed = () => {
        current.closed = true;
        cancelRestoration(current);
        if (leases.get(contents) === current) leases.delete(contents);
        try {
          contents.removeListener('destroyed', current.destroyed);
          contents.removeListener('render-process-gone', current.destroyed);
        } catch { /* Closing contents may no longer accept cleanup. */ }
        if (!contents.isDestroyed()) {
          try { contents.setBackgroundThrottling(current.originalThrottling); }
          catch { /* A crashed renderer cannot interrupt Run cleanup. */ }
        }
      };
      let attemptedChange = false;
      try {
        contents.once('destroyed', current.destroyed);
        contents.once('render-process-gone', current.destroyed);
        if (current.closed || contents.isDestroyed()) return () => undefined;
        attemptedChange = true;
        contents.setBackgroundThrottling(false);
        if (current.closed || contents.isDestroyed()) return () => undefined;
        leases.set(contents, current);
      } catch (error) {
        current.closed = true;
        try {
          contents.removeListener('destroyed', current.destroyed);
          contents.removeListener('render-process-gone', current.destroyed);
        }
        catch { /* Preserve the acquisition error if the contents has disappeared. */ }
        if (attemptedChange && !contents.isDestroyed()) {
          try { contents.setBackgroundThrottling(current.originalThrottling); }
          catch { /* Acquisition rollback is best effort; it must preserve the original error. */ }
        }
        throw error;
      }
    }
    cancelRestoration(lease);
    lease.references += 1;
    const current = lease;
    let released = false;
    return () => {
      if (released || current.closed) return;
      released = true;
      current.references -= 1;
      if (current.references > 0) return;
      if (restoreDelayMs === 0) { restore(contents, current); return; }
      // Run references end synchronously. Only the local drawing policy gets a
      // short grace period for queued terminal IPC/React work; it grants no input
      // or capture capability and is not a frame-completion acknowledgment.
      const generation = ++current.restoreGeneration;
      try {
        const cancel = scheduleRestore(() => {
          if (current.restoreGeneration !== generation) return;
          restore(contents, current);
        }, restoreDelayMs);
        if (current.closed || current.restoreGeneration !== generation) cancel();
        else current.cancelRestore = cancel;
      } catch {
        restore(contents, current);
      }
    };
  }
  function ownerWindow(ownerWebContentsId: number): RenderingWindow | undefined {
    if (!Number.isSafeInteger(ownerWebContentsId) || ownerWebContentsId <= 0) return undefined;
    const owner = dependencies.ownerWindow(ownerWebContentsId);
    return owner && !owner.isDestroyed() && !owner.webContents.isDestroyed() ? owner : undefined;
  }
  function keepOwnerRendering(ownerWebContentsId: number): () => void {
    const owner = ownerWindow(ownerWebContentsId);
    return owner ? acquire(owner.webContents) : () => undefined;
  }
  function keepApprovedWindowRendering(window: AgentComputerSharedWindow, ownerWebContentsId: number): () => void {
    if (window.pid !== dependencies.processId) return () => undefined;
    const owner = ownerWindow(ownerWebContentsId);
    if (!owner) return () => undefined;
    const nativeId = /^window:([1-9][0-9]*):[0-9]+$/u.exec(owner.getMediaSourceId());
    if (!nativeId || Number(nativeId[1]) !== window.windowId) return () => undefined;
    return acquire(owner.webContents);
  }
  return { keepOwnerRendering, keepApprovedWindowRendering };
}

/** Compatibility wrapper for independent approved-window consumers. */
export function createAgentComputerRenderingLease(dependencies: RenderingLeaseDependencies) {
  return createAgentRenderingLeaseManager({ ...dependencies, restoreDelayMs: dependencies.restoreDelayMs ?? 0 })
    .keepApprovedWindowRendering;
}
