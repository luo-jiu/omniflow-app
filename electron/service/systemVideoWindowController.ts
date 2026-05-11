import { BrowserWindow, screen } from 'electron';
import type {
  SystemVideoWindowCommandPayload,
  SystemVideoWindowOpenPayload,
  SystemVideoWindowStatePayload,
} from './systemVideoWindowTypes';
import { createSystemVideoWindowDataUrl } from './systemVideoWindowHtml';

type SystemVideoWindowControllerOptions = {
  getMainWindow: () => BrowserWindow | null;
  preloadPath: string;
};

export type SystemVideoWindowController = {
  open: (payload: SystemVideoWindowOpenPayload) => Promise<boolean>;
  close: () => boolean;
  sendCommand: (payload: SystemVideoWindowCommandPayload) => boolean;
  markReady: (fromWebContents: Electron.WebContents) => void;
  updateState: (payload: SystemVideoWindowStatePayload) => void;
  destroy: () => void;
};

const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 360;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 240;

export function createSystemVideoWindowController(
  options: SystemVideoWindowControllerOptions,
): SystemVideoWindowController {
  let videoWin: BrowserWindow | null = null;
  let readyPromise: Promise<void> | null = null;
  let readyResolve: (() => void) | null = null;
  let lastState: SystemVideoWindowStatePayload | null = null;

  function ensureCreated(): BrowserWindow | null {
    if (videoWin && !videoWin.isDestroyed()) {
      return videoWin;
    }

    const mainWindow = options.getMainWindow();
    const mainBounds = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.getBounds()
      : screen.getPrimaryDisplay().workArea;
    const x = Math.round(mainBounds.x + mainBounds.width - DEFAULT_WIDTH - 48);
    const y = Math.round(mainBounds.y + mainBounds.height - DEFAULT_HEIGHT - 48);

    const win = new BrowserWindow({
      x,
      y,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      frame: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      backgroundColor: '#08090b',
      autoHideMenuBar: true,
      webPreferences: {
        preload: options.preloadPath,
        devTools: true,
      },
    });

    videoWin = win;
    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('[system-video-window] render-process-gone', details);
    });

    win.on('closed', () => {
      if (videoWin === win) {
        videoWin = null;
        readyPromise = null;
        readyResolve = null;
      }
      const main = options.getMainWindow();
      if (main && !main.isDestroyed()) {
        main.webContents.send('system-video-window:closed', lastState);
      }
    });

    void win.loadURL(createSystemVideoWindowDataUrl());
    return win;
  }

  async function ensureReady(win: BrowserWindow) {
    if (win.isDestroyed()) return;
    if (readyPromise) await readyPromise;
  }

  async function open(payload: SystemVideoWindowOpenPayload) {
    const win = ensureCreated();
    if (!win) return false;
    lastState = {
      currentTime: payload.currentTime,
      duration: payload.duration ?? 0,
      isPlaying: payload.isPlaying,
      volume: payload.volume,
      muted: payload.muted,
      ended: false,
    };
    await ensureReady(win);
    if (!videoWin || videoWin.isDestroyed()) return false;
    videoWin.setTitle(payload.title || '视频');
    videoWin.webContents.send('system-video-window:host:init', payload);
    if (!videoWin.isVisible()) {
      videoWin.show();
    }
    videoWin.focus();
    return true;
  }

  function close() {
    if (!videoWin || videoWin.isDestroyed()) return false;
    videoWin.close();
    return true;
  }

  function sendCommand(payload: SystemVideoWindowCommandPayload) {
    if (!videoWin || videoWin.isDestroyed()) return false;
    videoWin.webContents.send('system-video-window:host:command', payload);
    return true;
  }

  function markReady(fromWebContents: Electron.WebContents) {
    if (!videoWin || videoWin.isDestroyed()) return;
    if (fromWebContents !== videoWin.webContents) return;
    if (readyResolve) {
      const resolve = readyResolve;
      readyResolve = null;
      resolve();
    }
  }

  function updateState(payload: SystemVideoWindowStatePayload) {
    lastState = payload;
    const main = options.getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send('system-video-window:state', payload);
    }
  }

  function destroy() {
    if (videoWin && !videoWin.isDestroyed()) {
      videoWin.destroy();
    }
    videoWin = null;
    readyPromise = null;
    readyResolve = null;
  }

  return {
    open,
    close,
    sendCommand,
    markReady,
    updateState,
    destroy,
  };
}
