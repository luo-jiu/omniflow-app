import type { BrowserWindow, WebContents, WebFrameMain } from 'electron';
import type { AgentComputerRect, AgentComputerSharedWindow, AgentComputerWindowIdentity } from '../../../platform/computer-use';
import type { AgentToolMainPreparationIdentity } from '../agent-tool-registry';
import type { OverlayWindowMainAccess } from '../../overlayWindowIpc';
import type { OverlayWindowController } from '../../overlayWindowController';
import type { AgentComputerRuntimeDependencies } from './agent-computer-runtime';

type Association = NonNullable<AgentComputerRuntimeDependencies['associatedMenu']>;
type State = ReturnType<OverlayWindowMainAccess['read']>;
interface Owner {
  main: BrowserWindow;
  contents: WebContents;
  frame: WebFrameMain;
  frameProcessId: number;
  frameRoutingId: number;
  bounds: AgentComputerRect;
  contentBounds: AgentComputerRect;
  overlay: BrowserWindow;
  overlayContents: WebContents;
  overlayFrame: WebFrameMain;
  overlayProcessId: number;
  overlayRoutingId: number;
  overlayId: number;
  overlayBounds: AgentComputerRect;
}

function nativeWindowId(window: BrowserWindow): number | undefined {
  const match = /^window:([1-9][0-9]*):[0-9]+$/u.exec(window.getMediaSourceId());
  const id = match && Number(match[1]);
  return id && Number.isSafeInteger(id) ? id : undefined;
}

function sameBounds(a: AgentComputerRect, b: AgentComputerRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function validBounds(bounds: AgentComputerRect): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width > 0 && bounds.height > 0;
}

function sameOwner(a: Owner, b: Owner): boolean {
  return a.main === b.main && a.contents === b.contents && a.frame === b.frame
    && a.frameProcessId === b.frameProcessId && a.frameRoutingId === b.frameRoutingId
    && sameBounds(a.bounds, b.bounds) && sameBounds(a.contentBounds, b.contentBounds)
    && a.overlay === b.overlay && a.overlayContents === b.overlayContents && a.overlayFrame === b.overlayFrame
    && a.overlayProcessId === b.overlayProcessId && a.overlayRoutingId === b.overlayRoutingId
    && a.overlayId === b.overlayId && sameBounds(a.overlayBounds, b.overlayBounds);
}

function ownsMenu(state: State, owner: Owner): boolean {
  const request = state.current;
  return !!request && request.type === 'directory-context-menu' && request.senderContents === owner.contents
    && request.senderFrame === owner.frame && request.frameProcessId === owner.frameProcessId
    && request.frameRoutingId === owner.frameRoutingId && request.hostWindow === owner.overlay;
}

/**
 * Associates only main's existing directory-menu request with its existing child
 * window. No discovery, renderer capability, library ownership or input dispatch.
 */
export function createAgentComputerAssociatedMenu(dependencies: {
  getMainWindow(): BrowserWindow | null;
  controller: Pick<OverlayWindowController, 'getWindow'>;
  access: OverlayWindowMainAccess;
  processId?: number;
}): Association {
  const processId = dependencies.processId ?? process.pid;

  function owner(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity, state: State): Owner | undefined {
    try {
      if (window.pid !== processId || window.layer !== 0 || !Number.isFinite(window.processStartedAt) || window.processStartedAt <= 0) return;
      const main = dependencies.getMainWindow();
      const overlay = dependencies.controller.getWindow();
      if (!main || main.isDestroyed() || !main.isVisible() || main.isMinimized()
        || main.webContents.isDestroyed() || main.webContents.id !== identity.ownerWebContentsId
        || nativeWindowId(main) !== window.windowId || !sameBounds(main.getBounds(), window.bounds)
        || !overlay || overlay.isDestroyed() || overlay.isAlwaysOnTop() || overlay.getParentWindow() !== main
        || overlay.webContents.isDestroyed()) return;
      const host = state.host;
      if (!host || !host.ready || host.window !== overlay || host.contents !== overlay.webContents
        || host.mediaSourceId !== overlay.getMediaSourceId()
        || host.frame !== overlay.webContents.mainFrame || host.frameProcessId !== host.frame.processId
        || host.frameRoutingId !== host.frame.routingId) return;
      const overlayId = nativeWindowId(overlay);
      const bounds = { ...main.getBounds() };
      const contentBounds = { ...main.getContentBounds() };
      const overlayBounds = { ...overlay.getBounds() };
      if (!overlayId || !validBounds(bounds) || !validBounds(contentBounds) || !validBounds(overlayBounds)
        || !sameBounds(contentBounds, overlayBounds)) return;
      const frame = main.webContents.mainFrame;
      return { main, contents: main.webContents, frame, frameProcessId: frame.processId, frameRoutingId: frame.routingId,
        bounds, contentBounds, overlay, overlayContents: overlay.webContents, overlayFrame: host.frame,
        overlayProcessId: host.frameProcessId, overlayRoutingId: host.frameRoutingId, overlayId, overlayBounds };
    } catch { return undefined; }
  }

  function menuWindow(window: AgentComputerSharedWindow, target: Owner): AgentComputerWindowIdentity {
    // Both windows belong to the already-approved Electron main process. The
    // controller creates this ordinary (non-always-on-top) child at layer zero.
    return Object.freeze({ windowId: target.overlayId, pid: window.pid, processStartedAt: window.processStartedAt,
      layer: 0, bounds: Object.freeze({ ...target.overlayBounds }) });
  }

  return Object.freeze({
    current(window, identity) {
      const baseline = dependencies.access.read();
      const target = owner(window, identity, baseline);
      if (!target || !target.overlay.isVisible() || !ownsMenu(baseline, target)) return;
      const valid = () => {
        const next = dependencies.access.read();
        const current = owner(window, identity, next);
        return !!current && next.epoch === baseline.epoch && next.promotion === baseline.promotion
          && next.current?.token === baseline.current?.token && sameOwner(target, current)
          && current.overlay.isVisible() && ownsMenu(next, current);
      };
      return { key: `${baseline.epoch}:${baseline.promotion}:${baseline.current!.requestId}`, window: menuWindow(window, target),
        valid, dismiss: () => valid() && dependencies.access.dismissCurrent(baseline.current!.token) };
    },
    prepareCompletion(window, identity) {
      const baseline = dependencies.access.read();
      const target = owner(window, identity, baseline);
      if (!target || baseline.current || baseline.queueLength !== 0 || target.overlay.isVisible()) return;
      return { window: menuWindow(window, target), validate: completionWindowId => {
        const next = dependencies.access.read();
        const current = owner(window, identity, next);
        if (!current || !sameOwner(target, current) || next.queueLength !== 0) return false;
        if (next.epoch === baseline.epoch && next.promotion === baseline.promotion && !next.current) {
          return completionWindowId === undefined && !current.overlay.isVisible();
        }
        // Exactly one fresh promotion: intervening update, cancellation, queue or
        // navigation cannot be mistaken for the right-click's own menu opening.
        return next.epoch === baseline.epoch + 1 && next.promotion === baseline.promotion + 1
          && ownsMenu(next, current) && current.overlay.isVisible()
          && (completionWindowId === undefined || completionWindowId === current.overlayId);
      } };
    },
  } satisfies Association);
}
