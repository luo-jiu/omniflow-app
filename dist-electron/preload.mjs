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
  ensureDirectory: (baseDirectory, relativePath) => electron.ipcRenderer.invoke("fs:ensure-directory", baseDirectory, relativePath),
  downloadUrlToPath: (url, baseDirectory, relativePath, headers) => electron.ipcRenderer.invoke("fs:download-url-to-path", url, baseDirectory, relativePath, headers),
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
