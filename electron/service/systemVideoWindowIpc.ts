import { ipcMain } from 'electron';
import type { SystemVideoWindowController } from './systemVideoWindowController';
import type {
  SystemVideoWindowCommandPayload,
  SystemVideoWindowOpenPayload,
  SystemVideoWindowStatePayload,
} from './systemVideoWindowTypes';

export function registerSystemVideoWindowIpcHandlers(controller: SystemVideoWindowController) {
  ipcMain.handle('system-video-window:open', (_event, payload: SystemVideoWindowOpenPayload) => (
    controller.open(payload)
  ));

  ipcMain.handle('system-video-window:close', () => controller.close());

  ipcMain.handle('system-video-window:command', (_event, payload: SystemVideoWindowCommandPayload) => (
    controller.sendCommand(payload)
  ));

  ipcMain.on('system-video-window:host:ready', (event) => {
    controller.markReady(event.sender);
  });

  ipcMain.on('system-video-window:host:state', (_event, payload: SystemVideoWindowStatePayload) => {
    controller.updateState(payload);
  });

  ipcMain.on('system-video-window:host:close', () => {
    controller.close();
  });
}
