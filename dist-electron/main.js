import { dialog, net, ipcMain, app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs$2, { existsSync } from "node:fs";
import fs from "fs/promises";
import require$$0 from "os";
import require$$1 from "child_process";
import fs$1 from "fs";
import http from "node:http";
import https from "node:https";
function shouldIgnoreSystemEntry(entryName) {
  const normalized = String(entryName || "");
  if (!normalized) return true;
  if (normalized === ".DS_Store") return true;
  if (normalized.startsWith("._")) return true;
  if (normalized === "Thumbs.db") return true;
  return false;
}
function normalizeRelativePath(input) {
  return input.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function byRelativePath(a, b) {
  return a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN");
}
async function collectFilesFromSelectedFilePaths(filePaths) {
  const files = await Promise.all(filePaths.map(async (filePath) => {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return null;
    }
    const fileName = path.basename(filePath);
    if (shouldIgnoreSystemEntry(fileName)) {
      return null;
    }
    return {
      name: fileName,
      size: stat.size,
      localPath: filePath,
      relativePath: normalizeRelativePath(fileName)
    };
  }));
  return files.filter((item) => Boolean(item)).sort(byRelativePath);
}
async function walkDirectoryFiles(rootPath, currentPath, rootDisplayName) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") {
      continue;
    }
    if (shouldIgnoreSystemEntry(entry.name)) {
      continue;
    }
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await walkDirectoryFiles(rootPath, absolutePath, rootDisplayName);
      files.push(...nested);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }
    const relativeInsideRoot = normalizeRelativePath(path.relative(rootPath, absolutePath));
    const relativePath = normalizeRelativePath(path.join(rootDisplayName, relativeInsideRoot));
    files.push({
      name: entry.name,
      size: stat.size,
      localPath: absolutePath,
      relativePath
    });
  }
  return files;
}
async function collectFilesFromSelectedFolders(folderPaths) {
  const allFiles = [];
  for (const folderPath of folderPaths) {
    const folderStat = await fs.stat(folderPath);
    if (!folderStat.isDirectory()) {
      continue;
    }
    const folderName = path.basename(folderPath);
    const files = await walkDirectoryFiles(folderPath, folderPath, folderName);
    allFiles.push(...files);
  }
  return allFiles.sort(byRelativePath);
}
function registerFileIpc(ipcMain2) {
  ipcMain2.handle("file:open", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return await fs.readFile(result.filePaths[0], "utf-8");
  });
  ipcMain2.handle("file:save", async (_e, filePath, content) => {
    await fs.writeFile(filePath, content, "utf-8");
    return true;
  });
  ipcMain2.handle("dialog:pick-upload-files", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, files: [] };
    }
    const files = await collectFilesFromSelectedFilePaths(result.filePaths);
    return { canceled: false, files };
  });
  ipcMain2.handle("dialog:pick-upload-folders", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, files: [] };
    }
    const files = await collectFilesFromSelectedFolders(result.filePaths);
    return { canceled: false, files };
  });
}
var osutils = {};
var _os = require$$0;
osutils.platform = function() {
  return process.platform;
};
osutils.cpuCount = function() {
  return _os.cpus().length;
};
osutils.sysUptime = function() {
  return _os.uptime();
};
osutils.processUptime = function() {
  return process.uptime();
};
osutils.freemem = function() {
  return _os.freemem() / (1024 * 1024);
};
osutils.totalmem = function() {
  return _os.totalmem() / (1024 * 1024);
};
osutils.freememPercentage = function() {
  return _os.freemem() / _os.totalmem();
};
osutils.freeCommand = function(callback) {
  require$$1.exec("free -m", function(error, stdout, stderr) {
    var lines = stdout.split("\n");
    var str_mem_info = lines[1].replace(/[\s\n\r]+/g, " ");
    var mem_info = str_mem_info.split(" ");
    total_mem = parseFloat(mem_info[1]);
    free_mem = parseFloat(mem_info[3]);
    buffers_mem = parseFloat(mem_info[5]);
    cached_mem = parseFloat(mem_info[6]);
    used_mem = total_mem - (free_mem + buffers_mem + cached_mem);
    callback(used_mem - 2);
  });
};
osutils.harddrive = function(callback) {
  require$$1.exec("df -k", function(error, stdout, stderr) {
    var total = 0;
    var used = 0;
    var free = 0;
    var lines = stdout.split("\n");
    var str_disk_info = lines[1].replace(/[\s\n\r]+/g, " ");
    var disk_info = str_disk_info.split(" ");
    total = Math.ceil(disk_info[1] * 1024 / Math.pow(1024, 2));
    used = Math.ceil(disk_info[2] * 1024 / Math.pow(1024, 2));
    free = Math.ceil(disk_info[3] * 1024 / Math.pow(1024, 2));
    callback(total, free, used);
  });
};
osutils.getProcesses = function(nProcess, callback) {
  if (typeof nProcess === "function") {
    callback = nProcess;
    nProcess = 0;
  }
  command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10";
  if (nProcess > 0)
    command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (nProcess + 1);
  require$$1.exec(command, function(error, stdout, stderr) {
    var lines = stdout.split("\n");
    lines.shift();
    lines.pop();
    var result = "";
    lines.forEach(function(_item, _i) {
      var _str = _item.replace(/[\s\n\r]+/g, " ");
      _str = _str.split(" ");
      result += _str[1] + " " + _str[2] + " " + _str[3] + " " + _str[4].substring(_str[4].length - 25) + "\n";
    });
    callback(result);
  });
};
osutils.allLoadavg = function() {
  var loads = _os.loadavg();
  return loads[0].toFixed(4) + "," + loads[1].toFixed(4) + "," + loads[2].toFixed(4);
};
osutils.loadavg = function(_time) {
  if (_time === void 0 || _time !== 5 && _time !== 15) _time = 1;
  var loads = _os.loadavg();
  var v = 0;
  if (_time == 1) v = loads[0];
  if (_time == 5) v = loads[1];
  if (_time == 15) v = loads[2];
  return v;
};
osutils.cpuFree = function(callback) {
  getCPUUsage(callback, true);
};
osutils.cpuUsage = function(callback) {
  getCPUUsage(callback, false);
};
function getCPUUsage(callback, free) {
  var stats1 = getCPUInfo();
  var startIdle = stats1.idle;
  var startTotal = stats1.total;
  setTimeout(function() {
    var stats2 = getCPUInfo();
    var endIdle = stats2.idle;
    var endTotal = stats2.total;
    var idle = endIdle - startIdle;
    var total = endTotal - startTotal;
    var perc = idle / total;
    if (free === true)
      callback(perc);
    else
      callback(1 - perc);
  }, 1e3);
}
function getCPUInfo(callback) {
  var cpus = _os.cpus();
  var user = 0;
  var nice = 0;
  var sys = 0;
  var idle = 0;
  var irq = 0;
  var total = 0;
  for (var cpu in cpus) {
    user += cpus[cpu].times.user;
    nice += cpus[cpu].times.nice;
    sys += cpus[cpu].times.sys;
    irq += cpus[cpu].times.irq;
    idle += cpus[cpu].times.idle;
  }
  var total = user + nice + sys + idle + irq;
  return {
    "idle": idle,
    "total": total
  };
}
const ENABLE_RUNTIME_LOGS = process.env.NODE_ENV === "test" || Boolean(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true";
const print = (level, ...args) => {
  if (!ENABLE_RUNTIME_LOGS) return;
  console[level](...args);
};
const runtimeLogger = {
  debug: (...args) => print("debug", ...args),
  info: (...args) => print("info", ...args),
  log: (...args) => print("log", ...args),
  warn: (...args) => print("warn", ...args),
  error: (...args) => print("error", ...args)
};
function getStaticData() {
  const totalStorage = getStorageData().total;
  const cpuModel = require$$0.cpus()[0].model;
  const totalMemoryGB = Math.floor(osutils.totalmem() / 1024);
  return {
    totalStorage,
    cpuModel,
    totalMemoryGB
  };
}
function getStorageData() {
  const stats = fs$1.statfsSync(process.platform === "win32" ? "C:" : "/");
  const total = stats.blocks * stats.bsize;
  const free = stats.bfree * stats.bsize;
  return {
    total: Math.floor(total / 1e9),
    // 换算为 GB
    usage: 1 - free / total
    // 使用率计算
  };
}
function registerSystemIpc(ipcMain2) {
  ipcMain2.handle("sys:get-static-data", getStaticData);
}
const MAX_SINGLE_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_SINGLE_UPLOAD_LABEL = "10GB";
const MAX_SINGLE_UPLOAD_ERROR_MESSAGE = `上传失败：单文件最大支持 ${MAX_SINGLE_UPLOAD_LABEL}`;
function registerHttpIpc(ipcMain2) {
  const activeUploads = /* @__PURE__ */ new Map();
  const sendUploadProgress = (runtime, force = false) => {
    const now = Date.now();
    if (!force && now - runtime.lastProgressAt < 80) return;
    runtime.lastProgressAt = now;
    const elapsedMs = Math.max(now - runtime.startedAt, 1);
    const speedBps = Math.floor(runtime.uploadedBytes * 1e3 / elapsedMs);
    const percentage = runtime.totalBytes > 0 ? Math.min(runtime.uploadedBytes / runtime.totalBytes * 100, 100) : 0;
    runtime.sender.send("http:upload:progress", {
      uploadId: runtime.uploadId,
      uploadedBytes: runtime.uploadedBytes,
      totalBytes: runtime.totalBytes,
      percentage,
      speedBps
    });
  };
  ipcMain2.handle("http:fetch", async (_event, url, options = {}) => {
    runtimeLogger.debug("http:fetch start");
    runtimeLogger.debug("http:fetch URL:", url);
    runtimeLogger.debug("http:fetch options:", options);
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: options.method || "GET" });
      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          runtimeLogger.debug(`http:fetch set header ${key}: ${String(value)}`);
          request.setHeader(key, value);
        });
      }
      let body = "";
      request.on("response", (response) => {
        runtimeLogger.debug("http:fetch response");
        runtimeLogger.debug("http:fetch status:", response.statusCode);
        runtimeLogger.debug("http:fetch headers:", response.headers);
        response.on("data", (chunk) => {
          runtimeLogger.debug(`http:fetch chunk length: ${chunk.length}`);
          body += chunk;
        });
        response.on("end", () => {
          runtimeLogger.debug("http:fetch body preview:", body.slice(0, 500));
          let parsedBody;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            parsedBody = body;
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: parsedBody
          });
        });
      });
      request.on("error", (err) => {
        runtimeLogger.error("http:fetch error:", err);
        reject(err);
      });
      if (options.body) {
        request.write(options.body);
      }
      request.end();
    });
  });
  ipcMain2.handle("http:upload:abort", async (_event, uploadId) => {
    const runtime = activeUploads.get(uploadId);
    if (!runtime) return false;
    runtime.aborted = true;
    activeUploads.delete(uploadId);
    try {
      runtime.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      runtime.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return true;
  });
  ipcMain2.handle("http:upload", async (event, url, filePath, formDataParams = {}, headers = {}, uploadId) => {
    return new Promise((resolve, reject) => {
      let stat;
      try {
        stat = fs$2.statSync(filePath);
      } catch (error) {
        reject(new Error(`读取上传文件失败: ${filePath} (${String(error)})`));
        return;
      }
      if (!stat.isFile()) {
        reject(new Error(`上传目标不是文件: ${filePath}`));
        return;
      }
      if (stat.size > MAX_SINGLE_UPLOAD_BYTES) {
        reject(new Error(MAX_SINGLE_UPLOAD_ERROR_MESSAGE));
        return;
      }
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const currentUploadId = uploadId || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fileName = path.basename(filePath);
      const fieldsPrefix = Object.entries(formDataParams).map(([key, value]) => `--${boundary}\r
Content-Disposition: form-data; name="${key}"\r
\r
${value}\r
`).join("");
      const filePrefix = `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${fileName}"\r
Content-Type: application/octet-stream\r
\r
`;
      const fileSuffix = `\r
--${boundary}--\r
`;
      const contentLength = Buffer.byteLength(fieldsPrefix) + Buffer.byteLength(filePrefix) + stat.size + Buffer.byteLength(fileSuffix);
      const finalHeaders = {
        ...headers,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(contentLength)
      };
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === "https:" ? https : http;
      const request = transport.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : void 0,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "POST",
        headers: finalHeaders
      });
      const fileStream = fs$2.createReadStream(filePath, {
        highWaterMark: 1024 * 1024
      });
      const runtime = {
        uploadId: currentUploadId,
        request,
        fileStream,
        sender: event.sender,
        totalBytes: Math.max(0, stat.size),
        uploadedBytes: 0,
        startedAt: Date.now(),
        lastProgressAt: 0,
        aborted: false
      };
      activeUploads.set(currentUploadId, runtime);
      let settled = false;
      const safeResolve = (payload) => {
        if (settled) return;
        settled = true;
        activeUploads.delete(currentUploadId);
        resolve(payload);
      };
      const safeReject = (error) => {
        if (settled) return;
        settled = true;
        activeUploads.delete(currentUploadId);
        reject(error);
      };
      let responseBody = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          responseBody += chunk.toString();
        });
        response.on("end", () => {
          let parsedBody;
          try {
            parsedBody = JSON.parse(responseBody);
          } catch {
            parsedBody = responseBody;
          }
          safeResolve({
            status: response.statusCode,
            body: parsedBody
          });
        });
      });
      request.on("error", (err) => {
        if (runtime.aborted) {
          safeReject(new Error("UPLOAD_ABORTED"));
          return;
        }
        try {
          fileStream.destroy(err);
        } catch {
        }
        safeReject(err);
      });
      request.write(fieldsPrefix);
      request.write(filePrefix);
      fileStream.on("data", (chunk) => {
        if (runtime.aborted) return;
        runtime.uploadedBytes += chunk.length;
        sendUploadProgress(runtime);
      });
      fileStream.on("end", () => {
        if (runtime.aborted) return;
        sendUploadProgress(runtime, true);
        request.write(fileSuffix);
        request.end();
      });
      fileStream.on("error", (err) => {
        if (runtime.aborted) {
          safeReject(new Error("UPLOAD_ABORTED"));
          return;
        }
        safeReject(err);
        try {
          request.destroy(err);
        } catch {
        }
      });
      fileStream.pipe(request, { end: false });
    });
  });
}
function registerIpcHandlers() {
  registerFileIpc(ipcMain);
  registerSystemIpc(ipcMain);
  registerHttpIpc(ipcMain);
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const APP_ICON_PATH = path.join(process.env.APP_ROOT, "build", "icons", "icon.png");
function getAppIconPath() {
  return existsSync(APP_ICON_PATH) ? APP_ICON_PATH : null;
}
let mainWindow = null;
let windowHandlersRegistered = false;
let isQuitting = false;
const WINDOW_ACTIVATE_TOPMOST_DURATION_MS = 240;
function isToggleDevToolsShortcut(input) {
  if (input.type !== "keyDown") {
    return false;
  }
  const key = (input.key || "").toLowerCase();
  return (input.meta || input.control) && input.shift && key === "i";
}
function registerWindowIpcHandlers() {
  if (windowHandlersRegistered) {
    return;
  }
  windowHandlersRegistered = true;
  ipcMain.handle("zoom-adjust", (event, delta) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null;
    }
    const currentZoom = targetWindow.webContents.getZoomFactor();
    const nextZoom = Math.min(Math.max(currentZoom + delta, 0.25), 3);
    targetWindow.webContents.setZoomFactor(nextZoom);
    return nextZoom;
  });
  ipcMain.on("window-minimize", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    targetWindow == null ? void 0 : targetWindow.minimize();
  });
  ipcMain.on("window-maximize", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
  });
  ipcMain.on("window-close", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    targetWindow == null ? void 0 : targetWindow.close();
  });
  ipcMain.handle("window-activate", (event, temporaryOnTop = false) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return false;
    }
    if (targetWindow.isMinimized()) {
      targetWindow.restore();
    }
    if (!targetWindow.isVisible()) {
      targetWindow.show();
    }
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    } else {
      app.focus();
    }
    if (typeof targetWindow.moveTop === "function") {
      targetWindow.moveTop();
    }
    targetWindow.focus();
    if (temporaryOnTop && !targetWindow.isAlwaysOnTop()) {
      targetWindow.setAlwaysOnTop(true, "screen-saver");
      setTimeout(() => {
        if (!targetWindow.isDestroyed()) {
          targetWindow.setAlwaysOnTop(false);
        }
      }, WINDOW_ACTIVATE_TOPMOST_DURATION_MS);
    }
    return true;
  });
}
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  const appIconPath = getAppIconPath();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    // 最小宽度
    minHeight: 400,
    // 最小高度
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: path.join(MAIN_DIST, "preload.mjs"),
      // Electron 安全推荐配置
      devTools: true,
      webSecurity: false
      // nodeIntegration: false,     // 禁用 Node.js 集成
      // contextIsolation: true,     // 启用上下文隔离
      // webSecurity: true           // 启用同源策略
    },
    autoHideMenuBar: true,
    // 自动隐藏菜单栏
    ...appIconPath ? { icon: appIconPath } : {}
  });
  mainWindow = win;
  win.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [""]
        // 将其置为空
      }
    });
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (!isToggleDevToolsShortcut(input)) {
      return;
    }
    event.preventDefault();
    win.webContents.toggleDevTools();
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
  return win;
}
app.on("before-quit", () => {
  isQuitting = true;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  const appIconPath = getAppIconPath();
  if (appIconPath && process.platform === "darwin") {
    app.dock.setIcon(appIconPath);
  }
  registerIpcHandlers();
  registerWindowIpcHandlers();
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
