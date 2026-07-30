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
  openTextFile: (options) => electron.ipcRenderer.invoke("file:open", options),
  readLocalChromeBookmarks: () => electron.ipcRenderer.invoke("file:read-local-chrome-bookmarks"),
  readTextFile: (filePath) => electron.ipcRenderer.invoke("file:read-text", filePath),
  writeTextFile: (filePath, content) => electron.ipcRenderer.invoke("fs:write-text-file", filePath, content),
  pickUploadFiles: () => electron.ipcRenderer.invoke("dialog:pick-upload-files"),
  pickUploadFolders: () => electron.ipcRenderer.invoke("dialog:pick-upload-folders"),
  pickDownloadDirectory: () => electron.ipcRenderer.invoke("dialog:pick-download-directory"),
  getDownloadDirectory: () => electron.ipcRenderer.invoke("fs:get-download-directory"),
  saveDownloadFile: (defaultFileName, options) => electron.ipcRenderer.invoke("dialog:save-download-file", defaultFileName, options),
  pickAutoImportDirectory: () => electron.ipcRenderer.invoke("dialog:pick-auto-import-directory"),
  ensureDirectory: (baseDirectory, relativePath) => electron.ipcRenderer.invoke("fs:ensure-directory", baseDirectory, relativePath),
  saveStagedDownloadFile: (stagedPath, targetFilePath) => electron.ipcRenderer.invoke("fs:save-staged-download-file", stagedPath, targetFilePath),
  downloadUrlToPath: (url, baseDirectory, relativePath, headers) => electron.ipcRenderer.invoke("fs:download-url-to-path", url, baseDirectory, relativePath, headers),
  claimAutoImportFiles: (watchDirectory, maxFiles) => electron.ipcRenderer.invoke("fs:claim-auto-import-files", watchDirectory, maxFiles),
  cleanupAutoImportStagedFile: (stagedPath) => electron.ipcRenderer.invoke("fs:cleanup-auto-import-staged-file", stagedPath),
  createStagedTextFile: (fileName, content) => electron.ipcRenderer.invoke("fs:create-staged-text-file", fileName, content),
  createStagedBinaryFile: (fileName, base64) => electron.ipcRenderer.invoke("fs:create-staged-binary-file", fileName, base64),
  createTempImportDirectory: () => electron.ipcRenderer.invoke("fs:create-temp-import-directory"),
  getTempImportFileInfo: (filePath) => electron.ipcRenderer.invoke("fs:get-temp-import-file-info", filePath),
  cleanupStagedTextFile: (stagedPath) => electron.ipcRenderer.invoke("fs:cleanup-staged-text-file", stagedPath),
  cleanupTempImportPath: (targetPath) => electron.ipcRenderer.invoke("fs:cleanup-temp-import-path", targetPath),
  processMediaFile: (payload) => electron.ipcRenderer.invoke("media-tool:process-file", payload),
  prepareImagePreview: (payload) => electron.ipcRenderer.invoke("image-preview:prepare", payload),
  onViewerZoomShortcut: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("app:viewer-zoom-shortcut", wrapped);
    return () => electron.ipcRenderer.removeListener("app:viewer-zoom-shortcut", wrapped);
  },
  fetch: (url, options) => electron.ipcRenderer.invoke("http:fetch", url, options),
  fetchBinary: (url, options) => electron.ipcRenderer.invoke("http:fetch-binary", url, options),
  uploadPresignedPut: (args) => electron.ipcRenderer.invoke("http:upload:presigned-put", args),
  uploadAbort: (uploadId) => electron.ipcRenderer.invoke("http:upload:abort", uploadId),
  uploadFormData: (url, filePath, formDataParams, headers, uploadId) => electron.ipcRenderer.invoke("http:upload:formdata", url, filePath, formDataParams, headers, uploadId),
  uploadFormDataAbort: (uploadId) => electron.ipcRenderer.invoke("http:upload:formdata:abort", uploadId),
  onUploadProgress: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("http:upload:progress", wrapped);
    return () => electron.ipcRenderer.removeListener("http:upload:progress", wrapped);
  }
});
electron.contextBridge.exposeInMainWorld("electronWindow", {
  minimize: () => electron.ipcRenderer.send("window-minimize"),
  maximize: () => electron.ipcRenderer.send("window-maximize"),
  close: () => electron.ipcRenderer.send("window-close"),
  activate: (temporaryOnTop = false) => electron.ipcRenderer.invoke("window-activate", temporaryOnTop),
  setThemeSource: (source) => electron.ipcRenderer.send("window-set-theme-source", source)
});
electron.contextBridge.exposeInMainWorld("electronOverlay", {
  open: (type, props) => electron.ipcRenderer.invoke("overlay:open", { type, props })
});
electron.contextBridge.exposeInMainWorld("electronOverlayHost", {
  onShow: (listener) => {
    const wrapped = (_event, spec) => {
      listener(spec);
    };
    electron.ipcRenderer.on("overlay:host:show", wrapped);
    return () => electron.ipcRenderer.removeListener("overlay:host:show", wrapped);
  },
  onDismissFromMain: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("overlay:host:dismiss-from-main", wrapped);
    return () => electron.ipcRenderer.removeListener("overlay:host:dismiss-from-main", wrapped);
  },
  resolve: (requestId, result) => electron.ipcRenderer.send("overlay:host:resolve", { requestId, result }),
  dismiss: (requestId, reason) => electron.ipcRenderer.send("overlay:host:dismiss", { requestId, reason }),
  reportReady: () => electron.ipcRenderer.send("overlay:host:ready")
});
electron.contextBridge.exposeInMainWorld("electronSystemVideo", {
  open: (payload) => electron.ipcRenderer.invoke("system-video-window:open", payload),
  close: () => electron.ipcRenderer.invoke("system-video-window:close"),
  play: () => electron.ipcRenderer.invoke("system-video-window:command", { type: "play" }),
  pause: () => electron.ipcRenderer.invoke("system-video-window:command", { type: "pause" }),
  seek: (time) => electron.ipcRenderer.invoke("system-video-window:command", { type: "seek", time }),
  onState: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    electron.ipcRenderer.on("system-video-window:state", wrapped);
    return () => electron.ipcRenderer.removeListener("system-video-window:state", wrapped);
  },
  onClosed: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    electron.ipcRenderer.on("system-video-window:closed", wrapped);
    return () => electron.ipcRenderer.removeListener("system-video-window:closed", wrapped);
  }
});
electron.contextBridge.exposeInMainWorld("electronSystemVideoHost", {
  onInit: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    electron.ipcRenderer.on("system-video-window:host:init", wrapped);
    return () => electron.ipcRenderer.removeListener("system-video-window:host:init", wrapped);
  },
  onCommand: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    electron.ipcRenderer.on("system-video-window:host:command", wrapped);
    return () => electron.ipcRenderer.removeListener("system-video-window:host:command", wrapped);
  },
  reportReady: () => electron.ipcRenderer.send("system-video-window:host:ready"),
  reportState: (payload) => electron.ipcRenderer.send("system-video-window:host:state", payload),
  close: () => electron.ipcRenderer.send("system-video-window:host:close")
});
electron.contextBridge.exposeInMainWorld("electronEmbeddedBrowser", {
  activateTab: (tabId) => electron.ipcRenderer.invoke("embedded-browser:activate-tab", tabId),
  cleanupDownloadFile: (tempPath) => electron.ipcRenderer.invoke("embedded-browser:cleanup-download-file", tempPath),
  closeAll: () => electron.ipcRenderer.invoke("embedded-browser:close-all"),
  closeTab: (tabId) => electron.ipcRenderer.invoke("embedded-browser:close-tab", tabId),
  deactivate: () => electron.ipcRenderer.invoke("embedded-browser:deactivate"),
  goBack: (tabId) => electron.ipcRenderer.invoke("embedded-browser:go-back", tabId),
  goForward: (tabId) => electron.ipcRenderer.invoke("embedded-browser:go-forward", tabId),
  navigate: (tabId, url) => electron.ipcRenderer.invoke("embedded-browser:navigate", tabId, url),
  openMappedFile: (tabId, pageUrl, sourceUrl, fileName) => electron.ipcRenderer.invoke("embedded-browser:open-mapped-file", tabId, pageUrl, sourceUrl, fileName),
  resolveFavicon: (payload) => electron.ipcRenderer.invoke("embedded-browser:resolve-favicon", payload),
  onStateChange: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("embedded-browser:state", wrapped);
    return () => electron.ipcRenderer.removeListener("embedded-browser:state", wrapped);
  },
  onDownload: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("embedded-browser:download", wrapped);
    return () => electron.ipcRenderer.removeListener("embedded-browser:download", wrapped);
  },
  onHlsTask: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("embedded-browser:hls-task", wrapped);
    return () => electron.ipcRenderer.removeListener("embedded-browser:hls-task", wrapped);
  },
  onResourceCaptured: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("embedded-browser:resource", wrapped);
    return () => electron.ipcRenderer.removeListener("embedded-browser:resource", wrapped);
  },
  openTab: (tabId, url) => electron.ipcRenderer.invoke("embedded-browser:open-tab", tabId, url),
  exportCapturedResource: (tabId, resourceKey) => electron.ipcRenderer.invoke("embedded-browser:resource:export", tabId, resourceKey),
  listCapturedResources: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:list", tabId),
  openCapturedResource: (tabId, resourceKey) => electron.ipcRenderer.invoke("embedded-browser:resource:open", tabId, resourceKey),
  readCapturedResource: (tabId, resourceKey) => electron.ipcRenderer.invoke("embedded-browser:resource:read", tabId, resourceKey),
  saveCapturedResource: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:save", tabId, payload),
  previewCapturedResource: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:preview", tabId, payload),
  getCatchToolkitState: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:catch-toolkit:get-state", tabId),
  updateCatchToolkitState: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:catch-toolkit:update-state", tabId, payload),
  clearCatchMediaCache: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:catch-toolkit:clear-cache", tabId),
  clearCacheAndReload: (tabId) => electron.ipcRenderer.invoke("embedded-browser:clear-cache-reload", tabId),
  resetPageStorageAndReload: (tabId) => electron.ipcRenderer.invoke("embedded-browser:reset-page-storage", tabId),
  downloadCatchMedia: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:catch-toolkit:download", tabId),
  restartCatchMediaCapture: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:catch-toolkit:restart", tabId),
  mergeCapturedMseResources: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:merge-mse", tabId, payload),
  transcodeCapturedResource: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:transcode", tabId, payload),
  downloadHlsManifest: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:download-hls", tabId, payload),
  startHlsRecording: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:start-hls-recording", tabId, payload),
  stopHlsRecording: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:stop-hls-recording", tabId, payload),
  discardHlsRecording: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:discard-hls-recording", tabId, payload),
  downloadHlsTracks: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:download-hls-tracks", tabId, payload),
  downloadHlsPlan: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:download-hls-plan", tabId, payload),
  retryHlsPlanFailed: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:retry-hls-plan-failed", tabId, payload),
  downloadMpdManifest: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:download-mpd", tabId, payload),
  downloadMpdPlan: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:download-mpd-plan", tabId, payload),
  downloadDirectFile: (tabId, payload) => electron.ipcRenderer.invoke("embedded-browser:resource:download-direct-file", tabId, payload),
  reload: (tabId) => electron.ipcRenderer.invoke("embedded-browser:reload", tabId),
  startDeepResourceCapture: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:start-deep-capture", tabId),
  startResourceCapture: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:start", tabId),
  stopResourceCapture: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:stop", tabId),
  clearCapturedResources: (tabId) => electron.ipcRenderer.invoke("embedded-browser:resource:clear", tabId),
  setBounds: (bounds) => electron.ipcRenderer.invoke("embedded-browser:set-bounds", bounds),
  getCookies: (filter) => electron.ipcRenderer.invoke("embedded-browser:cookie:get", filter),
  removeCookie: (url, name) => electron.ipcRenderer.invoke("embedded-browser:cookie:remove", url, name),
  removeCookiesByDomain: (domain) => electron.ipcRenderer.invoke("embedded-browser:cookie:remove-domain", domain),
  removeAllCookies: () => electron.ipcRenderer.invoke("embedded-browser:cookie:remove-all"),
  getResourceCaptureRules: () => electron.ipcRenderer.invoke("embedded-browser:resource-capture-rules:get"),
  updateResourceCaptureRules: (ruleSet) => electron.ipcRenderer.invoke("embedded-browser:resource-capture-rules:update", ruleSet),
  resetResourceCaptureRules: () => electron.ipcRenderer.invoke("embedded-browser:resource-capture-rules:reset"),
  getExternalToolSettings: () => electron.ipcRenderer.invoke("embedded-browser:external-tools:get"),
  updateExternalToolSettings: (settings) => electron.ipcRenderer.invoke("embedded-browser:external-tools:update", settings),
  resetExternalToolSettings: () => electron.ipcRenderer.invoke("embedded-browser:external-tools:reset"),
  listEnabledExternalTools: () => electron.ipcRenderer.invoke("embedded-browser:external-tools:list-enabled"),
  dispatchExternalTool: (toolKey, payload) => electron.ipcRenderer.invoke("embedded-browser:external-tools:dispatch", toolKey, payload),
  listPasswords: () => electron.ipcRenderer.invoke("embedded-browser:password:list"),
  getDecryptedPassword: (id) => electron.ipcRenderer.invoke("embedded-browser:password:get-decrypted", id),
  saveCapturedCredential: (credentialRequestId) => electron.ipcRenderer.invoke("embedded-browser:password:save-captured", credentialRequestId),
  deletePassword: (id) => electron.ipcRenderer.invoke("embedded-browser:password:delete", id),
  deleteAllPasswords: () => electron.ipcRenderer.invoke("embedded-browser:password:delete-all"),
  blacklistDomain: (domain) => electron.ipcRenderer.invoke("embedded-browser:password:blacklist-domain", domain),
  isBlacklistedDomain: (domain) => electron.ipcRenderer.invoke("embedded-browser:password:is-blacklisted", domain),
  autoFillPassword: (tabId, passwordId) => electron.ipcRenderer.invoke("embedded-browser:password:auto-fill", tabId, passwordId),
  onCredentialCaptured: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("embedded-browser:credential-captured", wrapped);
    return () => electron.ipcRenderer.removeListener("embedded-browser:credential-captured", wrapped);
  },
  onCredentialAutoFilled: (listener) => {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    electron.ipcRenderer.on("embedded-browser:credential-autofilled", wrapped);
    return () => electron.ipcRenderer.removeListener("embedded-browser:credential-autofilled", wrapped);
  }
});
