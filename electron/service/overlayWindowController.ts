import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type {
  OverlayDismissFromMainPayload,
  OverlaySpec,
} from './overlayWindowTypes';

type OverlayWindowControllerOptions = {
  getMainWindow: () => BrowserWindow | null;
  preloadPath: string;
  rendererDist: string;
  devServerUrl: string | undefined;
};

export type OverlayWindowController = {
  ensureReady: () => Promise<void>;
  markReady: (fromWebContents: Electron.WebContents) => void;
  getWindow: () => BrowserWindow | null;
  showSpec: (spec: OverlaySpec) => void;
  dismissSpec: (payload: OverlayDismissFromMainPayload) => void;
  setClickThrough: (ignore: boolean) => void;
  hideIdle: () => void;
  syncBoundsFromMain: () => void;
  destroy: () => void;
};

export function createOverlayWindowController(
  options: OverlayWindowControllerOptions,
): OverlayWindowController {
  let overlayWin: BrowserWindow | null = null;
  let readyPromise: Promise<void> | null = null;
  let readyResolve: (() => void) | null = null;
  let boundsSyncScheduled = false;
  let screenListenerAttached = false;

  function ensureCreated(): BrowserWindow | null {
    if (overlayWin && !overlayWin.isDestroyed()) {
      return overlayWin;
    }
    const mainWindow = options.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null;
    }

    if (!screenListenerAttached) {
      // Attach lazily: `screen` module is only accessible after app 'ready'
      screen.on('display-metrics-changed', () => {
        syncBoundsFromMain();
      });
      screenListenerAttached = true;
    }

    const win = new BrowserWindow({
      parent: mainWindow,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: true,
      show: false,
      backgroundColor: '#00000000',
      acceptFirstMouse: true,
      webPreferences: {
        preload: options.preloadPath,
        devTools: true,
      },
    });

    overlayWin = win;
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setContentBounds(mainWindow.getContentBounds());

    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('[overlay] render-process-gone', details);
    });

    if (options.devServerUrl) {
      const url = options.devServerUrl.replace(/\/$/, '') + '/overlay.html';
      void win.loadURL(url);
    } else {
      void win.loadFile(path.join(options.rendererDist, 'overlay.html'));
    }

    win.on('closed', () => {
      if (overlayWin === win) {
        overlayWin = null;
        readyPromise = null;
        readyResolve = null;
      }
    });

    return win;
  }

  async function ensureReady() {
    const win = ensureCreated();
    if (!win) return;
    if (readyPromise) await readyPromise;
  }

  function markReady(fromWebContents: Electron.WebContents) {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    if (fromWebContents !== overlayWin.webContents) return;
    if (readyResolve) {
      const resolve = readyResolve;
      readyResolve = null;
      resolve();
    }
  }

  function syncBoundsFromMain() {
    if (boundsSyncScheduled) return;
    boundsSyncScheduled = true;
    setImmediate(() => {
      boundsSyncScheduled = false;
      if (!overlayWin || overlayWin.isDestroyed()) return;
      const mainWindow = options.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        overlayWin.setContentBounds(mainWindow.getContentBounds());
      } catch {
        // ignore transient bounds errors (e.g. during fullscreen transition)
      }
    });
  }

  function showSpec(spec: OverlaySpec) {
    const win = ensureCreated();
    if (!win) return;
    void (async () => {
      await ensureReady();
      if (!overlayWin || overlayWin.isDestroyed()) return;
      syncBoundsFromMain();
      if (!overlayWin.isVisible()) {
        overlayWin.show();
      }
      overlayWin.webContents.send('overlay:host:show', spec);
      overlayWin.focus();
    })();
  }

  function dismissSpec(payload: OverlayDismissFromMainPayload) {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    overlayWin.webContents.send('overlay:host:dismiss-from-main', payload);
  }

  function setClickThrough(ignore: boolean) {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    if (ignore) {
      overlayWin.setIgnoreMouseEvents(true, { forward: true });
      const mainWindow = options.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      }
    } else {
      overlayWin.setIgnoreMouseEvents(false);
    }
  }

  function hideIdle() {
    // Hide the overlay window entirely when no pending requests, so it stops
    // intercepting drag/drop events from macOS (setIgnoreMouseEvents does not
    // reliably pass drag events through a visible transparent window).
    if (!overlayWin || overlayWin.isDestroyed()) return;
    if (overlayWin.isVisible()) {
      overlayWin.hide();
    }
  }

  function destroy() {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.destroy();
    }
    overlayWin = null;
    readyPromise = null;
  }

  return {
    ensureReady,
    markReady,
    getWindow: () => overlayWin,
    showSpec,
    dismissSpec,
    setClickThrough,
    hideIdle,
    syncBoundsFromMain,
    destroy,
  };
}
