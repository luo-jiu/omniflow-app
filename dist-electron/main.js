import { dialog, app, net, ipcMain, session, webContents, BrowserWindow, WebContentsView, nativeTheme, screen } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs$1, { existsSync, mkdirSync, constants, readFileSync, writeFileSync } from "node:fs";
import fs$2 from "fs/promises";
import fs, { mkdtemp, rm, access, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import require$$0 from "os";
import require$$1 from "child_process";
import fs$3 from "fs";
import { Buffer as Buffer$1 } from "node:buffer";
import { spawn } from "node:child_process";
import os from "node:os";
const DOWNLOAD_REQUEST_TIMEOUT_MS = 6e4;
async function downloadUrlToFile(url, targetPath, headers = {}, redirectDepth = 0) {
  const MAX_REDIRECT_DEPTH = 3;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`不支持的下载协议: ${parsed.protocol}`);
  }
  const transport = parsed.protocol === "https:" ? https : http;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : void 0,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers
    }, (response) => {
      response.setTimeout(DOWNLOAD_REQUEST_TIMEOUT_MS, () => {
        response.destroy(new Error(`下载响应超时: ${DOWNLOAD_REQUEST_TIMEOUT_MS}ms`));
      });
      const statusCode = Number(response.statusCode || 0);
      const redirectLocation = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
        response.resume();
        if (redirectDepth >= MAX_REDIRECT_DEPTH) {
          settleReject(new Error(`下载重定向次数过多: ${url}`));
          return;
        }
        const nextUrl = new URL(redirectLocation, url).toString();
        downloadUrlToFile(nextUrl, targetPath, headers, redirectDepth + 1).then(settleResolve).catch(settleReject);
        return;
      }
      if (statusCode >= 400) {
        response.resume();
        settleReject(new Error(`下载失败: HTTP ${statusCode} (${url})`));
        return;
      }
      const fileStream = fs$1.createWriteStream(targetPath);
      const cleanupAndReject = async (error) => {
        try {
          fileStream.destroy();
        } catch {
        }
        try {
          await fs.rm(targetPath, { force: true });
        } catch {
        }
        settleReject(error);
      };
      response.on("error", (error) => {
        void cleanupAndReject(error);
      });
      fileStream.on("error", (error) => {
        void cleanupAndReject(error);
      });
      fileStream.on("finish", () => settleResolve());
      response.pipe(fileStream);
    });
    request.setTimeout(DOWNLOAD_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`下载请求超时: ${DOWNLOAD_REQUEST_TIMEOUT_MS}ms`));
    });
    request.on("error", (error) => settleReject(error));
    request.end();
  });
}
const AUTO_IMPORT_DEFAULT_DIR_NAME = "Omniflow Inbox";
const AUTO_IMPORT_OBSERVE_TTL_MS = 10 * 60 * 1e3;
const AUTO_IMPORT_MIN_STABLE_COUNT = 2;
const AUTO_IMPORT_MIN_MTIME_AGE_MS = 2e3;
const AUTO_IMPORT_DEFAULT_MAX_FILES = 12;
const MAC_CHROME_BOOKMARK_RELATIVE_PATH = path.join(
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks"
);
const autoImportObservedFiles = /* @__PURE__ */ new Map();
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
function isTransientDownloadEntry(entryName) {
  const normalized = String(entryName || "").toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith(".")) return true;
  return normalized.endsWith(".crdownload") || normalized.endsWith(".part") || normalized.endsWith(".tmp") || normalized.endsWith(".opdownload") || normalized.endsWith(".download");
}
function getAutoImportStagingRoot() {
  return path.join(app.getPath("userData"), "auto-import-staging");
}
function getEmbeddedBrowserDownloadStagingRoot() {
  return path.join(app.getPath("userData"), "embedded-browser-downloads");
}
function getTextFileStagingRoot() {
  return path.join(app.getPath("userData"), "text-file-staging");
}
function normalizeDialogFilters(filters, fallback) {
  const normalized = Array.isArray(filters) ? filters.map((filter) => ({
    name: String((filter == null ? void 0 : filter.name) || "").trim() || "Files",
    extensions: Array.isArray(filter == null ? void 0 : filter.extensions) ? filter.extensions.map((extension) => String(extension || "").trim().replace(/^\./, "")).filter(Boolean) : []
  })).filter((filter) => filter.extensions.length > 0) : [];
  return normalized.length > 0 ? normalized : fallback;
}
function isPathInsideDirectory$1(filePath, directoryPath) {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedDirectoryPath = path.resolve(directoryPath);
  if (resolvedFilePath === resolvedDirectoryPath) return true;
  return resolvedFilePath.startsWith(`${resolvedDirectoryPath}${path.sep}`);
}
function buildStagedFileName$1(fileName) {
  const safeName = String(fileName || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}
async function moveFileSafe(sourcePath, targetPath) {
  try {
    await fs$2.rename(sourcePath, targetPath);
  } catch (error) {
    if ((error == null ? void 0 : error.code) !== "EXDEV") {
      throw error;
    }
    await fs$2.copyFile(sourcePath, targetPath);
    await fs$2.rm(sourcePath, { force: true });
  }
}
function cleanupObservedState(seenPaths) {
  const nowTs = Date.now();
  for (const [observedPath, observedState] of autoImportObservedFiles.entries()) {
    if (seenPaths.has(observedPath)) continue;
    if (nowTs - observedState.lastSeenAt <= AUTO_IMPORT_OBSERVE_TTL_MS) continue;
    autoImportObservedFiles.delete(observedPath);
  }
}
async function claimStableInboxFiles(watchDirectory, maxFiles = AUTO_IMPORT_DEFAULT_MAX_FILES) {
  const rawDirectory = String(watchDirectory || "").trim();
  const normalizedDirectory = rawDirectory ? path.resolve(rawDirectory) : path.join(app.getPath("downloads"), AUTO_IMPORT_DEFAULT_DIR_NAME);
  const stat = await fs$2.stat(normalizedDirectory).catch(() => null);
  if (!(stat == null ? void 0 : stat.isDirectory())) {
    return [];
  }
  const entries = await fs$2.readdir(normalizedDirectory, { withFileTypes: true });
  const seenPaths = /* @__PURE__ */ new Set();
  const nowTs = Date.now();
  const readyCandidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (shouldIgnoreSystemEntry(entry.name)) continue;
    if (isTransientDownloadEntry(entry.name)) continue;
    const sourcePath = path.join(normalizedDirectory, entry.name);
    const fileStat = await fs$2.stat(sourcePath).catch(() => null);
    if (!(fileStat == null ? void 0 : fileStat.isFile())) continue;
    seenPaths.add(sourcePath);
    const previous = autoImportObservedFiles.get(sourcePath);
    const unchanged = previous ? previous.size === fileStat.size && previous.mtimeMs === fileStat.mtimeMs : false;
    const stableCount = unchanged && previous ? previous.stableCount + 1 : 1;
    autoImportObservedFiles.set(sourcePath, {
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      stableCount,
      lastSeenAt: nowTs
    });
    if (stableCount < AUTO_IMPORT_MIN_STABLE_COUNT) continue;
    if (nowTs - fileStat.mtimeMs < AUTO_IMPORT_MIN_MTIME_AGE_MS) continue;
    readyCandidates.push({
      sourcePath,
      name: entry.name,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs
    });
  }
  cleanupObservedState(seenPaths);
  if (readyCandidates.length === 0) {
    return [];
  }
  readyCandidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const stagingRoot = getAutoImportStagingRoot();
  await fs$2.mkdir(stagingRoot, { recursive: true });
  const claimedFiles = [];
  const claimLimit = Math.max(1, Math.floor(Number(maxFiles) || AUTO_IMPORT_DEFAULT_MAX_FILES));
  for (const candidate of readyCandidates.slice(0, claimLimit)) {
    const stagedPath = path.join(stagingRoot, buildStagedFileName$1(candidate.name));
    try {
      await moveFileSafe(candidate.sourcePath, stagedPath);
    } catch {
      continue;
    }
    autoImportObservedFiles.delete(candidate.sourcePath);
    claimedFiles.push({
      name: candidate.name,
      size: candidate.size,
      localPath: stagedPath,
      relativePath: normalizeRelativePath(candidate.name)
    });
  }
  return claimedFiles;
}
async function cleanupStagedFile(stagedPath) {
  const normalizedPath = path.resolve(String(stagedPath || "").trim());
  const stagingRoot = getAutoImportStagingRoot();
  if (!normalizedPath || !isPathInsideDirectory$1(normalizedPath, stagingRoot)) {
    return false;
  }
  await fs$2.rm(normalizedPath, { force: true });
  return true;
}
function resolveTargetPath(baseDirectory, relativePath) {
  const normalizedRelativePath = normalizeRelativePath(relativePath || "");
  if (!normalizedRelativePath) {
    return baseDirectory;
  }
  const segments = normalizedRelativePath.split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error(`非法下载路径片段: ${segment}`);
    }
    if (segment.includes("\0")) {
      throw new Error("非法下载路径：包含空字符");
    }
  }
  return path.join(baseDirectory, ...segments);
}
function byRelativePath(a, b) {
  return a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN");
}
async function collectFilesFromSelectedFilePaths(filePaths) {
  const files = await Promise.all(filePaths.map(async (filePath) => {
    const stat = await fs$2.stat(filePath);
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
  const pendingDirectories = [currentPath];
  const pendingFiles = [];
  while (pendingDirectories.length > 0) {
    const directoryPath = pendingDirectories.pop();
    const entries = await fs$2.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") {
        continue;
      }
      if (shouldIgnoreSystemEntry(entry.name)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      pendingFiles.push({
        absolutePath,
        name: entry.name
      });
    }
  }
  const files = [];
  const STAT_CONCURRENCY = 48;
  let currentIndex = 0;
  const statWorker = async () => {
    while (currentIndex < pendingFiles.length) {
      const workIndex = currentIndex;
      currentIndex += 1;
      if (workIndex >= pendingFiles.length) {
        return;
      }
      const candidate = pendingFiles[workIndex];
      const stat = await fs$2.stat(candidate.absolutePath).catch(() => null);
      if (!(stat == null ? void 0 : stat.isFile())) {
        continue;
      }
      const relativeInsideRoot = normalizeRelativePath(path.relative(rootPath, candidate.absolutePath));
      const relativePath = normalizeRelativePath(path.join(rootDisplayName, relativeInsideRoot));
      files.push({
        name: candidate.name,
        size: stat.size,
        localPath: candidate.absolutePath,
        relativePath
      });
    }
  };
  const workerCount = Math.min(STAT_CONCURRENCY, Math.max(1, pendingFiles.length));
  await Promise.all(Array.from({ length: workerCount }, () => statWorker()));
  return files;
}
async function collectFilesFromSelectedFolders(folderPaths) {
  const allFiles = [];
  for (const folderPath of folderPaths) {
    const folderStat = await fs$2.stat(folderPath);
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
  ipcMain2.handle("file:open", async (_event, options) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "dontAddToRecent"],
      filters: normalizeDialogFilters(options == null ? void 0 : options.filters, [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ])
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, content: "", filePath: "" };
    }
    const filePath = result.filePaths[0];
    return {
      canceled: false,
      content: await fs$2.readFile(filePath, "utf-8"),
      filePath
    };
  });
  ipcMain2.handle("file:save", async (_e, filePath, content) => {
    await fs$2.writeFile(filePath, content, "utf-8");
    return true;
  });
  ipcMain2.handle("fs:write-text-file", async (_event, filePath, content) => {
    const normalizedPath = path.resolve(String(filePath || "").trim());
    if (!normalizedPath) {
      throw new Error("无效的文本保存路径");
    }
    await fs$2.mkdir(path.dirname(normalizedPath), { recursive: true });
    await fs$2.writeFile(normalizedPath, String(content ?? ""), "utf-8");
    return normalizedPath;
  });
  ipcMain2.handle("file:read-text", async (_event, filePath) => {
    const normalizedPath = path.resolve(String(filePath || "").trim());
    return {
      canceled: false,
      content: await fs$2.readFile(normalizedPath, "utf-8"),
      filePath: normalizedPath
    };
  });
  ipcMain2.handle("file:read-local-chrome-bookmarks", async () => {
    const filePath = path.join(app.getPath("home"), MAC_CHROME_BOOKMARK_RELATIVE_PATH);
    return {
      canceled: false,
      content: await fs$2.readFile(filePath, "utf-8"),
      filePath
    };
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
  ipcMain2.handle("dialog:pick-download-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, directoryPath: "" };
    }
    return { canceled: false, directoryPath: result.filePaths[0] };
  });
  ipcMain2.handle("dialog:save-download-file", async (_event, defaultFileName, options) => {
    const result = await dialog.showSaveDialog({
      defaultPath: String(defaultFileName || "download"),
      filters: normalizeDialogFilters(options == null ? void 0 : options.filters, [
        { name: "All Files", extensions: ["*"] }
      ]),
      showsTagField: false
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: "" };
    }
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain2.handle("dialog:pick-auto-import-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, directoryPath: "" };
    }
    return { canceled: false, directoryPath: result.filePaths[0] };
  });
  ipcMain2.handle("fs:claim-auto-import-files", async (_event, watchDirectory, maxFiles = AUTO_IMPORT_DEFAULT_MAX_FILES) => {
    const files = await claimStableInboxFiles(watchDirectory, maxFiles);
    return { canceled: false, files };
  });
  ipcMain2.handle("fs:cleanup-auto-import-staged-file", async (_event, stagedPath) => {
    try {
      return await cleanupStagedFile(stagedPath);
    } catch {
      return false;
    }
  });
  ipcMain2.handle("fs:ensure-directory", async (_event, baseDirectory, relativePath = "") => {
    const targetPath = resolveTargetPath(baseDirectory, relativePath);
    await fs$2.mkdir(targetPath, { recursive: true });
    return targetPath;
  });
  ipcMain2.handle("fs:download-url-to-path", async (_event, url, baseDirectory, relativePath, headers = {}) => {
    const targetPath = resolveTargetPath(baseDirectory, relativePath);
    await downloadUrlToFile(url, targetPath, headers);
    return targetPath;
  });
  ipcMain2.handle("fs:save-staged-download-file", async (_event, stagedPath, targetFilePath) => {
    const normalizedSourcePath = path.resolve(String(stagedPath || "").trim());
    const normalizedTargetPath = path.resolve(String(targetFilePath || "").trim());
    const stagingRoot = getEmbeddedBrowserDownloadStagingRoot();
    if (!normalizedSourcePath || !isPathInsideDirectory$1(normalizedSourcePath, stagingRoot)) {
      throw new Error("无效的下载临时文件");
    }
    if (!normalizedTargetPath) {
      throw new Error("无效的保存路径");
    }
    await fs$2.mkdir(path.dirname(normalizedTargetPath), { recursive: true });
    await fs$2.copyFile(normalizedSourcePath, normalizedTargetPath);
    return normalizedTargetPath;
  });
  ipcMain2.handle("fs:create-staged-text-file", async (_event, fileName, content) => {
    const stagingRoot = getTextFileStagingRoot();
    await fs$2.mkdir(stagingRoot, { recursive: true });
    const stagedPath = path.join(stagingRoot, buildStagedFileName$1(fileName || "subtitle.txt"));
    const normalizedContent = String(content ?? "");
    await fs$2.writeFile(stagedPath, normalizedContent, "utf-8");
    return {
      filePath: stagedPath,
      size: Buffer.byteLength(normalizedContent, "utf-8")
    };
  });
  ipcMain2.handle("fs:cleanup-staged-text-file", async (_event, stagedPath) => {
    const normalizedPath = path.resolve(String(stagedPath || "").trim());
    const stagingRoot = getTextFileStagingRoot();
    if (!normalizedPath || !isPathInsideDirectory$1(normalizedPath, stagingRoot)) {
      return false;
    }
    await fs$2.rm(normalizedPath, { force: true });
    return true;
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
  const stats = fs$3.statfsSync(process.platform === "win32" ? "C:" : "/");
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
function escapeMultipartDispositionValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function encodeRFC5987Value(value) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function buildFileContentDisposition(fileName) {
  const escaped = escapeMultipartDispositionValue(fileName);
  const encoded = encodeRFC5987Value(fileName);
  return `Content-Disposition: form-data; name="file"; filename="${escaped}"; filename*=UTF-8''${encoded}\r
`;
}
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
  ipcMain2.handle("http:fetch-binary", async (_event, url, options = {}) => {
    runtimeLogger.debug("http:fetch-binary start");
    runtimeLogger.debug("http:fetch-binary URL:", url);
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: options.method || "GET" });
      const maxBytes = Math.max(0, Number(options.maxBytes || 0));
      const chunks = [];
      let receivedBytes = 0;
      let settled = false;
      const safeResolve = (payload) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      };
      const safeReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          request.setHeader(key, value);
        });
      }
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          if (settled) {
            return;
          }
          let nextChunk = chunk;
          let truncated = false;
          if (maxBytes > 0 && receivedBytes + chunk.length > maxBytes) {
            nextChunk = chunk.subarray(0, Math.max(0, maxBytes - receivedBytes));
            truncated = true;
          }
          if (nextChunk.length > 0) {
            chunks.push(nextChunk);
            receivedBytes += nextChunk.length;
          }
          if (truncated) {
            try {
              request.abort();
            } catch {
            }
            safeResolve({
              base64: Buffer.concat(chunks).toString("base64"),
              headers: response.headers,
              receivedBytes,
              status: response.statusCode,
              truncated: true
            });
          }
        });
        response.on("end", () => {
          safeResolve({
            base64: Buffer.concat(chunks).toString("base64"),
            headers: response.headers,
            receivedBytes,
            status: response.statusCode,
            truncated: false
          });
        });
      });
      request.on("error", (err) => {
        if (settled) {
          return;
        }
        runtimeLogger.error("http:fetch-binary error:", err);
        safeReject(err);
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
        stat = fs$1.statSync(filePath);
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
Content-Disposition: form-data; name="${escapeMultipartDispositionValue(key)}"\r
\r
${value}\r
`).join("");
      const filePrefix = `--${boundary}\r
` + buildFileContentDisposition(fileName) + `Content-Type: application/octet-stream\r
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
      const fileStream = fs$1.createReadStream(filePath, {
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
function createEmbeddedBrowserCatchToolkitGetStateScript() {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.getCatchToolkitState === 'function'
        ? probe.getCatchToolkitState
        : null
      return handler ? handler() : null
    })()
  `;
}
function createEmbeddedBrowserCatchToolkitUpdateStateScript(payload) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.updateCatchToolkitState === 'function'
        ? probe.updateCatchToolkitState
        : null
      return handler ? handler(${JSON.stringify(payload)}) : null
    })()
  `;
}
function createEmbeddedBrowserCatchToolkitActionScript(action) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe[${JSON.stringify(action)}] === 'function'
        ? probe[${JSON.stringify(action)}]
        : null
      return handler ? handler() : false
    })()
  `;
}
function normalizeCatchToolkitStatePayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value;
  if (typeof payload.audioResourceKey !== "string" || typeof payload.audioSizeBytes !== "number" || typeof payload.autoSeekToBufferedEnd !== "boolean" || typeof payload.autoDownloadOnComplete !== "boolean" || typeof payload.capturedMediaSizeBytes !== "number" || typeof payload.clearCacheOnComplete !== "boolean" || typeof payload.currentFileName !== "string" || !payload.diagnostics || typeof payload.diagnostics !== "object" || typeof payload.diagnostics.appendBufferCount !== "number" || typeof payload.diagnostics.frameUrl !== "string" || typeof payload.diagnostics.hookErrors !== "number" || typeof payload.diagnostics.installedAt !== "number" || typeof payload.diagnostics.lastAppendAt !== "number" || typeof payload.diagnostics.lastError !== "string" || typeof payload.diagnostics.mediaSourceAvailable !== "boolean" || typeof payload.diagnostics.mediaSourceHooked !== "boolean" || typeof payload.diagnostics.sourceBufferCount !== "number" || typeof payload.isCaptureComplete !== "boolean" || typeof payload.manualFileName !== "string" || typeof payload.primaryResourceKey !== "string" || typeof payload.regexWarning !== "string" || typeof payload.regexRule !== "string" || typeof payload.restartAlwaysFromBeginning !== "boolean" || typeof payload.selectorWarning !== "string" || typeof payload.selectorRule !== "string" || typeof payload.streamCount !== "number" || typeof payload.trimExtraMediaHeaders !== "boolean" || typeof payload.videoResourceKey !== "string" || typeof payload.videoSizeBytes !== "number") {
    return null;
  }
  return {
    audioResourceKey: payload.audioResourceKey,
    audioSizeBytes: payload.audioSizeBytes,
    autoSeekToBufferedEnd: payload.autoSeekToBufferedEnd,
    autoDownloadOnComplete: payload.autoDownloadOnComplete,
    capturedMediaSizeBytes: payload.capturedMediaSizeBytes,
    clearCacheOnComplete: payload.clearCacheOnComplete,
    currentFileName: payload.currentFileName,
    diagnostics: {
      appendBufferCount: payload.diagnostics.appendBufferCount,
      frameCount: typeof payload.diagnostics.frameCount === "number" ? payload.diagnostics.frameCount : void 0,
      frameUrl: payload.diagnostics.frameUrl,
      hookErrors: payload.diagnostics.hookErrors,
      installedAt: payload.diagnostics.installedAt,
      lastAppendAt: payload.diagnostics.lastAppendAt,
      lastError: payload.diagnostics.lastError,
      mediaSourceAvailable: payload.diagnostics.mediaSourceAvailable,
      mediaSourceHooked: payload.diagnostics.mediaSourceHooked,
      sourceBufferCount: payload.diagnostics.sourceBufferCount
    },
    isCaptureComplete: payload.isCaptureComplete,
    manualFileName: payload.manualFileName,
    primaryResourceKey: payload.primaryResourceKey,
    regexWarning: payload.regexWarning,
    regexRule: payload.regexRule,
    restartAlwaysFromBeginning: payload.restartAlwaysFromBeginning,
    selectorWarning: payload.selectorWarning,
    selectorRule: payload.selectorRule,
    streamCount: payload.streamCount,
    trimExtraMediaHeaders: payload.trimExtraMediaHeaders,
    videoResourceKey: payload.videoResourceKey,
    videoSizeBytes: payload.videoSizeBytes
  };
}
async function getEmbeddedBrowserCatchToolkitState(executeScript) {
  const result = await executeScript(createEmbeddedBrowserCatchToolkitGetStateScript());
  return normalizeCatchToolkitStatePayload(result);
}
async function updateEmbeddedBrowserCatchToolkitState(executeScript, payload) {
  const result = await executeScript(
    createEmbeddedBrowserCatchToolkitUpdateStateScript(payload)
  );
  return normalizeCatchToolkitStatePayload(result);
}
async function runEmbeddedBrowserCatchToolkitAction(executeScript, action) {
  const result = await executeScript(
    createEmbeddedBrowserCatchToolkitActionScript(action)
  );
  return Boolean(result);
}
function registerEmbeddedBrowserMainIpcHandlers(handlers) {
  ipcMain.handle("embedded-browser:open-tab", async (event, tabId, url) => handlers.openTab(event.sender, tabId, url));
  ipcMain.handle("embedded-browser:activate-tab", (event, tabId) => handlers.activateTab(event.sender, tabId));
  ipcMain.handle("embedded-browser:navigate", async (event, tabId, url) => handlers.navigate(event.sender, tabId, url));
  ipcMain.handle("embedded-browser:resolve-favicon", async (_event, payload) => handlers.resolveFavicon(payload));
  ipcMain.handle(
    "embedded-browser:open-mapped-file",
    async (event, tabId, pageUrl, sourceUrl, fileName) => handlers.openMappedFile(event.sender, tabId, pageUrl, sourceUrl, fileName)
  );
  ipcMain.handle("embedded-browser:reload", async (_event, tabId) => handlers.reload(tabId));
  ipcMain.handle("embedded-browser:go-back", async (_event, tabId) => handlers.goBack(tabId));
  ipcMain.handle("embedded-browser:go-forward", async (_event, tabId) => handlers.goForward(tabId));
  ipcMain.handle("embedded-browser:resource:list", (_event, tabId) => handlers.listCapturedResources(tabId));
  ipcMain.handle("embedded-browser:resource:start", (_event, tabId) => handlers.startCapturedResources(tabId));
  ipcMain.handle("embedded-browser:resource:stop", (_event, tabId) => handlers.stopCapturedResources(tabId));
  ipcMain.handle("embedded-browser:resource:clear", (_event, tabId) => handlers.clearCapturedResources(tabId));
  ipcMain.handle("embedded-browser:resource:open", async (_event, tabId, resourceKey) => handlers.openResource(tabId, resourceKey));
  ipcMain.handle("embedded-browser:resource:export", async (_event, tabId, resourceKey) => handlers.exportResource(tabId, resourceKey));
  ipcMain.handle("embedded-browser:resource:read", async (_event, tabId, resourceKey) => handlers.readResource(tabId, resourceKey));
  ipcMain.handle(
    "embedded-browser:resource:preview",
    async (_event, tabId, payload) => handlers.previewResource(tabId, payload)
  );
  ipcMain.handle("embedded-browser:resource:catch-toolkit:get-state", async (_event, tabId) => handlers.getCatchToolkitState(tabId));
  ipcMain.handle(
    "embedded-browser:resource:catch-toolkit:update-state",
    async (_event, tabId, payload) => handlers.updateCatchToolkitState(tabId, payload)
  );
  ipcMain.handle("embedded-browser:resource:catch-toolkit:clear-cache", async (_event, tabId) => handlers.clearCatchMediaCache(tabId));
  ipcMain.handle("embedded-browser:resource:catch-toolkit:download", async (_event, tabId) => handlers.downloadCatchMedia(tabId));
  ipcMain.handle("embedded-browser:resource:catch-toolkit:restart", async (_event, tabId) => handlers.restartCatchMediaCapture(tabId));
  ipcMain.handle(
    "embedded-browser:resource:merge-mse",
    async (_event, tabId, payload) => handlers.mergeMseResources(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:save",
    async (_event, tabId, payload) => handlers.saveResource(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:download-hls",
    async (_event, tabId, payload) => handlers.downloadHlsManifest(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:download-mpd",
    async (_event, tabId, payload) => handlers.downloadMpdManifest(tabId, payload)
  );
  ipcMain.handle("embedded-browser:resource:start-deep-capture", async (_event, tabId) => handlers.startDeepResourceCapture(tabId));
  ipcMain.handle("embedded-browser:set-bounds", (event, bounds) => handlers.setBounds(event.sender, bounds));
  ipcMain.handle("embedded-browser:close-tab", (event, tabId) => handlers.closeTab(event.sender, tabId));
  ipcMain.handle("embedded-browser:cleanup-download-file", async (_event, tempPath) => handlers.cleanupDownloadFile(tempPath));
  ipcMain.handle("embedded-browser:deactivate", (event) => handlers.deactivate(event.sender));
  ipcMain.handle("embedded-browser:close-all", (event) => handlers.closeAll(event.sender));
}
const EMBEDDED_BROWSER_PARTITION = "persist:omniflow-embedded-browser";
const EMBEDDED_BROWSER_DOWNLOAD_DIRNAME = "embedded-browser-downloads";
let embeddedBrowserSessionInstance = null;
let embeddedBrowserDownloadBridgeInitialized = false;
function getEmbeddedBrowserDownloadRoot() {
  return path.join(app.getPath("userData"), EMBEDDED_BROWSER_DOWNLOAD_DIRNAME);
}
function ensureEmbeddedBrowserDownloadRoot() {
  const root = getEmbeddedBrowserDownloadRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}
function buildDownloadId() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function buildStagedDownloadName(fileName) {
  const safeName = String(fileName).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}
function toDownloadPayload(item, overrides) {
  var _a, _b;
  return {
    downloadId: overrides.downloadId,
    fileName: overrides.fileName,
    mimeType: overrides.mimeType,
    pageUrl: overrides.pageUrl,
    receivedBytes: overrides.receivedBytes ?? Math.max(0, Number(((_a = item.getReceivedBytes) == null ? void 0 : _a.call(item)) || 0)),
    state: overrides.state,
    tabId: overrides.tabId,
    tempPath: overrides.tempPath,
    totalBytes: overrides.totalBytes ?? Math.max(0, Number(((_b = item.getTotalBytes) == null ? void 0 : _b.call(item)) || 0)),
    url: overrides.url,
    ...overrides.error ? { error: overrides.error } : {}
  };
}
function getEmbeddedBrowserSession() {
  if (!embeddedBrowserSessionInstance) {
    embeddedBrowserSessionInstance = session.fromPartition(EMBEDDED_BROWSER_PARTITION);
  }
  return embeddedBrowserSessionInstance;
}
async function cleanupEmbeddedBrowserDownloadFile(tempPath) {
  const normalizedPath = path.resolve(String(tempPath || "").trim());
  if (!normalizedPath) {
    return false;
  }
  const downloadRoot = path.resolve(getEmbeddedBrowserDownloadRoot());
  if (normalizedPath !== downloadRoot && !normalizedPath.startsWith(`${downloadRoot}${path.sep}`)) {
    return false;
  }
  await fs.rm(normalizedPath, { force: true });
  return true;
}
function initializeEmbeddedBrowserDownloadBridge(options) {
  if (embeddedBrowserDownloadBridgeInitialized) {
    return;
  }
  embeddedBrowserDownloadBridgeInitialized = true;
  const handleWillDownload = (_event, item, webContents2) => {
    const tabId = options.resolveTabIdByWebContents(webContents2) || void 0;
    if (!tabId) {
      return;
    }
    const downloadRoot = ensureEmbeddedBrowserDownloadRoot();
    const downloadId = buildDownloadId();
    const fileName = item.getFilename() || "download";
    const url = item.getURL() || "";
    const pageUrl = webContents2.getURL() || void 0;
    const tempPath = path.join(downloadRoot, buildStagedDownloadName(fileName));
    item.setSavePath(tempPath);
    options.emitDownload(toDownloadPayload(item, {
      downloadId,
      fileName,
      mimeType: item.getMimeType() || void 0,
      pageUrl,
      state: "started",
      tabId,
      tempPath,
      url
    }));
    item.on("updated", (_updatedEvent, state) => {
      if (state !== "progressing") {
        return;
      }
      options.emitDownload(toDownloadPayload(item, {
        downloadId,
        fileName,
        mimeType: item.getMimeType() || void 0,
        pageUrl,
        state: "progress",
        tabId,
        tempPath,
        url
      }));
    });
    item.once("done", (_doneEvent, state) => {
      if (state === "completed") {
        options.emitDownload(toDownloadPayload(item, {
          downloadId,
          fileName,
          mimeType: item.getMimeType() || void 0,
          pageUrl,
          state: "completed",
          tabId,
          tempPath,
          url
        }));
        return;
      }
      void cleanupEmbeddedBrowserDownloadFile(tempPath).catch(() => void 0);
      options.emitDownload(toDownloadPayload(item, {
        downloadId,
        error: state === "cancelled" ? "下载已取消" : `下载失败：${state}`,
        fileName,
        mimeType: item.getMimeType() || void 0,
        pageUrl,
        state: state === "cancelled" ? "cancelled" : "failed",
        tabId,
        tempPath,
        url
      }));
    });
  };
  const handledSessions = /* @__PURE__ */ new Set();
  const candidateSessions = [session.defaultSession, getEmbeddedBrowserSession()].filter(Boolean);
  candidateSessions.forEach((candidate) => {
    if (handledSessions.has(candidate)) {
      return;
    }
    handledSessions.add(candidate);
    candidate.on("will-download", handleWillDownload);
  });
}
const catCatchManifestExtensions = [
  "m3u8",
  "m3u",
  "mpd"
];
const catCatchMediaExtensions = [
  "flv",
  "hlv",
  "f4v",
  "mp4",
  "m4v",
  "m4a",
  "m4s",
  "mp3",
  "wma",
  "wav",
  "aac",
  "flac",
  "ts",
  "webm",
  "ogg",
  "oga",
  "ogv",
  "mov",
  "mkv",
  "mpeg",
  "avi",
  "wmv",
  "asf",
  "movie",
  "divx",
  "mpeg4",
  "vid",
  "weba",
  "opus",
  "acc",
  "3gp"
];
const catCatchImageExtensions = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico"
];
const catCatchSubtitleExtensions = [
  "vtt",
  "srt",
  "ass",
  "ssa",
  "ttml"
];
const catCatchKeyExtensions = [
  "key",
  "base64key"
];
const catCatchMediaMimeTypes = [
  "application/ogg",
  "application/m4s"
];
const catCatchManifestMimeTypeIncludes = [
  "mpegurl",
  "dash+xml"
];
const catCatchRelevantRequestHeaders = [
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent"
];
const catCatchManifestExtensionSet = new Set(catCatchManifestExtensions);
const catCatchMediaExtensionSet = new Set(catCatchMediaExtensions);
const catCatchImageExtensionSet = new Set(catCatchImageExtensions);
const catCatchSubtitleExtensionSet = new Set(catCatchSubtitleExtensions);
const catCatchKeyExtensionSet = new Set(catCatchKeyExtensions);
const catCatchMediaMimeTypeSet = new Set(catCatchMediaMimeTypes);
const catCatchRelevantRequestHeaderSet = new Set(catCatchRelevantRequestHeaders);
function isCatCatchManifestMimeType(normalizedMimeType) {
  return catCatchManifestMimeTypeIncludes.some((value) => normalizedMimeType.includes(value));
}
function isCatCatchMediaMimeType(normalizedMimeType) {
  return normalizedMimeType.startsWith("video/") || normalizedMimeType.startsWith("audio/") || catCatchMediaMimeTypeSet.has(normalizedMimeType);
}
function classifyCatCatchExtensionKind(extension) {
  if (catCatchManifestExtensionSet.has(extension)) {
    return "manifest";
  }
  if (catCatchMediaExtensionSet.has(extension)) {
    return "media";
  }
  if (catCatchImageExtensionSet.has(extension)) {
    return "image";
  }
  if (catCatchSubtitleExtensionSet.has(extension)) {
    return "subtitle";
  }
  if (catCatchKeyExtensionSet.has(extension)) {
    return "key";
  }
  return null;
}
function getHeaderValue(headers, name) {
  if (!headers) {
    return "";
  }
  const targetName = name.toLowerCase();
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== targetName) {
      continue;
    }
    if (Array.isArray(headerValue)) {
      return String(headerValue[0] || "");
    }
    return String(headerValue || "");
  }
  return "";
}
function normalizeMimeType(input) {
  var _a;
  return ((_a = String(input || "").split(";")[0]) == null ? void 0 : _a.trim().toLowerCase()) || "";
}
function getResourceExtension(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return (match == null ? void 0 : match[1]) || "";
  } catch {
    const match = String(url || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (match == null ? void 0 : match[1]) || "";
  }
}
function classifyCapturedResource(input) {
  const normalizedMimeType = normalizeMimeType(input.mimeType);
  const extension = getResourceExtension(input.url);
  const extensionKind = classifyCatCatchExtensionKind(extension);
  if (extensionKind === "manifest" || isCatCatchManifestMimeType(normalizedMimeType)) {
    return "manifest";
  }
  if (extensionKind === "media" || isCatCatchMediaMimeType(normalizedMimeType) || input.resourceType === "media" || String(input.url || "").startsWith("blob:")) {
    return "media";
  }
  if (extensionKind === "image" || normalizedMimeType.startsWith("image/")) {
    return "image";
  }
  if (extensionKind === "subtitle" || normalizedMimeType.includes("text/vtt")) {
    return "subtitle";
  }
  if (extension === "pdf" || normalizedMimeType === "application/pdf") {
    return "document";
  }
  if (extensionKind === "key" || input.resourceType === "key" || normalizedMimeType === "application/octet-stream") {
    return "key";
  }
  return "other";
}
function shouldCaptureResource(input) {
  if (!input.url || input.url.startsWith("data:")) {
    return false;
  }
  if (input.kind !== "other") {
    return true;
  }
  return input.resourceType === "media" || input.url.startsWith("blob:");
}
function parseContentLength(rawValue) {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : void 0;
}
function parseContentRangeTotal(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return void 0;
  }
  const match = value.match(/\/(\d+)\s*$/);
  if (!(match == null ? void 0 : match[1])) {
    return void 0;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : void 0;
}
function inferStreamType(input) {
  if (input.streamType) {
    return input.streamType;
  }
  const normalizedMimeType = normalizeMimeType(input.mimeType);
  if (normalizedMimeType.startsWith("audio/")) {
    return "audio";
  }
  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }
  const normalizedUrl = String(input.url || "").toLowerCase();
  if (/(^|[\/_.-])audio([\/_.-]|$)/.test(normalizedUrl)) {
    return "audio";
  }
  if (/(^|[\/_.-])video([\/_.-]|$)/.test(normalizedUrl)) {
    return "video";
  }
  if (input.resourceType === "media") {
    return "video";
  }
  return void 0;
}
function pickRelevantRequestHeaders(headers) {
  if (!headers) {
    return void 0;
  }
  const result = {};
  Object.entries(headers).forEach(([headerName, headerValue]) => {
    const normalizedName = headerName.toLowerCase();
    if (!catCatchRelevantRequestHeaderSet.has(normalizedName)) {
      return;
    }
    const normalizedValue = String(headerValue || "").trim();
    if (!normalizedValue) {
      return;
    }
    result[normalizedName] = normalizedValue;
  });
  return Object.keys(result).length ? result : void 0;
}
const tabCaptureStates = /* @__PURE__ */ new Map();
let emitCapturedResource = null;
function createEmptyState() {
  return {
    deepCaptureEnabled: false,
    enabled: false,
    resources: /* @__PURE__ */ new Map()
  };
}
function getOrCreateTabCaptureState(tabId) {
  const normalizedTabId = String(tabId || "").trim();
  if (!normalizedTabId) {
    return null;
  }
  const existingState = tabCaptureStates.get(normalizedTabId);
  if (existingState) {
    return existingState;
  }
  const nextState = createEmptyState();
  tabCaptureStates.set(normalizedTabId, nextState);
  return nextState;
}
function getEmbeddedBrowserTabCaptureState(tabId) {
  const normalizedTabId = String(tabId || "").trim();
  if (!normalizedTabId) {
    return null;
  }
  return tabCaptureStates.get(normalizedTabId) || null;
}
function buildResourceKey(tabId, source, url, resourceKey) {
  if (resourceKey) {
    return `${tabId}::${source}::${resourceKey}`;
  }
  return `${tabId}::${source}::${url}`;
}
function buildResourceId(tabId, source, url, resourceKey) {
  return buildResourceKey(tabId, source, url, resourceKey);
}
function toSortedResourceList(resources) {
  return Array.from(resources.values()).sort((left, right) => right.capturedAt - left.capturedAt);
}
function createSnapshotFromState(state) {
  return {
    deepCaptureEnabled: state.deepCaptureEnabled,
    enabled: state.enabled,
    resources: toSortedResourceList(state.resources)
  };
}
function setEmbeddedBrowserCapturedResourceEmitter(emitter) {
  emitCapturedResource = emitter;
}
function updateEmbeddedBrowserCapturedResource(tabId, input) {
  const state = getEmbeddedBrowserTabCaptureState(tabId);
  if (!(state == null ? void 0 : state.enabled)) {
    return null;
  }
  const normalizedUrl = String(input.url || "").trim();
  if (!normalizedUrl) {
    return null;
  }
  const stableResourceKey = String(input.resourceKey || "").trim() || void 0;
  const storageKey = buildResourceKey(tabId, input.source, normalizedUrl, stableResourceKey);
  const previousResource = state.resources.get(storageKey);
  const nextResource = {
    ...previousResource,
    ...input,
    ext: input.ext || (previousResource == null ? void 0 : previousResource.ext) || getResourceExtension(normalizedUrl) || void 0,
    id: buildResourceId(tabId, input.source, normalizedUrl, stableResourceKey),
    kind: input.kind,
    resourceKey: stableResourceKey,
    tabId,
    url: normalizedUrl
  };
  const changed = JSON.stringify(previousResource) !== JSON.stringify(nextResource);
  if (!changed) {
    return previousResource || null;
  }
  state.resources.set(storageKey, nextResource);
  emitCapturedResource == null ? void 0 : emitCapturedResource(nextResource);
  return nextResource;
}
function getEmbeddedBrowserResourceCaptureSnapshot(tabId) {
  const state = getEmbeddedBrowserTabCaptureState(tabId);
  return state ? createSnapshotFromState(state) : createSnapshotFromState(createEmptyState());
}
function startEmbeddedBrowserResourceCapture(tabId) {
  const state = getOrCreateTabCaptureState(tabId);
  if (!state) {
    return createSnapshotFromState(createEmptyState());
  }
  state.enabled = true;
  return createSnapshotFromState(state);
}
function startEmbeddedBrowserDeepResourceCapture(tabId) {
  const state = getOrCreateTabCaptureState(tabId);
  if (!state) {
    return createSnapshotFromState(createEmptyState());
  }
  state.enabled = true;
  state.deepCaptureEnabled = true;
  return createSnapshotFromState(state);
}
function stopEmbeddedBrowserResourceCapture(tabId) {
  const state = getOrCreateTabCaptureState(tabId);
  if (!state) {
    return createSnapshotFromState(createEmptyState());
  }
  state.enabled = false;
  state.deepCaptureEnabled = false;
  return createSnapshotFromState(state);
}
function clearEmbeddedBrowserCapturedResources(tabId) {
  const state = getOrCreateTabCaptureState(tabId);
  if (!state) {
    return createSnapshotFromState(createEmptyState());
  }
  state.resources.clear();
  return createSnapshotFromState(state);
}
function disposeEmbeddedBrowserCapturedResources(tabId) {
  tabCaptureStates.delete(String(tabId || "").trim());
}
function isEmbeddedBrowserDeepCaptureEnabled(tabId) {
  var _a;
  return Boolean((_a = getEmbeddedBrowserTabCaptureState(tabId)) == null ? void 0 : _a.deepCaptureEnabled);
}
const requestContextsByRequestId = /* @__PURE__ */ new Map();
let embeddedBrowserResourceBridgeInitialized = false;
function initializeEmbeddedBrowserResourceBridge(options) {
  if (embeddedBrowserResourceBridgeInitialized) {
    return;
  }
  embeddedBrowserResourceBridgeInitialized = true;
  setEmbeddedBrowserCapturedResourceEmitter(options.emitResource);
  options.browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    requestContextsByRequestId.set(details.id, {
      referer: details.referrer || void 0,
      requestHeaders: pickRelevantRequestHeaders(details.requestHeaders)
    });
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
  options.browserSession.webRequest.onCompleted((details) => {
    if (!details.webContentsId) {
      requestContextsByRequestId.delete(details.id);
      return;
    }
    const tabId = options.resolveTabIdByWebContentsId(details.webContentsId);
    const state = tabId ? getEmbeddedBrowserTabCaptureState(tabId) : null;
    if (!tabId || !(state == null ? void 0 : state.enabled)) {
      requestContextsByRequestId.delete(details.id);
      return;
    }
    if (details.statusCode < 200 || details.statusCode >= 400) {
      requestContextsByRequestId.delete(details.id);
      return;
    }
    const targetWebContents = webContents.fromId(details.webContentsId);
    const url = String(details.url || "").trim();
    const requestContext = requestContextsByRequestId.get(details.id);
    const mimeType = normalizeMimeType(getHeaderValue(details.responseHeaders, "content-type"));
    const kind = classifyCapturedResource({
      mimeType,
      resourceType: details.resourceType,
      url
    });
    if (!shouldCaptureResource({ kind, resourceType: details.resourceType, url })) {
      requestContextsByRequestId.delete(details.id);
      return;
    }
    updateEmbeddedBrowserCapturedResource(tabId, {
      capturedAt: Date.now(),
      contentLength: parseContentRangeTotal(getHeaderValue(details.responseHeaders, "content-range")) || parseContentLength(getHeaderValue(details.responseHeaders, "content-length")),
      ext: getResourceExtension(url) || void 0,
      kind,
      method: details.method || void 0,
      mimeType,
      pageUrl: (targetWebContents == null ? void 0 : targetWebContents.getURL()) || void 0,
      referer: (requestContext == null ? void 0 : requestContext.referer) || details.referrer || void 0,
      requestHeaders: requestContext == null ? void 0 : requestContext.requestHeaders,
      resourceType: details.resourceType || void 0,
      source: "network",
      statusCode: details.statusCode || void 0,
      streamType: inferStreamType({
        mimeType,
        resourceType: details.resourceType,
        url
      }),
      url
    });
    requestContextsByRequestId.delete(details.id);
  });
  options.browserSession.webRequest.onErrorOccurred((details) => {
    requestContextsByRequestId.delete(details.id);
  });
}
function recordEmbeddedBrowserProbeResource(tabId, payload) {
  const state = getEmbeddedBrowserTabCaptureState(tabId);
  if (!(state == null ? void 0 : state.enabled) || !state.deepCaptureEnabled) {
    return null;
  }
  const url = String(payload.url || "").trim();
  if (!url) {
    return null;
  }
  const kind = payload.kind || classifyCapturedResource({
    mimeType: payload.mimeType,
    resourceType: payload.resourceType,
    url
  });
  if (!shouldCaptureResource({ kind, resourceType: payload.resourceType, url })) {
    return null;
  }
  return updateEmbeddedBrowserCapturedResource(tabId, {
    capturedAt: Number(payload.capturedAt) || Date.now(),
    contentLength: payload.contentLength,
    ext: payload.ext,
    kind,
    method: payload.method,
    mimeType: normalizeMimeType(payload.mimeType),
    pageUrl: payload.pageUrl,
    resourceType: payload.resourceType,
    resourceKey: payload.resourceKey,
    source: payload.source || "probe",
    statusCode: payload.statusCode,
    streamType: inferStreamType({
      mimeType: payload.mimeType,
      resourceType: payload.resourceType,
      streamType: payload.streamType,
      url
    }),
    url
  });
}
function resolveEmbeddedBrowserOrigin(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}
function isEmbeddedBrowserFileSystemPermission(permission) {
  return permission === "fileSystem";
}
async function confirmEmbeddedBrowserFileSystemOrigin(options, origin) {
  const normalizedOrigin = resolveEmbeddedBrowserOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }
  const cachedDecision = options.decisionCache.get(normalizedOrigin);
  if (typeof cachedDecision === "boolean") {
    return cachedDecision;
  }
  const focusedWindow = BrowserWindow.getFocusedWindow() ?? options.options.getMainWindow() ?? BrowserWindow.getAllWindows()[0] ?? void 0;
  const { response } = await dialog.showMessageBox(focusedWindow, {
    type: "question",
    buttons: ["拒绝", "允许"],
    defaultId: 1,
    cancelId: 0,
    title: "允许网页访问本地目录",
    message: `${normalizedOrigin} 想要访问你选择的本地目录。`,
    detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
    noLink: true
  });
  const granted = response === 1;
  options.decisionCache.set(normalizedOrigin, granted);
  return granted;
}
async function resolveRestrictedPathAccessAction(options, details) {
  const normalizedOrigin = resolveEmbeddedBrowserOrigin(details.origin);
  if (!normalizedOrigin) {
    return "deny";
  }
  const focusedWindow = BrowserWindow.getFocusedWindow() ?? options.getMainWindow() ?? BrowserWindow.getAllWindows()[0] ?? void 0;
  const { response } = await dialog.showMessageBox(focusedWindow, {
    type: "question",
    buttons: ["换个目录", "允许这次访问", "拒绝"],
    defaultId: 0,
    cancelId: 2,
    title: "网页请求访问受限路径",
    message: `${normalizedOrigin} 想要访问受限路径。`,
    detail: String(details.path || ""),
    noLink: true
  });
  if (response === 0) {
    return "tryAgain";
  }
  if (response === 1) {
    return "allow";
  }
  return "deny";
}
function configureEmbeddedBrowserSession(options) {
  const browserSession = session.fromPartition(EMBEDDED_BROWSER_PARTITION);
  browserSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (!isEmbeddedBrowserFileSystemPermission(String(permission))) {
      callback(false);
      return;
    }
    void confirmEmbeddedBrowserFileSystemOrigin(options, details.requestingUrl || "").then((granted) => {
      callback(granted);
    }).catch(() => {
      callback(false);
    });
  });
  browserSession.on("file-system-access-restricted", (event, details, callback) => {
    event.preventDefault();
    void resolveRestrictedPathAccessAction(options.options, details).then((action) => {
      callback(action);
    }).catch(() => {
      callback("deny");
    });
  });
}
function initializeEmbeddedBrowserMainBridges(options) {
  initializeEmbeddedBrowserDownloadBridge({
    emitDownload: options.emitDownload,
    resolveTabIdByWebContents: options.resolveTabIdByWebContents
  });
  initializeEmbeddedBrowserResourceBridge({
    browserSession: session.fromPartition(EMBEDDED_BROWSER_PARTITION),
    emitResource: options.emitResource,
    resolveTabIdByWebContentsId: options.resolveTabIdByWebContentsId
  });
}
async function collectEmbeddedBrowserDebugMeta(view, enabled) {
  if (!enabled || view.webContents.isDestroyed()) {
    return [];
  }
  try {
    const snapshot = await view.webContents.executeJavaScript(`
      (() => {
        const bodyText = document.body?.innerText?.trim() || ''
        const bodyHtmlLength = document.body?.innerHTML?.length || 0
        return {
          title: document.title || '',
          readyState: document.readyState || '',
          bodyTextPreview: bodyText.slice(0, 120),
          bodyHtmlLength,
          innerWidth: window.innerWidth || 0,
          innerHeight: window.innerHeight || 0,
          clientWidth: document.documentElement?.clientWidth || 0,
          clientHeight: document.documentElement?.clientHeight || 0,
          devicePixelRatio: window.devicePixelRatio || 0,
          userAgent: navigator.userAgent || '',
        }
      })()
    `, true);
    const meta = [];
    if (snapshot == null ? void 0 : snapshot.title) {
      meta.push(`title=${snapshot.title}`);
    }
    if (snapshot == null ? void 0 : snapshot.readyState) {
      meta.push(`readyState=${snapshot.readyState}`);
    }
    if (typeof (snapshot == null ? void 0 : snapshot.bodyHtmlLength) === "number") {
      meta.push(`bodyHtml=${snapshot.bodyHtmlLength}`);
    }
    if (typeof (snapshot == null ? void 0 : snapshot.innerWidth) === "number" && typeof (snapshot == null ? void 0 : snapshot.innerHeight) === "number") {
      meta.push(`viewport=${snapshot.innerWidth}x${snapshot.innerHeight}`);
    }
    if (typeof (snapshot == null ? void 0 : snapshot.clientWidth) === "number" && typeof (snapshot == null ? void 0 : snapshot.clientHeight) === "number") {
      meta.push(`client=${snapshot.clientWidth}x${snapshot.clientHeight}`);
    }
    if (typeof (snapshot == null ? void 0 : snapshot.devicePixelRatio) === "number") {
      meta.push(`dpr=${snapshot.devicePixelRatio}`);
    }
    if (snapshot == null ? void 0 : snapshot.bodyTextPreview) {
      meta.push(`preview=${snapshot.bodyTextPreview}`);
    }
    if (snapshot == null ? void 0 : snapshot.userAgent) {
      meta.push(`ua=${snapshot.userAgent}`);
    }
    return meta;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`inspect=${message}`];
  }
}
function resolveEmbeddedBrowserFaviconUrl(rawIconUrl, pageUrl) {
  const iconUrl = rawIconUrl.trim();
  if (!iconUrl) {
    return "";
  }
  if (iconUrl.startsWith("data:")) {
    return iconUrl;
  }
  try {
    return new URL(iconUrl, pageUrl || void 0).toString();
  } catch {
    return iconUrl;
  }
}
function getEmbeddedBrowserFaviconMimeType(iconUrl, contentType) {
  var _a;
  const normalizedContentType = (_a = String(contentType || "").split(";")[0]) == null ? void 0 : _a.trim();
  if (normalizedContentType == null ? void 0 : normalizedContentType.startsWith("image/")) {
    return normalizedContentType;
  }
  const pathname = (() => {
    try {
      return new URL(iconUrl).pathname.toLowerCase();
    } catch {
      return iconUrl.toLowerCase();
    }
  })();
  if (pathname.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (pathname.endsWith(".ico")) {
    return "image/x-icon";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "image/png";
}
async function fetchEmbeddedBrowserFaviconDataUrl(browserSession, iconUrl) {
  if (!iconUrl || iconUrl.startsWith("data:")) {
    return iconUrl;
  }
  try {
    const response = await browserSession.fetch(iconUrl);
    if (!response.ok) {
      return "";
    }
    const content = Buffer$1.from(await response.arrayBuffer());
    if (content.length === 0) {
      return "";
    }
    const mimeType = getEmbeddedBrowserFaviconMimeType(iconUrl, response.headers.get("content-type"));
    return `data:${mimeType};base64,${content.toString("base64")}`;
  } catch (error) {
    runtimeLogger.warn("embedded browser favicon load failed", {
      error: error instanceof Error ? error.message : String(error),
      iconUrl
    });
    return "";
  }
}
function loadEmbeddedBrowserFaviconDataUrl(view, iconUrl) {
  return fetchEmbeddedBrowserFaviconDataUrl(view.webContents.session, iconUrl);
}
function extractEmbeddedBrowserFaviconCandidates(html, pageUrl) {
  const candidates = [];
  const linkRegex = /<link\b[^>]*>/gi;
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let linkMatch;
  while (linkMatch = linkRegex.exec(html)) {
    const tag = linkMatch[0];
    const attrs = /* @__PURE__ */ new Map();
    let attrMatch;
    attrRegex.lastIndex = 0;
    while (attrMatch = attrRegex.exec(tag)) {
      attrs.set(attrMatch[1].toLowerCase(), attrMatch[2] || attrMatch[3] || attrMatch[4] || "");
    }
    const rel = attrs.get("rel") || "";
    const href = attrs.get("href") || "";
    if (!href || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(rel)) {
      continue;
    }
    const iconUrl = resolveEmbeddedBrowserFaviconUrl(href, pageUrl);
    if (iconUrl) {
      candidates.push(iconUrl);
    }
  }
  return candidates;
}
async function resolveEmbeddedBrowserBookmarkFavicon(payload) {
  const pageUrl = String((payload == null ? void 0 : payload.pageUrl) || "").trim();
  const browserSession = session.fromPartition(EMBEDDED_BROWSER_PARTITION);
  const candidates = [];
  const providedIconUrl = resolveEmbeddedBrowserFaviconUrl(String((payload == null ? void 0 : payload.iconUrl) || ""), pageUrl || void 0);
  if (providedIconUrl && !providedIconUrl.startsWith("data:")) {
    candidates.push(providedIconUrl);
  }
  if (pageUrl) {
    try {
      const response = await browserSession.fetch(pageUrl);
      const contentType = response.headers.get("content-type") || "";
      if (response.ok && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
        candidates.push(...extractEmbeddedBrowserFaviconCandidates(await response.text(), pageUrl));
      }
    } catch (error) {
      runtimeLogger.warn("embedded browser favicon page inspect failed", {
        error: error instanceof Error ? error.message : String(error),
        pageUrl
      });
    }
    try {
      const origin = new URL(pageUrl).origin;
      candidates.push(`${origin}/favicon.ico`);
    } catch {
    }
  }
  const visited = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    if (!candidate || visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);
    const faviconDataUrl = await fetchEmbeddedBrowserFaviconDataUrl(browserSession, candidate);
    if (faviconDataUrl) {
      return {
        dataUrl: faviconDataUrl,
        iconUrl: candidate
      };
    }
  }
  return {
    dataUrl: providedIconUrl.startsWith("data:") ? providedIconUrl : "",
    iconUrl: ""
  };
}
const EMBEDDED_BROWSER_OPEN_FILE_DIRNAME = "embedded-browser-open-files";
const FALLBACK_FILE_INPUT_SELECTOR = 'input[data-omniflow-browser-open-fallback="true"]';
function getEmbeddedBrowserOpenFileRoot() {
  return path.join(app.getPath("userData"), EMBEDDED_BROWSER_OPEN_FILE_DIRNAME);
}
function ensureEmbeddedBrowserOpenFileRoot() {
  const root = getEmbeddedBrowserOpenFileRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}
function buildStagedFileName(fileName) {
  const safeName = String(fileName).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}
function isPathInsideDirectory(filePath, directoryPath) {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedDirectoryPath = path.resolve(directoryPath);
  if (resolvedFilePath === resolvedDirectoryPath) return true;
  return resolvedFilePath.startsWith(`${resolvedDirectoryPath}${path.sep}`);
}
async function ensureInputSelector(view) {
  const selector = await view.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${FALLBACK_FILE_INPUT_SELECTOR}')
      if (!(fallback instanceof HTMLInputElement)) {
        fallback = document.createElement('input')
        fallback.type = 'file'
        fallback.multiple = false
        fallback.setAttribute('data-omniflow-browser-open-fallback', 'true')
        fallback.style.position = 'fixed'
        fallback.style.left = '-9999px'
        fallback.style.top = '-9999px'
        fallback.style.width = '1px'
        fallback.style.height = '1px'
        fallback.style.opacity = '0'
        fallback.style.pointerEvents = 'none'
        document.body.appendChild(fallback)
      }
      return '${FALLBACK_FILE_INPUT_SELECTOR}'
    })()
  `, true);
  return typeof selector === "string" && selector.trim() ? selector.trim() : null;
}
async function setFileInputFiles(view, selector, filePaths) {
  var _a;
  if (!selector || filePaths.length === 0) {
    return false;
  }
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach("1.3");
    }
  } catch (error) {
    if (!String(error).includes("Already attached")) {
      throw error;
    }
  }
  const documentNode = await view.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  });
  const nodeID = Number(((_a = documentNode == null ? void 0 : documentNode.root) == null ? void 0 : _a.nodeId) || 0);
  if (!Number.isFinite(nodeID) || nodeID <= 0) {
    return false;
  }
  const queryResult = await view.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: nodeID,
    selector
  });
  const inputNodeID = Number((queryResult == null ? void 0 : queryResult.nodeId) || 0);
  if (!Number.isFinite(inputNodeID) || inputNodeID <= 0) {
    return false;
  }
  await view.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: inputNodeID,
    files: filePaths
  });
  return true;
}
async function dispatchFileToPage(view, selector) {
  const result = await view.webContents.executeJavaScript(`
    (() => {
      const inputSelector = ${JSON.stringify(selector)}
      const input = document.querySelector(inputSelector)
      if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
        return { ok: false }
      }

      const dataTransfer = new DataTransfer()
      Array.from(input.files).forEach((file) => dataTransfer.items.add(file))

      const centerX = Math.max(1, Math.floor(window.innerWidth / 2))
      const centerY = Math.max(1, Math.floor(window.innerHeight / 2))
      const centerTarget = document.elementFromPoint(centerX, centerY)

      const candidates = []
      const pushCandidate = (candidate) => {
        if (!(candidate instanceof Element)) {
          return
        }
        if (candidates.includes(candidate)) {
          return
        }
        candidates.push(candidate)
      }

      pushCandidate(input)
      pushCandidate(input.closest('label'))
      pushCandidate(centerTarget)
      pushCandidate(document.querySelector('[data-testid*="drop"], [class*="drop"], [class*="upload"], [data-upload], main, [role="main"]'))
      pushCandidate(document.body)
      pushCandidate(document.documentElement)

      candidates.forEach((target) => {
        ['dragenter', 'dragover', 'drop'].forEach((eventType) => {
          const event = new DragEvent(eventType, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          })
          target.dispatchEvent(event)
        })
      })

      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))

      return {
        ok: true,
        candidateCount: candidates.length,
      }
    })()
  `, true);
  return Boolean(result == null ? void 0 : result.ok);
}
async function stageEmbeddedBrowserOpenFile(sourceUrl, fileName, headers = {}) {
  const openFileRoot = ensureEmbeddedBrowserOpenFileRoot();
  const stagedPath = path.join(openFileRoot, buildStagedFileName(fileName));
  await downloadUrlToFile(sourceUrl, stagedPath, headers);
  return stagedPath;
}
async function cleanupEmbeddedBrowserOpenFile(stagedPath) {
  const normalizedPath = path.resolve(String(stagedPath || "").trim());
  if (!normalizedPath) {
    return false;
  }
  const openFileRoot = path.resolve(getEmbeddedBrowserOpenFileRoot());
  if (!isPathInsideDirectory(normalizedPath, openFileRoot)) {
    return false;
  }
  await fs.rm(normalizedPath, { force: true });
  return true;
}
async function injectEmbeddedBrowserOpenFile(view, stagedPath) {
  if (!view || view.webContents.isDestroyed()) {
    return false;
  }
  const selector = await ensureInputSelector(view);
  if (!selector) {
    return false;
  }
  const filesSet = await setFileInputFiles(view, selector, [stagedPath]);
  if (!filesSet) {
    return false;
  }
  return dispatchFileToPage(view, selector);
}
function cleanupEmbeddedBrowserOpenFileForTab(options) {
  const pending = options.pendingOpenFiles.get(options.tabId);
  if (pending == null ? void 0 : pending.stagedPath) {
    void cleanupEmbeddedBrowserOpenFile(pending.stagedPath).catch(() => void 0);
  }
  options.pendingOpenFiles.delete(options.tabId);
  const attachedPath = options.attachedOpenFiles.get(options.tabId);
  if (attachedPath) {
    void cleanupEmbeddedBrowserOpenFile(attachedPath).catch(() => void 0);
  }
  options.attachedOpenFiles.delete(options.tabId);
}
function bumpEmbeddedBrowserOpenFileRequestVersion(options) {
  const nextVersion = (options.requestVersions.get(options.tabId) ?? 0) + 1;
  options.requestVersions.set(options.tabId, nextVersion);
  return nextVersion;
}
function isEmbeddedBrowserOpenFileRequestCurrent(options) {
  return options.requestVersions.get(options.tabId) === options.version;
}
function matchesEmbeddedBrowserOpenFileTargetPage(currentUrl, targetUrl) {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (current.origin !== target.origin) {
      return false;
    }
    const normalizedCurrentPath = current.pathname.replace(/\/+$/, "") || "/";
    const normalizedTargetPath = target.pathname.replace(/\/+$/, "") || "/";
    if (normalizedTargetPath === "/") {
      return true;
    }
    return normalizedCurrentPath === normalizedTargetPath || normalizedCurrentPath.startsWith(`${normalizedTargetPath}/`);
  } catch {
    return false;
  }
}
async function tryDispatchPendingEmbeddedBrowserOpenFile(options) {
  const pending = options.pendingOpenFiles.get(options.tabId);
  if (!pending || options.view.webContents.isDestroyed()) {
    return false;
  }
  const currentUrl = options.view.webContents.getURL() || options.currentUrls.get(options.tabId) || "";
  if (!currentUrl) {
    return false;
  }
  if (!matchesEmbeddedBrowserOpenFileTargetPage(currentUrl, pending.pageUrl)) {
    return false;
  }
  try {
    const injected = await injectEmbeddedBrowserOpenFile(options.view, pending.stagedPath);
    if (!injected) {
      return false;
    }
    const previousAttachedPath = options.attachedOpenFiles.get(options.tabId);
    if (previousAttachedPath && previousAttachedPath !== pending.stagedPath) {
      void cleanupEmbeddedBrowserOpenFile(previousAttachedPath).catch(() => void 0);
    }
    options.attachedOpenFiles.set(options.tabId, pending.stagedPath);
    options.pendingOpenFiles.delete(options.tabId);
    return true;
  } catch {
    return false;
  }
}
function createEmbeddedBrowserResourceProbeActionScript(action, resourceKey) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe[${JSON.stringify(action)}] === 'function'
        ? probe[${JSON.stringify(action)}]
        : null
      return handler ? Boolean(handler(${JSON.stringify(resourceKey)})) : false
    })()
  `;
}
function createEmbeddedBrowserResourcePreviewScript(payload) {
  return `
    (() => {
      const preview = ${JSON.stringify(payload)}
      const overlayId = '__omniflow_embedded_browser_resource_preview__'
      const previous = document.getElementById(overlayId)
      if (previous) {
        previous.remove()
      }

      const root = document.body || document.documentElement
      if (!root) {
        return false
      }

      const mimeType = String(preview.mimeType || '').toLowerCase()
      const streamType = preview.streamType === 'audio' || mimeType.startsWith('audio/')
        ? 'audio'
        : 'video'

      const overlay = document.createElement('div')
      overlay.id = overlayId
      overlay.style.position = 'fixed'
      overlay.style.inset = '0'
      overlay.style.zIndex = '2147483647'
      overlay.style.background = 'rgba(3, 7, 18, 0.78)'
      overlay.style.backdropFilter = 'blur(6px)'
      overlay.style.display = 'flex'
      overlay.style.alignItems = 'center'
      overlay.style.justifyContent = 'center'
      overlay.style.padding = '24px'

      const panel = document.createElement('div')
      panel.style.width = streamType === 'audio' ? 'min(640px, 96vw)' : 'min(1080px, 96vw)'
      panel.style.maxHeight = '88vh'
      panel.style.background = 'rgba(15, 23, 42, 0.96)'
      panel.style.border = '1px solid rgba(148, 163, 184, 0.28)'
      panel.style.borderRadius = '18px'
      panel.style.boxShadow = '0 32px 80px rgba(15, 23, 42, 0.45)'
      panel.style.display = 'flex'
      panel.style.flexDirection = 'column'
      panel.style.gap = '12px'
      panel.style.padding = '16px'

      const header = document.createElement('div')
      header.style.display = 'flex'
      header.style.alignItems = 'center'
      header.style.justifyContent = 'space-between'
      header.style.gap = '12px'

      const title = document.createElement('div')
      title.textContent = preview.title || (streamType === 'audio' ? '音频预览' : '视频预览')
      title.style.color = '#e2e8f0'
      title.style.fontSize = '14px'
      title.style.fontWeight = '600'
      title.style.wordBreak = 'break-all'
      header.appendChild(title)

      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = '关闭'
      close.style.border = '1px solid rgba(148, 163, 184, 0.28)'
      close.style.background = 'transparent'
      close.style.color = '#cbd5e1'
      close.style.borderRadius = '999px'
      close.style.padding = '6px 12px'
      close.style.cursor = 'pointer'
      close.addEventListener('click', () => {
        overlay.remove()
      })
      header.appendChild(close)

      const media = document.createElement(streamType === 'audio' ? 'audio' : 'video')
      media.controls = true
      media.autoplay = true
      media.preload = 'auto'
      media.src = preview.url
      if (streamType === 'video') {
        media.setAttribute('playsinline', 'true')
        media.style.width = '100%'
        media.style.maxHeight = '72vh'
        media.style.background = '#000'
        media.style.borderRadius = '14px'
      } else {
        media.style.width = '100%'
      }

      const meta = document.createElement('div')
      meta.textContent = preview.url
      meta.style.color = 'rgba(191, 219, 254, 0.78)'
      meta.style.fontSize = '12px'
      meta.style.lineHeight = '1.6'
      meta.style.wordBreak = 'break-all'

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          overlay.remove()
        }
      })

      panel.appendChild(header)
      panel.appendChild(media)
      panel.appendChild(meta)
      overlay.appendChild(panel)
      root.appendChild(overlay)

      media.play().catch(() => undefined)
      return true
    })()
  `;
}
function createEmbeddedBrowserResourceExtractScript(resourceKey) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.readResource === 'function'
        ? probe.readResource
        : null
      return handler ? handler(${JSON.stringify(resourceKey)}) : null
    })()
  `;
}
async function runEmbeddedBrowserResourceProbeAction(executeScript, action, resourceKey) {
  const normalizedResourceKey = String(resourceKey || "").trim();
  if (!normalizedResourceKey) {
    return false;
  }
  const result = await executeScript(
    createEmbeddedBrowserResourceProbeActionScript(action, normalizedResourceKey)
  );
  return Boolean(result);
}
async function runEmbeddedBrowserResourcePreview(executeScript, payload) {
  const normalizedUrl = String(payload.url || "").trim();
  if (!normalizedUrl) {
    return false;
  }
  const result = await executeScript(
    createEmbeddedBrowserResourcePreviewScript(payload)
  );
  return Boolean(result);
}
async function extractEmbeddedBrowserResourceFromPage(executeScript, resourceKey) {
  const normalizedResourceKey = String(resourceKey || "").trim();
  if (!normalizedResourceKey) {
    return null;
  }
  const result = await executeScript(
    createEmbeddedBrowserResourceExtractScript(normalizedResourceKey)
  );
  if (!result || typeof result !== "object") {
    return null;
  }
  const payload = result;
  if (typeof payload.base64 !== "string" || typeof payload.fileName !== "string") {
    return null;
  }
  return {
    base64: payload.base64,
    fileName: payload.fileName,
    mimeType: typeof payload.mimeType === "string" ? payload.mimeType : void 0,
    resourceKey: typeof payload.resourceKey === "string" ? payload.resourceKey : normalizedResourceKey,
    streamType: payload.streamType === "audio" || payload.streamType === "video" ? payload.streamType : void 0
  };
}
function embeddedBrowserResourceProbePageActionsBody() {
  function attachTrackedMediaElement(element) {
    if (trackedMediaElements.has(element)) {
      return;
    }
    trackedMediaElements.add(element);
    element.addEventListener("progress", () => {
      if (!catchToolkitState.autoSeekToBufferedEnd) {
        return;
      }
      try {
        if (!element.buffered || element.buffered.length === 0) {
          return;
        }
        const bufferedEnd = element.buffered.end(element.buffered.length - 1);
        const targetTime = Math.max(bufferedEnd - 5, 0);
        const duration = Number.isFinite(element.duration) ? element.duration : 0;
        if (duration > 0 && bufferedEnd >= duration) {
          return;
        }
        if (Math.abs(element.currentTime - targetTime) > 1) {
          element.currentTime = targetTime;
        }
      } catch {
      }
    });
    const attemptRestartFromBeginning = () => {
      if (!catchToolkitState.restartAlwaysFromBeginning || autoRestartHandledMediaElements.has(element)) {
        return;
      }
      try {
        autoRestartHandledMediaElements.add(element);
        clearCatchMediaCacheInternal2();
        element.currentTime = 0;
      } catch {
      }
    };
    element.addEventListener("play", () => {
      attemptRestartFromBeginning();
    }, { once: true });
    const initialRestartTimer = window.setInterval(() => {
      if (autoRestartHandledMediaElements.has(element) || !catchToolkitState.restartAlwaysFromBeginning) {
        window.clearInterval(initialRestartTimer);
        return;
      }
      if (!element.paused) {
        attemptRestartFromBeginning();
        window.clearInterval(initialRestartTimer);
      }
    }, 500);
    window.setTimeout(() => {
      window.clearInterval(initialRestartTimer);
    }, 5e3);
  }
  function bindTrackedMediaElements() {
    if (typeof document === "undefined") {
      return;
    }
    document.querySelectorAll("video, audio").forEach((node) => {
      if (node instanceof HTMLMediaElement) {
        attachTrackedMediaElement(node);
      }
    });
  }
  function ensureTrackedMediaObserver2() {
    if (isWorkerScope || typeof MutationObserver === "undefined" || trackedMediaObserver || typeof document === "undefined") {
      return;
    }
    bindTrackedMediaElements();
    const observerTarget = document.body || document.documentElement;
    if (!observerTarget) {
      window.setTimeout(() => {
        ensureTrackedMediaObserver2();
      }, 250);
      return;
    }
    trackedMediaObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) {
            return;
          }
          if (node instanceof HTMLMediaElement) {
            attachTrackedMediaElement(node);
            return;
          }
          node.querySelectorAll("video, audio").forEach((childNode) => {
            if (childNode instanceof HTMLMediaElement) {
              attachTrackedMediaElement(childNode);
            }
          });
        });
      });
    });
    trackedMediaObserver.observe(observerTarget, {
      childList: true,
      subtree: true
    });
  }
  function clearCatchMediaCacheInternal2() {
    let cleared = false;
    mseStreams.forEach((stream) => {
      if (stream.blobUrl) {
        URL.revokeObjectURL(stream.blobUrl);
        stream.blobUrl = "";
      }
      if (isCaptureComplete) {
        cleared = cleared || stream.buffers.length > 0;
        stream.buffers = [];
        stream.bufferCount = 0;
        stream.lastReportedBufferCount = 0;
        stream.lastReportedBytes = 0;
        stream.totalBytes = 0;
        emitMseStream2(stream.streamId);
        return;
      }
      if (stream.buffers.length > 1) {
        const firstChunk = stream.buffers[0];
        stream.buffers = firstChunk ? [firstChunk] : [];
        stream.bufferCount = stream.buffers.length;
        stream.totalBytes = (firstChunk == null ? void 0 : firstChunk.byteLength) || 0;
        stream.lastReportedBufferCount = stream.bufferCount;
        stream.lastReportedBytes = stream.totalBytes;
        cleared = true;
        emitMseStream2(stream.streamId);
      }
    });
    isCaptureComplete = false;
    return cleared;
  }
  function downloadCatchMediaInternal() {
    if (typeof document === "undefined") {
      return false;
    }
    const downloadableStreams = Array.from(mseStreams.values()).filter((stream) => stream.buffers.length > 0);
    if (downloadableStreams.length === 0) {
      return false;
    }
    const baseName = resolveCatchToolkitFileName();
    downloadableStreams.forEach((stream) => {
      const playableBuffers = normalizeBuffersForPlayback(stream.buffers);
      const blob = new Blob(playableBuffers, { type: stream.mimeType });
      const anchor = document.createElement("a");
      const blobUrl = URL.createObjectURL(blob);
      const extension = guessExtensionFromMimeType(stream.mimeType, stream.streamType);
      const fileSuffix = downloadableStreams.length > 1 && stream.streamType ? `-${stream.streamType}` : "";
      anchor.href = blobUrl;
      anchor.download = `${baseName}${fileSuffix}.${extension}`;
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 1e3);
    });
    if (catchToolkitState.clearCacheOnComplete) {
      setTimeout(() => {
        clearCatchMediaCacheInternal2();
      }, 0);
    }
    return true;
  }
  function restartCatchMediaCaptureInternal() {
    if (typeof document === "undefined") {
      return false;
    }
    clearCatchMediaCacheInternal2();
    let restarted = false;
    document.querySelectorAll("video, audio").forEach((node) => {
      if (!(node instanceof HTMLMediaElement)) {
        return;
      }
      try {
        node.currentTime = 0;
        void node.play().catch(() => void 0);
        restarted = true;
      } catch {
      }
    });
    return restarted;
  }
  function createMseResourceKey2(streamId) {
    return `mse-stream:${streamId}`;
  }
  function emitMseStream2(streamId) {
    const stream = mseStreams.get(streamId);
    if (!stream) {
      return;
    }
    emit({
      contentLength: stream.totalBytes,
      ext: guessExtensionFromMimeType(stream.mimeType, stream.streamType),
      kind: "media",
      mimeType: stream.mimeType,
      resourceKey: createMseResourceKey2(streamId),
      resourceType: "mse-stream",
      source: "probe",
      streamType: stream.streamType,
      url: stream.blobUrl || `mse://capturing/${streamId}`
    });
  }
  function finalizeMseStream2(streamId) {
    const stream = mseStreams.get(streamId);
    if (!stream || stream.buffers.length === 0) {
      return false;
    }
    if (stream.blobUrl) {
      URL.revokeObjectURL(stream.blobUrl);
      stream.blobUrl = "";
    }
    try {
      const playableBuffers = normalizeBuffersForPlayback(stream.buffers);
      stream.blobUrl = URL.createObjectURL(new Blob(playableBuffers, { type: stream.mimeType }));
      emitMseStream2(streamId);
      return true;
    } catch {
      return false;
    }
  }
  function ensureMseStreamBlobUrl(streamId) {
    const stream = mseStreams.get(streamId);
    if (!stream) {
      return "";
    }
    if (!stream.blobUrl) {
      finalizeMseStream2(streamId);
    }
    return stream.blobUrl;
  }
  function createMseExportName(streamId) {
    const stream = mseStreams.get(streamId);
    if (!stream) {
      return "media.bin";
    }
    const baseName = resolveCatchToolkitFileName();
    const streamSuffix = stream.streamType ? `-${stream.streamType}` : "";
    const extension = guessExtensionFromMimeType(stream.mimeType, stream.streamType);
    return `${baseName}${streamSuffix}.${extension}`;
  }
  function exportMseResource(resourceKey) {
    const streamId = String(resourceKey || "").replace(/^mse-stream:/, "");
    const blobUrl = ensureMseStreamBlobUrl(streamId);
    if (!blobUrl) {
      return false;
    }
    if (typeof document === "undefined") {
      return false;
    }
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = createMseExportName(streamId);
    anchor.click();
    anchor.remove();
    if (catchToolkitState.clearCacheOnComplete) {
      setTimeout(() => {
        clearCatchMediaCacheInternal2();
      }, 0);
    }
    return true;
  }
  function openMseResource(resourceKey) {
    const streamId = String(resourceKey || "").replace(/^mse-stream:/, "");
    const blobUrl = ensureMseStreamBlobUrl(streamId);
    if (!blobUrl) {
      return false;
    }
    if (!openWindow) {
      return false;
    }
    openWindow(blobUrl, "_blank", "noopener,noreferrer");
    return true;
  }
  async function readMseResource(resourceKey) {
    const streamId = String(resourceKey || "").replace(/^mse-stream:/, "");
    const stream = mseStreams.get(streamId);
    if (!stream || stream.buffers.length === 0) {
      return null;
    }
    try {
      const playableBuffers = normalizeBuffersForPlayback(stream.buffers);
      const blob = new Blob(playableBuffers, { type: stream.mimeType });
      const buffer = await blob.arrayBuffer();
      return {
        base64: arrayBufferToBase64(buffer),
        fileName: createMseExportName(streamId),
        mimeType: stream.mimeType,
        resourceKey,
        streamType: stream.streamType
      };
    } catch {
      return null;
    }
  }
  function openProbeResource(resourceKey) {
    const resource = probeResources.get(resourceKey);
    if (!(resource == null ? void 0 : resource.blobUrl)) {
      return false;
    }
    if (!openWindow) {
      return false;
    }
    openWindow(resource.blobUrl, "_blank", "noopener,noreferrer");
    return true;
  }
  function exportProbeResource(resourceKey) {
    const resource = probeResources.get(resourceKey);
    if (!(resource == null ? void 0 : resource.blobUrl)) {
      return false;
    }
    if (typeof document === "undefined") {
      return false;
    }
    const anchor = document.createElement("a");
    anchor.href = resource.blobUrl;
    anchor.download = resource.fileName;
    anchor.click();
    anchor.remove();
    return true;
  }
  function readProbeResource(resourceKey) {
    const resource = probeResources.get(resourceKey);
    if (!resource) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      base64: resource.base64,
      fileName: resource.fileName,
      mimeType: resource.mimeType,
      resourceKey,
      streamType: resource.streamType
    });
  }
  if (!isWorkerScope) {
    ensureTrackedMediaObserver2();
  }
  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return clearCatchMediaCacheInternal2();
    },
    downloadCatchMedia() {
      return downloadCatchMediaInternal();
    },
    exportResource(resourceKey) {
      const normalizedResourceKey = String(resourceKey || "");
      if (normalizedResourceKey.startsWith("mse-stream:")) {
        return exportMseResource(normalizedResourceKey);
      }
      if (normalizedResourceKey.startsWith("probe-resource:")) {
        return exportProbeResource(normalizedResourceKey);
      }
      return false;
    },
    getCatchToolkitState() {
      return buildCatchToolkitState();
    },
    installedAt: Date.now(),
    openResource(resourceKey) {
      const normalizedResourceKey = String(resourceKey || "");
      if (normalizedResourceKey.startsWith("mse-stream:")) {
        return openMseResource(normalizedResourceKey);
      }
      if (normalizedResourceKey.startsWith("probe-resource:")) {
        return openProbeResource(normalizedResourceKey);
      }
      return false;
    },
    readResource(resourceKey) {
      const normalizedResourceKey = String(resourceKey || "");
      if (normalizedResourceKey.startsWith("mse-stream:")) {
        return readMseResource(normalizedResourceKey);
      }
      if (normalizedResourceKey.startsWith("probe-resource:")) {
        return readProbeResource(normalizedResourceKey);
      }
      return Promise.resolve(null);
    },
    restartCatchMediaCapture() {
      return restartCatchMediaCaptureInternal();
    },
    seen,
    updateCatchToolkitState(payload) {
      if (typeof payload.autoSeekToBufferedEnd === "boolean") {
        catchToolkitState.autoSeekToBufferedEnd = payload.autoSeekToBufferedEnd;
      }
      if (typeof payload.autoDownloadOnComplete === "boolean") {
        catchToolkitState.autoDownloadOnComplete = payload.autoDownloadOnComplete;
      }
      if (typeof payload.clearCacheOnComplete === "boolean") {
        catchToolkitState.clearCacheOnComplete = payload.clearCacheOnComplete;
      }
      if (typeof payload.manualFileName === "string") {
        catchToolkitState.manualFileName = payload.manualFileName;
      }
      if (typeof payload.regexRule === "string") {
        catchToolkitState.regexRule = evaluateRegexRule(payload.regexRule).rule;
      }
      if (typeof payload.restartAlwaysFromBeginning === "boolean") {
        catchToolkitState.restartAlwaysFromBeginning = payload.restartAlwaysFromBeginning;
      }
      if (typeof payload.selectorRule === "string") {
        catchToolkitState.selectorRule = evaluateSelectorRule(payload.selectorRule).rule;
      }
      if (typeof payload.trimExtraMediaHeaders === "boolean") {
        catchToolkitState.trimExtraMediaHeaders = payload.trimExtraMediaHeaders;
      }
      persistCatchToolkitState();
      if (!isWorkerScope) {
        ensureTrackedMediaObserver2();
      }
      return buildCatchToolkitState();
    }
  };
}
function embeddedBrowserResourceProbeManifestHeuristicsBody() {
  const vimeoPlaylistUrls = /* @__PURE__ */ new Set();
  const vimeoPlaylistPattern = /^https:\/\/[^.]*\.vimeocdn\.com\/exp=.*\/playlist\.json\?/i;
  const knownManifestBaseUrls = /* @__PURE__ */ new Set();
  const pendingM3u8TextsBySignature = /* @__PURE__ */ new Map();
  let m3u8Accumulator = "";
  function getBaseUrl(url) {
    try {
      const currentUrl = new URL(url, currentLocationHref);
      const parts = currentUrl.toString().split("/");
      parts.pop();
      return `${parts.join("/")}/`;
    } catch {
      return "";
    }
  }
  function resolveM3u8Reference(baseUrl, reference) {
    try {
      return new URL(reference, baseUrl || currentLocationHref).toString();
    } catch {
      return baseUrl ? `${baseUrl}${reference.replace(/^\//, "")}` : reference;
    }
  }
  function addBaseUrl(baseUrl, m3u8Text) {
    if (!baseUrl || !m3u8Text) {
      return m3u8Text;
    }
    return m3u8Text.split("\n").map((line) => {
      const currentLine = line.trim();
      if (!currentLine) {
        return line;
      }
      if (currentLine.startsWith("#")) {
        if (currentLine.includes('URI="')) {
          return currentLine.replace(/URI="([^"]*)"/g, (_input, keyUrl) => {
            if (toAbsoluteUrl(keyUrl)) {
              return `URI="${keyUrl}"`;
            }
            return `URI="${resolveM3u8Reference(baseUrl, keyUrl)}"`;
          });
        }
        return line;
      }
      if (toAbsoluteUrl(currentLine)) {
        return currentLine;
      }
      return resolveM3u8Reference(baseUrl, currentLine);
    }).join("\n");
  }
  function getM3u8PendingSignature(text) {
    return String(text || "").replace(/\s+/g, "");
  }
  function getM3u8References(text) {
    const references = [];
    String(text || "").split("\n").forEach((line) => {
      const currentLine = line.trim();
      if (!currentLine) {
        return;
      }
      if (currentLine.startsWith("#")) {
        const uriMatches = Array.from(currentLine.matchAll(/URI="([^"]*)"/g));
        uriMatches.forEach((match) => {
          const uri = String(match[1] || "").trim();
          if (uri) {
            references.push(uri);
          }
        });
        return;
      }
      references.push(currentLine);
    });
    return references;
  }
  function hasRelativeM3u8References(text) {
    return getM3u8References(text).some((reference) => {
      if (!reference || reference.startsWith("data:") || reference.startsWith("blob:")) {
        return false;
      }
      return !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(reference);
    });
  }
  function emitM3u8DataKeyReference(reference) {
    const normalizedReference = String(reference || "").trim();
    if (!/^data:application\/octet-stream/i.test(normalizedReference)) {
      return false;
    }
    const commaIndex = normalizedReference.indexOf(",");
    if (commaIndex === -1) {
      return false;
    }
    const metadata = normalizedReference.slice(0, commaIndex);
    const data = normalizedReference.slice(commaIndex + 1).trim();
    if (!data || !/;base64/i.test(metadata)) {
      return false;
    }
    return emitKeyCandidateFromBase64(data);
  }
  function emitM3u8ReferenceResource(reference, sourceLine, baseUrl) {
    const normalizedReference = String(reference || "").trim();
    if (!normalizedReference) {
      return;
    }
    const normalizedSourceLine = String(sourceLine || "").trim().toUpperCase();
    if (normalizedReference.startsWith("data:")) {
      if (normalizedSourceLine.startsWith("#EXT-X-KEY")) {
        emitM3u8DataKeyReference(normalizedReference);
      }
      return;
    }
    const absoluteUrl = resolveM3u8Reference(baseUrl, normalizedReference);
    if (!absoluteUrl || !toAbsoluteUrl(absoluteUrl)) {
      return;
    }
    const inferredKind = classifyKind(absoluteUrl);
    const kind = normalizedSourceLine.startsWith("#EXT-X-KEY") ? "key" : normalizedSourceLine.startsWith("#EXT-X-MAP") ? "media" : inferredKind;
    if (kind === "other") {
      return;
    }
    registerManifestBaseUrl(absoluteUrl);
    emit({
      ext: kind === "key" ? "key" : getExtension(absoluteUrl),
      kind,
      resourceType: normalizedSourceLine.startsWith("#EXT-X-KEY") ? "m3u8-key" : normalizedSourceLine.startsWith("#EXT-X-MAP") ? "m3u8-map" : normalizedSourceLine.startsWith("#") ? "m3u8-uri" : "m3u8-reference",
      source: "probe",
      url: absoluteUrl
    });
  }
  function emitM3u8ReferenceResources(text, baseUrl) {
    String(text || "").split("\n").slice(0, 500).forEach((line) => {
      const currentLine = line.trim();
      if (!currentLine) {
        return;
      }
      if (currentLine.startsWith("#")) {
        Array.from(currentLine.matchAll(/URI="([^"]*)"/g)).forEach((match) => {
          emitM3u8ReferenceResource(String(match[1] || ""), currentLine, baseUrl);
        });
        return;
      }
      emitM3u8ReferenceResource(currentLine, currentLine, baseUrl);
    });
  }
  function decodeXmlEntities(value) {
    return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  function resolveMpdReferenceUrl(reference, baseUrl) {
    const normalizedReference = decodeXmlEntities(reference).trim();
    if (!normalizedReference || normalizedReference.includes("$")) {
      return "";
    }
    const absoluteUrl = resolveM3u8Reference(baseUrl, normalizedReference);
    if (!absoluteUrl || !toAbsoluteUrl(absoluteUrl)) {
      return "";
    }
    return absoluteUrl;
  }
  function resolveMpdBaseUrl(reference, baseUrl) {
    const absoluteUrl = resolveMpdReferenceUrl(reference, baseUrl);
    if (!absoluteUrl) {
      return "";
    }
    if (getExtension(absoluteUrl)) {
      return getBaseUrl(absoluteUrl);
    }
    return absoluteUrl.endsWith("/") ? absoluteUrl : `${absoluteUrl}/`;
  }
  function emitMpdReferenceResource(reference, resourceType, baseUrl) {
    const absoluteUrl = resolveMpdReferenceUrl(reference, baseUrl);
    if (!absoluteUrl) {
      return;
    }
    const kind = classifyKind(absoluteUrl);
    if (kind === "other") {
      return;
    }
    registerManifestBaseUrl(absoluteUrl);
    emit({
      ext: getExtension(absoluteUrl),
      kind,
      resourceType,
      source: "probe",
      url: absoluteUrl
    });
  }
  function emitMpdReferenceResources(text, baseUrl) {
    const normalizedText = String(text || "");
    const referenceBaseUrl = baseUrl || getBaseUrl(currentLocationHref);
    const referenceBaseUrls = /* @__PURE__ */ new Set([referenceBaseUrl]);
    Array.from(normalizedText.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/gi)).slice(0, 80).forEach((match) => {
      const reference = String(match[1] || "");
      emitMpdReferenceResource(reference, "mpd-url", referenceBaseUrl);
      const nestedBaseUrl = resolveMpdBaseUrl(reference, referenceBaseUrl);
      if (nestedBaseUrl) {
        referenceBaseUrls.add(nestedBaseUrl);
      }
    });
    Array.from(normalizedText.matchAll(/<Location>([^<]+)<\/Location>/gi)).slice(0, 20).forEach((match) => {
      emitMpdReferenceResource(String(match[1] || ""), "mpd-url", referenceBaseUrl);
    });
    Array.from(normalizedText.matchAll(/\s(?:media|initialization|sourceURL)=["']([^"']+)["']/gi)).slice(0, 300).forEach((match) => {
      const rawInput = String(match[0] || "").toLowerCase();
      const resourceType = rawInput.includes("initialization=") ? "mpd-init-segment" : rawInput.includes("sourceurl=") ? "mpd-source-url" : "mpd-media";
      referenceBaseUrls.forEach((currentBaseUrl) => {
        emitMpdReferenceResource(String(match[1] || ""), resourceType, currentBaseUrl);
      });
    });
  }
  function emitM3u8ManifestWithBase(text, baseUrl, emitReferences = true) {
    const normalizedText = addBaseUrl(baseUrl, text);
    emitGeneratedResource({
      base64: textToBase64(normalizedText),
      ext: "m3u8",
      kind: "manifest",
      mimeType: "application/vnd.apple.mpegurl",
      resourceType: "inline-manifest",
      signature: `m3u8:${normalizedText}`
    });
    if (emitReferences) {
      emitM3u8ReferenceResources(text, baseUrl);
    }
  }
  function registerManifestBaseUrl(url) {
    const absoluteUrl = toAbsoluteUrl(url);
    const kind = absoluteUrl ? classifyKind(absoluteUrl) : "other";
    if (kind !== "manifest" && kind !== "media") {
      return false;
    }
    const baseUrl = getBaseUrl(absoluteUrl);
    if (!baseUrl || knownManifestBaseUrls.has(baseUrl)) {
      return false;
    }
    knownManifestBaseUrls.add(baseUrl);
    pendingM3u8TextsBySignature.forEach((text) => {
      emitM3u8ManifestWithBase(text, baseUrl);
    });
    return true;
  }
  function emitInlineManifest(text, ext, baseUrl) {
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      return;
    }
    if (ext === "mpd") {
      const explicitBaseUrl2 = getBaseUrl(baseUrl || currentLocationHref);
      emitGeneratedResource({
        base64: textToBase64(normalizedText),
        ext,
        kind: "manifest",
        mimeType: "application/dash+xml",
        resourceType: "inline-manifest",
        signature: `${ext}:${normalizedText}`
      });
      emitMpdReferenceResources(normalizedText, explicitBaseUrl2);
      return;
    }
    const baseUrlCandidate = String(baseUrl || "").trim();
    const explicitBaseUrl = getBaseUrl(baseUrlCandidate);
    const hasRelativeReferences = hasRelativeM3u8References(normalizedText);
    const isWeakPageBaseUrl = !baseUrlCandidate || baseUrlCandidate === currentLocationHref;
    if (explicitBaseUrl && (!hasRelativeReferences || !isWeakPageBaseUrl)) {
      knownManifestBaseUrls.add(explicitBaseUrl);
      emitM3u8ManifestWithBase(normalizedText, explicitBaseUrl);
      return;
    }
    if (hasRelativeReferences) {
      pendingM3u8TextsBySignature.set(getM3u8PendingSignature(normalizedText), normalizedText);
      emitM3u8ManifestWithBase(normalizedText, explicitBaseUrl || getBaseUrl(currentLocationHref), !isWeakPageBaseUrl);
      knownManifestBaseUrls.forEach((knownBaseUrl) => {
        emitM3u8ManifestWithBase(normalizedText, knownBaseUrl);
      });
      return;
    }
    emitGeneratedResource({
      base64: textToBase64(normalizedText),
      ext,
      kind: "manifest",
      mimeType: "application/vnd.apple.mpegurl",
      resourceType: "inline-manifest",
      signature: `${ext}:${normalizedText}`
    });
    emitM3u8ReferenceResources(normalizedText, "");
  }
  function createVimeoManifestBlobUrl(text, signature) {
    const resource = createProbeBlobResource({
      base64: textToBase64(text),
      ext: "m3u8",
      kind: "manifest",
      mimeType: "application/vnd.apple.mpegurl",
      signature
    });
    return resource.url;
  }
  function emitVimeoPlaylistManifest(originalUrl, payload) {
    const normalizedOriginalUrl = String(originalUrl || "").trim();
    if (!normalizedOriginalUrl || !vimeoPlaylistPattern.test(normalizedOriginalUrl) || vimeoPlaylistUrls.has(normalizedOriginalUrl)) {
      return false;
    }
    const data = typeof payload === "string" ? parseMaybeJson(payload) : payload;
    if (!data || typeof data !== "object") {
      return false;
    }
    const playlist = data;
    if (typeof playlist.base_url !== "string" || !Array.isArray(playlist.video)) {
      return false;
    }
    try {
      const parsedUrl = new URL(normalizedOriginalUrl);
      const pathBase = parsedUrl.pathname.slice(0, parsedUrl.pathname.lastIndexOf("/") + 1);
      const baseUrl = new URL(`${parsedUrl.origin}${pathBase}${playlist.base_url}`).href;
      const masterLines = ["#EXTM3U", "#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-VERSION:3"];
      const createStreamManifestUrl = (stream) => {
        const segments = Array.isArray(stream.segments) ? stream.segments : [];
        if (segments.length === 0) {
          return "";
        }
        const streamBaseUrl = String(stream.base_url || "");
        const manifestLines = [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          `#EXT-X-TARGETDURATION:${Number(stream.duration) || 0}`,
          "#EXT-X-MEDIA-SEQUENCE:0",
          "#EXT-X-PLAYLIST-TYPE:VOD"
        ];
        if (typeof stream.init_segment === "string" && stream.init_segment) {
          manifestLines.push(`#EXT-X-MAP:URI="data:application/octet-stream;base64,${stream.init_segment}"`);
        } else if (typeof stream.init_segment_url === "string" && stream.init_segment_url) {
          manifestLines.push(`#EXT-X-MAP:URI="${baseUrl}${streamBaseUrl}${stream.init_segment_url}"`);
        }
        segments.forEach((segment) => {
          if (!segment || typeof segment !== "object") {
            return;
          }
          const currentSegment = segment;
          const segmentUrl = String(currentSegment.url || "");
          if (!segmentUrl) {
            return;
          }
          const start = Number(currentSegment.start) || 0;
          const end = Number(currentSegment.end) || start;
          manifestLines.push(`#EXTINF:${Math.max(end - start, 0)},`);
          manifestLines.push(`${baseUrl}${streamBaseUrl}${segmentUrl}`);
        });
        manifestLines.push("#EXT-X-ENDLIST");
        const manifestText = manifestLines.join("\n");
        return createVimeoManifestBlobUrl(manifestText, `vimeo-stream:${manifestText}`);
      };
      playlist.video.forEach((stream) => {
        if (!stream || typeof stream !== "object") {
          return;
        }
        const currentStream = stream;
        const streamUrl = createStreamManifestUrl(currentStream);
        if (!streamUrl) {
          return;
        }
        masterLines.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${Number(currentStream.bitrate) || 0},RESOLUTION=${Number(currentStream.width) || 0}x${Number(currentStream.height) || 0},CODECS="${String(currentStream.codecs || "")}"`
        );
        masterLines.push(streamUrl);
      });
      const audioStreams = Array.isArray(playlist.audio) ? playlist.audio : [];
      audioStreams.forEach((stream) => {
        if (!stream || typeof stream !== "object") {
          return;
        }
        const currentStream = stream;
        const streamUrl = createStreamManifestUrl(currentStream);
        if (!streamUrl) {
          return;
        }
        masterLines.push(
          `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${String(currentStream.id || "")}",NAME="${String(currentStream.bitrate || "")}",URI="${streamUrl}"`
        );
      });
      if (masterLines.length <= 3) {
        return false;
      }
      const masterText = masterLines.join("\n");
      vimeoPlaylistUrls.add(normalizedOriginalUrl);
      emitGeneratedResource({
        base64: textToBase64(masterText),
        ext: "m3u8",
        kind: "manifest",
        mimeType: "application/vnd.apple.mpegurl",
        resourceType: "inline-manifest",
        signature: `vimeo-master:${masterText}`
      });
      return true;
    } catch {
      return false;
    }
  }
  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_PROBE_MANIFEST_KEEP_ALIVE__ = [
    addBaseUrl,
    createVimeoManifestBlobUrl,
    decodeXmlEntities,
    emitInlineManifest,
    emitM3u8DataKeyReference,
    emitM3u8ManifestWithBase,
    emitM3u8ReferenceResource,
    emitM3u8ReferenceResources,
    emitMpdReferenceResource,
    emitMpdReferenceResources,
    emitVimeoPlaylistManifest,
    getBaseUrl,
    getM3u8PendingSignature,
    getM3u8References,
    hasRelativeM3u8References,
    knownManifestBaseUrls,
    m3u8Accumulator,
    pendingM3u8TextsBySignature,
    registerManifestBaseUrl,
    resolveM3u8Reference,
    resolveMpdBaseUrl,
    resolveMpdReferenceUrl,
    vimeoPlaylistPattern,
    vimeoPlaylistUrls
  ];
}
function embeddedBrowserResourceProbeRuntimeCoreBody() {
  var _a, _b, _c;
  const globalScope2 = globalThis;
  const isWorkerScope2 = typeof document === "undefined" && typeof globalScope2.importScripts === "function";
  const currentLocationHref2 = typeof ((_a = globalScope2.location) == null ? void 0 : _a.href) === "string" ? globalScope2.location.href : "";
  const currentLocationHost = typeof ((_b = globalScope2.location) == null ? void 0 : _b.hostname) === "string" ? globalScope2.location.hostname : "resource";
  const currentLocationProtocol = typeof ((_c = globalScope2.location) == null ? void 0 : _c.protocol) === "string" ? globalScope2.location.protocol : "https:";
  const workerRelayKey = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__";
  const openWindow2 = typeof globalScope2.open === "function" ? globalScope2.open.bind(globalScope2) : null;
  if (globalScope2.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__) {
    return "already-installed";
  }
  const seen2 = /* @__PURE__ */ new Set();
  const probeDiagnostics2 = {
    appendBufferCount: 0,
    hookErrors: 0,
    mediaSourceAvailable: typeof globalScope2.MediaSource !== "undefined",
    mediaSourceHooked: false,
    sourceBufferCount: 0,
    lastAppendAt: 0,
    lastError: ""
  };
  const mseStreams2 = /* @__PURE__ */ new Map();
  const probeResources2 = /* @__PURE__ */ new Map();
  const probeResourceKeysBySignature = /* @__PURE__ */ new Map();
  const mediaSourceStreams2 = /* @__PURE__ */ new WeakMap();
  let mseSequence2 = 0;
  let probeResourceSequence = 0;
  const manifestExtensions = /* @__PURE__ */ new Set(["m3u8", "m3u", "mpd"]);
  const mediaExtensions = /* @__PURE__ */ new Set([
    "mp4",
    "m4v",
    "m4a",
    "m4s",
    "mp3",
    "aac",
    "flac",
    "wav",
    "ogg",
    "oga",
    "ogv",
    "webm",
    "mkv",
    "mov",
    "avi",
    "ts",
    "flv",
    "hlv",
    "f4v",
    "wma",
    "mpeg",
    "wmv",
    "asf",
    "movie",
    "divx",
    "mpeg4",
    "vid",
    "weba",
    "opus",
    "acc",
    "3gp"
  ]);
  const imageExtensions = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]);
  const subtitleExtensions = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]);
  const keyExtensions = /* @__PURE__ */ new Set(["key", "base64key"]);
  const dataUrlPattern = /^data:(application|video|audio)\//i;
  const likelyUrlPattern = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i;
  const manifestPattern = /\.(m3u8|m3u|mpd)(\?|#|$)/i;
  const mediaPattern = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|hlv|f4v|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc|3gp)(\?|#|$)/i;
  const imagePattern = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|#|$)/i;
  const subtitlePattern = /\.(vtt|srt|ass|ssa|ttml)(\?|#|$)/i;
  const pdfPattern = /\.pdf(\?|#|$)/i;
  const keyPattern = /\.(key|base64key)(\?|#|$)/i;
  const originalJSONParse = JSON.parse.bind(JSON);
  const originalConsoleInfo = typeof console.info === "function" ? console.info.bind(console) : console.log.bind(console);
  const catchToolkitStorageKeys = {
    autoDownloadOnComplete: "OmniflowCatchToolkit:autoDownloadOnComplete",
    autoSeekToBufferedEnd: "OmniflowCatchToolkit:autoSeekToBufferedEnd",
    clearCacheOnComplete: "OmniflowCatchToolkit:clearCacheOnComplete",
    manualFileName: "OmniflowCatchToolkit:manualFileName",
    regexRule: "OmniflowCatchToolkit:regexRule",
    restartAlwaysFromBeginning: "OmniflowCatchToolkit:restartAlwaysFromBeginning",
    selectorRule: "OmniflowCatchToolkit:selectorRule",
    trimExtraMediaHeaders: "OmniflowCatchToolkit:trimExtraMediaHeaders"
  };
  let isEmittingKeyCandidate = false;
  let isCaptureComplete2 = false;
  const catchToolkitState2 = {
    autoSeekToBufferedEnd: false,
    autoDownloadOnComplete: false,
    clearCacheOnComplete: false,
    manualFileName: "",
    regexRule: "",
    restartAlwaysFromBeginning: false,
    selectorRule: "",
    trimExtraMediaHeaders: true
  };
  const trackedMediaElements2 = /* @__PURE__ */ new WeakSet();
  const autoRestartHandledMediaElements2 = /* @__PURE__ */ new WeakSet();
  let trackedMediaObserver2 = null;
  function readCatchToolkitStorageString(key) {
    try {
      if (typeof localStorage === "undefined") {
        return "";
      }
      return String(localStorage.getItem(key) || "").trim();
    } catch {
      return "";
    }
  }
  function readCatchToolkitStorageChecked(key, fallback = false) {
    try {
      if (typeof localStorage === "undefined") {
        return fallback;
      }
      return localStorage.getItem(key) === "checked";
    } catch {
      return fallback;
    }
  }
  function writeCatchToolkitStorageString(key, value) {
    try {
      if (typeof localStorage === "undefined") {
        return;
      }
      const normalizedValue = String(value || "").trim();
      if (!normalizedValue) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, normalizedValue);
    } catch {
    }
  }
  function writeCatchToolkitStorageChecked(key, checked) {
    try {
      if (typeof localStorage === "undefined") {
        return;
      }
      localStorage.setItem(key, checked ? "checked" : "");
    } catch {
    }
  }
  function evaluateSelectorRule2(rule) {
    var _a2;
    const normalizedRule = String(rule || "").trim();
    if (!normalizedRule) {
      return {
        rule: "",
        warning: ""
      };
    }
    if (typeof document === "undefined") {
      return {
        rule: normalizedRule,
        warning: ""
      };
    }
    try {
      const matchedNode = document.querySelector(normalizedRule);
      const matchedText = ((_a2 = matchedNode == null ? void 0 : matchedNode.textContent) == null ? void 0 : _a2.trim()) || "";
      return {
        rule: normalizedRule,
        warning: matchedText ? "" : "表达式暂时没有命中可用内容"
      };
    } catch {
      return {
        rule: "",
        warning: "选择器语法错误"
      };
    }
  }
  function evaluateRegexRule2(rule) {
    const normalizedRule = String(rule || "").trim();
    if (!normalizedRule) {
      return {
        rule: "",
        warning: ""
      };
    }
    try {
      new RegExp(normalizedRule, "g");
      return {
        rule: normalizedRule,
        warning: ""
      };
    } catch {
      return {
        rule: "",
        warning: "正则表达式错误"
      };
    }
  }
  function hydrateCatchToolkitStateFromStorage() {
    if (isWorkerScope2) {
      return;
    }
    catchToolkitState2.autoDownloadOnComplete = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.autoDownloadOnComplete,
      catchToolkitState2.autoDownloadOnComplete
    );
    catchToolkitState2.autoSeekToBufferedEnd = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.autoSeekToBufferedEnd,
      catchToolkitState2.autoSeekToBufferedEnd
    );
    catchToolkitState2.clearCacheOnComplete = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.clearCacheOnComplete,
      catchToolkitState2.clearCacheOnComplete
    );
    catchToolkitState2.manualFileName = readCatchToolkitStorageString(catchToolkitStorageKeys.manualFileName);
    catchToolkitState2.restartAlwaysFromBeginning = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.restartAlwaysFromBeginning,
      catchToolkitState2.restartAlwaysFromBeginning
    );
    catchToolkitState2.trimExtraMediaHeaders = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.trimExtraMediaHeaders,
      catchToolkitState2.trimExtraMediaHeaders
    );
    catchToolkitState2.selectorRule = evaluateSelectorRule2(
      readCatchToolkitStorageString(catchToolkitStorageKeys.selectorRule)
    ).rule;
    catchToolkitState2.regexRule = evaluateRegexRule2(
      readCatchToolkitStorageString(catchToolkitStorageKeys.regexRule)
    ).rule;
  }
  function persistCatchToolkitState2() {
    if (isWorkerScope2) {
      return;
    }
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.autoDownloadOnComplete,
      catchToolkitState2.autoDownloadOnComplete
    );
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.autoSeekToBufferedEnd,
      catchToolkitState2.autoSeekToBufferedEnd
    );
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.clearCacheOnComplete,
      catchToolkitState2.clearCacheOnComplete
    );
    writeCatchToolkitStorageString(
      catchToolkitStorageKeys.manualFileName,
      catchToolkitState2.manualFileName
    );
    writeCatchToolkitStorageString(
      catchToolkitStorageKeys.regexRule,
      catchToolkitState2.regexRule
    );
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.restartAlwaysFromBeginning,
      catchToolkitState2.restartAlwaysFromBeginning
    );
    writeCatchToolkitStorageString(
      catchToolkitStorageKeys.selectorRule,
      catchToolkitState2.selectorRule
    );
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.trimExtraMediaHeaders,
      catchToolkitState2.trimExtraMediaHeaders
    );
  }
  hydrateCatchToolkitStateFromStorage();
  function getCurrentDocumentTitle() {
    if (typeof document === "undefined" || typeof document.title !== "string") {
      return "";
    }
    return document.title.trim();
  }
  function resolveCatchToolkitFileName2() {
    var _a2, _b2;
    const manualFileName = sanitizeFileName2(catchToolkitState2.manualFileName);
    if (manualFileName !== "media") {
      return manualFileName;
    }
    let candidateName = "";
    const selectorRule = String(catchToolkitState2.selectorRule || "").trim();
    if (selectorRule && typeof document !== "undefined") {
      try {
        const matchedNode = document.querySelector(selectorRule);
        const matchedText = ((_a2 = matchedNode == null ? void 0 : matchedNode.textContent) == null ? void 0 : _a2.trim()) || "";
        if (matchedText) {
          candidateName = matchedText;
        }
      } catch {
      }
    }
    const regexRule = String(catchToolkitState2.regexRule || "").trim();
    if (regexRule && typeof document !== "undefined") {
      try {
        const sourceText = candidateName || ((_b2 = document.documentElement) == null ? void 0 : _b2.outerHTML) || "";
        if (sourceText) {
          const expression = new RegExp(regexRule, "g");
          const matches = Array.from(sourceText.matchAll(expression));
          const extractedValues = matches.flatMap((match) => {
            if (match.length > 1) {
              return match.slice(1).filter((item) => typeof item === "string" && item.trim());
            }
            return match[0] ? [match[0]] : [];
          });
          if (extractedValues.length > 0) {
            candidateName = extractedValues.join("_");
          }
        }
      } catch {
      }
    }
    return sanitizeFileName2(candidateName || getCurrentDocumentTitle() || currentLocationHost || "media");
  }
  function toAbsoluteUrl2(input) {
    if (typeof input !== "string") {
      return "";
    }
    const value = input.trim();
    if (!value || value.startsWith("data:")) {
      return "";
    }
    if (value.startsWith("//")) {
      return `${currentLocationProtocol}${value}`;
    }
    if (value.startsWith("blob:")) {
      return value;
    }
    try {
      if (likelyUrlPattern.test(value) || manifestPattern.test(value) || mediaPattern.test(value) || imagePattern.test(value) || subtitlePattern.test(value) || pdfPattern.test(value) || keyPattern.test(value)) {
        return new URL(value, currentLocationHref2).toString();
      }
      if (/^https?:\/\//i.test(value)) {
        return value;
      }
    } catch {
      return "";
    }
    return "";
  }
  function getExtension2(url) {
    try {
      const pathname = new URL(url, currentLocationHref2).pathname || "";
      const match = pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
      return (match == null ? void 0 : match[1]) || "";
    } catch {
      const match = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
      return (match == null ? void 0 : match[1]) || "";
    }
  }
  function classifyKind2(url, mimeType) {
    var _a2;
    const extension = getExtension2(url);
    const normalizedMimeType = (_a2 = String(mimeType || "").split(";")[0]) == null ? void 0 : _a2.trim().toLowerCase();
    if (manifestExtensions.has(extension) || normalizedMimeType.includes("mpegurl") || normalizedMimeType.includes("dash+xml") || manifestPattern.test(url)) {
      return "manifest";
    }
    if (mediaExtensions.has(extension) || normalizedMimeType.startsWith("video/") || normalizedMimeType.startsWith("audio/") || normalizedMimeType === "application/ogg" || normalizedMimeType === "application/m4s" || mediaPattern.test(url) || url.startsWith("blob:")) {
      return "media";
    }
    if (keyExtensions.has(extension) || keyPattern.test(url)) {
      return "key";
    }
    if (imageExtensions.has(extension) || normalizedMimeType.startsWith("image/") || imagePattern.test(url)) {
      return "image";
    }
    if (subtitleExtensions.has(extension) || normalizedMimeType.includes("text/vtt") || subtitlePattern.test(url)) {
      return "subtitle";
    }
    if (extension === "pdf" || normalizedMimeType === "application/pdf" || pdfPattern.test(url)) {
      return "document";
    }
    return "other";
  }
  function guessExtensionFromMimeType2(mimeType, streamType) {
    var _a2;
    const normalizedMimeType = (_a2 = String(mimeType || "").split(";")[0]) == null ? void 0 : _a2.trim().toLowerCase();
    if (normalizedMimeType === "audio/mp4") {
      return "m4a";
    }
    if (normalizedMimeType === "video/mp4") {
      return "mp4";
    }
    if (normalizedMimeType === "audio/mpeg") {
      return "mp3";
    }
    if (normalizedMimeType === "audio/aac") {
      return "aac";
    }
    if (normalizedMimeType.endsWith("/webm")) {
      return "webm";
    }
    if (normalizedMimeType.endsWith("/ogg")) {
      return "ogg";
    }
    if (normalizedMimeType === "application/m4s") {
      return "m4s";
    }
    if (normalizedMimeType.endsWith("/wav")) {
      return "wav";
    }
    if (streamType === "audio") {
      return "m4a";
    }
    return "mp4";
  }
  function sanitizeFileName2(input) {
    const safeName = String(input || "").replace(/[\\/:*?"<>|]+/g, "_").trim();
    return safeName || "media";
  }
  function buildCatchToolkitState2() {
    var _a2;
    const selectorEvaluation = evaluateSelectorRule2(catchToolkitState2.selectorRule);
    const regexEvaluation = evaluateRegexRule2(catchToolkitState2.regexRule);
    const capturedMediaSizeBytes = Array.from(mseStreams2.values()).reduce((totalBytes, stream) => {
      return totalBytes + Math.max(0, Number(stream.totalBytes || 0));
    }, 0);
    const sortedStreams = Array.from(mseStreams2.values()).filter((stream) => stream.buffers.length > 0 || stream.totalBytes > 0).sort((left, right) => {
      const sizeDelta = Math.max(0, Number(right.totalBytes || 0)) - Math.max(0, Number(left.totalBytes || 0));
      if (sizeDelta !== 0) {
        return sizeDelta;
      }
      return String(left.streamId).localeCompare(String(right.streamId));
    });
    const primaryStream = sortedStreams[0];
    const audioStream = sortedStreams.find((stream) => stream.streamType === "audio");
    const videoStream = sortedStreams.find((stream) => stream.streamType === "video");
    return {
      audioResourceKey: audioStream ? createMseResourceKey(audioStream.streamId) : "",
      audioSizeBytes: audioStream ? Math.max(0, Number(audioStream.totalBytes || 0)) : 0,
      autoSeekToBufferedEnd: catchToolkitState2.autoSeekToBufferedEnd,
      autoDownloadOnComplete: catchToolkitState2.autoDownloadOnComplete,
      capturedMediaSizeBytes,
      clearCacheOnComplete: catchToolkitState2.clearCacheOnComplete,
      currentFileName: resolveCatchToolkitFileName2(),
      diagnostics: {
        appendBufferCount: probeDiagnostics2.appendBufferCount,
        frameUrl: currentLocationHref2,
        hookErrors: probeDiagnostics2.hookErrors,
        installedAt: ((_a2 = globalScope2.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__) == null ? void 0 : _a2.installedAt) || Date.now(),
        lastAppendAt: probeDiagnostics2.lastAppendAt,
        lastError: probeDiagnostics2.lastError,
        mediaSourceAvailable: probeDiagnostics2.mediaSourceAvailable,
        mediaSourceHooked: probeDiagnostics2.mediaSourceHooked,
        sourceBufferCount: probeDiagnostics2.sourceBufferCount
      },
      isCaptureComplete: isCaptureComplete2,
      manualFileName: catchToolkitState2.manualFileName,
      primaryResourceKey: primaryStream ? createMseResourceKey(primaryStream.streamId) : "",
      regexWarning: regexEvaluation.warning,
      regexRule: regexEvaluation.rule,
      restartAlwaysFromBeginning: catchToolkitState2.restartAlwaysFromBeginning,
      selectorWarning: selectorEvaluation.warning,
      selectorRule: selectorEvaluation.rule,
      streamCount: mseStreams2.size,
      trimExtraMediaHeaders: catchToolkitState2.trimExtraMediaHeaders,
      videoResourceKey: videoStream ? createMseResourceKey(videoStream.streamId) : "",
      videoSizeBytes: videoStream ? Math.max(0, Number(videoStream.totalBytes || 0)) : 0
    };
  }
  function cloneChunk2(input) {
    if (input instanceof ArrayBuffer) {
      return input;
    }
    if (ArrayBuffer.isView(input)) {
      return input;
    }
    return null;
  }
  function getChunkBytes(input) {
    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  function arrayBufferToBase642(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 32768;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  function textToBase642(text) {
    return arrayBufferToBase642(new TextEncoder().encode(text).buffer);
  }
  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }
  function isLikelyBase64Key(value) {
    const normalizedValue = String(value || "").trim();
    return normalizedValue.length === 24 && normalizedValue.endsWith("==") && !normalizedValue.startsWith("AAAAAAAAAAAAAAAAAAAA") && /^[A-Za-z0-9+/]+={0,2}$/.test(normalizedValue);
  }
  function isLikelyHexKey(value) {
    return /^[A-Fa-f0-9]{32}$/.test(String(value || "").trim());
  }
  function decodeDataUrlText(value) {
    const normalizedValue = String(value || "").trim();
    if (!dataUrlPattern.test(normalizedValue)) {
      return "";
    }
    const commaIndex = normalizedValue.indexOf(",");
    if (commaIndex === -1) {
      return "";
    }
    const metadata = normalizedValue.slice(0, commaIndex);
    const data = normalizedValue.slice(commaIndex + 1);
    try {
      if (/;base64/i.test(metadata)) {
        return new TextDecoder().decode(base64ToArrayBuffer(data));
      }
      return decodeURIComponent(data);
    } catch {
      return "";
    }
  }
  function isRepeatedExpansion(buffer, chunkSize = 16) {
    if (buffer.byteLength <= chunkSize || buffer.byteLength % chunkSize !== 0) {
      return null;
    }
    const bytes = new Uint8Array(buffer);
    const firstChunk = bytes.slice(0, chunkSize);
    for (let offset = chunkSize; offset < bytes.length; offset += chunkSize) {
      for (let index = 0; index < chunkSize; index += 1) {
        if (bytes[offset + index] !== firstChunk[index]) {
          return null;
        }
      }
    }
    return firstChunk.buffer;
  }
  function normalizePotentialKeyBuffer(buffer) {
    if (buffer.byteLength === 16) {
      return buffer.slice(0);
    }
    if (buffer.byteLength === 32) {
      const repeatedBuffer = isRepeatedExpansion(buffer, 16);
      return repeatedBuffer || buffer.slice(0, 16);
    }
    if (buffer.byteLength === 128 || buffer.byteLength === 256) {
      return isRepeatedExpansion(buffer, 16);
    }
    return null;
  }
  function uint32ArrayToUint8Array(input) {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 4; index += 1) {
      const value = input[index] || 0;
      bytes[index * 4] = value >> 24 & 255;
      bytes[index * 4 + 1] = value >> 16 & 255;
      bytes[index * 4 + 2] = value >> 8 & 255;
      bytes[index * 4 + 3] = value & 255;
    }
    return bytes;
  }
  function uint16ArrayToUint8Array(input) {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 8; index += 1) {
      const value = input[index] || 0;
      bytes[index * 2] = value >> 8 & 255;
      bytes[index * 2 + 1] = value & 255;
    }
    return bytes;
  }
  function createProbeResourceKey() {
    probeResourceSequence += 1;
    return `probe-resource:${Date.now()}-${probeResourceSequence}`;
  }
  function createProbeResourceFileName(kind, ext) {
    const fileStem = kind === "key" ? `${getCurrentDocumentTitle() || currentLocationHost || "resource"}-key` : getCurrentDocumentTitle() || currentLocationHost || "resource";
    return `${sanitizeFileName2(fileStem)}.${ext}`;
  }
  function createProbeBlobResource2(input) {
    const existingKey = probeResourceKeysBySignature.get(input.signature);
    if (existingKey) {
      const existingResource = probeResources2.get(existingKey);
      if (existingResource) {
        return {
          contentLength: existingResource.contentLength,
          fileName: existingResource.fileName,
          resourceKey: existingKey,
          url: existingResource.blobUrl
        };
      }
    }
    const blob = new Blob([base64ToArrayBuffer(input.base64)], { type: input.mimeType });
    const resourceKey = createProbeResourceKey();
    const fileName = createProbeResourceFileName(input.kind, input.ext);
    const blobUrl = URL.createObjectURL(blob);
    probeResourceKeysBySignature.set(input.signature, resourceKey);
    probeResources2.set(resourceKey, {
      base64: input.base64,
      blobUrl,
      contentLength: blob.size,
      fileName,
      mimeType: input.mimeType,
      streamType: input.streamType
    });
    return {
      contentLength: blob.size,
      fileName,
      resourceKey,
      url: blobUrl
    };
  }
  function relayEnvelope(envelope) {
    if (!isWorkerScope2 || typeof globalScope2.postMessage !== "function") {
      return false;
    }
    try {
      globalScope2.postMessage({ [workerRelayKey]: envelope });
      return true;
    } catch {
      return false;
    }
  }
  function emitGeneratedResource2(input, fromRelay = false) {
    if (isWorkerScope2 && !fromRelay) {
      relayEnvelope({ payload: input, type: "generated-resource" });
      return;
    }
    const resource = createProbeBlobResource2(input);
    emit2({
      contentLength: resource.contentLength,
      ext: input.ext,
      kind: input.kind,
      mimeType: input.mimeType,
      resourceKey: resource.resourceKey,
      resourceType: input.resourceType,
      source: "probe",
      streamType: input.streamType,
      url: resource.url
    }, fromRelay);
  }
  function emitKeyCandidateFromBuffer(buffer, ext = "key") {
    if (isEmittingKeyCandidate) {
      return false;
    }
    if (isMp4HeaderChunk(buffer)) {
      return false;
    }
    isEmittingKeyCandidate = true;
    try {
      const normalizedKeyBuffer = normalizePotentialKeyBuffer(buffer);
      if (!normalizedKeyBuffer) {
        return false;
      }
      const base64 = arrayBufferToBase642(normalizedKeyBuffer);
      emitGeneratedResource2({
        base64,
        ext,
        kind: "key",
        mimeType: "application/octet-stream",
        resourceType: "key",
        signature: `key:${base64}`
      });
      return true;
    } finally {
      isEmittingKeyCandidate = false;
    }
  }
  function emitKeyCandidateFromBase642(base64) {
    if (isEmittingKeyCandidate) {
      return false;
    }
    if (!isLikelyBase64Key(base64)) {
      return false;
    }
    isEmittingKeyCandidate = true;
    try {
      const keyBuffer = base64ToArrayBuffer(base64);
      if (keyBuffer.byteLength !== 16) {
        return false;
      }
      emitGeneratedResource2({
        base64,
        ext: "base64key",
        kind: "key",
        mimeType: "application/octet-stream",
        resourceType: "key",
        signature: `key:${base64}`
      });
      return true;
    } catch {
      return false;
    } finally {
      isEmittingKeyCandidate = false;
    }
  }
  function emitKeyCandidateFromHex(hex) {
    if (isEmittingKeyCandidate) {
      return false;
    }
    const normalizedValue = String(hex || "").trim().toLowerCase();
    if (!isLikelyHexKey(normalizedValue)) {
      return false;
    }
    isEmittingKeyCandidate = true;
    try {
      const bytes = new Uint8Array(16);
      for (let index = 0; index < 16; index += 1) {
        bytes[index] = Number.parseInt(normalizedValue.slice(index * 2, index * 2 + 2), 16);
      }
      emitGeneratedResource2({
        base64: arrayBufferToBase642(bytes.buffer),
        ext: "key",
        kind: "key",
        mimeType: "application/octet-stream",
        resourceType: "key",
        signature: `key:${normalizedValue}`
      });
      return true;
    } finally {
      isEmittingKeyCandidate = false;
    }
  }
  function isMp4HeaderChunk(chunk) {
    const data = getChunkBytes(chunk);
    return data.length > 8 && data[4] === 102 && data[5] === 116 && data[6] === 121 && data[7] === 112;
  }
  function isWebmHeaderChunk(chunk) {
    const data = getChunkBytes(chunk);
    return data.length > 4 && data[0] === 26 && data[1] === 69 && data[2] === 223 && data[3] === 163;
  }
  function normalizeBuffersForPlayback2(buffers) {
    if (!catchToolkitState2.trimExtraMediaHeaders) {
      return buffers;
    }
    if (!Array.isArray(buffers) || buffers.length <= 1) {
      return buffers;
    }
    let lastHeaderIndex = -1;
    buffers.forEach((chunk, index) => {
      if (isMp4HeaderChunk(chunk) || isWebmHeaderChunk(chunk)) {
        lastHeaderIndex = index;
      }
    });
    if (lastHeaderIndex > 0) {
      return buffers.slice(lastHeaderIndex);
    }
    return buffers;
  }
  function emit2(payload, fromRelay = false) {
    if (!payload.url) {
      return;
    }
    if (payload.resourceType !== "mse-stream") {
      const dedupeKey = `${payload.resourceKey || payload.source}:${payload.resourceType || "unknown"}:${payload.url}`;
      if (seen2.has(dedupeKey)) {
        return;
      }
      seen2.add(dedupeKey);
      if (seen2.size > 2e3) {
        seen2.clear();
        seen2.add(dedupeKey);
      }
    }
    if (isWorkerScope2 && !fromRelay) {
      relayEnvelope({ payload, type: "capture" });
      return;
    }
    try {
      originalConsoleInfo(consolePrefix + JSON.stringify({
        capturedAt: Date.now(),
        contentLength: payload.contentLength,
        ext: payload.ext,
        kind: payload.kind || classifyKind2(payload.url, payload.mimeType),
        mimeType: payload.mimeType,
        pageUrl: currentLocationHref2,
        resourceKey: payload.resourceKey,
        resourceType: payload.resourceType || "probe",
        source: payload.source,
        streamType: payload.streamType,
        url: payload.url
      }));
    } catch {
    }
  }
  function inferStreamTypeFromPath(path2) {
    const normalizedPath = path2.map((item) => String(item || "").toLowerCase());
    if (normalizedPath.some((item) => item === "audio" || item.includes("audio"))) {
      return "audio";
    }
    if (normalizedPath.some((item) => item === "video" || item.includes("video"))) {
      return "video";
    }
    return void 0;
  }
  globalScope2.__OMNIFLOW_EMBEDDED_BROWSER_PROBE_CORE_KEEP_ALIVE__ = [
    arrayBufferToBase642,
    autoRestartHandledMediaElements2,
    base64ToArrayBuffer,
    buildCatchToolkitState2,
    catchToolkitState2,
    catchToolkitStorageKeys,
    classifyKind2,
    cloneChunk2,
    currentLocationHost,
    currentLocationHref2,
    currentLocationProtocol,
    dataUrlPattern,
    decodeDataUrlText,
    emit2,
    emitGeneratedResource2,
    emitKeyCandidateFromBase642,
    emitKeyCandidateFromBuffer,
    emitKeyCandidateFromHex,
    getChunkBytes,
    getCurrentDocumentTitle,
    getExtension2,
    globalScope2,
    guessExtensionFromMimeType2,
    hydrateCatchToolkitStateFromStorage,
    imageExtensions,
    imagePattern,
    inferStreamTypeFromPath,
    isCaptureComplete2,
    isEmittingKeyCandidate,
    isLikelyBase64Key,
    isLikelyHexKey,
    isMp4HeaderChunk,
    isRepeatedExpansion,
    isWebmHeaderChunk,
    isWorkerScope2,
    keyExtensions,
    keyPattern,
    likelyUrlPattern,
    manifestExtensions,
    manifestPattern,
    mediaExtensions,
    mediaPattern,
    mediaSourceStreams2,
    mseSequence2,
    mseStreams2,
    normalizeBuffersForPlayback2,
    normalizePotentialKeyBuffer,
    openWindow2,
    originalConsoleInfo,
    originalJSONParse,
    pdfPattern,
    persistCatchToolkitState2,
    probeDiagnostics2,
    probeResourceKeysBySignature,
    probeResourceSequence,
    probeResources2,
    readCatchToolkitStorageChecked,
    readCatchToolkitStorageString,
    relayEnvelope,
    resolveCatchToolkitFileName2,
    sanitizeFileName2,
    seen2,
    subtitleExtensions,
    subtitlePattern,
    textToBase642,
    toAbsoluteUrl2,
    trackedMediaElements2,
    trackedMediaObserver2,
    uint16ArrayToUint8Array,
    uint32ArrayToUint8Array,
    workerRelayKey,
    writeCatchToolkitStorageChecked,
    writeCatchToolkitStorageString
  ];
}
function embeddedBrowserResourceProbeRuntimeHooksBody() {
  var _a, _b;
  globalScope.Worker;
  const mediaSourceConstructor = globalScope.MediaSource;
  if ((_a = mediaSourceConstructor == null ? void 0 : mediaSourceConstructor.prototype) == null ? void 0 : _a.addSourceBuffer) {
    const originalAddSourceBuffer = mediaSourceConstructor.prototype.addSourceBuffer;
    mediaSourceConstructor.prototype.addSourceBuffer = new Proxy(originalAddSourceBuffer, {
      apply(target, thisArg, argumentsList) {
        var _a2;
        const sourceBuffer = Reflect.apply(target, thisArg, argumentsList);
        try {
          probeDiagnostics.mediaSourceHooked = true;
          probeDiagnostics.sourceBufferCount += 1;
          ensureTrackedMediaObserver();
          isCaptureComplete = false;
          const mediaSource = thisArg;
          const mimeType = String((argumentsList == null ? void 0 : argumentsList[0]) || "").trim();
          const normalizedMimeType = ((_a2 = mimeType.split(";")[0]) == null ? void 0 : _a2.trim().toLowerCase()) || "";
          const streamType = normalizedMimeType.startsWith("audio/") ? "audio" : normalizedMimeType.startsWith("video/") ? "video" : void 0;
          const streamId = `${Date.now()}-${++mseSequence}`;
          const existingStreamIds = mediaSourceStreams.get(mediaSource) || [];
          existingStreamIds.push(streamId);
          mediaSourceStreams.set(mediaSource, existingStreamIds);
          mseStreams.set(streamId, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: mimeType || (streamType === "audio" ? "audio/mp4" : "video/mp4"),
            streamId,
            streamType,
            totalBytes: 0
          });
          emitMseStream(streamId);
          if (sourceBuffer && typeof sourceBuffer.appendBuffer === "function") {
            const originalAppendBuffer = sourceBuffer.appendBuffer;
            sourceBuffer.appendBuffer = new Proxy(originalAppendBuffer, {
              apply(appendTarget, appendThisArg, appendArgumentsList) {
                const appendResult = Reflect.apply(appendTarget, appendThisArg, appendArgumentsList);
                const stream = mseStreams.get(streamId);
                if (!stream) {
                  return appendResult;
                }
                const chunk = cloneChunk(appendArgumentsList == null ? void 0 : appendArgumentsList[0]);
                if (!chunk || chunk.byteLength === 0) {
                  return appendResult;
                }
                stream.buffers.push(chunk);
                stream.bufferCount += 1;
                stream.totalBytes += chunk.byteLength;
                probeDiagnostics.appendBufferCount += 1;
                probeDiagnostics.lastAppendAt = Date.now();
                const shouldReport = stream.bufferCount <= 3 || stream.bufferCount - stream.lastReportedBufferCount >= 8 || stream.totalBytes - stream.lastReportedBytes >= 1024 * 512;
                if (shouldReport) {
                  stream.lastReportedBufferCount = stream.bufferCount;
                  stream.lastReportedBytes = stream.totalBytes;
                  emitMseStream(streamId);
                }
                return appendResult;
              }
            });
          }
        } catch (error) {
          probeDiagnostics.hookErrors += 1;
          probeDiagnostics.lastError = error instanceof Error ? error.message : String(error);
        }
        return sourceBuffer;
      }
    });
  }
  if ((_b = mediaSourceConstructor == null ? void 0 : mediaSourceConstructor.prototype) == null ? void 0 : _b.endOfStream) {
    const originalEndOfStream = mediaSourceConstructor.prototype.endOfStream;
    mediaSourceConstructor.prototype.endOfStream = new Proxy(originalEndOfStream, {
      apply(target, thisArg, argumentsList) {
        const result = Reflect.apply(target, thisArg, argumentsList);
        try {
          isCaptureComplete = true;
          const streamIds = mediaSourceStreams.get(thisArg) || [];
          streamIds.forEach((streamId) => {
            finalizeMseStream(streamId);
          });
          if (catchToolkitState.autoDownloadOnComplete) {
            return result;
          }
          if (catchToolkitState.clearCacheOnComplete) {
            setTimeout(() => {
              clearCatchMediaCacheInternal();
            }, 0);
          }
        } catch {
        }
        return result;
      }
    });
  }
}
const EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:";
const EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE_INSTALL_ERROR__";
function getScriptFunctionBody(fn) {
  const source = fn.toString();
  const bodyStart = source.indexOf("{");
  const bodyEnd = source.lastIndexOf("}");
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
    return "";
  }
  return source.slice(bodyStart + 1, bodyEnd).trim();
}
const probeRuntimeNames = [
  "addBaseUrl",
  "arrayBufferToBase64",
  "attachTrackedMediaElement",
  "autoRestartHandledMediaElements",
  "base64ToArrayBuffer",
  "bindTrackedMediaElements",
  "buildCatchToolkitState",
  "catchToolkitState",
  "catchToolkitStorageKeys",
  "classifyGeneratedResource",
  "classifyKind",
  "clearCatchMediaCacheInternal",
  "cloneChunk",
  "consumeWorkerRelayMessage",
  "createMseExportName",
  "createMseResourceKey",
  "createProbeBlobResource",
  "createProbeResourceFileName",
  "createProbeResourceKey",
  "createVimeoManifestBlobUrl",
  "currentLocationHost",
  "currentLocationHref",
  "currentLocationProtocol",
  "dataUrlPattern",
  "decodeDataUrlText",
  "decodeXmlEntities",
  "dedupeResourceKey",
  "downloadCatchMediaInternal",
  "emit",
  "emitGeneratedResource",
  "emitInlineManifest",
  "emitKeyCandidateFromBase64",
  "emitKeyCandidateFromBuffer",
  "emitKeyCandidateFromHex",
  "emitM3u8DataKeyReference",
  "emitM3u8ManifestWithBase",
  "emitM3u8ReferenceResource",
  "emitM3u8ReferenceResources",
  "emitMpdReferenceResource",
  "emitMpdReferenceResources",
  "emitMseStream",
  "emitVimeoPlaylistManifest",
  "ensureMseStreamBlobUrl",
  "ensureTrackedMediaObserver",
  "evaluateRegexRule",
  "evaluateSelectorRule",
  "exportMseResource",
  "exportProbeResource",
  "finalizeMseStream",
  "getBaseUrl",
  "getCurrentDocumentTitle",
  "getExtension",
  "getM3u8PendingSignature",
  "getM3u8References",
  "globalScope",
  "guessExtensionFromMimeType",
  "hasRelativeM3u8References",
  "hydrateCatchToolkitStateFromStorage",
  "imageExtensions",
  "imagePattern",
  "inferStreamTypeFromPath",
  "isCaptureComplete",
  "isEmittingKeyCandidate",
  "isLikelyBase64Key",
  "isLikelyHexKey",
  "isMp4HeaderChunk",
  "isRepeatedExpansion",
  "isWebmHeaderChunk",
  "isWorkerScope",
  "keyExtensions",
  "keyPattern",
  "knownManifestBaseUrls",
  "likelyUrlPattern",
  "m3u8Accumulator",
  "manifestExtensions",
  "manifestPattern",
  "mediaExtensions",
  "mediaPattern",
  "mediaSourceStreams",
  "mseSequence",
  "mseStreams",
  "normalizeBuffersForPlayback",
  "normalizePotentialKeyBuffer",
  "openMseResource",
  "openProbeResource",
  "openWindow",
  "originalConsoleInfo",
  "originalJSONParse",
  "pdfPattern",
  "pendingM3u8TextsBySignature",
  "persistCatchToolkitState",
  "probeDiagnostics",
  "probeResourceKeysBySignature",
  "probeResourceSequence",
  "probeResources",
  "readCatchToolkitStorageChecked",
  "readCatchToolkitStorageString",
  "readMseResource",
  "readProbeResource",
  "registerManifestBaseUrl",
  "relayEnvelope",
  "reportCandidate",
  "requestHeadersByUrl",
  "resolveCatchToolkitFileName",
  "resolveM3u8Reference",
  "resolveMpdBaseUrl",
  "resolveMpdReferenceUrl",
  "restartCatchMediaCaptureInternal",
  "sanitizeFileName",
  "scanInlineScriptResourceCandidates",
  "seen",
  "subtitleExtensions",
  "subtitlePattern",
  "textToBase64",
  "toAbsoluteUrl",
  "trackedMediaElements",
  "trackedMediaObserver",
  "uint16ArrayToUint8Array",
  "uint32ArrayToUint8Array",
  "vimeoPlaylistPattern",
  "vimeoPlaylistUrls",
  "walkValue",
  "workerRelayKey",
  "writeCatchToolkitStorageChecked",
  "writeCatchToolkitStorageString"
];
function restoreProbeRuntimeNames(source) {
  return probeRuntimeNames.reduce((nextSource, name) => {
    return nextSource.replace(new RegExp(`\\b${name}\\d+\\b`, "g"), name);
  }, source);
}
function createProbeBootstrapFunctionSource() {
  return `function createProbeBootstrapSource(nextConsolePrefix) {
  return [
    ';(() => {',
    'try {',
    'delete globalThis[' + JSON.stringify(${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}) + '];',
    'const consolePrefix = ' + JSON.stringify(String(nextConsolePrefix || '')) + ';',
    'const probeRuntimeCoreBodySource = ' + JSON.stringify(probeRuntimeCoreBodySource) + ';',
    'const probeManifestHeuristicsBodySource = ' + JSON.stringify(probeManifestHeuristicsBodySource) + ';',
    'const probePageActionsBodySource = ' + JSON.stringify(probePageActionsBodySource) + ';',
    'const probeRuntimeHooksBodySource = ' + JSON.stringify(probeRuntimeHooksBodySource) + ';',
    createProbeBootstrapSource.toString(),
    probeRuntimeCoreBodySource,
    probeManifestHeuristicsBodySource,
    probePageActionsBodySource,
    probeRuntimeHooksBodySource,
    "return 'installed';",
    '} catch (error) {',
    'try { globalThis[' + JSON.stringify(${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}) + '] = { message: error instanceof Error ? error.message : String(error), name: error && error.name ? String(error.name) : "", stack: error && error.stack ? String(error.stack).slice(0, 600) : "", at: Date.now() }; } catch (_) {}',
    "return 'install-error';",
    '}',
    '})();',
  ].join('\\n')
}`;
}
function createProbeScriptTemplate(input) {
  return [
    ";(() => {",
    "try {",
    `delete globalThis[${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}];`,
    `const consolePrefix = ${JSON.stringify(input.consolePrefix)};`,
    `const probeRuntimeCoreBodySource = ${JSON.stringify(input.runtimeCoreBodySource)};`,
    `const probeManifestHeuristicsBodySource = ${JSON.stringify(input.manifestHeuristicsBodySource)};`,
    `const probePageActionsBodySource = ${JSON.stringify(input.pageActionsBodySource)};`,
    `const probeRuntimeHooksBodySource = ${JSON.stringify(input.runtimeHooksBodySource)};`,
    createProbeBootstrapFunctionSource(),
    input.runtimeCoreBodySource,
    input.manifestHeuristicsBodySource,
    input.pageActionsBodySource,
    input.runtimeHooksBodySource,
    "return 'installed';",
    "} catch (error) {",
    `try { globalThis[${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}] = { message: error instanceof Error ? error.message : String(error), name: error && error.name ? String(error.name) : '', stack: error && error.stack ? String(error.stack).slice(0, 600) : '', at: Date.now() }; } catch (_) {}`,
    "return 'install-error';",
    "}",
    "})();"
  ].join("\n");
}
function createEmbeddedBrowserResourceProbeScript() {
  return createProbeScriptTemplate({
    consolePrefix: EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX,
    manifestHeuristicsBodySource: restoreProbeRuntimeNames(getScriptFunctionBody(embeddedBrowserResourceProbeManifestHeuristicsBody)),
    pageActionsBodySource: restoreProbeRuntimeNames(getScriptFunctionBody(embeddedBrowserResourceProbePageActionsBody)),
    runtimeCoreBodySource: restoreProbeRuntimeNames(getScriptFunctionBody(embeddedBrowserResourceProbeRuntimeCoreBody)),
    runtimeHooksBodySource: restoreProbeRuntimeNames(getScriptFunctionBody(embeddedBrowserResourceProbeRuntimeHooksBody))
  });
}
const embeddedBrowserProbeNewDocumentScriptIds = /* @__PURE__ */ new WeakMap();
function createEmbeddedBrowserView(options) {
  const existingView = options.views.get(options.tabId);
  if (existingView && !existingView.webContents.isDestroyed()) {
    return existingView;
  }
  const view = new WebContentsView({
    webPreferences: {
      devTools: true,
      partition: EMBEDDED_BROWSER_PARTITION
    }
  });
  view.webContents.setZoomFactor(1);
  const currentUserAgent = view.webContents.getUserAgent();
  if (currentUserAgent.includes("Electron")) {
    view.webContents.setUserAgent(
      currentUserAgent.replace(/\sElectron\/[^\s]+/g, "")
    );
  }
  options.syncBounds(view);
  options.views.set(options.tabId, view);
  view.webContents.on("did-start-loading", () => {
    options.emitTabState(options.tabId, view, {
      details: "did-start-loading",
      state: "loading",
      url: view.webContents.getURL() || options.currentUrls.get(options.tabId) || void 0
    });
  });
  view.webContents.on("dom-ready", () => {
    void options.createIfMissingProbe(options.tabId, view);
  });
  view.webContents.on("did-stop-loading", async () => {
    if (view.webContents.isDestroyed()) {
      return;
    }
    const committedUrl = view.webContents.getURL() || "";
    options.currentUrls.set(options.tabId, committedUrl);
    await options.tryDispatchPendingOpenFile(options.tabId, view);
    const meta = await collectEmbeddedBrowserDebugMeta(view, options.debugEnabled);
    options.emitTabState(options.tabId, view, {
      details: "did-stop-loading",
      ...meta.length ? { meta } : {},
      state: "ready",
      url: committedUrl || void 0
    });
  });
  view.webContents.on("did-navigate", (_event, url) => {
    options.currentUrls.set(options.tabId, url);
    options.emitTabState(options.tabId, view, { details: "did-navigate", state: "ready", url });
    void options.tryDispatchPendingOpenFile(options.tabId, view);
  });
  view.webContents.on("did-navigate-in-page", (_event, url) => {
    options.currentUrls.set(options.tabId, url);
    options.emitTabState(options.tabId, view, { details: "did-navigate-in-page", state: "ready", url });
    void options.tryDispatchPendingOpenFile(options.tabId, view);
  });
  view.webContents.on("page-title-updated", (_event, title) => {
    options.emitTabState(options.tabId, view, {
      details: "page-title-updated",
      state: "ready",
      title: title || void 0,
      url: options.currentUrls.get(options.tabId) || view.webContents.getURL() || void 0
    });
  });
  view.webContents.on("page-favicon-updated", (_event, favicons) => {
    const iconUrl = favicons.map((item) => String(item || "").trim()).find((item) => item) || "";
    if (!iconUrl) {
      return;
    }
    void loadEmbeddedBrowserFaviconDataUrl(view, iconUrl).then((faviconDataUrl) => {
      if (!faviconDataUrl || view.webContents.isDestroyed()) {
        return;
      }
      options.iconSourceUrls.set(options.tabId, iconUrl);
      options.iconUrls.set(options.tabId, faviconDataUrl);
      options.emitTabState(options.tabId, view, {
        details: "page-favicon-updated",
        iconSourceUrl: iconUrl,
        iconUrl: faviconDataUrl,
        state: "ready",
        url: options.currentUrls.get(options.tabId) || view.webContents.getURL() || void 0
      });
    });
  });
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) {
      return;
    }
    options.emitTabState(options.tabId, view, {
      details: `did-fail-load(${errorCode})`,
      state: "error",
      message: `页面加载失败：${errorDescription || "未知错误"}`,
      url: validatedURL
    });
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    options.emitTabState(options.tabId, view, {
      details: `render-process-gone:${details.reason}`,
      state: "error",
      message: `页面渲染进程异常退出：${details.reason}`,
      url: options.currentUrls.get(options.tabId) || view.webContents.getURL() || void 0
    });
  });
  view.webContents.debugger.on("detach", () => {
    embeddedBrowserProbeNewDocumentScriptIds.delete(view.webContents);
  });
  view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (typeof message === "string" && message.startsWith(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX)) {
      const rawPayload = message.slice(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX.length);
      try {
        options.onProbePayload(JSON.parse(rawPayload));
      } catch (error) {
        runtimeLogger.warn("embedded browser resource payload parse failed", {
          error: error instanceof Error ? error.message : String(error),
          tabId: options.tabId
        });
      }
      return;
    }
    if (options.debugEnabled && level >= 2) {
      options.emitTabState(options.tabId, view, {
        details: `console:${sourceId}:${line}`,
        state: "ready",
        message,
        meta: [`console-level=${level}`],
        url: options.currentUrls.get(options.tabId) || view.webContents.getURL() || void 0
      });
    }
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    void view.webContents.loadURL(url);
    return { action: "deny" };
  });
  return view;
}
function buildEmbeddedBrowserProbeResourceRecorder(tabId) {
  return (payload) => {
    recordEmbeddedBrowserProbeResource(tabId, {
      capturedAt: Number(payload.capturedAt) || Date.now(),
      contentLength: typeof payload.contentLength === "number" ? payload.contentLength : void 0,
      ext: typeof payload.ext === "string" ? payload.ext : void 0,
      kind: typeof payload.kind === "string" ? payload.kind : void 0,
      mimeType: typeof payload.mimeType === "string" ? payload.mimeType : void 0,
      pageUrl: typeof payload.pageUrl === "string" ? payload.pageUrl : void 0,
      resourceKey: typeof payload.resourceKey === "string" ? payload.resourceKey : void 0,
      resourceType: typeof payload.resourceType === "string" ? payload.resourceType : void 0,
      source: "probe",
      streamType: payload.streamType === "audio" || payload.streamType === "video" ? payload.streamType : void 0,
      url: typeof payload.url === "string" ? payload.url : ""
    });
  };
}
async function installEmbeddedBrowserResourceProbe(tabId, view, isDeepCaptureEnabled) {
  if (!isDeepCaptureEnabled(tabId) || view.webContents.isDestroyed()) {
    return false;
  }
  const probeScript = createEmbeddedBrowserResourceProbeScript();
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach("1.3");
    }
    const existingScriptId = embeddedBrowserProbeNewDocumentScriptIds.get(view.webContents);
    if (existingScriptId) {
      try {
        await view.webContents.debugger.sendCommand("Page.removeScriptToEvaluateOnNewDocument", {
          identifier: existingScriptId
        });
      } catch {
      }
      embeddedBrowserProbeNewDocumentScriptIds.delete(view.webContents);
    }
    await view.webContents.debugger.sendCommand("Page.enable");
    const result = await view.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
      source: probeScript
    });
    if (result.identifier) {
      embeddedBrowserProbeNewDocumentScriptIds.set(view.webContents, result.identifier);
    }
  } catch (error) {
    runtimeLogger.warn("embedded browser resource probe document-start install failed", {
      error: error instanceof Error ? error.message : String(error),
      tabId,
      url: view.webContents.getURL() || ""
    });
  }
  try {
    const mainFrame = view.webContents.mainFrame;
    const frames = mainFrame ? [mainFrame, ...mainFrame.framesInSubtree.filter((frame) => frame !== mainFrame)] : [];
    if (frames.length) {
      await Promise.all(frames.map(async (frame) => {
        try {
          await frame.executeJavaScript(probeScript, true);
        } catch {
        }
      }));
    } else {
      await view.webContents.executeJavaScript(probeScript, true);
    }
    return true;
  } catch (error) {
    runtimeLogger.warn("embedded browser resource probe install failed", {
      error: error instanceof Error ? error.message : String(error),
      tabId,
      url: view.webContents.getURL() || ""
    });
    return false;
  }
}
const COMMON_FFMPEG_PATHS = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
].filter((value) => Boolean(value));
const FFMPEG_HTTP_HEADER_BLACKLIST = /* @__PURE__ */ new Set([
  "accept-encoding",
  "connection",
  "host",
  "range"
]);
function sanitizeFileName$1(input) {
  const normalized = String(input || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
  return normalized || "media";
}
async function canExecuteFile(candidatePath) {
  if (!candidatePath || candidatePath === "ffmpeg") {
    return false;
  }
  try {
    await access(candidatePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function canExecuteCommand(candidateCommand) {
  return new Promise((resolve) => {
    const child = spawn(candidateCommand, ["-version"], {
      stdio: "ignore"
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}
async function resolveEmbeddedBrowserFfmpegPath(preferredPath) {
  const candidates = [
    String(preferredPath || "").trim() || void 0,
    ...COMMON_FFMPEG_PATHS
  ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
  for (const candidate of candidates) {
    if (candidate === "ffmpeg") {
      if (await canExecuteCommand(candidate)) {
        return candidate;
      }
      continue;
    }
    if (await canExecuteFile(candidate)) {
      return candidate;
    }
  }
  return null;
}
function buildEmbeddedBrowserResourceMergeArgs(request) {
  return [
    "-y",
    ...request.video.inputArgs,
    "-i",
    request.video.path,
    ...request.audio.inputArgs,
    "-i",
    request.audio.path,
    "-c",
    "copy",
    request.outputPath
  ];
}
function deriveEmbeddedBrowserMergedFileName(videoFileName, audioFileName) {
  const normalizedVideoName = sanitizeFileName$1(path.parse(videoFileName).name);
  const normalizedAudioName = sanitizeFileName$1(path.parse(audioFileName).name);
  const mergedBaseName = normalizedVideoName.replace(/-video$/i, "").replace(/_video$/i, "") || normalizedAudioName.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media";
  return `${mergedBaseName}.mp4`;
}
async function createEmbeddedBrowserResourceMergeTempDir() {
  return mkdtemp(path.join(os.tmpdir(), "omniflow-resource-merge-"));
}
async function cleanupEmbeddedBrowserResourceMergeTempDir(tempDir) {
  if (!tempDir) {
    return;
  }
  await rm(tempDir, {
    force: true,
    recursive: true
  });
}
async function writeExtractedResourceToTempFile(tempDir, resource) {
  if (!resource.base64) {
    throw new Error("缺少可写入的资源内容");
  }
  const filePath = path.join(tempDir, sanitizeFileName$1(resource.fileName));
  await writeFile(filePath, Buffer$1.from(resource.base64, "base64"));
  return filePath;
}
function isHttpResourceUrl(input) {
  return /^https?:\/\//i.test(String(input || "").trim());
}
function sanitizeHeaderValue$1(input) {
  return String(input || "").replace(/[\r\n]+/g, " ").trim();
}
function buildFfmpegHttpInputArgs(resource) {
  const url = String(resource.url || "").trim();
  if (!isHttpResourceUrl(url)) {
    return [];
  }
  const headers = resource.requestHeaders || {};
  const inputArgs = [];
  const headerLines = [];
  Object.entries(headers).forEach(([rawName, rawValue]) => {
    const headerName = String(rawName || "").trim().toLowerCase();
    const headerValue = sanitizeHeaderValue$1(rawValue);
    if (!headerName || !headerValue || FFMPEG_HTTP_HEADER_BLACKLIST.has(headerName)) {
      return;
    }
    headerLines.push(`${headerName}: ${headerValue}`);
  });
  if (headerLines.length) {
    inputArgs.push("-headers", `${headerLines.join("\r\n")}\r
`);
  }
  return inputArgs;
}
async function prepareResourceMergeInput(tempDir, resource) {
  const url = String(resource.url || "").trim();
  if (url && isHttpResourceUrl(url) && !resource.base64) {
    return {
      inputArgs: buildFfmpegHttpInputArgs(resource),
      path: url
    };
  }
  return {
    inputArgs: [],
    path: await writeExtractedResourceToTempFile(tempDir, resource)
  };
}
async function mergeEmbeddedBrowserResourceTracks(request) {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  }
  const tempDir = await createEmbeddedBrowserResourceMergeTempDir();
  try {
    const [audio, video] = await Promise.all([
      prepareResourceMergeInput(tempDir, request.audio),
      prepareResourceMergeInput(tempDir, request.video)
    ]);
    const commandArgs = buildEmbeddedBrowserResourceMergeArgs({
      audio,
      outputPath: request.outputPath,
      video
    });
    const result = await new Promise((resolve, reject) => {
      const stdout = [];
      const stderr = [];
      const child = spawn(ffmpegPath, commandArgs, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.on("data", (chunk) => {
        stdout.push(String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderr.push(String(chunk));
      });
      child.once("error", (error) => {
        reject(error);
      });
      child.once("exit", (code) => {
        if (code === 0) {
          resolve({
            commandArgs,
            ffmpegPath,
            outputPath: request.outputPath,
            stderr: stderr.join(""),
            stdout: stdout.join("")
          });
          return;
        }
        reject(new Error(stderr.join("").trim() || `ffmpeg 退出码异常: ${code}`));
      });
    });
    return result;
  } finally {
    await cleanupEmbeddedBrowserResourceMergeTempDir(tempDir).catch(() => void 0);
  }
}
function sanitizeFileName(input) {
  const normalized = String(input || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
  return normalized || "media";
}
function deriveEmbeddedBrowserExtractedResourceOutputFileName(resourceFileName, suggestedFileName) {
  const normalizedResourceName = sanitizeFileName(resourceFileName);
  const resourceExtension = path.extname(normalizedResourceName);
  const normalizedSuggestion = sanitizeFileName(suggestedFileName || "");
  if (normalizedSuggestion === "media") {
    return normalizedResourceName;
  }
  const parsedSuggestion = path.parse(normalizedSuggestion);
  const outputExtension = parsedSuggestion.ext || resourceExtension;
  return `${sanitizeFileName(parsedSuggestion.name || normalizedSuggestion)}${outputExtension}`;
}
async function saveEmbeddedBrowserExtractedResourceFile(resource, outputPath) {
  await writeFile(outputPath, Buffer$1.from(resource.base64, "base64"));
  return outputPath;
}
const FFMPEG_MANIFEST_HEADER_BLACKLIST = /* @__PURE__ */ new Set([
  "accept-encoding",
  "connection",
  "host",
  "range"
]);
function sanitizeHeaderValue(input) {
  return String(input || "").replace(/[\r\n]+/g, " ").trim();
}
function buildFfmpegHttpHeaderArgs(headers) {
  const headerLines = [];
  Object.entries(headers || {}).forEach(([rawName, rawValue]) => {
    const headerName = String(rawName || "").trim().toLowerCase();
    const headerValue = sanitizeHeaderValue(rawValue);
    if (!headerName || !headerValue || FFMPEG_MANIFEST_HEADER_BLACKLIST.has(headerName)) {
      return;
    }
    headerLines.push(`${headerName}: ${headerValue}`);
  });
  return headerLines.length ? ["-headers", `${headerLines.join("\r\n")}\r
`] : [];
}
function deriveEmbeddedBrowserManifestOutputFileName(input, kind) {
  try {
    const extensionPattern = kind === "hls" ? /\.(m3u8|m3u)(?:$|[?#])/i : /\.mpd(?:$|[?#])/i;
    const fileName = decodeURIComponent(path.basename(new URL(input).pathname)).replace(extensionPattern, "").replace(/[\\/:*?"<>|]+/g, "_").trim();
    if (fileName) {
      return `${fileName}.mp4`;
    }
  } catch {
  }
  return kind === "hls" ? "hls-media.mp4" : "dash-media.mp4";
}
function buildEmbeddedBrowserManifestDownloadArgs(request) {
  return [
    "-y",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto,data",
    "-allowed_extensions",
    "ALL",
    ...buildFfmpegHttpHeaderArgs(request.headers),
    "-i",
    request.manifestUrl,
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    request.outputPath
  ];
}
async function downloadEmbeddedBrowserManifestResource(request) {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  }
  const commandArgs = buildEmbeddedBrowserManifestDownloadArgs(request);
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(ffmpegPath, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => {
      stdout.push(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(String(chunk));
    });
    child.once("error", (error) => {
      reject(error);
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve({
          commandArgs,
          ffmpegPath,
          outputPath: request.outputPath,
          stderr: stderr.join(""),
          stdout: stdout.join("")
        });
        return;
      }
      reject(new Error(stderr.join("").trim() || `ffmpeg 退出码异常: ${code}`));
    });
  });
}
function createEmbeddedBrowserMainController(options) {
  const embeddedBrowserViews = /* @__PURE__ */ new Map();
  const embeddedBrowserLastCommittedUrls = /* @__PURE__ */ new Map();
  const embeddedBrowserIconUrls = /* @__PURE__ */ new Map();
  const embeddedBrowserIconSourceUrls = /* @__PURE__ */ new Map();
  const embeddedBrowserPendingOpenFiles = /* @__PURE__ */ new Map();
  const embeddedBrowserAttachedOpenFiles = /* @__PURE__ */ new Map();
  const embeddedBrowserOpenFileRequestVersions = /* @__PURE__ */ new Map();
  const embeddedBrowserFileSystemOriginDecisions = /* @__PURE__ */ new Map();
  let activeEmbeddedBrowserTabId = null;
  let embeddedBrowserPendingBounds = null;
  let embeddedBrowserSessionConfigured = false;
  function emitEmbeddedBrowserState(payload) {
    runtimeLogger.log("[embedded-browser:main]", payload);
    const mainWindow2 = options.getMainWindow();
    if (!mainWindow2 || mainWindow2.isDestroyed()) {
      return;
    }
    mainWindow2.webContents.send("embedded-browser:state", payload);
  }
  function emitEmbeddedBrowserDownload(payload) {
    const mainWindow2 = options.getMainWindow();
    if (!mainWindow2 || mainWindow2.isDestroyed()) {
      return;
    }
    mainWindow2.webContents.send("embedded-browser:download", payload);
  }
  function emitEmbeddedBrowserResource(payload) {
    const mainWindow2 = options.getMainWindow();
    if (!mainWindow2 || mainWindow2.isDestroyed()) {
      return;
    }
    mainWindow2.webContents.send("embedded-browser:resource", payload);
  }
  function resolveEmbeddedBrowserTabIdByWebContents(targetContents) {
    for (const [tabId, view] of embeddedBrowserViews.entries()) {
      if (view.webContents === targetContents) {
        return tabId;
      }
    }
    return null;
  }
  function resolveEmbeddedBrowserTabIdByWebContentsId(targetWebContentsId) {
    for (const [tabId, view] of embeddedBrowserViews.entries()) {
      if (view.webContents.id === targetWebContentsId) {
        return tabId;
      }
    }
    return null;
  }
  function configureSession() {
    if (embeddedBrowserSessionConfigured) {
      return;
    }
    embeddedBrowserSessionConfigured = true;
    configureEmbeddedBrowserSession({
      decisionCache: embeddedBrowserFileSystemOriginDecisions,
      options
    });
  }
  function initializeBridges() {
    initializeEmbeddedBrowserMainBridges({
      emitDownload: emitEmbeddedBrowserDownload,
      emitResource: emitEmbeddedBrowserResource,
      resolveTabIdByWebContents: resolveEmbeddedBrowserTabIdByWebContents,
      resolveTabIdByWebContentsId: resolveEmbeddedBrowserTabIdByWebContentsId
    });
  }
  function getEmbeddedBrowserTitle(view) {
    const runtimeTitle = view.webContents.getTitle().trim();
    if (runtimeTitle) {
      return runtimeTitle;
    }
    return void 0;
  }
  function emitEmbeddedBrowserTabState(tabId, view, payload) {
    emitEmbeddedBrowserState({
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      iconSourceUrl: payload.iconSourceUrl ?? embeddedBrowserIconSourceUrls.get(tabId),
      iconUrl: payload.iconUrl ?? embeddedBrowserIconUrls.get(tabId),
      tabId,
      title: payload.title ?? getEmbeddedBrowserTitle(view),
      ...payload
    });
  }
  function emitEmbeddedBrowserTabSnapshot(tabId, view, payload) {
    emitEmbeddedBrowserTabState(tabId, view, {
      state: "ready",
      url: (payload == null ? void 0 : payload.url) ?? (embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || void 0),
      ...payload
    });
  }
  function getEmbeddedBrowserView(tabId) {
    const view = embeddedBrowserViews.get(tabId);
    if (!view || view.webContents.isDestroyed()) {
      embeddedBrowserViews.delete(tabId);
      embeddedBrowserLastCommittedUrls.delete(tabId);
      embeddedBrowserIconUrls.delete(tabId);
      embeddedBrowserIconSourceUrls.delete(tabId);
      disposeEmbeddedBrowserCapturedResources(tabId);
      return null;
    }
    return view;
  }
  async function tryInstallEmbeddedBrowserResourceProbe(tabId, view) {
    return installEmbeddedBrowserResourceProbe(
      tabId,
      view,
      isEmbeddedBrowserDeepCaptureEnabled
    );
  }
  async function withEmbeddedBrowserResourceScriptExecutor(tabId, runner) {
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return null;
    }
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (!view || view.webContents.isDestroyed()) {
      return null;
    }
    const executeScript = (script) => view.webContents.executeJavaScript(script, true);
    return runner(executeScript, view);
  }
  async function withEmbeddedBrowserView(tabId, runner) {
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return null;
    }
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (!view || view.webContents.isDestroyed()) {
      return null;
    }
    return runner(view);
  }
  function getEmbeddedBrowserFrameList(view) {
    const mainFrame = view.webContents.mainFrame;
    if (!mainFrame) {
      return [];
    }
    return [mainFrame, ...mainFrame.framesInSubtree.filter((frame) => frame !== mainFrame)];
  }
  function mergeCatchToolkitStatePayloads(states) {
    const firstState = states[0];
    if (!firstState) {
      return null;
    }
    const chooseLargestTrack = (key, sizeKey) => states.filter((state) => state[key]).sort((left, right) => Math.max(0, Number(right[sizeKey] || 0)) - Math.max(0, Number(left[sizeKey] || 0)))[0];
    const audioState = chooseLargestTrack("audioResourceKey", "audioSizeBytes");
    const primaryState = chooseLargestTrack("primaryResourceKey", "capturedMediaSizeBytes");
    const videoState = chooseLargestTrack("videoResourceKey", "videoSizeBytes");
    const diagnosticStates = states.map((state) => state.diagnostics);
    const installedAtValues = diagnosticStates.map((diagnostics) => diagnostics.installedAt).filter((value) => value > 0);
    return {
      audioResourceKey: (audioState == null ? void 0 : audioState.audioResourceKey) || "",
      audioSizeBytes: states.reduce((totalBytes, state) => totalBytes + Math.max(0, Number(state.audioSizeBytes || 0)), 0),
      autoSeekToBufferedEnd: firstState.autoSeekToBufferedEnd,
      autoDownloadOnComplete: firstState.autoDownloadOnComplete,
      capturedMediaSizeBytes: states.reduce((totalBytes, state) => {
        return totalBytes + Math.max(0, Number(state.capturedMediaSizeBytes || 0));
      }, 0),
      clearCacheOnComplete: firstState.clearCacheOnComplete,
      currentFileName: states.map((state) => state.currentFileName).find(Boolean) || "",
      diagnostics: {
        appendBufferCount: diagnosticStates.reduce((totalCount, diagnostics) => totalCount + Math.max(0, Number(diagnostics.appendBufferCount || 0)), 0),
        frameCount: states.length,
        frameUrl: diagnosticStates.map((diagnostics) => diagnostics.frameUrl).find(Boolean) || "",
        hookErrors: diagnosticStates.reduce((totalCount, diagnostics) => totalCount + Math.max(0, Number(diagnostics.hookErrors || 0)), 0),
        installedAt: installedAtValues.length ? Math.min(...installedAtValues) : 0,
        lastAppendAt: Math.max(...diagnosticStates.map((diagnostics) => diagnostics.lastAppendAt || 0)),
        lastError: diagnosticStates.map((diagnostics) => diagnostics.lastError).find(Boolean) || "",
        mediaSourceAvailable: diagnosticStates.some((diagnostics) => diagnostics.mediaSourceAvailable),
        mediaSourceHooked: diagnosticStates.some((diagnostics) => diagnostics.mediaSourceHooked),
        sourceBufferCount: diagnosticStates.reduce((totalCount, diagnostics) => totalCount + Math.max(0, Number(diagnostics.sourceBufferCount || 0)), 0)
      },
      isCaptureComplete: states.some((state) => state.isCaptureComplete),
      manualFileName: firstState.manualFileName,
      primaryResourceKey: (primaryState == null ? void 0 : primaryState.primaryResourceKey) || "",
      regexWarning: states.map((state) => state.regexWarning).find(Boolean) || "",
      regexRule: firstState.regexRule,
      restartAlwaysFromBeginning: firstState.restartAlwaysFromBeginning,
      selectorWarning: states.map((state) => state.selectorWarning).find(Boolean) || "",
      selectorRule: firstState.selectorRule,
      streamCount: states.reduce((totalCount, state) => totalCount + Math.max(0, Number(state.streamCount || 0)), 0),
      trimExtraMediaHeaders: firstState.trimExtraMediaHeaders,
      videoResourceKey: (videoState == null ? void 0 : videoState.videoResourceKey) || "",
      videoSizeBytes: states.reduce((totalBytes, state) => totalBytes + Math.max(0, Number(state.videoSizeBytes || 0)), 0)
    };
  }
  async function createMissingCatchToolkitProbeState(view) {
    const frames = getEmbeddedBrowserFrameList(view);
    const diagnostics = await Promise.all(frames.map(async (frame) => {
      try {
        return await frame.executeJavaScript(`
          (() => ({
            frameUrl: String(location.href || ''),
            installError: globalThis[${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}] || null,
            mediaSourceAvailable: typeof MediaSource !== 'undefined',
          }))()
        `, true);
      } catch {
        return null;
      }
    }));
    const validDiagnostics = diagnostics.filter((item) => Boolean(item));
    const installError = validDiagnostics.map((item) => item.installError).find((item) => item && typeof item === "object");
    const installErrorMessage = installError ? [
      installError.name ? String(installError.name) : "",
      installError.message ? String(installError.message) : ""
    ].filter(Boolean).join(": ") || "probe 安装失败" : "probe 未安装或读取不到";
    return {
      audioResourceKey: "",
      audioSizeBytes: 0,
      autoSeekToBufferedEnd: false,
      autoDownloadOnComplete: false,
      capturedMediaSizeBytes: 0,
      clearCacheOnComplete: false,
      currentFileName: "",
      diagnostics: {
        appendBufferCount: 0,
        frameCount: frames.length,
        frameUrl: validDiagnostics.map((item) => item.frameUrl).find(Boolean) || "",
        hookErrors: 0,
        installedAt: 0,
        lastAppendAt: 0,
        lastError: installErrorMessage,
        mediaSourceAvailable: validDiagnostics.some((item) => item.mediaSourceAvailable),
        mediaSourceHooked: false,
        sourceBufferCount: 0
      },
      isCaptureComplete: false,
      manualFileName: "",
      primaryResourceKey: "",
      regexWarning: "",
      regexRule: "",
      restartAlwaysFromBeginning: false,
      selectorWarning: "",
      selectorRule: "",
      streamCount: 0,
      trimExtraMediaHeaders: true,
      videoResourceKey: "",
      videoSizeBytes: 0
    };
  }
  async function extractEmbeddedBrowserResourceFromFrames(view, resourceKey) {
    const frames = getEmbeddedBrowserFrameList(view);
    if (!frames.length) {
      return extractEmbeddedBrowserResourceFromPage(
        (script) => view.webContents.executeJavaScript(script, true),
        resourceKey
      );
    }
    for (const frame of frames) {
      try {
        const resource = await extractEmbeddedBrowserResourceFromPage(
          (script) => frame.executeJavaScript(script, true),
          resourceKey
        );
        if (resource) {
          return resource;
        }
      } catch {
      }
    }
    return null;
  }
  async function mergeEmbeddedBrowserCapturedMseResources(tabId, payload) {
    var _a, _b, _c, _d;
    const normalizedTabId = String(tabId || "").trim();
    const audioResourceKey = String(payload.audioResourceKey || ((_a = payload.audioResource) == null ? void 0 : _a.resourceKey) || "").trim();
    const videoResourceKey = String(payload.videoResourceKey || ((_b = payload.videoResource) == null ? void 0 : _b.resourceKey) || "").trim();
    const createPayloadMergeResource = (input, fallbackStreamType) => {
      const url = String((input == null ? void 0 : input.url) || "").trim();
      if (!url) {
        return null;
      }
      let fileName = String((input == null ? void 0 : input.fileName) || "").trim();
      if (!fileName) {
        try {
          fileName = decodeURIComponent(path.basename(new URL(url).pathname));
        } catch {
          fileName = "";
        }
      }
      return {
        fileName: fileName || `${fallbackStreamType}.m4s`,
        mimeType: input == null ? void 0 : input.mimeType,
        requestHeaders: input == null ? void 0 : input.requestHeaders,
        resourceKey: input == null ? void 0 : input.resourceKey,
        streamType: (input == null ? void 0 : input.streamType) || fallbackStreamType,
        url
      };
    };
    if (!normalizedTabId || !audioResourceKey && !((_c = payload.audioResource) == null ? void 0 : _c.url) || !videoResourceKey && !((_d = payload.videoResource) == null ? void 0 : _d.url)) {
      return {
        error: "缺少要合并的音频或视频资源",
        ok: false
      };
    }
    try {
      let audioResource = createPayloadMergeResource(payload.audioResource, "audio");
      let videoResource = createPayloadMergeResource(payload.videoResource, "video");
      if (audioResourceKey || videoResourceKey) {
        const extractedResources = await withEmbeddedBrowserView(
          normalizedTabId,
          async (view) => Promise.all([
            audioResourceKey ? extractEmbeddedBrowserResourceFromFrames(view, audioResourceKey) : null,
            videoResourceKey ? extractEmbeddedBrowserResourceFromFrames(view, videoResourceKey) : null
          ])
        );
        audioResource = (extractedResources == null ? void 0 : extractedResources[0]) || audioResource;
        videoResource = (extractedResources == null ? void 0 : extractedResources[1]) || videoResource;
      }
      if (!audioResource || !videoResource) {
        return {
          error: "当前音频或视频资源还没有整理完成，先继续播放几秒再试试",
          ok: false
        };
      }
      const defaultFileName = String(payload.suggestedFileName || "").trim() || deriveEmbeddedBrowserMergedFileName(videoResource.fileName, audioResource.fileName);
      const mainWindow2 = options.getMainWindow();
      const targetWindow = mainWindow2 && !mainWindow2.isDestroyed() ? mainWindow2 : void 0;
      const saveDialogOptions = {
        defaultPath: path.join(app.getPath("downloads"), defaultFileName),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: false
      };
      const saveResult = targetWindow ? await dialog.showSaveDialog(targetWindow, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
      if (saveResult.canceled || !saveResult.filePath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      const mergeResult = await mergeEmbeddedBrowserResourceTracks({
        audio: audioResource,
        ffmpegPath: payload.ffmpegPath,
        outputPath: saveResult.filePath,
        video: videoResource
      });
      return {
        ffmpegPath: mergeResult.ffmpegPath,
        ok: true,
        outputPath: mergeResult.outputPath
      };
    } catch (error) {
      runtimeLogger.warn("embedded browser resource merge failed", {
        audioResourceKey,
        error: error instanceof Error ? error.message : String(error),
        tabId: normalizedTabId,
        videoResourceKey
      });
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    }
  }
  async function saveEmbeddedBrowserCapturedResourceForRenderer(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    const resourceKey = String(payload.resourceKey || "").trim();
    if (!normalizedTabId || !resourceKey) {
      return {
        error: "缺少要保存的捕捉资源",
        ok: false
      };
    }
    try {
      const resource = await withEmbeddedBrowserView(
        normalizedTabId,
        async (view) => extractEmbeddedBrowserResourceFromFrames(view, resourceKey)
      );
      if (!resource) {
        return {
          error: "当前捕捉资源还没有整理完成，先继续播放几秒再试试",
          ok: false
        };
      }
      const defaultFileName = deriveEmbeddedBrowserExtractedResourceOutputFileName(
        resource.fileName,
        payload.suggestedFileName
      );
      const mainWindow2 = options.getMainWindow();
      const targetWindow = mainWindow2 && !mainWindow2.isDestroyed() ? mainWindow2 : void 0;
      const saveDialogOptions = {
        defaultPath: path.join(app.getPath("downloads"), defaultFileName),
        showsTagField: false
      };
      const saveResult = targetWindow ? await dialog.showSaveDialog(targetWindow, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
      if (saveResult.canceled || !saveResult.filePath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      const outputPath = await saveEmbeddedBrowserExtractedResourceFile(resource, saveResult.filePath);
      return {
        ok: true,
        outputPath
      };
    } catch (error) {
      runtimeLogger.warn("embedded browser resource save failed", {
        error: error instanceof Error ? error.message : String(error),
        resourceKey,
        tabId: normalizedTabId
      });
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    }
  }
  async function downloadEmbeddedBrowserManifestResourceForRenderer(tabId, payload, kind) {
    const normalizedTabId = String(tabId || "").trim();
    const manifestUrl = String(payload.manifestUrl || "").trim();
    if (!normalizedTabId || !manifestUrl) {
      return {
        error: kind === "hls" ? "缺少要下载的 m3u8 地址" : "缺少要下载的 mpd 地址",
        ok: false
      };
    }
    try {
      const defaultFileName = String(payload.suggestedFileName || "").trim() || deriveEmbeddedBrowserManifestOutputFileName(manifestUrl, kind);
      const mainWindow2 = options.getMainWindow();
      const targetWindow = mainWindow2 && !mainWindow2.isDestroyed() ? mainWindow2 : void 0;
      const saveDialogOptions = {
        defaultPath: path.join(app.getPath("downloads"), defaultFileName),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: false
      };
      const saveResult = targetWindow ? await dialog.showSaveDialog(targetWindow, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
      if (saveResult.canceled || !saveResult.filePath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      const result = await downloadEmbeddedBrowserManifestResource({
        ffmpegPath: payload.ffmpegPath,
        headers: payload.headers,
        kind,
        manifestUrl,
        outputPath: saveResult.filePath
      });
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath
      };
    } catch (error) {
      runtimeLogger.warn("embedded browser manifest download failed", {
        error: error instanceof Error ? error.message : String(error),
        kind,
        manifestUrl,
        tabId: normalizedTabId
      });
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    }
  }
  async function downloadEmbeddedBrowserHlsResource(tabId, payload) {
    return downloadEmbeddedBrowserManifestResourceForRenderer(tabId, payload, "hls");
  }
  async function downloadEmbeddedBrowserMpdResource(tabId, payload) {
    return downloadEmbeddedBrowserManifestResourceForRenderer(tabId, payload, "mpd");
  }
  function syncEmbeddedBrowserViewBounds(view) {
    view.setBounds(embeddedBrowserPendingBounds ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }
  function detachActiveEmbeddedBrowserView(targetWindow) {
    if (!activeEmbeddedBrowserTabId) {
      return;
    }
    const activeView = getEmbeddedBrowserView(activeEmbeddedBrowserTabId);
    if (!activeView) {
      activeEmbeddedBrowserTabId = null;
      return;
    }
    if (targetWindow.contentView.children.includes(activeView)) {
      targetWindow.contentView.removeChildView(activeView);
    }
    activeEmbeddedBrowserTabId = null;
  }
  function createEmbeddedBrowserView$1(tabId) {
    const mainWindow2 = options.getMainWindow();
    if (!mainWindow2 || mainWindow2.isDestroyed()) {
      return null;
    }
    return createEmbeddedBrowserView({
      createIfMissingProbe: tryInstallEmbeddedBrowserResourceProbe,
      currentUrls: embeddedBrowserLastCommittedUrls,
      debugEnabled: options.debugEnabled,
      emitTabState: emitEmbeddedBrowserTabState,
      iconSourceUrls: embeddedBrowserIconSourceUrls,
      iconUrls: embeddedBrowserIconUrls,
      onProbePayload: buildEmbeddedBrowserProbeResourceRecorder(tabId),
      syncBounds: syncEmbeddedBrowserViewBounds,
      tabId,
      tryDispatchPendingOpenFile: async (targetTabId, view) => tryDispatchPendingEmbeddedBrowserOpenFile({
        attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
        currentUrls: embeddedBrowserLastCommittedUrls,
        pendingOpenFiles: embeddedBrowserPendingOpenFiles,
        tabId: targetTabId,
        view
      }),
      views: embeddedBrowserViews
    });
  }
  function activateEmbeddedBrowserTab(targetWindow, tabId, activateOptions = {}) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null;
    }
    if (!tabId) {
      detachActiveEmbeddedBrowserView(targetWindow);
      return null;
    }
    const createIfMissing = activateOptions.createIfMissing ?? false;
    const nextView = createIfMissing ? createEmbeddedBrowserView$1(tabId) : getEmbeddedBrowserView(tabId);
    if (!nextView) {
      detachActiveEmbeddedBrowserView(targetWindow);
      return null;
    }
    if (activeEmbeddedBrowserTabId && activeEmbeddedBrowserTabId !== tabId) {
      detachActiveEmbeddedBrowserView(targetWindow);
    }
    syncEmbeddedBrowserViewBounds(nextView);
    if (!targetWindow.contentView.children.includes(nextView)) {
      targetWindow.contentView.addChildView(nextView);
    }
    activeEmbeddedBrowserTabId = tabId;
    return nextView;
  }
  async function loadEmbeddedBrowserUrl(targetWindow, tabId, url, errorDetails, activateOnly = false) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return;
    }
    const view = activateEmbeddedBrowserTab(targetWindow, normalizedTabId, { createIfMissing: true });
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      emitEmbeddedBrowserTabState(normalizedTabId, view, {
        state: "ready",
        title: getEmbeddedBrowserTitle(view) || "新标签页",
        url: embeddedBrowserLastCommittedUrls.get(normalizedTabId) || void 0
      });
      return;
    }
    const currentUrl = embeddedBrowserLastCommittedUrls.get(normalizedTabId) || view.webContents.getURL();
    if (activateOnly && currentUrl === normalizedUrl) {
      emitEmbeddedBrowserTabState(normalizedTabId, view, {
        state: "ready",
        url: currentUrl || void 0
      });
      return;
    }
    emitEmbeddedBrowserTabState(normalizedTabId, view, {
      details: "load-url",
      state: "loading",
      url: normalizedUrl
    });
    try {
      await view.webContents.loadURL(normalizedUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ERR_ABORTED")) {
        return;
      }
      emitEmbeddedBrowserTabState(normalizedTabId, view, {
        details: errorDetails,
        state: "error",
        message: `页面加载失败：${message}`,
        url: normalizedUrl
      });
      throw error;
    }
  }
  function closeEmbeddedBrowserTab(targetWindow, tabId) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return;
    }
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (!view) {
      return;
    }
    if (targetWindow.contentView.children.includes(view)) {
      targetWindow.contentView.removeChildView(view);
    }
    if (activeEmbeddedBrowserTabId === normalizedTabId) {
      activeEmbeddedBrowserTabId = null;
    }
    embeddedBrowserViews.delete(normalizedTabId);
    embeddedBrowserLastCommittedUrls.delete(normalizedTabId);
    embeddedBrowserIconUrls.delete(normalizedTabId);
    embeddedBrowserIconSourceUrls.delete(normalizedTabId);
    disposeEmbeddedBrowserCapturedResources(normalizedTabId);
    bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId
    });
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId
    });
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false });
    }
  }
  async function handleOpenTab(sender, tabId, url) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow();
    const normalizedTabId = String(tabId || "").trim();
    bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId
    });
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId
    });
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      emitEmbeddedBrowserState({
        canGoBack: false,
        canGoForward: false,
        state: "ready",
        tabId: normalizedTabId,
        title: "新标签页"
      });
      return;
    }
    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, normalizedUrl, "open-exception", true);
  }
  function handleActivateTab(sender, tabId) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow();
    activateEmbeddedBrowserTab(targetWindow, tabId, { createIfMissing: false });
  }
  async function handleNavigate(sender, tabId, url) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow();
    const normalizedTabId = String(tabId || "").trim();
    bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId
    });
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId
    });
    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, url, "navigate-exception");
  }
  async function handleOpenMappedFile(sender, tabId, pageUrl, sourceUrl, fileName) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow();
    const normalizedTabId = String(tabId || "").trim();
    const normalizedPageUrl = String(pageUrl || "").trim();
    const normalizedSourceUrl = String(sourceUrl || "").trim();
    const normalizedFileName = String(fileName || "").trim() || "file";
    if (!normalizedTabId || !normalizedPageUrl || !normalizedSourceUrl) {
      return;
    }
    const requestVersion = bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId
    });
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId
    });
    const stagedPath = await stageEmbeddedBrowserOpenFile(normalizedSourceUrl, normalizedFileName);
    if (!isEmbeddedBrowserOpenFileRequestCurrent({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
      version: requestVersion
    })) {
      void cleanupEmbeddedBrowserOpenFile(stagedPath).catch(() => void 0);
      return;
    }
    embeddedBrowserPendingOpenFiles.set(normalizedTabId, {
      fileName: normalizedFileName,
      pageUrl: normalizedPageUrl,
      stagedPath
    });
    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, normalizedPageUrl, "navigate-exception");
    if (!isEmbeddedBrowserOpenFileRequestCurrent({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
      version: requestVersion
    })) {
      return;
    }
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (view) {
      void tryDispatchPendingEmbeddedBrowserOpenFile({
        attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
        currentUrls: embeddedBrowserLastCommittedUrls,
        pendingOpenFiles: embeddedBrowserPendingOpenFiles,
        tabId: normalizedTabId,
        view
      });
    }
  }
  async function handleReload(tabId) {
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return;
    }
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    emitEmbeddedBrowserTabState(normalizedTabId, view, {
      details: "reload",
      state: "loading",
      url: embeddedBrowserLastCommittedUrls.get(normalizedTabId) || view.webContents.getURL() || void 0
    });
    view.webContents.reloadIgnoringCache();
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: "reload-requested"
    });
  }
  async function handleGoBack(tabId) {
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return;
    }
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    if (view.webContents.canGoBack()) {
      view.webContents.goBack();
    }
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: "history-back"
    });
  }
  async function handleGoForward(tabId) {
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return;
    }
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    if (view.webContents.canGoForward()) {
      view.webContents.goForward();
    }
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: "history-forward"
    });
  }
  async function handleOpenResource(tabId, resourceKey) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const frames = getEmbeddedBrowserFrameList(view);
        if (!frames.length) {
          return await runEmbeddedBrowserResourceProbeAction(
            (script) => view.webContents.executeJavaScript(script, true),
            "openResource",
            resourceKey
          );
        }
        const results = await Promise.all(frames.map(async (frame) => {
          try {
            return await runEmbeddedBrowserResourceProbeAction(
              (script) => frame.executeJavaScript(script, true),
              "openResource",
              resourceKey
            );
          } catch {
            return false;
          }
        }));
        return results.some(Boolean);
      } catch (error) {
        runtimeLogger.warn("embedded browser resource probe action failed", {
          action: "openResource",
          error: error instanceof Error ? error.message : String(error),
          resourceKey: String(resourceKey || "").trim(),
          tabId: String(tabId || "").trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || "").trim()) || ""
        });
        return false;
      }
    }).then((result) => Boolean(result));
  }
  async function handleExportResource(tabId, resourceKey) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const frames = getEmbeddedBrowserFrameList(view);
        if (!frames.length) {
          return await runEmbeddedBrowserResourceProbeAction(
            (script) => view.webContents.executeJavaScript(script, true),
            "exportResource",
            resourceKey
          );
        }
        const results = await Promise.all(frames.map(async (frame) => {
          try {
            return await runEmbeddedBrowserResourceProbeAction(
              (script) => frame.executeJavaScript(script, true),
              "exportResource",
              resourceKey
            );
          } catch {
            return false;
          }
        }));
        return results.some(Boolean);
      } catch (error) {
        runtimeLogger.warn("embedded browser resource probe action failed", {
          action: "exportResource",
          error: error instanceof Error ? error.message : String(error),
          resourceKey: String(resourceKey || "").trim(),
          tabId: String(tabId || "").trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || "").trim()) || ""
        });
        return false;
      }
    }).then((result) => Boolean(result));
  }
  async function handleReadResource(tabId, resourceKey) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        return await extractEmbeddedBrowserResourceFromFrames(view, resourceKey);
      } catch (error) {
        runtimeLogger.warn("embedded browser resource read failed", {
          error: error instanceof Error ? error.message : String(error),
          resourceKey: String(resourceKey || "").trim(),
          tabId: String(tabId || "").trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || "").trim()) || ""
        });
        return null;
      }
    });
  }
  async function handlePreviewResource(tabId, payload) {
    return withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript) => {
      try {
        return await runEmbeddedBrowserResourcePreview(executeScript, payload);
      } catch (error) {
        runtimeLogger.warn("embedded browser network resource preview failed", {
          error: error instanceof Error ? error.message : String(error),
          tabId: String(tabId || "").trim(),
          url: String(payload.url || "").trim()
        });
        return false;
      }
    }).then((result) => Boolean(result));
  }
  async function handleGetCatchToolkitState(tabId) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const readState = async () => {
          const frames = getEmbeddedBrowserFrameList(view);
          if (!frames.length) {
            return await getEmbeddedBrowserCatchToolkitState(
              (script) => view.webContents.executeJavaScript(script, true)
            );
          }
          const states = await Promise.all(frames.map(async (frame) => {
            try {
              return await getEmbeddedBrowserCatchToolkitState(
                (script) => frame.executeJavaScript(script, true)
              );
            } catch {
              return null;
            }
          }));
          return mergeCatchToolkitStatePayloads(states.filter((state) => Boolean(state)));
        };
        const currentState = await readState();
        if (currentState) {
          return currentState;
        }
        await tryInstallEmbeddedBrowserResourceProbe(String(tabId || "").trim(), view);
        return await readState() || await createMissingCatchToolkitProbeState(view);
      } catch (error) {
        runtimeLogger.warn("embedded browser catch toolkit get state failed", {
          error: error instanceof Error ? error.message : String(error),
          tabId: String(tabId || "").trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || "").trim()) || ""
        });
        return null;
      }
    });
  }
  async function handleUpdateCatchToolkitState(tabId, payload) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const frames = getEmbeddedBrowserFrameList(view);
        if (!frames.length) {
          return await updateEmbeddedBrowserCatchToolkitState(
            (script) => view.webContents.executeJavaScript(script, true),
            payload
          );
        }
        const states = await Promise.all(frames.map(async (frame) => {
          try {
            return await updateEmbeddedBrowserCatchToolkitState(
              (script) => frame.executeJavaScript(script, true),
              payload
            );
          } catch {
            return null;
          }
        }));
        return mergeCatchToolkitStatePayloads(states.filter((state) => Boolean(state)));
      } catch (error) {
        runtimeLogger.warn("embedded browser catch toolkit update state failed", {
          error: error instanceof Error ? error.message : String(error),
          payload,
          tabId: String(tabId || "").trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || "").trim()) || ""
        });
        return null;
      }
    });
  }
  async function handleCatchToolkitAction(tabId, action, logKey) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const frames = getEmbeddedBrowserFrameList(view);
        if (!frames.length) {
          return await runEmbeddedBrowserCatchToolkitAction(
            (script) => view.webContents.executeJavaScript(script, true),
            action
          );
        }
        const results = await Promise.all(frames.map(async (frame) => {
          try {
            return await runEmbeddedBrowserCatchToolkitAction(
              (script) => frame.executeJavaScript(script, true),
              action
            );
          } catch {
            return false;
          }
        }));
        return results.some(Boolean);
      } catch (error) {
        runtimeLogger.warn(`embedded browser catch toolkit ${logKey} failed`, {
          error: error instanceof Error ? error.message : String(error),
          tabId: String(tabId || "").trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || "").trim()) || ""
        });
        return false;
      }
    }).then((result) => Boolean(result));
  }
  async function handleStartDeepResourceCapture(tabId) {
    const normalizedTabId = String(tabId || "").trim();
    const snapshot = startEmbeddedBrowserDeepResourceCapture(normalizedTabId);
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (view && !view.webContents.isDestroyed()) {
      if (view.webContents.getURL()) {
        await tryInstallEmbeddedBrowserResourceProbe(normalizedTabId, view);
        view.webContents.reloadIgnoringCache();
      } else {
        await tryInstallEmbeddedBrowserResourceProbe(normalizedTabId, view);
      }
    }
    return snapshot;
  }
  function handleSetBounds(sender, bounds) {
    const nextBounds = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow();
    const zoomFactor = targetWindow && !targetWindow.isDestroyed() ? Math.max(targetWindow.webContents.getZoomFactor(), 0.01) : 1;
    nextBounds.x = Math.max(0, Math.round(bounds.x * zoomFactor));
    nextBounds.y = Math.max(0, Math.round(bounds.y * zoomFactor));
    nextBounds.width = Math.max(0, Math.round(bounds.width * zoomFactor));
    nextBounds.height = Math.max(0, Math.round(bounds.height * zoomFactor));
    embeddedBrowserPendingBounds = nextBounds;
    if (!activeEmbeddedBrowserTabId) {
      return;
    }
    const activeView = getEmbeddedBrowserView(activeEmbeddedBrowserTabId);
    if (!activeView) {
      return;
    }
    activeView.setBounds(nextBounds);
  }
  function handleCloseTab(sender, tabId) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow();
    closeEmbeddedBrowserTab(targetWindow, tabId);
  }
  async function handleCleanupDownloadFile(tempPath) {
    try {
      return await cleanupEmbeddedBrowserDownloadFile(tempPath);
    } catch {
      return false;
    }
  }
  function handleDeactivate(sender) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow();
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    detachActiveEmbeddedBrowserView(targetWindow);
  }
  function handleCloseAll(sender) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow();
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    Array.from(embeddedBrowserViews.keys()).forEach((tabId) => {
      closeEmbeddedBrowserTab(targetWindow, tabId);
    });
    activeEmbeddedBrowserTabId = null;
    emitEmbeddedBrowserState({ state: "idle" });
  }
  function registerIpcHandlers2() {
    registerEmbeddedBrowserMainIpcHandlers({
      activateTab: handleActivateTab,
      cleanupDownloadFile: handleCleanupDownloadFile,
      clearCapturedResources: (tabId) => clearEmbeddedBrowserCapturedResources(String(tabId || "").trim()),
      clearCatchMediaCache: (tabId) => handleCatchToolkitAction(tabId, "clearCatchMediaCache", "clear cache"),
      closeAll: handleCloseAll,
      closeTab: handleCloseTab,
      deactivate: handleDeactivate,
      downloadCatchMedia: (tabId) => handleCatchToolkitAction(tabId, "downloadCatchMedia", "download"),
      downloadHlsManifest: downloadEmbeddedBrowserHlsResource,
      downloadMpdManifest: downloadEmbeddedBrowserMpdResource,
      exportResource: handleExportResource,
      getCatchToolkitState: handleGetCatchToolkitState,
      goBack: handleGoBack,
      goForward: handleGoForward,
      listCapturedResources: (tabId) => getEmbeddedBrowserResourceCaptureSnapshot(String(tabId || "").trim()),
      mergeMseResources: mergeEmbeddedBrowserCapturedMseResources,
      navigate: handleNavigate,
      openMappedFile: handleOpenMappedFile,
      openResource: handleOpenResource,
      openTab: handleOpenTab,
      previewResource: handlePreviewResource,
      readResource: handleReadResource,
      reload: handleReload,
      resolveFavicon: resolveEmbeddedBrowserBookmarkFavicon,
      restartCatchMediaCapture: (tabId) => handleCatchToolkitAction(tabId, "restartCatchMediaCapture", "restart"),
      saveResource: saveEmbeddedBrowserCapturedResourceForRenderer,
      setBounds: handleSetBounds,
      startCapturedResources: (tabId) => startEmbeddedBrowserResourceCapture(String(tabId || "").trim()),
      startDeepResourceCapture: handleStartDeepResourceCapture,
      stopCapturedResources: (tabId) => stopEmbeddedBrowserResourceCapture(String(tabId || "").trim()),
      updateCatchToolkitState: handleUpdateCatchToolkitState
    });
  }
  return {
    configureSession,
    initializeBridges,
    registerIpcHandlers: registerIpcHandlers2
  };
}
const WINDOW_ACTIVATE_TOPMOST_DURATION_MS = 240;
function registerWindowControlIpcHandlers(options) {
  ipcMain.on("window-minimize", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow();
    targetWindow == null ? void 0 : targetWindow.minimize();
  });
  ipcMain.on("window-maximize", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow();
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
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow();
    targetWindow == null ? void 0 : targetWindow.close();
  });
  ipcMain.on("window-set-theme-source", (_event, source) => {
    if (["light", "dark", "system"].includes(source)) {
      nativeTheme.themeSource = source;
    }
  });
  ipcMain.handle("window-activate", (event, temporaryOnTop = false) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow();
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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const APP_ICON_PATH = path.join(process.env.APP_ROOT, "build", "icons", "icon.png");
const APP_DISPLAY_NAME = "Omniflow";
const LEGACY_USER_DATA_DIRNAME = "omniflow-app";
const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 920;
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 400;
const WINDOW_STATE_FILENAME = "window-state.json";
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 200;
const ENABLE_EMBEDDED_BROWSER_DEBUG = process.env.NODE_ENV === "test" || Boolean(VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true";
const ENABLE_CHROMIUM_RUNTIME_LOGS = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
if (!ENABLE_CHROMIUM_RUNTIME_LOGS) {
  app.commandLine.appendSwitch("disable-logging");
  app.commandLine.appendSwitch("log-level", "3");
}
app.setName(APP_DISPLAY_NAME);
try {
  const stableUserDataPath = path.join(app.getPath("appData"), LEGACY_USER_DATA_DIRNAME);
  app.setPath("userData", stableUserDataPath);
} catch {
}
function getAppIconPath() {
  return existsSync(APP_ICON_PATH) ? APP_ICON_PATH : null;
}
let mainWindow = null;
let isQuitting = false;
let windowStateSaveTimer = null;
function getWindowStateFilePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILENAME);
}
function isFiniteNumber(input) {
  return typeof input === "number" && Number.isFinite(input);
}
function isValidWindowSize(width, height) {
  return width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT;
}
function isWindowWithinAnyDisplay(bounds) {
  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const area = display.workArea;
    return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  });
}
function readPersistedWindowState() {
  try {
    const filePath = getWindowStateFilePath();
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isFiniteNumber(parsed.width) || !isFiniteNumber(parsed.height)) {
      return null;
    }
    if (!isValidWindowSize(parsed.width, parsed.height)) {
      return null;
    }
    const maximized = Boolean(parsed.maximized);
    const nextState = {
      width: parsed.width,
      height: parsed.height,
      maximized
    };
    if (isFiniteNumber(parsed.x) && isFiniteNumber(parsed.y)) {
      nextState.x = parsed.x;
      nextState.y = parsed.y;
    }
    if (isFiniteNumber(nextState.x) && isFiniteNumber(nextState.y)) {
      const isVisible = isWindowWithinAnyDisplay({
        x: nextState.x,
        y: nextState.y,
        width: nextState.width,
        height: nextState.height
      });
      if (!isVisible) {
        delete nextState.x;
        delete nextState.y;
      }
    }
    return nextState;
  } catch {
    return null;
  }
}
function saveWindowState(win) {
  if (win.isDestroyed()) {
    return;
  }
  try {
    const normalBounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    const payload = {
      x: normalBounds.x,
      y: normalBounds.y,
      width: Math.max(Math.round(normalBounds.width), MIN_WINDOW_WIDTH),
      height: Math.max(Math.round(normalBounds.height), MIN_WINDOW_HEIGHT),
      maximized: win.isMaximized()
    };
    const filePath = getWindowStateFilePath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(payload), "utf-8");
  } catch {
  }
}
function scheduleSaveWindowState(win) {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
  }
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    saveWindowState(win);
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
}
function isToggleDevToolsShortcut(input) {
  if (input.type !== "keyDown") {
    return false;
  }
  const key = (input.key || "").toLowerCase();
  return (input.meta || input.control) && input.shift && key === "i";
}
function isZoomShortcut(input) {
  if (input.type !== "keyDown") {
    return false;
  }
  if (!(input.meta || input.control)) {
    return false;
  }
  const key = (input.key || "").toLowerCase();
  return key === "+" || key === "=" || key === "-" || key === "_" || key === "0";
}
const embeddedBrowserMainController = createEmbeddedBrowserMainController({
  debugEnabled: ENABLE_EMBEDDED_BROWSER_DEBUG,
  getMainWindow: () => mainWindow
});
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  const appIconPath = getAppIconPath();
  const persistedWindowState = readPersistedWindowState();
  const initialWidth = (persistedWindowState == null ? void 0 : persistedWindowState.width) ?? DEFAULT_WINDOW_WIDTH;
  const initialHeight = (persistedWindowState == null ? void 0 : persistedWindowState.height) ?? DEFAULT_WINDOW_HEIGHT;
  const win = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    vibrancy: "sidebar",
    visualEffectState: "active",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...isFiniteNumber(persistedWindowState == null ? void 0 : persistedWindowState.x) && isFiniteNumber(persistedWindowState == null ? void 0 : persistedWindowState.y) ? { x: persistedWindowState.x, y: persistedWindowState.y } : {},
    webPreferences: {
      preload: path.join(MAIN_DIST, "preload.mjs"),
      devTools: true
    },
    autoHideMenuBar: true,
    ...appIconPath ? { icon: appIconPath } : {}
  });
  mainWindow = win;
  if (persistedWindowState == null ? void 0 : persistedWindowState.maximized) {
    win.maximize();
  }
  win.on("move", () => {
    scheduleSaveWindowState(win);
  });
  win.on("resize", () => {
    scheduleSaveWindowState(win);
  });
  win.on("maximize", () => {
    scheduleSaveWindowState(win);
  });
  win.on("unmaximize", () => {
    scheduleSaveWindowState(win);
  });
  win.on("close", (event) => {
    saveWindowState(win);
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
  win.webContents.setZoomFactor(1);
  void win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => void 0);
  win.webContents.on("before-input-event", (event, input) => {
    if (isZoomShortcut(input)) {
      event.preventDefault();
      return;
    }
    if (!isToggleDevToolsShortcut(input)) {
      return;
    }
    event.preventDefault();
    win.webContents.toggleDevTools();
  });
  win.on("app-command", (event, command2) => {
    if (command2 === "browser-backward" || command2 === "browser-forward") {
      event.preventDefault();
    }
  });
  win.on("swipe", (event, direction) => {
    if (direction === "left" || direction === "right") {
      event.preventDefault();
    }
  });
  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
  return win;
}
app.on("before-quit", () => {
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowState(mainWindow);
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
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
  embeddedBrowserMainController.configureSession();
  embeddedBrowserMainController.initializeBridges();
  registerIpcHandlers();
  registerWindowControlIpcHandlers({
    getMainWindow: () => mainWindow
  });
  embeddedBrowserMainController.registerIpcHandlers();
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
