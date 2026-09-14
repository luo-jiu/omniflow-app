import { ipcMain, nativeTheme, type BrowserWindow, type WebContents } from 'electron';
import { validateThemeView, type ThemeView } from '../../src/features/appearance/theme-view';
import { applyMainWindowAppearanceBackground } from './mainWindowBackground';

export function registerAppearanceIpc(options: { getMainWindow: () => BrowserWindow | null; getOverlayWindow: () => BrowserWindow | null }) {
  let snapshot: ThemeView | null = null;
  let owner: WebContents | null = null;
  let claimedEpoch: string | null = null;
  const trusted = (sender: WebContents) => sender === options.getMainWindow()?.webContents || sender === options.getOverlayWindow()?.webContents;
  ipcMain.handle('appearance:claim', (event, epoch: unknown) => {
    if (event.sender !== options.getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame || typeof epoch !== 'string' || !epoch.trim() || epoch.length > 128) return false;
    if (owner !== event.sender) {
      owner = event.sender;
      event.sender.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) { snapshot = null; claimedEpoch = null; } });
      event.sender.once('destroyed', () => { snapshot = null; owner = null; claimedEpoch = null; });
    }
    if (claimedEpoch !== epoch) { snapshot = null; claimedEpoch = epoch; }
    return true;
  });
  ipcMain.handle('appearance:get', event => event.senderFrame === event.sender.mainFrame && trusted(event.sender) ? snapshot : null);
  ipcMain.handle('appearance:publish', (event, input: unknown) => {
    const main = options.getMainWindow();
    if (!main || event.sender !== main.webContents || event.senderFrame !== event.sender.mainFrame) return false;
    const next = validateThemeView(input);
    if (!next || next.ownerEpoch !== claimedEpoch) return false;
    if (snapshot && (snapshot.ownerEpoch !== next.ownerEpoch || snapshot.revision >= next.revision)) return false;
    snapshot = next;
    nativeTheme.themeSource = next.source;
    applyMainWindowAppearanceBackground(main, next.colors['surface.app']);
    const overlay = options.getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('appearance:changed', next);
    return true;
  });
}
