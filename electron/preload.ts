// 渲染进程中的Bridge API
import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

contextBridge.exposeInMainWorld('electronAPI', {
  getStaticData: () => ipcRenderer.invoke('sys:get-static-data'),
  pickUploadFiles: () => ipcRenderer.invoke('dialog:pick-upload-files'),
  pickUploadFolders: () => ipcRenderer.invoke('dialog:pick-upload-folders'),
  pickDownloadDirectory: () => ipcRenderer.invoke('dialog:pick-download-directory'),
  pickAutoImportDirectory: () => ipcRenderer.invoke('dialog:pick-auto-import-directory'),
  ensureDirectory: (baseDirectory: string, relativePath: string) =>
    ipcRenderer.invoke('fs:ensure-directory', baseDirectory, relativePath),
  downloadUrlToPath: (
    url: string,
    baseDirectory: string,
    relativePath: string,
    headers?: Record<string, string>,
  ) => ipcRenderer.invoke('fs:download-url-to-path', url, baseDirectory, relativePath, headers),
  claimAutoImportFiles: (watchDirectory: string, maxFiles?: number) =>
    ipcRenderer.invoke('fs:claim-auto-import-files', watchDirectory, maxFiles),
  cleanupAutoImportStagedFile: (stagedPath: string) =>
    ipcRenderer.invoke('fs:cleanup-auto-import-staged-file', stagedPath),
  fetch: (url: string, options?: any) => ipcRenderer.invoke('http:fetch', url, options),
  upload: (
    url: string,
    filePath: string,
    formDataParams?: Record<string, string>,
    headers?: Record<string, string>,
    uploadId?: string,
  ) => ipcRenderer.invoke('http:upload', url, filePath, formDataParams, headers, uploadId),
  uploadAbort: (uploadId: string) => ipcRenderer.invoke('http:upload:abort', uploadId),
  onUploadProgress: (listener: (payload: {
    uploadId: string;
    uploadedBytes: number;
    totalBytes: number;
    percentage: number;
    speedBps: number;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      uploadId: string;
      uploadedBytes: number;
      totalBytes: number;
      percentage: number;
      speedBps: number;
    }) => {
      listener(payload);
    };
    ipcRenderer.on('http:upload:progress', wrapped);
    return () => ipcRenderer.removeListener('http:upload:progress', wrapped);
  },
});

contextBridge.exposeInMainWorld('electronZoom', (delta: number) => {
  return ipcRenderer.invoke('zoom-adjust', delta);
})

// 窗口控制 API
contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  activate: (temporaryOnTop = false) => ipcRenderer.invoke('window-activate', temporaryOnTop),
});

contextBridge.exposeInMainWorld('electronEmbeddedBrowser', {
  activateTab: (tabId: string | null) => ipcRenderer.invoke('embedded-browser:activate-tab', tabId),
  closeAll: () => ipcRenderer.invoke('embedded-browser:close-all'),
  closeTab: (tabId: string) => ipcRenderer.invoke('embedded-browser:close-tab', tabId),
  deactivate: () => ipcRenderer.invoke('embedded-browser:deactivate'),
  navigate: (tabId: string, url: string) => ipcRenderer.invoke('embedded-browser:navigate', tabId, url),
  onStateChange: (listener: (payload: {
    details?: string;
    message?: string;
    meta?: string[];
    state?: 'idle' | 'loading' | 'ready' | 'error';
    tabId?: string;
    title?: string;
    url?: string;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      details?: string;
      message?: string;
      meta?: string[];
      state?: 'idle' | 'loading' | 'ready' | 'error';
      tabId?: string;
      title?: string;
      url?: string;
    }) => {
      listener(payload);
    };
    ipcRenderer.on('embedded-browser:state', wrapped);
    return () => ipcRenderer.removeListener('embedded-browser:state', wrapped);
  },
  openTab: (tabId: string, url?: string) => ipcRenderer.invoke('embedded-browser:open-tab', tabId, url),
  reload: (tabId: string) => ipcRenderer.invoke('embedded-browser:reload', tabId),
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('embedded-browser:set-bounds', bounds),
});
