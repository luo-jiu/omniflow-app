import type { IpcMain } from 'electron';

import type { AppUpdateService } from './appUpdateService';

export function registerAppUpdateIpcHandlers(ipcMain: IpcMain, service: AppUpdateService) {
  ipcMain.handle('app-update:get-state', () => service.getState());
  ipcMain.handle('app-update:check', () => service.check());
  ipcMain.handle('app-update:download', () => service.download());
  ipcMain.handle('app-update:install', () => service.install());
}
