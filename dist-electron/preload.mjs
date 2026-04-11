"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
  // You can expose other APTs you need here.
  // ...
});
electron.contextBridge.exposeInMainWorld("electronAPI", {
  getStaticData: () => electron.ipcRenderer.invoke("sys:get-static-data"),
  pickUploadFiles: () => electron.ipcRenderer.invoke("dialog:pick-upload-files"),
  pickUploadFolders: () => electron.ipcRenderer.invoke("dialog:pick-upload-folders"),
  pickDownloadDirectory: () => electron.ipcRenderer.invoke("dialog:pick-download-directory"),
  pickAutoImportDirectory: () => electron.ipcRenderer.invoke("dialog:pick-auto-import-directory"),
  ensureDirectory: (baseDirectory, relativePath) => electron.ipcRenderer.invoke("fs:ensure-directory", baseDirectory, relativePath),
  downloadUrlToPath: (url, baseDirectory, relativePath, headers) => electron.ipcRenderer.invoke("fs:download-url-to-path", url, baseDirectory, relativePath, headers),
  claimAutoImportFiles: (watchDirectory, maxFiles) => electron.ipcRenderer.invoke("fs:claim-auto-import-files", watchDirectory, maxFiles),
  cleanupAutoImportStagedFile: (stagedPath) => electron.ipcRenderer.invoke("fs:cleanup-auto-import-staged-file", stagedPath),
  fetch: (url, options) => electron.ipcRenderer.invoke("http:fetch", url, options),
  upload: (url, filePath, formDataParams, headers, uploadId) => electron.ipcRenderer.invoke("http:upload", url, filePath, formDataParams, headers, uploadId),
  uploadAbort: (uploadId) => electron.ipcRenderer.invoke("http:upload:abort", uploadId),
  onUploadProgress: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("http:upload:progress", wrapped);
    return () => electron.ipcRenderer.removeListener("http:upload:progress", wrapped);
  }
});
electron.contextBridge.exposeInMainWorld("electronZoom", (delta) => {
  return electron.ipcRenderer.invoke("zoom-adjust", delta);
});
electron.contextBridge.exposeInMainWorld("electronWindow", {
  minimize: () => electron.ipcRenderer.send("window-minimize"),
  maximize: () => electron.ipcRenderer.send("window-maximize"),
  close: () => electron.ipcRenderer.send("window-close"),
  activate: (temporaryOnTop = false) => electron.ipcRenderer.invoke("window-activate", temporaryOnTop)
});
electron.contextBridge.exposeInMainWorld("electronEmbeddedBrowser", {
  activateTab: (tabId) => electron.ipcRenderer.invoke("embedded-browser:activate-tab", tabId),
  closeAll: () => electron.ipcRenderer.invoke("embedded-browser:close-all"),
  closeTab: (tabId) => electron.ipcRenderer.invoke("embedded-browser:close-tab", tabId),
  deactivate: () => electron.ipcRenderer.invoke("embedded-browser:deactivate"),
  navigate: (tabId, url) => electron.ipcRenderer.invoke("embedded-browser:navigate", tabId, url),
  onStateChange: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("embedded-browser:state", wrapped);
    return () => electron.ipcRenderer.removeListener("embedded-browser:state", wrapped);
  },
  openTab: (tabId, url) => electron.ipcRenderer.invoke("embedded-browser:open-tab", tabId, url),
  reload: (tabId) => electron.ipcRenderer.invoke("embedded-browser:reload", tabId),
  setBounds: (bounds) => electron.ipcRenderer.invoke("embedded-browser:set-bounds", bounds)
});
