var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { dialog, app, net, protocol, ipcMain, session, systemPreferences, safeStorage, webContents, BrowserWindow, shell, Menu, WebContentsView, nativeTheme, screen } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs$1, { constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs$2 from "fs/promises";
import fs, { access, mkdtemp, rm, writeFile, mkdir, copyFile, appendFile, readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import require$$0 from "os";
import require$$1 from "child_process";
import fs$3 from "fs";
import { spawn, execFile } from "node:child_process";
import os from "node:os";
import { Buffer as Buffer$1 } from "node:buffer";
import crypto, { randomUUID } from "node:crypto";
import { promisify } from "node:util";
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
const TEMP_IMPORT_STAGING_DIR_NAME = "omniflow-import-staging";
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
function getTempImportStagingRoot() {
  return path.join(app.getPath("temp"), TEMP_IMPORT_STAGING_DIR_NAME);
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
  ipcMain2.handle("fs:get-download-directory", async () => app.getPath("downloads"));
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
    const subDir = path.join(stagingRoot, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs$2.mkdir(subDir, { recursive: true });
    const safeName = String(fileName || "subtitle.txt").replace(/[/\\]/g, "_").trim() || "unknown";
    const stagedPath = path.join(subDir, safeName);
    const normalizedContent = String(content ?? "");
    await fs$2.writeFile(stagedPath, normalizedContent, "utf-8");
    return {
      filePath: stagedPath,
      size: Buffer.byteLength(normalizedContent, "utf-8")
    };
  });
  ipcMain2.handle("fs:create-staged-binary-file", async (_event, fileName, base64) => {
    const stagingRoot = getTempImportStagingRoot();
    const subDir = path.join(stagingRoot, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs$2.mkdir(subDir, { recursive: true });
    const safeName = String(fileName || "image.png").replace(/[/\\]/g, "_").trim() || "image.png";
    const stagedPath = path.join(subDir, safeName);
    const buffer = Buffer.from(String(base64 || ""), "base64");
    if (buffer.length <= 0) {
      throw new Error("临时图片内容为空");
    }
    await fs$2.writeFile(stagedPath, buffer);
    return {
      filePath: stagedPath,
      size: buffer.length
    };
  });
  ipcMain2.handle("fs:create-temp-import-directory", async () => {
    const stagingRoot = getTempImportStagingRoot();
    await fs$2.mkdir(stagingRoot, { recursive: true });
    return await fs$2.mkdtemp(path.join(stagingRoot, "job-"));
  });
  ipcMain2.handle("fs:get-temp-import-file-info", async (_event, filePath) => {
    const normalizedPath = path.resolve(String(filePath || "").trim());
    const stagingRoot = getTempImportStagingRoot();
    if (!normalizedPath || !isPathInsideDirectory$1(normalizedPath, stagingRoot)) {
      throw new Error("无效的临时导入文件");
    }
    const stat = await fs$2.stat(normalizedPath);
    if (!stat.isFile()) {
      throw new Error("临时导入路径不是文件");
    }
    return {
      filePath: normalizedPath,
      name: path.basename(normalizedPath),
      size: Number(stat.size || 0)
    };
  });
  ipcMain2.handle("fs:cleanup-staged-text-file", async (_event, stagedPath) => {
    const normalizedPath = path.resolve(String(stagedPath || "").trim());
    const stagingRoot = getTextFileStagingRoot();
    if (!normalizedPath || !isPathInsideDirectory$1(normalizedPath, stagingRoot)) {
      return false;
    }
    const parentDir = path.dirname(normalizedPath);
    if (parentDir !== stagingRoot && isPathInsideDirectory$1(parentDir, stagingRoot)) {
      await fs$2.rm(parentDir, { recursive: true, force: true });
    } else {
      await fs$2.rm(normalizedPath, { force: true });
    }
    return true;
  });
  ipcMain2.handle("fs:cleanup-temp-import-path", async (_event, targetPath) => {
    const normalizedPath = path.resolve(String(targetPath || "").trim());
    const stagingRoot = getTempImportStagingRoot();
    if (!normalizedPath || !isPathInsideDirectory$1(normalizedPath, stagingRoot)) {
      return false;
    }
    const stat = await fs$2.stat(normalizedPath).catch(() => null);
    if (stat == null ? void 0 : stat.isFile()) {
      const parentDir = path.dirname(normalizedPath);
      if (parentDir !== stagingRoot && isPathInsideDirectory$1(parentDir, stagingRoot)) {
        await fs$2.rm(parentDir, { recursive: true, force: true });
        return true;
      }
    }
    await fs$2.rm(normalizedPath, { force: true, recursive: true });
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
  const registerRuntime = (runtime) => {
    let bucket = activeUploads.get(runtime.uploadId);
    if (!bucket) {
      bucket = /* @__PURE__ */ new Set();
      activeUploads.set(runtime.uploadId, bucket);
    }
    bucket.add(runtime);
  };
  const unregisterRuntime = (runtime) => {
    const bucket = activeUploads.get(runtime.uploadId);
    if (!bucket) return;
    bucket.delete(runtime);
    if (bucket.size === 0) activeUploads.delete(runtime.uploadId);
  };
  const sendUploadProgress = (runtime, force = false) => {
    const now = Date.now();
    if (!force && now - runtime.lastProgressAt < 80) return;
    runtime.lastProgressAt = now;
    const elapsedMs = Math.max(now - runtime.startedAt, 1);
    const speedBps = Math.floor(runtime.uploadedBytes * 1e3 / elapsedMs);
    const percentage = runtime.totalBytes > 0 ? Math.min(runtime.uploadedBytes / runtime.totalBytes * 100, 100) : 0;
    runtime.sender.send("http:upload:progress", {
      uploadId: runtime.uploadId,
      partNumber: runtime.partNumber,
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
  const activeFormDataUploads = /* @__PURE__ */ new Map();
  ipcMain2.handle("http:upload:formdata:abort", async (_event, uploadId) => {
    const runtime = activeFormDataUploads.get(uploadId);
    if (!runtime) return false;
    runtime.aborted = true;
    activeFormDataUploads.delete(uploadId);
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
  ipcMain2.handle("http:upload:formdata", async (_event, url, filePath, formDataParams = {}, headers = {}, uploadId) => {
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
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const currentUploadId = uploadId || `formdata-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      const fileStream = fs$1.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
      const runtime = { request, fileStream, aborted: false };
      activeFormDataUploads.set(currentUploadId, runtime);
      let settled = false;
      const safeResolve = (payload) => {
        if (settled) return;
        settled = true;
        activeFormDataUploads.delete(currentUploadId);
        resolve(payload);
      };
      const safeReject = (error) => {
        if (settled) return;
        settled = true;
        activeFormDataUploads.delete(currentUploadId);
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
          safeResolve({ status: response.statusCode, body: parsedBody });
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
      fileStream.on("end", () => {
        if (runtime.aborted) return;
        request.write(fileSuffix);
        request.end();
      });
      fileStream.on("error", (err) => {
        if (runtime.aborted) {
          safeReject(new Error("UPLOAD_ABORTED"));
          return;
        }
        try {
          request.destroy(err);
        } catch {
        }
        safeReject(err);
      });
      fileStream.pipe(request, { end: false });
    });
  });
  ipcMain2.handle("http:upload:abort", async (_event, uploadId) => {
    const bucket = activeUploads.get(uploadId);
    if (!bucket || bucket.size === 0) return false;
    for (const runtime of bucket) {
      runtime.aborted = true;
      try {
        runtime.fileStream.destroy(new Error("UPLOAD_ABORTED"));
      } catch {
      }
      try {
        runtime.request.destroy(new Error("UPLOAD_ABORTED"));
      } catch {
      }
    }
    activeUploads.delete(uploadId);
    return true;
  });
  ipcMain2.handle("http:upload:presigned-put", async (event, args) => {
    const { uploadId, partNumber, presignedUrl, filePath, byteOffset, byteLength, contentType } = args;
    if (!uploadId || !presignedUrl || !filePath) {
      throw new Error("uploadId / presignedUrl / filePath 必填");
    }
    if (!Number.isFinite(partNumber) || partNumber < 1) {
      throw new Error(`非法 partNumber: ${partNumber}`);
    }
    if (!Number.isFinite(byteOffset) || byteOffset < 0) {
      throw new Error(`非法 byteOffset: ${byteOffset}`);
    }
    if (!Number.isFinite(byteLength) || byteLength <= 0) {
      throw new Error(`非法 byteLength: ${byteLength}`);
    }
    let stat;
    try {
      stat = fs$1.statSync(filePath);
    } catch (error) {
      throw new Error(`读取上传文件失败: ${filePath} (${String(error)})`);
    }
    if (!stat.isFile()) {
      throw new Error(`上传目标不是文件: ${filePath}`);
    }
    if (byteOffset + byteLength > stat.size) {
      throw new Error(`分片越界: offset=${byteOffset}, length=${byteLength}, fileSize=${stat.size}`);
    }
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(presignedUrl);
      const transport = parsedUrl.protocol === "https:" ? https : http;
      const headers = {
        "Content-Length": String(byteLength)
      };
      if (contentType) {
        headers["Content-Type"] = contentType;
      }
      const request = transport.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : void 0,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "PUT",
        headers
      });
      const fileStream = fs$1.createReadStream(filePath, {
        start: byteOffset,
        end: byteOffset + byteLength - 1,
        highWaterMark: 1024 * 1024
      });
      const runtime = {
        uploadId,
        partNumber,
        request,
        fileStream,
        sender: event.sender,
        totalBytes: byteLength,
        uploadedBytes: 0,
        startedAt: Date.now(),
        lastProgressAt: 0,
        aborted: false
      };
      registerRuntime(runtime);
      let settled = false;
      const safeResolve = (payload) => {
        if (settled) return;
        settled = true;
        unregisterRuntime(runtime);
        resolve(payload);
      };
      const safeReject = (error) => {
        if (settled) return;
        settled = true;
        unregisterRuntime(runtime);
        reject(error);
      };
      let responseBody = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          responseBody += chunk.toString();
        });
        response.on("end", () => {
          const status = response.statusCode || 0;
          const rawEtag = response.headers.etag || response.headers.ETag || "";
          const etag = String(rawEtag).replace(/^"+|"+$/g, "");
          if (status >= 400) {
            safeReject(new Error(`分片上传失败: HTTP ${status} ${responseBody.slice(0, 200)}`));
            return;
          }
          runtime.uploadedBytes = runtime.totalBytes;
          sendUploadProgress(runtime, true);
          safeResolve({ status, etag, body: responseBody });
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
      fileStream.on("data", (chunk) => {
        if (runtime.aborted) return;
        runtime.uploadedBytes += chunk.length;
        sendUploadProgress(runtime);
      });
      fileStream.on("error", (err) => {
        if (runtime.aborted) {
          safeReject(new Error("UPLOAD_ABORTED"));
          return;
        }
        try {
          request.destroy(err);
        } catch {
        }
        safeReject(err);
      });
      fileStream.pipe(request);
    });
  });
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
function normalizeEmbeddedBrowserResourceTranscodeFormat(input) {
  const normalized = String(input || "").trim().replace(/^\.+/, "").toLowerCase();
  if (!/^[a-z0-9]{1,12}$/.test(normalized)) {
    return null;
  }
  return normalized;
}
function sanitizeFileName$2(input) {
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
function buildEmbeddedBrowserResourceTranscodeArgs(request) {
  const normalizedFormat = normalizeEmbeddedBrowserResourceTranscodeFormat(request.outputFormat);
  if (!normalizedFormat) {
    throw new Error("请输入 1-12 位字母或数字格式，例如 mp3、m4a、mp4");
  }
  const outputArgsByFormat = {
    aac: ["-vn", "-c:a", "aac", "-b:a", "192k"],
    aiff: ["-vn"],
    alac: ["-vn", "-c:a", "alac"],
    flac: ["-vn", "-c:a", "flac"],
    m4a: ["-vn", "-c:a", "aac", "-b:a", "192k"],
    mp3: ["-vn", "-c:a", "libmp3lame", "-b:a", "192k"],
    ogg: ["-vn", "-c:a", "libvorbis", "-q:a", "5"],
    opus: ["-vn", "-c:a", "libopus", "-b:a", "128k"],
    wav: ["-vn", "-c:a", "pcm_s16le"],
    weba: ["-vn", "-c:a", "libopus", "-b:a", "128k"],
    webm: ["-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libvpx-vp9", "-c:a", "libopus"],
    wma: ["-vn"]
  };
  const outputArgs = outputArgsByFormat[normalizedFormat] || ["-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart"];
  return [
    "-y",
    ...request.input.inputArgs,
    "-i",
    request.input.path,
    ...outputArgs,
    request.outputPath
  ];
}
function deriveEmbeddedBrowserMergedFileName(videoFileName, audioFileName) {
  const normalizedVideoName = sanitizeFileName$2(path.parse(videoFileName).name);
  const normalizedAudioName = sanitizeFileName$2(path.parse(audioFileName).name);
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
  if (resource.filePath) {
    return resource.filePath;
  }
  if (!resource.base64) {
    throw new Error("缺少可写入的资源内容");
  }
  const filePath = path.join(tempDir, sanitizeFileName$2(resource.fileName));
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
async function transcodeEmbeddedBrowserResource(request) {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  }
  const tempDir = await createEmbeddedBrowserResourceMergeTempDir();
  try {
    const input = await prepareResourceMergeInput(tempDir, request.resource);
    const commandArgs = buildEmbeddedBrowserResourceTranscodeArgs({
      input,
      outputFormat: request.outputFormat,
      outputPath: request.outputPath
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
function isMediaToolOperation(input) {
  return input === "extract-audio" || input === "compress-video";
}
function sanitizeFileName$1(input) {
  const normalized = String(input).trim().replace(/[\\/:*?"<>|]+/g, "_");
  return normalized || "media";
}
function deriveOutputFileName(inputFileName, operation) {
  const parsed = path.parse(sanitizeFileName$1(inputFileName || "media"));
  const baseName = parsed.name || "media";
  if (operation === "extract-audio") {
    return `${baseName}-audio.m4a`;
  }
  return `${baseName}-compressed.mp4`;
}
async function resolveUniqueOutputPath(outputDirectoryPath, fileName) {
  const parsed = path.parse(fileName);
  for (let index = 0; index < 1e3; index += 1) {
    const suffix = index === 0 ? "" : ` (${index})`;
    const candidate = path.join(outputDirectoryPath, `${parsed.name}${suffix}${parsed.ext}`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  return path.join(outputDirectoryPath, `${parsed.name}-${Date.now()}${parsed.ext}`);
}
function buildMediaToolArgs(request) {
  if (request.operation === "extract-audio") {
    return [
      "-y",
      "-i",
      request.inputUrl,
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      request.outputPath
    ];
  }
  return [
    "-y",
    "-i",
    request.inputUrl,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    request.outputPath
  ];
}
async function processMediaToolFile(request) {
  const inputUrl = String(request.inputUrl || "").trim();
  if (!inputUrl) {
    return { ok: false, error: "缺少输入文件地址" };
  }
  if (!isMediaToolOperation(request.operation)) {
    return { ok: false, error: "未知的媒体处理操作" };
  }
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath);
  if (!ffmpegPath) {
    return { ok: false, error: "未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行" };
  }
  const outputDirectoryPath = path.resolve(
    String(request.outputDirectoryPath || "").trim() || app.getPath("downloads")
  );
  await mkdir(outputDirectoryPath, { recursive: true });
  const outputPath = await resolveUniqueOutputPath(
    outputDirectoryPath,
    deriveOutputFileName(request.inputFileName, request.operation)
  );
  const commandArgs = buildMediaToolArgs({
    inputUrl,
    operation: request.operation,
    outputPath
  });
  return new Promise((resolve) => {
    const stderr = [];
    const child = spawn(ffmpegPath, commandArgs, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(String(chunk));
    });
    child.once("error", (error) => {
      resolve({
        commandArgs,
        error: error.message || "媒体处理失败",
        ffmpegPath,
        ok: false,
        outputPath
      });
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve({
          commandArgs,
          ffmpegPath,
          ok: true,
          outputPath
        });
        return;
      }
      resolve({
        commandArgs,
        error: stderr.join("").trim() || `ffmpeg 退出码异常: ${code}`,
        ffmpegPath,
        ok: false,
        outputPath
      });
    });
  });
}
function registerMediaToolIpc(ipcMain2) {
  ipcMain2.handle("media-tool:process-file", async (_event, payload) => processMediaToolFile(payload));
}
const execFileAsync = promisify(execFile);
const CACHE_DIR_NAME = "gallery-preview-cache";
const IMAGE_PREVIEW_PROTOCOL = "omniflow-preview";
const HEIC_EXTENSIONS = /* @__PURE__ */ new Set(["heic", "heif", "heics", "heifs"]);
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH || "",
  "ffmpeg",
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg"
].filter(Boolean);
const SIPS_PATH = "/usr/bin/sips";
function normalizeExt(ext) {
  return String(ext || "").trim().toLowerCase().replace(/^\./, "");
}
function isHeicRequest(payload) {
  const mimeType = String(payload.mimeType || "").toLowerCase();
  return HEIC_EXTENSIONS.has(normalizeExt(payload.ext)) || mimeType === "image/heic" || mimeType === "image/heif" || mimeType === "image/heic-sequence" || mimeType === "image/heif-sequence";
}
function buildCacheKey(payload) {
  const libraryId = Number(payload.libraryId || 0);
  const nodeId = Number(payload.nodeId || 0);
  const sourceVersion = String(payload.sourceVersion || "").trim();
  let sourcePath = "";
  try {
    const parsedUrl = new URL(payload.url);
    sourcePath = `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    sourcePath = payload.url || "";
  }
  const sourceSignature = `${payload.fileName || ""}|${payload.ext || ""}|${payload.fileSize || ""}|${sourceVersion || sourcePath}`;
  if (libraryId > 0 && nodeId > 0) {
    const sourceHash = crypto.createHash("sha256").update(sourceSignature).digest("hex").slice(0, 12);
    return `${libraryId}-${nodeId}-${sourceHash}`;
  }
  if (nodeId > 0) {
    const fileHash = crypto.createHash("sha256").update(sourceSignature).digest("hex").slice(0, 12);
    return `node-${nodeId}-${fileHash}`;
  }
  const hash = crypto.createHash("sha256").update(sourceSignature).digest("hex").slice(0, 24);
  return `url-${hash}`;
}
function getCacheRoot() {
  return path.join(app.getPath("userData"), CACHE_DIR_NAME);
}
function getCachePaths(cacheKey) {
  const root = getCacheRoot();
  return {
    inputPath: path.join(root, `${cacheKey}.source.heic`),
    metadataPath: path.join(root, `${cacheKey}.json`),
    previewPath: path.join(root, `${cacheKey}.png`)
  };
}
function isSafeCacheKey(input) {
  return /^[a-z0-9-]+$/i.test(input);
}
function buildPreviewUrl(cacheKey) {
  return `${IMAGE_PREVIEW_PROTOCOL}://image-preview/${encodeURIComponent(cacheKey)}.png`;
}
function registerImagePreviewProtocol() {
  if (protocol.isProtocolHandled(IMAGE_PREVIEW_PROTOCOL)) return;
  protocol.handle(IMAGE_PREVIEW_PROTOCOL, async (request) => {
    const parsedUrl = new URL(request.url);
    if (parsedUrl.hostname !== "image-preview") {
      return new Response("Not Found", { status: 404 });
    }
    const fileName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
    const cacheKey = fileName.replace(/\.png$/i, "");
    if (!cacheKey || !isSafeCacheKey(cacheKey)) {
      return new Response("Bad Request", { status: 400 });
    }
    const { previewPath } = getCachePaths(cacheKey);
    try {
      const previewBuffer = await fs.readFile(previewPath);
      return new Response(previewBuffer, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "image/png"
        }
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  });
}
async function readCachedResult(cacheKey) {
  const { metadataPath, previewPath } = getCachePaths(cacheKey);
  const [metadataRaw, hasPreview] = await Promise.all([
    fs.readFile(metadataPath, "utf-8").catch(() => ""),
    fs.access(previewPath).then(() => true).catch(() => false)
  ]);
  if (!metadataRaw || !hasPreview) return null;
  const metadata = JSON.parse(metadataRaw);
  return {
    ok: true,
    cacheKey,
    metadataRows: Array.isArray(metadata.metadataRows) ? metadata.metadataRows : [],
    originalSize: Number(metadata.originalSize || 0) || void 0,
    previewPath,
    previewUrl: buildPreviewUrl(cacheKey)
  };
}
async function resolveExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-version"], { timeout: 5e3 });
      return candidate;
    } catch {
    }
  }
  return null;
}
function parseSipsRows(output) {
  const rows = [];
  const map = /* @__PURE__ */ new Map();
  output.split(/\r?\n/).forEach((line) => {
    const match = /^\s*([A-Za-z][A-Za-z0-9]+):\s*(.*?)\s*$/.exec(line);
    if (match) map.set(match[1], match[2]);
  });
  const width = map.get("pixelWidth");
  const height = map.get("pixelHeight");
  if (width && height) rows.push({ label: "尺寸", value: `${width} × ${height}` });
  const creation = map.get("creation");
  if (creation) rows.push({ label: "拍摄时间", value: creation.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") });
  const make = map.get("make");
  if (make) rows.push({ label: "相机品牌", value: make });
  const model = map.get("model");
  if (model) rows.push({ label: "相机型号", value: model });
  const software = map.get("software");
  if (software) rows.push({ label: "软件", value: software });
  const profile = map.get("profile");
  if (profile) rows.push({ label: "色彩配置", value: profile });
  const space = map.get("space");
  if (space) rows.push({ label: "色彩空间", value: space });
  const dpiWidth = map.get("dpiWidth");
  const dpiHeight = map.get("dpiHeight");
  if (dpiWidth && dpiHeight) rows.push({ label: "DPI", value: `${dpiWidth} × ${dpiHeight}` });
  const bitsPerSample = map.get("bitsPerSample");
  if (bitsPerSample) rows.push({ label: "位深", value: bitsPerSample });
  return rows;
}
async function readSipsMetadata(inputPath) {
  try {
    const { stdout } = await execFileAsync(SIPS_PATH, ["-g", "all", inputPath], { timeout: 15e3 });
    return parseSipsRows(stdout);
  } catch {
    return [];
  }
}
async function convertHeicToPng(inputPath, outputPath) {
  const ffmpegPath = await resolveExecutable(FFMPEG_CANDIDATES);
  if (!ffmpegPath) {
    throw new Error("未找到 ffmpeg，无法生成 HEIC 预览");
  }
  await execFileAsync(ffmpegPath, [
    "-v",
    "error",
    "-y",
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-update",
    "1",
    outputPath
  ], {
    timeout: 6e4,
    maxBuffer: 1024 * 1024 * 8
  });
}
function registerImagePreviewIpc(ipcMain2) {
  ipcMain2.handle("image-preview:prepare", async (_event, payload) => {
    const url = String((payload == null ? void 0 : payload.url) || "").trim();
    if (!url) {
      return { ok: false, error: "缺少图片访问链接", metadataRows: [] };
    }
    if (!isHeicRequest(payload)) {
      return { ok: false, error: "当前只支持 HEIC / HEIF 预览代理", metadataRows: [] };
    }
    const cacheKey = buildCacheKey(payload);
    const cached = await readCachedResult(cacheKey).catch(() => null);
    if (cached) return cached;
    const paths = getCachePaths(cacheKey);
    await fs.mkdir(path.dirname(paths.previewPath), { recursive: true });
    try {
      await downloadUrlToFile(url, paths.inputPath);
      const inputStat = await fs.stat(paths.inputPath).catch(() => null);
      const metadataRows = await readSipsMetadata(paths.inputPath);
      await convertHeicToPng(paths.inputPath, paths.previewPath);
      const result = {
        ok: true,
        cacheKey,
        metadataRows,
        originalSize: inputStat == null ? void 0 : inputStat.size,
        previewPath: paths.previewPath,
        previewUrl: buildPreviewUrl(cacheKey)
      };
      await fs.writeFile(paths.metadataPath, JSON.stringify({
        cacheKey,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        metadataRows,
        originalExt: normalizeExt(payload.ext),
        originalSize: inputStat == null ? void 0 : inputStat.size,
        previewPath: paths.previewPath
      }), "utf-8");
      return result;
    } catch (error) {
      return {
        ok: false,
        error: (error == null ? void 0 : error.message) || "生成 HEIC 预览失败",
        metadataRows: []
      };
    } finally {
      await fs.rm(paths.inputPath, { force: true }).catch(() => void 0);
    }
  });
}
function registerIpcHandlers() {
  registerFileIpc(ipcMain);
  registerSystemIpc(ipcMain);
  registerHttpIpc(ipcMain);
  registerMediaToolIpc(ipcMain);
  registerImagePreviewIpc(ipcMain);
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
  ipcMain.handle("embedded-browser:clear-cache-reload", async (_event, tabId) => handlers.clearBrowserCache(tabId));
  ipcMain.handle("embedded-browser:reset-page-storage", async (_event, tabId) => handlers.resetPageStorage(tabId));
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
    "embedded-browser:resource:transcode",
    async (_event, tabId, payload) => handlers.transcodeResource(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:download-hls",
    async (_event, tabId, payload) => handlers.downloadHlsManifest(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:start-hls-recording",
    async (_event, tabId, payload) => handlers.startHlsRecording(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:stop-hls-recording",
    async (_event, tabId, payload) => handlers.stopHlsRecording(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:discard-hls-recording",
    async (_event, tabId, payload) => handlers.discardHlsRecording(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:download-hls-tracks",
    async (_event, tabId, payload) => handlers.downloadHlsTracks(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:download-hls-plan",
    async (_event, tabId, payload) => handlers.downloadHlsPlan(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:retry-hls-plan-failed",
    async (_event, tabId, payload) => handlers.retryHlsPlanFailed(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:download-mpd",
    async (_event, tabId, payload) => handlers.downloadMpdManifest(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:download-mpd-plan",
    async (_event, tabId, payload) => handlers.downloadMpdPlan(tabId, payload)
  );
  ipcMain.handle(
    "embedded-browser:resource:download-direct-file",
    async (_event, tabId, payload) => handlers.downloadDirectFile(tabId, payload)
  );
  ipcMain.handle("embedded-browser:resource:start-deep-capture", async (_event, tabId) => handlers.startDeepResourceCapture(tabId));
  ipcMain.handle("embedded-browser:set-bounds", (event, bounds) => handlers.setBounds(event.sender, bounds));
  ipcMain.handle("embedded-browser:close-tab", (event, tabId) => handlers.closeTab(event.sender, tabId));
  ipcMain.handle("embedded-browser:cleanup-download-file", async (_event, tempPath) => handlers.cleanupDownloadFile(tempPath));
  ipcMain.handle("embedded-browser:deactivate", (event) => handlers.deactivate(event.sender));
  ipcMain.handle("embedded-browser:close-all", (event) => handlers.closeAll(event.sender));
  ipcMain.handle("embedded-browser:cookie:get", async (_event, filter) => handlers.getCookies(filter));
  ipcMain.handle("embedded-browser:cookie:remove", async (_event, url, name) => handlers.removeCookie(url, name));
  ipcMain.handle("embedded-browser:cookie:remove-domain", async (_event, domain) => handlers.removeCookiesByDomain(domain));
  ipcMain.handle("embedded-browser:cookie:remove-all", async () => handlers.removeAllCookies());
  ipcMain.handle("embedded-browser:resource-capture-rules:get", async () => handlers.getResourceCaptureRules());
  ipcMain.handle("embedded-browser:resource-capture-rules:update", async (_event, ruleSet) => handlers.updateResourceCaptureRules(ruleSet));
  ipcMain.handle("embedded-browser:resource-capture-rules:reset", async () => handlers.resetResourceCaptureRules());
  ipcMain.handle("embedded-browser:external-tools:get", async () => handlers.getExternalToolSettings());
  ipcMain.handle("embedded-browser:external-tools:update", async (_event, settings) => handlers.updateExternalToolSettings(settings));
  ipcMain.handle("embedded-browser:external-tools:reset", async () => handlers.resetExternalToolSettings());
  ipcMain.handle("embedded-browser:external-tools:list-enabled", async () => handlers.listEnabledExternalTools());
  ipcMain.handle(
    "embedded-browser:external-tools:dispatch",
    async (_event, toolKey, payload) => handlers.dispatchExternalTool(toolKey, payload)
  );
  ipcMain.handle("embedded-browser:password:list", () => handlers.listPasswords());
  ipcMain.handle("embedded-browser:password:get-decrypted", async (_event, id) => handlers.getDecryptedPassword(id));
  ipcMain.handle("embedded-browser:password:save-captured", async (_event, credentialRequestId) => handlers.saveCapturedCredential(credentialRequestId));
  ipcMain.handle("embedded-browser:password:delete", (_event, id) => handlers.deletePassword(id));
  ipcMain.handle("embedded-browser:password:delete-all", () => handlers.deleteAllPasswords());
  ipcMain.handle("embedded-browser:password:blacklist-domain", (_event, domain) => handlers.blacklistDomain(domain));
  ipcMain.handle("embedded-browser:password:is-blacklisted", (_event, domain) => handlers.isBlacklistedDomain(domain));
  ipcMain.handle("embedded-browser:password:auto-fill", async (_event, tabId, passwordId) => handlers.autoFillPassword(tabId, passwordId));
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
  var _a2, _b;
  return {
    downloadId: overrides.downloadId,
    fileName: overrides.fileName,
    mimeType: overrides.mimeType,
    pageUrl: overrides.pageUrl,
    receivedBytes: overrides.receivedBytes ?? Math.max(0, Number(((_a2 = item.getReceivedBytes) == null ? void 0 : _a2.call(item)) || 0)),
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
function buildCookieRemoveUrl(cookie) {
  const domain = cookie.domain.replace(/^\./, "");
  const scheme = cookie.secure ? "https" : "http";
  return `${scheme}://${domain}${cookie.path}`;
}
function mapElectronCookie(raw) {
  return {
    name: raw.name,
    value: raw.value,
    domain: raw.domain ?? "",
    path: raw.path ?? "/",
    secure: raw.secure ?? false,
    httpOnly: raw.httpOnly ?? false,
    sameSite: raw.sameSite ?? "unspecified",
    expirationDate: raw.expirationDate,
    session: raw.session ?? false
  };
}
async function getEmbeddedBrowserCookies(filter) {
  const browserSession = getEmbeddedBrowserSession();
  const raw = await browserSession.cookies.get(filter ?? {});
  return raw.map(mapElectronCookie);
}
async function removeEmbeddedBrowserCookie(url, name) {
  const browserSession = getEmbeddedBrowserSession();
  await browserSession.cookies.remove(url, name);
}
async function removeEmbeddedBrowserCookiesByDomain(domain) {
  const normalizedDomain = String(domain || "").trim();
  if (!normalizedDomain) {
    return;
  }
  const cookies = await getEmbeddedBrowserCookies({ domain: normalizedDomain });
  for (const cookie of cookies) {
    await removeEmbeddedBrowserCookie(buildCookieRemoveUrl(cookie), cookie.name);
  }
}
async function removeAllEmbeddedBrowserCookies() {
  const cookies = await getEmbeddedBrowserCookies();
  for (const cookie of cookies) {
    await removeEmbeddedBrowserCookie(buildCookieRemoveUrl(cookie), cookie.name);
  }
  await getEmbeddedBrowserSession().cookies.flushStore();
}
const STORE_FILE_NAME$2 = "embedded-browser-passwords.json";
const CREDENTIAL_CACHE_TTL_MS = 6e4;
let cachedStore = null;
const credentialCache = /* @__PURE__ */ new Map();
function getStorePath() {
  return path.join(app.getPath("userData"), STORE_FILE_NAME$2);
}
function loadPasswordStore() {
  if (cachedStore) {
    return cachedStore;
  }
  const storePath = getStorePath();
  if (!existsSync(storePath)) {
    cachedStore = { passwords: [], blacklistedDomains: [] };
    return cachedStore;
  }
  try {
    const raw = readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    cachedStore = {
      passwords: Array.isArray(parsed.passwords) ? parsed.passwords : [],
      blacklistedDomains: Array.isArray(parsed.blacklistedDomains) ? parsed.blacklistedDomains : []
    };
    return cachedStore;
  } catch (error) {
    runtimeLogger.warn("embedded browser password store load failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    cachedStore = { passwords: [], blacklistedDomains: [] };
    return cachedStore;
  }
}
function savePasswordStore(store) {
  cachedStore = store;
  const storePath = getStorePath();
  const storeDir = path.dirname(storePath);
  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true });
  }
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
}
function toEntry(saved) {
  return {
    id: saved.id,
    domain: saved.domain,
    username: saved.username,
    pageUrl: saved.pageUrl,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt
  };
}
function listEmbeddedBrowserPasswords() {
  const store = loadPasswordStore();
  return store.passwords.map(toEntry);
}
function getEmbeddedBrowserPasswordsForDomain(domain) {
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  if (!normalizedDomain) {
    return [];
  }
  const store = loadPasswordStore();
  return store.passwords.filter((p) => p.domain === normalizedDomain).sort((a, b) => b.updatedAt - a.updatedAt).map(toEntry);
}
function decryptEmbeddedBrowserPasswordForAutoFill(id) {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }
  const store = loadPasswordStore();
  const entry = store.passwords.find((p) => p.id === id);
  if (!entry) {
    return null;
  }
  try {
    const buffer = Buffer.from(entry.encryptedPassword, "base64");
    return safeStorage.decryptString(buffer);
  } catch {
    return null;
  }
}
function hasEmbeddedBrowserMatchingPassword(domain, username) {
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  const normalizedUsername = String(username || "").trim();
  if (!normalizedDomain || !normalizedUsername) {
    return false;
  }
  const store = loadPasswordStore();
  return store.passwords.some((p) => p.domain === normalizedDomain && p.username === normalizedUsername);
}
function saveEmbeddedBrowserPassword(credential) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统加密服务不可用，无法保存密码");
  }
  const store = loadPasswordStore();
  const encryptedPassword = safeStorage.encryptString(credential.password).toString("base64");
  const now = Date.now();
  const existing = store.passwords.find(
    (p) => p.domain === credential.domain && p.username === credential.username
  );
  if (existing) {
    existing.encryptedPassword = encryptedPassword;
    existing.pageUrl = credential.pageUrl;
    existing.updatedAt = now;
    savePasswordStore(store);
    return toEntry(existing);
  }
  const newEntry = {
    id: crypto.randomUUID(),
    domain: credential.domain,
    username: credential.username,
    encryptedPassword,
    pageUrl: credential.pageUrl,
    createdAt: now,
    updatedAt: now
  };
  store.passwords.push(newEntry);
  savePasswordStore(store);
  return toEntry(newEntry);
}
function deleteEmbeddedBrowserPassword(id) {
  const store = loadPasswordStore();
  const index = store.passwords.findIndex((p) => p.id === id);
  if (index === -1) {
    return false;
  }
  store.passwords.splice(index, 1);
  savePasswordStore(store);
  return true;
}
function deleteAllEmbeddedBrowserPasswords() {
  const store = loadPasswordStore();
  store.passwords = [];
  savePasswordStore(store);
}
async function getEmbeddedBrowserDecryptedPassword(id) {
  if (process.platform === "darwin") {
    await systemPreferences.promptTouchID("查看已保存的密码");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统加密服务不可用");
  }
  const store = loadPasswordStore();
  const entry = store.passwords.find((p) => p.id === id);
  if (!entry) {
    throw new Error("密码条目不存在");
  }
  const buffer = Buffer.from(entry.encryptedPassword, "base64");
  return safeStorage.decryptString(buffer);
}
function addEmbeddedBrowserBlacklistedDomain(domain) {
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  if (!normalizedDomain) {
    return;
  }
  const store = loadPasswordStore();
  if (!store.blacklistedDomains.includes(normalizedDomain)) {
    store.blacklistedDomains.push(normalizedDomain);
    savePasswordStore(store);
  }
}
function isEmbeddedBrowserBlacklistedDomain(domain) {
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  if (!normalizedDomain) {
    return false;
  }
  const store = loadPasswordStore();
  return store.blacklistedDomains.includes(normalizedDomain);
}
function cacheEmbeddedBrowserCredential(credential) {
  const requestId = crypto.randomUUID();
  const timer = setTimeout(() => {
    credentialCache.delete(requestId);
  }, CREDENTIAL_CACHE_TTL_MS);
  credentialCache.set(requestId, { credential, timer });
  return requestId;
}
function consumeEmbeddedBrowserCachedCredential(requestId) {
  const entry = credentialCache.get(requestId);
  if (!entry) {
    return null;
  }
  clearTimeout(entry.timer);
  credentialCache.delete(requestId);
  return entry.credential;
}
const STORE_FILE_NAME$1 = "embedded-browser-resource-capture-rules.json";
const CAPTURE_RULE_SCHEMA_VERSION = 2;
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
  "ttml",
  "lrc",
  "qrc",
  "krc",
  "yrc",
  "trc",
  "ksc",
  "sbv",
  "dfxp",
  "smi",
  "sami",
  "scc",
  "stl",
  "sub",
  "idx",
  "sup",
  "lyric",
  "lyrics",
  "webvtt"
];
const catCatchExpandedSubtitleExtensions = [
  "lrc",
  "qrc",
  "krc",
  "yrc",
  "trc",
  "ksc",
  "sbv",
  "dfxp",
  "smi",
  "sami",
  "scc",
  "stl",
  "sub",
  "idx",
  "sup",
  "lyric",
  "lyrics",
  "webvtt"
];
const catCatchKeyExtensions = [
  "key",
  "base64key"
];
const catCatchMediaMimeTypes = [
  "application/ogg",
  "application/m4s"
];
const catCatchSubtitleMimeTypes = [
  "text/vtt",
  "text/srt",
  "text/x-srt",
  "text/x-ass",
  "text/x-ssa",
  "application/x-subrip",
  "application/ttml+xml",
  "application/x-srt",
  "application/x-subtitle"
];
const catCatchSubtitleMimeTypeIncludes = [
  "subrip",
  "subtitle",
  "ttml+xml"
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
const catCatchDefaultRegexRules = [
  {
    builtIn: true,
    enabled: false,
    ext: "json",
    flags: "ig",
    id: "iqiyi-json",
    label: "爱奇艺 JSON",
    pattern: String.raw`https://cache\.video\.[a-z]*\.com/dash\?tvid=.*`
  },
  {
    blacklist: true,
    builtIn: true,
    enabled: true,
    ext: "",
    flags: "ig",
    id: "bilibili-live-m4s",
    label: "B 站直播 m4s 屏蔽",
    pattern: String.raw`.*\.bilivideo\.(com|cn).*\/live-bvc\/.*m4s`
  },
  {
    builtIn: true,
    enabled: false,
    ext: "",
    flags: "ig",
    id: "instagram-bytestart",
    label: "Instagram bytestart 收敛",
    pattern: String.raw`(^https://scontent[a-z0-9-]*\.cdninstagram\.com/.*)&bytestart=.*`
  },
  {
    builtIn: true,
    enabled: false,
    ext: "",
    flags: "ig",
    id: "facebook-bytestart",
    label: "Facebook bytestart 收敛",
    pattern: String.raw`(^https://.*\.fbcdn\.net/.*)&bytestart=.*`
  }
];
const defaultCaptureExtensions = [
  ...catCatchManifestExtensions,
  ...catCatchMediaExtensions,
  ...catCatchImageExtensions,
  ...catCatchSubtitleExtensions,
  ...catCatchKeyExtensions
];
const defaultCaptureMimeTypes = [
  "video/*",
  "audio/*",
  ...catCatchMediaMimeTypes,
  ...catCatchSubtitleMimeTypes,
  "application/x-mpegurl",
  "application/vnd.apple.mpegurl",
  "application/dash+xml"
];
let cachedRuleSet = null;
const catCatchManifestExtensionSet = new Set(catCatchManifestExtensions);
const catCatchMediaExtensionSet = new Set(catCatchMediaExtensions);
const catCatchImageExtensionSet = new Set(catCatchImageExtensions);
const catCatchSubtitleExtensionSet = new Set(catCatchSubtitleExtensions);
const catCatchKeyExtensionSet = new Set(catCatchKeyExtensions);
const catCatchMediaMimeTypeSet = new Set(catCatchMediaMimeTypes);
const catCatchSubtitleMimeTypeSet = new Set(catCatchSubtitleMimeTypes);
const catCatchRelevantRequestHeaderSet = new Set(catCatchRelevantRequestHeaders);
function getRuleStorePath() {
  return path.join(app.getPath("userData"), STORE_FILE_NAME$1);
}
function normalizeExtension(value) {
  return String(value || "").trim().replace(/^\./, "").toLowerCase();
}
function normalizeMimeTypePattern(value) {
  return String(value || "").trim().toLowerCase();
}
function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase();
}
function inferExtensionFromUrl$1(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return (match == null ? void 0 : match[1]) || "";
  } catch {
    const match = String(url || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (match == null ? void 0 : match[1]) || "";
  }
}
function createDefaultRuleSet() {
  return {
    domainBlacklist: [],
    domainWhitelist: [],
    extensions: defaultCaptureExtensions.map(normalizeExtension),
    mimeTypes: defaultCaptureMimeTypes.map(normalizeMimeTypePattern),
    regexRules: catCatchDefaultRegexRules.map((rule) => ({
      ...rule,
      ext: normalizeExtension(rule.ext || "") || void 0
    })),
    version: CAPTURE_RULE_SCHEMA_VERSION
  };
}
function normalizeRegexRule(rule) {
  const pattern = String(rule.pattern || "").trim();
  if (!pattern) {
    return null;
  }
  const flags = String(rule.flags || "").trim() || "ig";
  try {
    new RegExp(pattern, flags);
  } catch {
    return null;
  }
  return {
    blacklist: Boolean(rule.blacklist),
    builtIn: Boolean(rule.builtIn),
    enabled: rule.enabled !== false,
    ext: normalizeExtension(rule.ext || "") || void 0,
    flags,
    id: String(rule.id || "").trim() || crypto.randomUUID(),
    label: String(rule.label || "").trim() || "未命名规则",
    pattern
  };
}
function normalizeRuleSet(input) {
  const defaults = createDefaultRuleSet();
  const inputVersion = Number((input == null ? void 0 : input.version) || 0);
  const shouldAppendNewDefaults = inputVersion < CAPTURE_RULE_SCHEMA_VERSION;
  const extensions = Array.from(/* @__PURE__ */ new Set([
    ...((input == null ? void 0 : input.extensions) || defaults.extensions).map(normalizeExtension).filter(Boolean),
    ...shouldAppendNewDefaults ? catCatchExpandedSubtitleExtensions.map(normalizeExtension) : []
  ]));
  const mimeTypes = Array.from(/* @__PURE__ */ new Set([
    ...((input == null ? void 0 : input.mimeTypes) || defaults.mimeTypes).map(normalizeMimeTypePattern).filter(Boolean),
    ...shouldAppendNewDefaults ? catCatchSubtitleMimeTypes.map(normalizeMimeTypePattern) : []
  ]));
  const regexRules = Array.isArray(input == null ? void 0 : input.regexRules) ? input == null ? void 0 : input.regexRules.map(normalizeRegexRule).filter(Boolean) : defaults.regexRules;
  return {
    domainBlacklist: Array.from(new Set(((input == null ? void 0 : input.domainBlacklist) || []).map(normalizeDomain).filter(Boolean))),
    domainWhitelist: Array.from(new Set(((input == null ? void 0 : input.domainWhitelist) || []).map(normalizeDomain).filter(Boolean))),
    extensions,
    mimeTypes,
    regexRules,
    version: CAPTURE_RULE_SCHEMA_VERSION
  };
}
function loadStoredRuleSet() {
  if (cachedRuleSet) {
    return cachedRuleSet;
  }
  const storePath = getRuleStorePath();
  if (!existsSync(storePath)) {
    cachedRuleSet = createDefaultRuleSet();
    return cachedRuleSet;
  }
  try {
    const raw = readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    cachedRuleSet = normalizeRuleSet(parsed);
    if (cachedRuleSet.version !== parsed.version) {
      saveStoredRuleSet(cachedRuleSet);
    }
    return cachedRuleSet;
  } catch {
    cachedRuleSet = createDefaultRuleSet();
    return cachedRuleSet;
  }
}
function saveStoredRuleSet(ruleSet) {
  cachedRuleSet = ruleSet;
  const storePath = getRuleStorePath();
  const storeDir = path.dirname(storePath);
  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true });
  }
  writeFileSync(storePath, JSON.stringify(ruleSet, null, 2), "utf-8");
}
function extractHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
function matchesDomainRule(hostname, domain) {
  const normalizedHostname = normalizeDomain(hostname);
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedHostname || !normalizedDomain) {
    return false;
  }
  return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`);
}
function matchesMimePattern(mimeType, pattern) {
  const normalizedMime = normalizeMimeTypePattern(mimeType);
  const normalizedPattern = normalizeMimeTypePattern(pattern);
  if (!normalizedMime || !normalizedPattern) {
    return false;
  }
  if (normalizedPattern.endsWith("/*")) {
    return normalizedMime.startsWith(`${normalizedPattern.slice(0, -1)}`);
  }
  return normalizedMime === normalizedPattern;
}
function listEmbeddedBrowserResourceCaptureRules() {
  return loadStoredRuleSet();
}
function updateEmbeddedBrowserResourceCaptureRules(input) {
  const normalized = normalizeRuleSet(input);
  saveStoredRuleSet(normalized);
  return normalized;
}
function resetEmbeddedBrowserResourceCaptureRules() {
  const nextRuleSet = createDefaultRuleSet();
  saveStoredRuleSet(nextRuleSet);
  return nextRuleSet;
}
function isCatCatchManifestMimeType(normalizedMimeType) {
  return catCatchManifestMimeTypeIncludes.some((value) => normalizedMimeType.includes(value));
}
function isCatCatchMediaMimeType(normalizedMimeType) {
  return normalizedMimeType.startsWith("video/") || normalizedMimeType.startsWith("audio/") || catCatchMediaMimeTypeSet.has(normalizedMimeType);
}
function isCatCatchSubtitleMimeType(normalizedMimeType) {
  return catCatchSubtitleMimeTypeSet.has(normalizedMimeType) || catCatchSubtitleMimeTypeIncludes.some((value) => normalizedMimeType.includes(value));
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
function matchCatCatchRegexRule(url, rules = loadStoredRuleSet().regexRules) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return null;
  }
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    const regex = new RegExp(rule.pattern, rule.flags);
    const match = regex.exec(normalizedUrl);
    if (!match) {
      continue;
    }
    if (rule.blacklist) {
      return {
        blacklist: true,
        ext: rule.ext || void 0,
        url: normalizedUrl
      };
    }
    if (match.length <= 1) {
      return {
        blacklist: false,
        ext: rule.ext || void 0,
        url: normalizedUrl
      };
    }
    const rewrittenPath = match.slice(1).map((value) => decodeURIComponent(value)).join("");
    let rewrittenUrl = rewrittenPath;
    if (rewrittenUrl && !/^https?:\/\//i.test(rewrittenUrl)) {
      try {
        const parsedUrl = new URL(normalizedUrl);
        rewrittenUrl = `${parsedUrl.protocol}//${parsedUrl.host}${rewrittenUrl}`;
      } catch {
        rewrittenUrl = normalizedUrl;
      }
    }
    return {
      blacklist: false,
      ext: rule.ext || void 0,
      url: rewrittenUrl || normalizedUrl
    };
  }
  return null;
}
function evaluateEmbeddedBrowserResourceCapture(input) {
  const normalizedUrl = String(input.url || "").trim();
  if (!normalizedUrl || normalizedUrl.startsWith("data:")) {
    return null;
  }
  const ruleSet = loadStoredRuleSet();
  const hostname = extractHostname(normalizedUrl) || extractHostname(String(input.pageUrl || "").trim());
  if (ruleSet.domainWhitelist.length > 0 && hostname && !ruleSet.domainWhitelist.some((domain) => matchesDomainRule(hostname, domain))) {
    return null;
  }
  if (hostname && ruleSet.domainBlacklist.some((domain) => matchesDomainRule(hostname, domain))) {
    return null;
  }
  const regexMatch = matchCatCatchRegexRule(normalizedUrl, ruleSet.regexRules);
  if (regexMatch == null ? void 0 : regexMatch.blacklist) {
    return null;
  }
  const resolvedUrl = (regexMatch == null ? void 0 : regexMatch.url) || normalizedUrl;
  const extHint = normalizeExtension((regexMatch == null ? void 0 : regexMatch.ext) || input.ext || inferExtensionFromUrl$1(resolvedUrl)) || void 0;
  const normalizedMimeType = normalizeMimeTypePattern(input.mimeType || "");
  const matchedExtension = extHint ? ruleSet.extensions.includes(extHint) : false;
  const matchedMime = normalizedMimeType ? ruleSet.mimeTypes.some((pattern) => matchesMimePattern(normalizedMimeType, pattern)) : false;
  const hasTypeSignal = Boolean(extHint || normalizedMimeType);
  if (!regexMatch && hasTypeSignal && !matchedExtension && !matchedMime) {
    return null;
  }
  return {
    extHint,
    matchedByRuleSet: Boolean(regexMatch || matchedExtension || matchedMime),
    url: resolvedUrl
  };
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
  var _a2;
  return ((_a2 = String(input || "").split(";")[0]) == null ? void 0 : _a2.trim().toLowerCase()) || "";
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
  const extension = String(input.extHint || "").trim().toLowerCase() || getResourceExtension(input.url);
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
  if (extensionKind === "subtitle" || isCatCatchSubtitleMimeType(normalizedMimeType)) {
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
  if (/(^|[/_.-])audio([/_.-]|$)/.test(normalizedUrl)) {
    return "audio";
  }
  if (/(^|[/_.-])video([/_.-]|$)/.test(normalizedUrl)) {
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
  var _a2;
  return Boolean((_a2 = getEmbeddedBrowserTabCaptureState(tabId)) == null ? void 0 : _a2.deepCaptureEnabled);
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
    const rawUrl = String(details.url || "").trim();
    const requestContext = requestContextsByRequestId.get(details.id);
    const mimeType = normalizeMimeType(getHeaderValue(details.responseHeaders, "content-type"));
    const pageUrl = (targetWebContents == null ? void 0 : targetWebContents.getURL()) || void 0;
    const captureEvaluation = evaluateEmbeddedBrowserResourceCapture({
      ext: getResourceExtension(rawUrl) || void 0,
      mimeType,
      pageUrl,
      resourceType: details.resourceType,
      url: rawUrl
    });
    if (!captureEvaluation) {
      requestContextsByRequestId.delete(details.id);
      return;
    }
    const url = captureEvaluation.url;
    const kind = classifyCapturedResource({
      extHint: captureEvaluation.extHint,
      mimeType,
      resourceType: details.resourceType,
      url
    });
    if (!captureEvaluation.matchedByRuleSet && !shouldCaptureResource({ kind, resourceType: details.resourceType, url })) {
      requestContextsByRequestId.delete(details.id);
      return;
    }
    updateEmbeddedBrowserCapturedResource(tabId, {
      capturedAt: Date.now(),
      contentLength: parseContentRangeTotal(getHeaderValue(details.responseHeaders, "content-range")) || parseContentLength(getHeaderValue(details.responseHeaders, "content-length")),
      ext: captureEvaluation.extHint || getResourceExtension(url) || void 0,
      kind,
      method: details.method || void 0,
      mimeType,
      pageUrl,
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
  const captureEvaluation = evaluateEmbeddedBrowserResourceCapture({
    ext: payload.ext,
    mimeType: payload.mimeType,
    pageUrl: payload.pageUrl,
    resourceType: payload.resourceType,
    url
  });
  if (!captureEvaluation) {
    return null;
  }
  const resolvedUrl = captureEvaluation.url;
  const kind = payload.kind || classifyCapturedResource({
    extHint: captureEvaluation.extHint,
    mimeType: payload.mimeType,
    resourceType: payload.resourceType,
    url: resolvedUrl
  });
  if (!captureEvaluation.matchedByRuleSet && !shouldCaptureResource({ kind, resourceType: payload.resourceType, url: resolvedUrl })) {
    return null;
  }
  return updateEmbeddedBrowserCapturedResource(tabId, {
    capturedAt: Number(payload.capturedAt) || Date.now(),
    contentLength: payload.contentLength,
    ext: captureEvaluation.extHint || payload.ext,
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
      url: resolvedUrl
    }),
    url: resolvedUrl
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
  var _a2;
  const normalizedContentType = (_a2 = String(contentType || "").split(";")[0]) == null ? void 0 : _a2.trim();
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
  var _a2;
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
  const nodeID = Number(((_a2 = documentNode == null ? void 0 : documentNode.root) == null ? void 0 : _a2.nodeId) || 0);
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
function createEmbeddedBrowserResourceDrainMseScript(resourceKey) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.drainResource === 'function'
        ? probe.drainResource
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
async function drainEmbeddedBrowserMseResourceFromPage(executeScript, resourceKey) {
  const normalizedResourceKey = String(resourceKey || "").trim();
  if (!normalizedResourceKey) {
    return null;
  }
  const result = await executeScript(
    createEmbeddedBrowserResourceDrainMseScript(normalizedResourceKey)
  );
  if (!result || typeof result !== "object") {
    return null;
  }
  const payload = result;
  if (typeof payload.fileName !== "string") {
    return null;
  }
  return {
    base64: typeof payload.base64 === "string" ? payload.base64 : void 0,
    fileName: payload.fileName,
    mimeType: typeof payload.mimeType === "string" ? payload.mimeType : void 0,
    resourceKey: typeof payload.resourceKey === "string" ? payload.resourceKey : normalizedResourceKey,
    streamType: payload.streamType === "audio" || payload.streamType === "video" ? payload.streamType : void 0
  };
}
function createDefaultEmbeddedBrowserExternalToolSettings() {
  return {
    aria2: {
      downloadDir: "",
      enabled: false,
      label: "aria2 RPC",
      rpcUrl: "http://localhost:6800/jsonrpc",
      secret: ""
    },
    command: {
      enabled: false,
      label: "本地命令",
      template: 'N_m3u8DL-RE "{url}" --save-dir "{downloadDir}" --save-name "{filename}" {headerArgs}',
      workingDirectory: ""
    },
    protocol: {
      enabled: false,
      label: "m3u8dl URL 协议",
      urlTemplate: "m3u8dl:{url}"
    }
  };
}
function cloneEmbeddedBrowserExternalToolSettings(settings) {
  return {
    aria2: { ...settings.aria2 },
    command: { ...settings.command },
    protocol: { ...settings.protocol }
  };
}
function listEnabledEmbeddedBrowserExternalTools(settings) {
  const options = [];
  if (settings.aria2.enabled) {
    options.push({
      key: "aria2",
      label: settings.aria2.label || "aria2 RPC"
    });
  }
  if (settings.command.enabled) {
    options.push({
      key: "command",
      label: settings.command.label || "本地命令"
    });
  }
  if (settings.protocol.enabled) {
    options.push({
      key: "protocol",
      label: settings.protocol.label || "m3u8dl URL 协议"
    });
  }
  return options;
}
const STORE_FILE_NAME = "embedded-browser-external-tools.json";
let cachedSettings = null;
function getExternalToolStorePath() {
  return path.join(app.getPath("userData"), STORE_FILE_NAME);
}
function sanitizeLabel(value, fallback) {
  return String(value || "").trim() || fallback;
}
function normalizeSettings(input) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
  const defaults = createDefaultEmbeddedBrowserExternalToolSettings();
  return {
    aria2: {
      downloadDir: String(((_a2 = input == null ? void 0 : input.aria2) == null ? void 0 : _a2.downloadDir) || "").trim(),
      enabled: Boolean((_b = input == null ? void 0 : input.aria2) == null ? void 0 : _b.enabled),
      label: sanitizeLabel(((_c = input == null ? void 0 : input.aria2) == null ? void 0 : _c.label) || "", defaults.aria2.label),
      rpcUrl: String(((_d = input == null ? void 0 : input.aria2) == null ? void 0 : _d.rpcUrl) || defaults.aria2.rpcUrl).trim(),
      secret: String(((_e = input == null ? void 0 : input.aria2) == null ? void 0 : _e.secret) || "").trim()
    },
    command: {
      enabled: Boolean((_f = input == null ? void 0 : input.command) == null ? void 0 : _f.enabled),
      label: sanitizeLabel(((_g = input == null ? void 0 : input.command) == null ? void 0 : _g.label) || "", defaults.command.label),
      template: String(((_h = input == null ? void 0 : input.command) == null ? void 0 : _h.template) || defaults.command.template).trim(),
      workingDirectory: String(((_i = input == null ? void 0 : input.command) == null ? void 0 : _i.workingDirectory) || "").trim()
    },
    protocol: {
      enabled: Boolean((_j = input == null ? void 0 : input.protocol) == null ? void 0 : _j.enabled),
      label: sanitizeLabel(((_k = input == null ? void 0 : input.protocol) == null ? void 0 : _k.label) || "", defaults.protocol.label),
      urlTemplate: String(((_l = input == null ? void 0 : input.protocol) == null ? void 0 : _l.urlTemplate) || defaults.protocol.urlTemplate).trim()
    }
  };
}
function loadSettingsFromDisk() {
  const storePath = getExternalToolStorePath();
  if (!existsSync(storePath)) {
    return createDefaultEmbeddedBrowserExternalToolSettings();
  }
  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch (error) {
    runtimeLogger.warn("embedded browser external tool settings load failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return createDefaultEmbeddedBrowserExternalToolSettings();
  }
}
function persistSettings(settings) {
  const storePath = getExternalToolStorePath();
  const directoryPath = path.dirname(storePath);
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
  writeFileSync(storePath, JSON.stringify(settings, null, 2), "utf8");
}
function getSettings() {
  if (!cachedSettings) {
    cachedSettings = loadSettingsFromDisk();
  }
  return cloneEmbeddedBrowserExternalToolSettings(cachedSettings);
}
function resolveDownloadDirectory(preferredPath) {
  return String(preferredPath || "").trim() || path.join(os.homedir(), "Downloads");
}
function deriveFileName(input) {
  const explicit = String(input.fileName || "").trim();
  if (explicit) {
    return explicit;
  }
  const title = String(input.title || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
  if (title) {
    return title;
  }
  try {
    const pathname = new URL(input.url).pathname;
    const fileName = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "").replace(/[\\/:*?"<>|]+/g, "_").trim();
    if (fileName) {
      return fileName;
    }
  } catch {
  }
  return "captured-resource";
}
function buildDispatchContext(settings, input) {
  const headers = Object.fromEntries(
    Object.entries(input.headers || {}).filter(([headerName, headerValue]) => Boolean(String(headerName || "").trim()) && Boolean(String(headerValue || "").trim()))
  );
  const fileName = deriveFileName(input);
  const title = String(input.title || fileName).trim() || fileName;
  const downloadDir = resolveDownloadDirectory(settings.aria2.downloadDir);
  const referer = String(input.referer || input.pageUrl || headers.referer || headers.Referer || "").trim();
  const cookie = String(headers.cookie || headers.Cookie || "").trim();
  const userAgent = String(headers["user-agent"] || headers["User-Agent"] || "").trim();
  const headerArgs = Object.entries(headers).map(([headerName, headerValue]) => `--header "${headerName}: ${String(headerValue).replace(/"/g, '\\"')}"`).join(" ").trim();
  return {
    cookie,
    downloadDir,
    encodedUrl: encodeURIComponent(input.url),
    fileName,
    filename: fileName,
    headerArgs,
    headersJson: JSON.stringify(headers),
    mimeType: String(input.mimeType || "").trim(),
    pageUrl: String(input.pageUrl || "").trim(),
    referer,
    title,
    url: input.url,
    userAgent
  };
}
function applyTemplate(template, context) {
  return String(template || "").replace(/\{([a-zA-Z0-9]+)\}/g, (_match, key) => context[key] ?? "");
}
async function dispatchToAria2(settings, input) {
  const rpcUrl = String(settings.aria2.rpcUrl || "").trim();
  if (!rpcUrl) {
    throw new Error("请先填写 aria2 RPC 地址");
  }
  const parsedUrl = new URL(rpcUrl);
  const transport = parsedUrl.protocol === "https:" ? https : http;
  const context = buildDispatchContext(settings, input);
  const params = [];
  if (settings.aria2.secret) {
    params.push(`token:${settings.aria2.secret}`);
  }
  params.push([input.url]);
  params.push({
    dir: context.downloadDir,
    header: Object.entries(input.headers || {}).map(([headerName, headerValue]) => `${headerName}: ${headerValue}`),
    out: context.fileName,
    referer: context.referer || void 0,
    "user-agent": context.userAgent || void 0
  });
  const payload = JSON.stringify({
    id: `omniflow-${Date.now()}`,
    jsonrpc: "2.0",
    method: "aria2.addUri",
    params
  });
  await new Promise((resolve, reject) => {
    const request = transport.request({
      headers: {
        "content-length": Buffer.byteLength(payload),
        "content-type": "application/json"
      },
      hostname: parsedUrl.hostname,
      method: "POST",
      path: `${parsedUrl.pathname || "/"}${parsedUrl.search || ""}`,
      port: parsedUrl.port ? Number(parsedUrl.port) : void 0,
      protocol: parsedUrl.protocol
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        var _a2;
        const responseText = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          reject(new Error(`aria2 RPC 请求失败：HTTP ${response.statusCode || 0}`));
          return;
        }
        try {
          const parsed = JSON.parse(responseText);
          if ((_a2 = parsed.error) == null ? void 0 : _a2.message) {
            reject(new Error(parsed.error.message));
            return;
          }
        } catch {
        }
        resolve();
      });
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}
async function dispatchToProtocol(settings, input) {
  const template = String(settings.protocol.urlTemplate || "").trim();
  if (!template) {
    throw new Error("请先填写 URL 协议模板");
  }
  const targetUrl = applyTemplate(template, buildDispatchContext(settings, input));
  if (!targetUrl) {
    throw new Error("URL 协议模板展开后为空");
  }
  await shell.openExternal(targetUrl);
}
async function dispatchToCommand(settings, input) {
  const template = String(settings.command.template || "").trim();
  if (!template) {
    throw new Error("请先填写命令模板");
  }
  const command2 = applyTemplate(template, buildDispatchContext(settings, input)).trim();
  if (!command2) {
    throw new Error("命令模板展开后为空");
  }
  await new Promise((resolve, reject) => {
    const child = spawn(command2, {
      cwd: String(settings.command.workingDirectory || "").trim() || void 0,
      detached: true,
      shell: true,
      stdio: "ignore",
      windowsHide: true
    });
    let settled = false;
    let timer = null;
    const cleanup = () => {
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const resolveLaunch = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const rejectLaunch = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      runtimeLogger.warn("embedded browser external command spawn failed", {
        command: command2,
        error: error.message
      });
      reject(error);
    };
    child.once("error", (error) => {
      rejectLaunch(error instanceof Error ? error : new Error(String(error)));
    });
    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }
      if (typeof code === "number" && code !== 0) {
        rejectLaunch(new Error(`本地命令启动失败，退出码 ${code}`));
        return;
      }
      if (signal) {
        rejectLaunch(new Error(`本地命令启动失败，进程被 ${signal} 中断`));
        return;
      }
      resolveLaunch();
    });
    child.unref();
    timer = setTimeout(() => {
      resolveLaunch();
    }, 800);
  });
}
function listEmbeddedBrowserExternalToolSettings() {
  return getSettings();
}
function listEnabledEmbeddedBrowserExternalToolOptions() {
  return listEnabledEmbeddedBrowserExternalTools(getSettings());
}
function updateEmbeddedBrowserExternalToolSettings(nextSettings) {
  const normalizedSettings = normalizeSettings(nextSettings);
  cachedSettings = normalizedSettings;
  persistSettings(normalizedSettings);
  return cloneEmbeddedBrowserExternalToolSettings(normalizedSettings);
}
function resetEmbeddedBrowserExternalToolSettings() {
  const defaults = createDefaultEmbeddedBrowserExternalToolSettings();
  cachedSettings = defaults;
  persistSettings(defaults);
  return cloneEmbeddedBrowserExternalToolSettings(defaults);
}
async function dispatchEmbeddedBrowserExternalTool(toolKey, payload) {
  const settings = getSettings();
  if (!/^https?:\/\//i.test(String(payload.url || "").trim())) {
    throw new Error("只有 http(s) 资源可以发送到外部工具");
  }
  if (toolKey === "aria2") {
    if (!settings.aria2.enabled) {
      throw new Error("aria2 RPC 尚未启用");
    }
    await dispatchToAria2(settings, payload);
    return;
  }
  if (toolKey === "protocol") {
    if (!settings.protocol.enabled) {
      throw new Error("URL 协议工具尚未启用");
    }
    await dispatchToProtocol(settings, payload);
    return;
  }
  if (toolKey === "command") {
    if (!settings.command.enabled) {
      throw new Error("本地命令工具尚未启用");
    }
    await dispatchToCommand(settings, payload);
    return;
  }
  throw new Error("不支持的外部工具类型");
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
      clearMseFlushTimer(stream.streamId);
      if (stream.blobUrl) {
        URL.revokeObjectURL(stream.blobUrl);
        stream.blobUrl = "";
      }
      emitMseStreamReset(stream.streamId);
      stream.flushedBytes = 0;
      if (isCaptureComplete) {
        cleared = cleared || stream.buffers.length > 0;
        stream.buffers = [];
        stream.bufferCount = 0;
        stream.lastReportedBufferCount = 0;
        stream.lastReportedBytes = 0;
        stream.retainedBytes = 0;
        stream.totalBytes = 0;
        emitMseStream2(stream.streamId);
        return;
      }
      if (stream.buffers.length > 1) {
        const firstChunk = stream.buffers[0];
        stream.buffers = firstChunk ? [firstChunk] : [];
        stream.bufferCount = stream.buffers.length;
        stream.retainedBytes = (firstChunk == null ? void 0 : firstChunk.byteLength) || 0;
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
  function drainMseResource(resourceKey) {
    const streamId = String(resourceKey || "").replace(/^mse-stream:/, "");
    const stream = mseStreams.get(streamId);
    if (!stream) {
      return null;
    }
    clearMseFlushTimer(streamId);
    const retainedBuffers = normalizeBuffersForPlayback(stream.buffers);
    const retainedBuffer = retainedBuffers.length > 0 ? combineArrayBuffers(retainedBuffers) : null;
    stream.buffers = [];
    stream.retainedBytes = 0;
    stream.lastReportedBufferCount = stream.bufferCount;
    stream.lastReportedBytes = stream.totalBytes;
    emitMseStream2(streamId);
    return {
      base64: retainedBuffer && retainedBuffer.byteLength > 0 ? arrayBufferToBase64(retainedBuffer) : void 0,
      fileName: createMseExportName(streamId),
      mimeType: stream.mimeType,
      resourceKey,
      streamType: stream.streamType
    };
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
    drainResource(resourceKey) {
      const normalizedResourceKey = String(resourceKey || "");
      if (normalizedResourceKey.startsWith("mse-stream:")) {
        return drainMseResource(normalizedResourceKey);
      }
      return null;
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
  var _a2, _b, _c;
  const globalScope2 = globalThis;
  const isWorkerScope2 = typeof document === "undefined" && typeof globalScope2.importScripts === "function";
  const currentLocationHref2 = typeof ((_a2 = globalScope2.location) == null ? void 0 : _a2.href) === "string" ? globalScope2.location.href : "";
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
  const subtitleExtensions = /* @__PURE__ */ new Set([
    "vtt",
    "srt",
    "ass",
    "ssa",
    "ttml",
    "lrc",
    "qrc",
    "krc",
    "yrc",
    "trc",
    "ksc",
    "sbv",
    "dfxp",
    "smi",
    "sami",
    "scc",
    "stl",
    "sub",
    "idx",
    "sup",
    "lyric",
    "lyrics",
    "webvtt"
  ]);
  const keyExtensions = /* @__PURE__ */ new Set(["key", "base64key"]);
  const dataUrlPattern = /^data:(application|video|audio)\//i;
  const likelyUrlPattern = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i;
  const manifestPattern = /\.(m3u8|m3u|mpd)(\?|#|$)/i;
  const mediaPattern = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|hlv|f4v|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc|3gp)(\?|#|$)/i;
  const imagePattern = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|#|$)/i;
  const subtitlePattern = /\.(vtt|srt|ass|ssa|ttml|lrc|qrc|krc|yrc|trc|ksc|sbv|dfxp|smi|sami|scc|stl|sub|idx|sup|lyric|lyrics|webvtt)(\?|#|$)/i;
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
    var _a3;
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
      const matchedText = ((_a3 = matchedNode == null ? void 0 : matchedNode.textContent) == null ? void 0 : _a3.trim()) || "";
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
    var _a3, _b2;
    const manualFileName = sanitizeFileName2(catchToolkitState2.manualFileName);
    if (manualFileName !== "media") {
      return manualFileName;
    }
    let candidateName = "";
    const selectorRule = String(catchToolkitState2.selectorRule || "").trim();
    if (selectorRule && typeof document !== "undefined") {
      try {
        const matchedNode = document.querySelector(selectorRule);
        const matchedText = ((_a3 = matchedNode == null ? void 0 : matchedNode.textContent) == null ? void 0 : _a3.trim()) || "";
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
    var _a3;
    const extension = getExtension2(url);
    const normalizedMimeType = (_a3 = String(mimeType || "").split(";")[0]) == null ? void 0 : _a3.trim().toLowerCase();
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
    if (subtitleExtensions.has(extension) || normalizedMimeType.includes("text/vtt") || normalizedMimeType.includes("subrip") || normalizedMimeType.includes("subtitle") || normalizedMimeType.includes("ttml+xml") || normalizedMimeType === "text/srt" || normalizedMimeType === "text/x-srt" || normalizedMimeType === "text/x-ass" || normalizedMimeType === "text/x-ssa" || subtitlePattern.test(url)) {
      return "subtitle";
    }
    if (extension === "pdf" || normalizedMimeType === "application/pdf" || pdfPattern.test(url)) {
      return "document";
    }
    return "other";
  }
  function guessExtensionFromMimeType2(mimeType, streamType) {
    var _a3;
    const normalizedMimeType = (_a3 = String(mimeType || "").split(";")[0]) == null ? void 0 : _a3.trim().toLowerCase();
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
    var _a3;
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
        installedAt: ((_a3 = globalScope2.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__) == null ? void 0 : _a3.installedAt) || Date.now(),
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
  function emitProbeConsolePayload(payload) {
    try {
      originalConsoleInfo(consolePrefix + JSON.stringify(payload));
    } catch {
    }
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
  function emitMseStreamReset2(streamId) {
    emitProbeConsolePayload({
      capturedAt: Date.now(),
      event: "mse-reset",
      pageUrl: currentLocationHref2,
      resourceKey: createMseResourceKey(streamId)
    });
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
    emitProbeConsolePayload({
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
    });
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
    emitMseStreamReset2,
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
  var _a2, _b;
  globalScope.Worker;
  const mediaSourceConstructor = globalScope.MediaSource;
  if ((_a2 = mediaSourceConstructor == null ? void 0 : mediaSourceConstructor.prototype) == null ? void 0 : _a2.addSourceBuffer) {
    const originalAddSourceBuffer = mediaSourceConstructor.prototype.addSourceBuffer;
    mediaSourceConstructor.prototype.addSourceBuffer = new Proxy(originalAddSourceBuffer, {
      apply(target, thisArg, argumentsList) {
        var _a3;
        const sourceBuffer = Reflect.apply(target, thisArg, argumentsList);
        try {
          probeDiagnostics.mediaSourceHooked = true;
          probeDiagnostics.sourceBufferCount += 1;
          ensureTrackedMediaObserver();
          isCaptureComplete = false;
          const mediaSource = thisArg;
          const mimeType = String((argumentsList == null ? void 0 : argumentsList[0]) || "").trim();
          const normalizedMimeType = ((_a3 = mimeType.split(";")[0]) == null ? void 0 : _a3.trim().toLowerCase()) || "";
          const streamType = normalizedMimeType.startsWith("audio/") ? "audio" : normalizedMimeType.startsWith("video/") ? "video" : void 0;
          const streamId = `${Date.now()}-${++mseSequence}`;
          const existingStreamIds = mediaSourceStreams.get(mediaSource) || [];
          existingStreamIds.push(streamId);
          mediaSourceStreams.set(mediaSource, existingStreamIds);
          mseStreams.set(streamId, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            flushTimer: null,
            flushedBytes: 0,
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: mimeType || (streamType === "audio" ? "audio/mp4" : "video/mp4"),
            retainedBytes: 0,
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
                stream.retainedBytes += chunk.byteLength;
                stream.totalBytes += chunk.byteLength;
                probeDiagnostics.appendBufferCount += 1;
                probeDiagnostics.lastAppendAt = Date.now();
                const shouldReport = stream.bufferCount <= 3 || stream.bufferCount - stream.lastReportedBufferCount >= 8 || stream.totalBytes - stream.lastReportedBytes >= 1024 * 512;
                if (shouldReport) {
                  stream.lastReportedBufferCount = stream.bufferCount;
                  stream.lastReportedBytes = stream.totalBytes;
                  emitMseStream(streamId);
                }
                if (stream.retainedBytes >= MSE_FLUSH_THRESHOLD_BYTES) {
                  scheduleMseStreamFlush(streamId);
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
const EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX = "__OMNIFLOW_CREDENTIAL__:";
const EMBEDDED_BROWSER_AUTOFILL_CONSOLE_PREFIX = "__OMNIFLOW_AUTOFILL_READY__:";
function createCredentialDetectionScript() {
  const prefix = EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX;
  const autofillPrefix = EMBEDDED_BROWSER_AUTOFILL_CONSOLE_PREFIX;
  return `(function(){
  if(window.__OMNIFLOW_CREDENTIAL_DETECTION__)return;
  window.__OMNIFLOW_CREDENTIAL_DETECTION__=true;
  var PREFIX=${JSON.stringify(prefix)};
  var AUTOFILL_PREFIX=${JSON.stringify(autofillPrefix)};
  var USERNAME_PATTERN=/user|email|login|account|phone|name|identifier|usr|uname/i;
  var lastSent='';
  var lastSentAt=0;
  var autoFillSignalSent=false;
  var nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  function findPasswordFields(root){
    try{return Array.from((root||document).querySelectorAll('input[type="password"]'))}catch(e){return[]}
  }
  function findUsernameField(passwordField){
    var form=passwordField.closest('form');
    var container=form||passwordField.parentElement&&passwordField.parentElement.parentElement||document;
    var candidates=[];
    try{candidates=Array.from(container.querySelectorAll('input[type="email"],input[type="text"],input[type="tel"]'))}catch(e){return null}
    var scored=candidates.filter(function(input){
      if(input===passwordField||input.type==='hidden')return false;
      var rect=input.getBoundingClientRect();
      if(rect.width===0&&rect.height===0)return false;
      return true;
    }).map(function(input){
      var score=0;
      var attrs=(input.name||'')+'|'+(input.id||'')+'|'+(input.getAttribute('autocomplete')||'')+'|'+(input.getAttribute('aria-label')||'')+'|'+(input.placeholder||'');
      if(USERNAME_PATTERN.test(attrs))score+=10;
      if(input.type==='email')score+=5;
      if(form&&form.contains(input)){
        var inputs=Array.from(form.querySelectorAll('input'));
        var pwIdx=inputs.indexOf(passwordField);
        var myIdx=inputs.indexOf(input);
        if(myIdx>=0&&pwIdx>=0&&myIdx<pwIdx)score+=3;
      }
      return{el:input,score:score};
    });
    scored.sort(function(a,b){return b.score-a.score});
    return scored.length?scored[0].el:null;
  }
  window.__OMNIFLOW_FILL_CREDENTIAL__=function(username,password){
    var pwFields=findPasswordFields();
    if(!pwFields.length)return false;
    var filled=false;
    pwFields.forEach(function(pwField){
      var usernameField=findUsernameField(pwField);
      if(usernameField&&username){
        nativeSetter.call(usernameField,username);
        usernameField.dispatchEvent(new Event('input',{bubbles:true}));
        usernameField.dispatchEvent(new Event('change',{bubbles:true}));
      }
      nativeSetter.call(pwField,password);
      pwField.dispatchEvent(new Event('input',{bubbles:true}));
      pwField.dispatchEvent(new Event('change',{bubbles:true}));
      filled=true;
    });
    return filled;
  };
  function signalAutoFillReady(){
    if(autoFillSignalSent)return;
    var pwFields=findPasswordFields();
    if(!pwFields.length)return;
    autoFillSignalSent=true;
    var domain='';
    try{domain=location.hostname}catch(e){}
    console.info(AUTOFILL_PREFIX+JSON.stringify({domain:domain}));
  }
  function sendCredential(username,password){
    if(!username||!password)return;
    var key=username+'\\n'+password;
    var now=Date.now();
    if(key===lastSent&&now-lastSentAt<3000)return;
    lastSent=key;
    lastSentAt=now;
    var domain='';
    try{domain=location.hostname}catch(e){}
    var pageUrl='';
    try{pageUrl=location.href}catch(e){}
    console.info(PREFIX+JSON.stringify({username:username,password:password,domain:domain,pageUrl:pageUrl}));
  }
  function captureFromPasswordField(pwField){
    var usernameField=findUsernameField(pwField);
    var username=usernameField?usernameField.value:'';
    var password=pwField.value;
    sendCredential(username,password);
  }
  function handleSubmit(event){
    var form=event.target;
    var pwFields=findPasswordFields(form);
    pwFields.forEach(function(pwField){captureFromPasswordField(pwField)});
  }
  function handleClick(event){
    var btn=event.target.closest('button[type="submit"],input[type="submit"],button:not([type])');
    if(!btn)return;
    var form=btn.closest('form');
    if(!form)return;
    var pwFields=findPasswordFields(form);
    pwFields.forEach(function(pwField){captureFromPasswordField(pwField)});
  }
  function observePasswordFields(){
    document.addEventListener('submit',handleSubmit,true);
    document.addEventListener('click',handleClick,true);
  }
  function scanAndObserve(){
    observePasswordFields();
    signalAutoFillReady();
    try{
      var observer=new MutationObserver(function(){signalAutoFillReady()});
      observer.observe(document.documentElement||document.body||document,{childList:true,subtree:true});
    }catch(e){}
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',scanAndObserve);
  }else{
    scanAndObserve();
  }
})();`;
}
const CHROMIUM_ZOOM_FACTORS = [
  0.25,
  0.33,
  0.5,
  0.67,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  3,
  4,
  5
];
const ZOOM_FACTOR_EPSILON = 1e-3;
function isKeyDown(input) {
  return input.type === "keyDown";
}
function isPrimaryModifierPressed(input, platform) {
  return platform === "darwin" ? input.meta : input.control;
}
function isDevToolsToggleShortcut(input, platform = process.platform) {
  if (!isKeyDown(input)) {
    return false;
  }
  const key = (input.key || "").toLowerCase();
  const code = input.code || "";
  if (key === "f12" || code === "F12") {
    return true;
  }
  if (key !== "i" && code !== "KeyI") {
    return false;
  }
  if (platform === "darwin") {
    return Boolean(input.meta && (input.alt || input.shift));
  }
  return Boolean(input.control && input.shift);
}
function getZoomShortcutAction(input, platform) {
  if (!isKeyDown(input) || !isPrimaryModifierPressed(input, platform)) {
    return null;
  }
  const key = (input.key || "").toLowerCase();
  const code = input.code || "";
  if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") {
    return "zoom-in";
  }
  if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") {
    return "zoom-out";
  }
  if (key === "0" || code === "Digit0" || code === "Numpad0") {
    return "zoom-reset";
  }
  return null;
}
function getEmbeddedBrowserInputShortcutAction(input, platform = process.platform) {
  if (isDevToolsToggleShortcut(input, platform)) {
    return "devtools";
  }
  return getZoomShortcutAction(input, platform);
}
function getNextZoomFactor(currentFactor, direction) {
  if (direction === "in") {
    return CHROMIUM_ZOOM_FACTORS.find((factor) => factor > currentFactor + ZOOM_FACTOR_EPSILON) ?? CHROMIUM_ZOOM_FACTORS[CHROMIUM_ZOOM_FACTORS.length - 1];
  }
  return [...CHROMIUM_ZOOM_FACTORS].reverse().find((factor) => factor < currentFactor - ZOOM_FACTOR_EPSILON) ?? CHROMIUM_ZOOM_FACTORS[0];
}
function toggleEmbeddedBrowserDevTools(webContents2) {
  if (webContents2.isDestroyed()) {
    return;
  }
  if (webContents2.isDevToolsOpened()) {
    webContents2.closeDevTools();
    return;
  }
  if (webContents2.debugger.isAttached()) {
    try {
      webContents2.debugger.detach();
    } catch {
    }
  }
  webContents2.openDevTools({ activate: true, mode: "right" });
}
function applyZoomShortcut(webContents2, action) {
  if (action === "zoom-reset") {
    webContents2.setZoomFactor(1);
    return;
  }
  const direction = action === "zoom-in" ? "in" : "out";
  webContents2.setZoomFactor(getNextZoomFactor(webContents2.getZoomFactor(), direction));
}
function handleEmbeddedBrowserInputShortcut(webContents2, input, platform = process.platform) {
  if (webContents2.isDestroyed()) {
    return false;
  }
  const action = getEmbeddedBrowserInputShortcutAction(input, platform);
  if (!action) {
    return false;
  }
  if (action === "devtools") {
    toggleEmbeddedBrowserDevTools(webContents2);
  } else {
    applyZoomShortcut(webContents2, action);
  }
  return true;
}
function inspectEmbeddedBrowserElement(webContents2, x, y) {
  if (webContents2.isDevToolsOpened()) {
    webContents2.inspectElement(x, y);
    return;
  }
  if (webContents2.debugger.isAttached()) {
    try {
      webContents2.debugger.detach();
    } catch {
    }
  }
  webContents2.once("devtools-opened", () => {
    if (!webContents2.isDestroyed()) {
      webContents2.inspectElement(x, y);
    }
  });
  webContents2.openDevTools({ activate: true, mode: "right" });
}
function showEmbeddedBrowserContextMenu(webContents2, params) {
  if (webContents2.isDestroyed()) {
    return;
  }
  const template = [];
  if (params.isEditable) {
    template.push(
      { enabled: params.editFlags.canUndo, role: "undo" },
      { enabled: params.editFlags.canRedo, role: "redo" },
      { type: "separator" },
      { enabled: params.editFlags.canCut, role: "cut" },
      { enabled: params.editFlags.canCopy, role: "copy" },
      { enabled: params.editFlags.canPaste, role: "paste" },
      { enabled: params.editFlags.canDelete, role: "delete" },
      { type: "separator" },
      { enabled: params.editFlags.canSelectAll, role: "selectAll" },
      { type: "separator" }
    );
  } else if (params.editFlags.canCopy) {
    template.push(
      { role: "copy" },
      { type: "separator" }
    );
  }
  template.push({
    click: () => inspectEmbeddedBrowserElement(webContents2, params.x, params.y),
    label: "检查"
  });
  Menu.buildFromTemplate(template).popup();
}
const embeddedBrowserProbeNewDocumentScriptIds = /* @__PURE__ */ new WeakMap();
const EMBEDDED_BROWSER_POPUP_PLACEHOLDER_URLS = /* @__PURE__ */ new Set(["", "about:blank"]);
function isEmbeddedBrowserPopupPlaceholderUrl(url) {
  return EMBEDDED_BROWSER_POPUP_PLACEHOLDER_URLS.has(String(url || "").trim().toLowerCase());
}
function isEmbeddedBrowserPopupNavigableUrl(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || isEmbeddedBrowserPopupPlaceholderUrl(normalizedUrl)) {
    return false;
  }
  return !normalizedUrl.toLowerCase().startsWith("javascript:");
}
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
  view.webContents.on("before-input-event", (event, input) => {
    if (handleEmbeddedBrowserInputShortcut(view.webContents, input)) {
      event.preventDefault();
    }
  });
  view.webContents.on("context-menu", (_event, params) => {
    showEmbeddedBrowserContextMenu(view.webContents, params);
  });
  let removeDevToolsInputListener = null;
  const cleanupDevToolsInputListener = () => {
    removeDevToolsInputListener == null ? void 0 : removeDevToolsInputListener();
    removeDevToolsInputListener = null;
  };
  view.webContents.on("devtools-opened", () => {
    cleanupDevToolsInputListener();
    const devToolsWebContents = view.webContents.devToolsWebContents;
    if (!devToolsWebContents || devToolsWebContents.isDestroyed()) {
      return;
    }
    const handleDevToolsInput = (event, input) => {
      if (!isDevToolsToggleShortcut(input)) {
        return;
      }
      event.preventDefault();
      if (!view.webContents.isDestroyed()) {
        view.webContents.closeDevTools();
      }
    };
    devToolsWebContents.on("before-input-event", handleDevToolsInput);
    removeDevToolsInputListener = () => {
      devToolsWebContents.removeListener("before-input-event", handleDevToolsInput);
    };
  });
  view.webContents.on("did-start-loading", () => {
    options.emitTabState(options.tabId, view, {
      details: "did-start-loading",
      state: "loading",
      url: view.webContents.getURL() || options.currentUrls.get(options.tabId) || void 0
    });
  });
  view.webContents.on("dom-ready", () => {
    void options.createIfMissingProbe(options.tabId, view);
    view.webContents.executeJavaScript(createCredentialDetectionScript(), true).catch(() => {
    });
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
  view.webContents.on("devtools-closed", () => {
    cleanupDevToolsInputListener();
    if (!view.webContents.isDestroyed()) {
      void options.createIfMissingProbe(options.tabId, view);
    }
  });
  view.webContents.once("destroyed", cleanupDevToolsInputListener);
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
    if (typeof message === "string" && message.startsWith(EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX)) {
      try {
        options.onCredentialPayload(options.tabId, JSON.parse(message.slice(EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX.length)));
      } catch {
      }
      return;
    }
    if (typeof message === "string" && message.startsWith(EMBEDDED_BROWSER_AUTOFILL_CONSOLE_PREFIX)) {
      try {
        const payload = JSON.parse(message.slice(EMBEDDED_BROWSER_AUTOFILL_CONSOLE_PREFIX.length));
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        if (domain) {
          options.onAutoFillReady(options.tabId, domain);
        }
      } catch {
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
  const loadPopupUrlInCurrentTab = (url, details) => {
    const normalizedUrl = String(url || "").trim();
    if (!isEmbeddedBrowserPopupNavigableUrl(normalizedUrl) || view.webContents.isDestroyed()) {
      return false;
    }
    options.currentUrls.set(options.tabId, normalizedUrl);
    options.emitTabState(options.tabId, view, {
      details,
      state: "loading",
      url: normalizedUrl
    });
    void view.webContents.loadURL(normalizedUrl).catch((error) => {
      runtimeLogger.warn("embedded browser popup navigation failed", {
        error: error instanceof Error ? error.message : String(error),
        tabId: options.tabId,
        url: normalizedUrl
      });
    });
    return true;
  };
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isEmbeddedBrowserPopupPlaceholderUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          frame: false,
          show: false,
          skipTaskbar: true
        }
      };
    }
    loadPopupUrlInCurrentTab(url, "window-open");
    return { action: "deny" };
  });
  view.webContents.on("did-create-window", (popupWindow, details) => {
    let closeTimer = null;
    const cleanupPopup = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      if (!popupWindow.webContents.isDestroyed()) {
        popupWindow.webContents.removeListener("will-navigate", handlePopupNavigation);
        popupWindow.webContents.removeListener("did-start-navigation", handlePopupNavigation);
      }
      popupWindow.removeListener("closed", cleanupPopup);
    };
    const closePopup = () => {
      cleanupPopup();
      if (!popupWindow.isDestroyed()) {
        popupWindow.close();
      }
    };
    const handlePopupNavigation = (event, url, _isInPlace, isMainFrame) => {
      const targetIsMainFrame = typeof event.isMainFrame === "boolean" ? event.isMainFrame : isMainFrame;
      if (targetIsMainFrame === false) {
        return;
      }
      const targetUrl = String(event.url || url || "").trim();
      if (!loadPopupUrlInCurrentTab(targetUrl, "window-open-placeholder")) {
        return;
      }
      event.preventDefault();
      closePopup();
    };
    popupWindow.on("closed", cleanupPopup);
    popupWindow.webContents.on("will-navigate", handlePopupNavigation);
    popupWindow.webContents.on("did-start-navigation", handlePopupNavigation);
    closeTimer = setTimeout(closePopup, 15e3);
    if (loadPopupUrlInCurrentTab(details.url, "window-open-created")) {
      closePopup();
    }
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
  if (resource.filePath) {
    await copyFile(resource.filePath, outputPath);
    return outputPath;
  }
  if (!resource.base64) {
    throw new Error("缺少可保存的资源内容");
  }
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
    "-nostats",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto,data",
    "-allowed_extensions",
    "ALL",
    ...buildFfmpegHttpHeaderArgs(request.headers),
    "-progress",
    "pipe:1",
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
function buildEmbeddedBrowserManifestTrackMergeArgs(request) {
  return [
    "-y",
    "-nostats",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto,data",
    "-allowed_extensions",
    "ALL",
    ...buildFfmpegHttpHeaderArgs(request.headers),
    "-progress",
    "pipe:1",
    "-i",
    request.videoManifestUrl,
    ...buildFfmpegHttpHeaderArgs(request.headers),
    "-i",
    request.audioManifestUrl,
    "-map",
    "0:v:0?",
    "-map",
    "1:a:0?",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    request.outputPath
  ];
}
function parseFfmpegProgressChunk(state, chunkText) {
  String(chunkText || "").split(/\r?\n/).forEach((line) => {
    const normalizedLine = String(line || "").trim();
    if (!normalizedLine || !normalizedLine.includes("=")) {
      return;
    }
    const separatorIndex = normalizedLine.indexOf("=");
    const key = normalizedLine.slice(0, separatorIndex).trim();
    const value = normalizedLine.slice(separatorIndex + 1).trim();
    if (!key) {
      return;
    }
    if (key === "out_time_ms" || key === "out_time_us") {
      const rawValue = Number(value);
      if (Number.isFinite(rawValue) && rawValue >= 0) {
        state.processedSeconds = rawValue / 1e6;
      }
      return;
    }
    if (key === "speed") {
      state.speedText = value;
    }
  });
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
    let lastProcessedSeconds = -1;
    let lastSpeedText = "";
    const progressState = {};
    const child = spawn(ffmpegPath, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => {
      var _a2;
      const chunkText = String(chunk);
      stdout.push(chunkText);
      parseFfmpegProgressChunk(progressState, chunkText);
      const nextProcessedSeconds = progressState.processedSeconds;
      const nextSpeedText = progressState.speedText || "";
      const progressChanged = typeof nextProcessedSeconds === "number" && Math.abs(nextProcessedSeconds - lastProcessedSeconds) >= 0.5 || nextSpeedText && nextSpeedText !== lastSpeedText;
      if (!progressChanged) {
        return;
      }
      if (typeof nextProcessedSeconds === "number") {
        lastProcessedSeconds = nextProcessedSeconds;
      }
      if (nextSpeedText) {
        lastSpeedText = nextSpeedText;
      }
      (_a2 = request.onProgress) == null ? void 0 : _a2.call(request, {
        processedSeconds: typeof nextProcessedSeconds === "number" ? Math.min(nextProcessedSeconds, request.durationSeconds || Number.POSITIVE_INFINITY) : void 0,
        speedText: nextSpeedText || void 0
      });
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
async function downloadEmbeddedBrowserManifestTracks(request) {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  }
  const commandArgs = buildEmbeddedBrowserManifestTrackMergeArgs(request);
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let lastProcessedSeconds = -1;
    let lastSpeedText = "";
    const progressState = {};
    const child = spawn(ffmpegPath, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => {
      var _a2;
      const chunkText = String(chunk);
      stdout.push(chunkText);
      parseFfmpegProgressChunk(progressState, chunkText);
      const nextProcessedSeconds = progressState.processedSeconds;
      const nextSpeedText = progressState.speedText || "";
      const progressChanged = typeof nextProcessedSeconds === "number" && Math.abs(nextProcessedSeconds - lastProcessedSeconds) >= 0.5 || nextSpeedText && nextSpeedText !== lastSpeedText;
      if (!progressChanged) {
        return;
      }
      if (typeof nextProcessedSeconds === "number") {
        lastProcessedSeconds = nextProcessedSeconds;
      }
      if (nextSpeedText) {
        lastSpeedText = nextSpeedText;
      }
      (_a2 = request.onProgress) == null ? void 0 : _a2.call(request, {
        processedSeconds: typeof nextProcessedSeconds === "number" ? Math.min(nextProcessedSeconds, request.durationSeconds || Number.POSITIVE_INFINITY) : void 0,
        speedText: nextSpeedText || void 0
      });
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
function mergeHeaders(baseHeaders, overrideHeaders) {
  const headers = new Headers(baseHeaders);
  Object.entries(overrideHeaders).forEach(([name, value]) => {
    const normalizedName = String(name || "").trim();
    const normalizedValue = String(value || "").trim();
    if (!normalizedName || !normalizedValue) {
      return;
    }
    headers.set(normalizedName, normalizedValue);
  });
  return headers;
}
function createRangeHeader(byteRange) {
  if (!byteRange || !Number.isFinite(byteRange.length) || byteRange.length <= 0) {
    return null;
  }
  const start = Math.max(0, Number(byteRange.offset || 0));
  const end = start + Math.max(0, Number(byteRange.length || 0)) - 1;
  if (!Number.isFinite(end) || end < start) {
    return null;
  }
  return `bytes=${start}-${end}`;
}
async function readResponseBuffer(response, fragment, emit2) {
  const responseBody = response.body;
  const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10) || 0;
  if (!responseBody || typeof responseBody.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    emit2("itemProgress", fragment, true, buffer.byteLength, buffer.byteLength);
    return buffer;
  }
  const reader = responseBody.getReader();
  const chunks = [];
  let receivedLength = 0;
  let reading = true;
  while (reading) {
    const { value, done } = await reader.read();
    if (done) {
      reading = false;
      continue;
    }
    if (!value) {
      continue;
    }
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    receivedLength += chunk.byteLength;
    emit2("itemProgress", fragment, false, receivedLength, contentLength, chunk);
  }
  emit2("itemProgress", fragment, true, receivedLength, contentLength);
  const mergedBuffer = new Uint8Array(receivedLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    mergedBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return mergedBuffer.buffer;
}
class EmbeddedBrowserFragmentDownloader {
  constructor(options) {
    __publicField(this, "allFragments");
    __publicField(this, "buffer");
    __publicField(this, "buffersize");
    __publicField(this, "controller");
    __publicField(this, "duration");
    __publicField(this, "errorList");
    __publicField(this, "headers");
    __publicField(this, "index");
    __publicField(this, "pushIndex");
    __publicField(this, "running");
    __publicField(this, "state");
    __publicField(this, "success");
    __publicField(this, "thread");
    __publicField(this, "events");
    __publicField(this, "fragmentsInternal");
    __publicField(this, "maxRetries");
    __publicField(this, "pendingQueue");
    this.events = {};
    this.thread = Math.max(1, Number((options == null ? void 0 : options.thread) || 6));
    this.maxRetries = Math.max(0, Number((options == null ? void 0 : options.maxRetries) || 2));
    this.headers = options == null ? void 0 : options.headers;
    this.allFragments = [];
    this.fragmentsInternal = [];
    this.pendingQueue = [];
    this.index = 0;
    this.buffer = [];
    this.state = "waiting";
    this.success = 0;
    this.errorList = /* @__PURE__ */ new Set();
    this.buffersize = 0;
    this.duration = 0;
    this.pushIndex = 0;
    this.controller = [];
    this.running = 0;
    this.setFragments((options == null ? void 0 : options.fragments) || []);
  }
  on(eventName, callback) {
    const listeners = this.events[eventName] || [];
    listeners.push(callback);
    this.events[eventName] = listeners;
  }
  emit(eventName, ...args) {
    const listeners = this.events[eventName];
    listeners == null ? void 0 : listeners.forEach((callback) => {
      callback(...args);
    });
  }
  setFragments(fragments) {
    this.allFragments = fragments.map((fragment) => ({ ...fragment }));
    this.fragmentsInternal = this.allFragments.map((fragment, index) => ({
      ...fragment,
      index
    }));
    this.resetRuntimeState();
  }
  get fragments() {
    return this.fragmentsInternal;
  }
  get total() {
    return this.fragmentsInternal.length;
  }
  get totalDuration() {
    return this.fragmentsInternal.reduce((total, fragment) => total + Number(fragment.duration || 0), 0);
  }
  get errorItem() {
    return this.errorList;
  }
  push(fragment) {
    const nextFragment = {
      ...fragment,
      index: this.fragmentsInternal.length
    };
    this.allFragments.push({ ...fragment });
    this.fragmentsInternal.push(nextFragment);
    this.buffer.push(null);
    this.controller.push(null);
  }
  stop(index) {
    var _a2;
    if (typeof index === "number") {
      (_a2 = this.controller[index]) == null ? void 0 : _a2.abort();
      return;
    }
    this.controller.forEach((controller) => {
      controller == null ? void 0 : controller.abort();
    });
    this.pendingQueue = [];
    this.state = "aborted";
  }
  destroy() {
    this.stop();
    this.events = {};
    this.allFragments = [];
    this.fragmentsInternal = [];
    this.pendingQueue = [];
    this.resetRuntimeState();
  }
  range(start = 0, end = this.allFragments.length) {
    const normalizedStart = Math.max(0, Number(start || 0));
    const normalizedEnd = Math.max(0, Number(end || 0));
    if (normalizedStart > normalizedEnd) {
      this.emit("error", "start > end");
      return false;
    }
    if (normalizedEnd > this.allFragments.length) {
      this.emit("error", "end > total");
      return false;
    }
    if (normalizedStart >= this.allFragments.length) {
      this.emit("error", "start >= total");
      return false;
    }
    const selected = this.allFragments.slice(normalizedStart, normalizedEnd);
    this.fragmentsInternal = selected.map((fragment, index) => ({
      ...fragment,
      index
    }));
    if (!this.fragmentsInternal.length) {
      this.emit("error", "List is empty");
      return false;
    }
    this.resetRuntimeState();
    return true;
  }
  start(start = 0, end = this.allFragments.length) {
    if (this.state === "running") {
      this.emit("error", "state running");
      return;
    }
    if (!this.range(start, end)) {
      return;
    }
    this.state = "running";
    this.pendingQueue = this.fragmentsInternal.map((fragment) => ({
      attempt: 1,
      fragment
    }));
    const workerCount = Math.min(this.thread, this.pendingQueue.length);
    for (let index = 0; index < workerCount; index += 1) {
      void this.scheduleNext();
    }
  }
  retryErrors() {
    if (this.state === "running") {
      this.emit("error", "state running");
      return;
    }
    const retryFragments = Array.from(this.errorList);
    if (!retryFragments.length) {
      return;
    }
    this.errorList.clear();
    retryFragments.forEach((fragment) => {
      this.buffer[fragment.index] = null;
      this.pendingQueue.push({
        attempt: 1,
        fragment
      });
    });
    this.state = "running";
    const workerCount = Math.min(this.thread, this.pendingQueue.length);
    for (let index = 0; index < workerCount; index += 1) {
      void this.scheduleNext();
    }
  }
  resetRuntimeState() {
    this.index = 0;
    this.pendingQueue = [];
    this.buffer = Array.from({ length: this.fragmentsInternal.length }, () => null);
    this.state = "waiting";
    this.success = 0;
    this.errorList = /* @__PURE__ */ new Set();
    this.buffersize = 0;
    this.duration = 0;
    this.pushIndex = 0;
    this.controller = Array.from({ length: this.fragmentsInternal.length }, () => null);
    this.running = 0;
  }
  async scheduleNext() {
    if (this.state !== "running") {
      return;
    }
    const task = this.pendingQueue.shift();
    if (!task) {
      if (this.running === 0) {
        this.finishIfComplete();
      }
      return;
    }
    await this.downloadTask(task);
    if (this.pendingQueue.length > 0 && this.state === "running") {
      await this.scheduleNext();
      return;
    }
    this.finishIfComplete();
  }
  async downloadTask(task) {
    const { fragment, attempt } = task;
    this.running += 1;
    const controller = new AbortController();
    this.controller[fragment.index] = controller;
    const initHeaders = {};
    const rangeHeader = createRangeHeader(fragment.byteRange);
    if (rangeHeader) {
      initHeaders.Range = rangeHeader;
    }
    const requestInit = {
      headers: mergeHeaders(this.headers, initHeaders),
      signal: controller.signal
    };
    this.emit("start", fragment, requestInit, attempt);
    try {
      const response = await fetch(fragment.url, requestInit);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = await readResponseBuffer(response, fragment, this.emit.bind(this));
      this.emit("rawBuffer", buffer, fragment);
      this.buffer[fragment.index] = buffer;
      this.success += 1;
      this.buffersize += buffer.byteLength;
      this.duration += Number(fragment.duration || 0);
      this.errorList.delete(fragment);
      this.sequentialPush();
      this.emit("completed", buffer, fragment);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      if (normalizedError.name === "AbortError") {
        this.emit("stop", fragment, normalizedError);
        return;
      }
      this.emit("downloadError", fragment, normalizedError, attempt);
      if (attempt <= this.maxRetries && this.state === "running") {
        this.pendingQueue.push({
          attempt: attempt + 1,
          fragment
        });
      } else {
        this.errorList.add(fragment);
      }
    } finally {
      this.running = Math.max(0, this.running - 1);
      this.controller[fragment.index] = null;
    }
  }
  sequentialPush() {
    var _a2;
    if (!((_a2 = this.events.sequentialPush) == null ? void 0 : _a2.length)) {
      return;
    }
    for (; this.pushIndex < this.fragmentsInternal.length; this.pushIndex += 1) {
      const buffer = this.buffer[this.pushIndex];
      if (!buffer) {
        break;
      }
      const fragment = this.fragmentsInternal[this.pushIndex];
      if (!fragment) {
        break;
      }
      this.emit("sequentialPush", buffer, fragment);
      this.buffer[this.pushIndex] = null;
    }
  }
  finishIfComplete() {
    if (this.state !== "running" || this.running > 0 || this.pendingQueue.length > 0) {
      return;
    }
    if (this.success === this.fragmentsInternal.length) {
      this.state = "done";
      this.emit("allCompleted", this.buffer, this.fragmentsInternal);
      return;
    }
    if (this.errorList.size > 0) {
      this.state = "waiting";
      this.emit("failed", this.fragmentsInternal, this.errorList);
    }
  }
}
function getFragmentSourceIndex(fragment) {
  if ("sourceIndex" in fragment && typeof fragment.sourceIndex === "number") {
    return fragment.sourceIndex;
  }
  return typeof fragment.index === "number" ? fragment.index : -1;
}
function normalizeManualAes128KeyBase64(base64) {
  const normalizedBase64 = String(base64 || "").trim();
  if (!normalizedBase64) {
    return null;
  }
  try {
    const decoded = Buffer.from(normalizedBase64, "base64");
    return decoded.byteLength === 16 ? decoded.toString("base64") : null;
  } catch {
    return null;
  }
}
function createByteRangeHeader(byteRange) {
  if (!byteRange || byteRange.length <= 0) {
    return void 0;
  }
  const start = Math.max(0, Number(byteRange.offset || 0));
  const end = start + Math.max(0, Number(byteRange.length || 0)) - 1;
  return `bytes=${start}-${end}`;
}
function createResourceCacheKey(input) {
  var _a2, _b, _c;
  return [
    String(input.method || ""),
    String(input.url || ""),
    ((_a2 = input.byteRange) == null ? void 0 : _a2.raw) || "",
    String(((_b = input.byteRange) == null ? void 0 : _b.length) || ""),
    String(((_c = input.byteRange) == null ? void 0 : _c.offset) || "")
  ].join("|");
}
function createKeyRefCacheKey(input) {
  const normalizedMethod = String(input.method || "").trim().toUpperCase();
  if (input.manualKeyBase64 && normalizedMethod === "AES-128") {
    return `manual:${input.manualKeyBase64}:${normalizedMethod}`;
  }
  return createResourceCacheKey({
    method: normalizedMethod,
    url: input.url
  });
}
function inferExtensionFromUrl(input, fallback) {
  try {
    const extension = path.extname(new URL(input).pathname || "").replace(/^\./, "").trim();
    return extension || fallback;
  } catch {
    const extension = path.extname(String(input || "")).replace(/^\./, "").trim();
    return extension || fallback;
  }
}
function createHlsKeyLine(ref, uri) {
  if (!ref) {
    return "#EXT-X-KEY:METHOD=NONE";
  }
  const attributes = [
    `METHOD=${ref.method || "NONE"}`,
    `URI="${uri}"`
  ];
  if (ref.iv) {
    attributes.push(`IV=${ref.iv}`);
  }
  if (ref.keyFormat) {
    attributes.push(`KEYFORMAT="${ref.keyFormat}"`);
  }
  return `#EXT-X-KEY:${attributes.join(",")}`;
}
function createHlsMapLine(uri) {
  return `#EXT-X-MAP:URI="${uri}"`;
}
function getRequiredLocalRef(collectionName, record, fragmentSequence) {
  if (record == null ? void 0 : record.playlistPath) {
    return record;
  }
  throw new Error(`重写本地 playlist 失败：分片序号 ${fragmentSequence} 缺少对应的本地${collectionName}文件`);
}
async function downloadStaticResource(input) {
  const headers = new Headers(input.headers);
  const rangeHeader = createByteRangeHeader(input.byteRange);
  if (rangeHeader) {
    headers.set("Range", rangeHeader);
  }
  const response = await fetch(input.url, {
    headers
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  await writeFile(input.outputPath, new Uint8Array(buffer));
}
async function prepareStaticRefs(input) {
  const records = /* @__PURE__ */ new Map();
  await mkdir(path.join(input.outputDirectoryPath, input.directoryName), {
    recursive: true
  });
  let resourceIndex = 0;
  for (const ref of input.refs) {
    if (!ref.url) {
      continue;
    }
    const cacheKey = createResourceCacheKey(ref);
    if (records.has(cacheKey)) {
      continue;
    }
    const nextPaths = input.resourcePathBuilder(resourceIndex, ref);
    resourceIndex += 1;
    await downloadStaticResource({
      byteRange: ref.byteRange,
      headers: input.headers,
      outputPath: nextPaths.outputPath,
      url: ref.url
    });
    records.set(cacheKey, {
      localPath: nextPaths.outputPath,
      playlistPath: nextPaths.localPath
    });
  }
  return records;
}
async function prepareKeyRefs(input) {
  const records = /* @__PURE__ */ new Map();
  const keysDirectoryPath = path.join(input.outputDirectoryPath, "keys");
  await mkdir(keysDirectoryPath, { recursive: true });
  const normalizedManualKeyBase64 = normalizeManualAes128KeyBase64(input.manualKeyBase64);
  const manualKeyBytes = normalizedManualKeyBase64 ? Buffer.from(normalizedManualKeyBase64, "base64") : null;
  let resourceIndex = 0;
  for (const ref of input.refs) {
    const normalizedMethod = String(ref.method || "").trim().toUpperCase();
    if (!normalizedMethod || normalizedMethod === "NONE") {
      continue;
    }
    const cacheKey = createKeyRefCacheKey({
      manualKeyBase64: normalizedManualKeyBase64 || void 0,
      method: normalizedMethod,
      url: ref.url
    });
    if (records.has(cacheKey)) {
      continue;
    }
    const extension = normalizedMethod === "AES-128" ? "key" : inferExtensionFromUrl(ref.url || "", "key");
    const fileName = `key-${String(resourceIndex + 1).padStart(3, "0")}.${extension}`;
    resourceIndex += 1;
    const outputPath = path.join(keysDirectoryPath, fileName);
    if (manualKeyBytes && normalizedMethod === "AES-128") {
      await writeFile(outputPath, manualKeyBytes);
    } else if (ref.url) {
      await downloadStaticResource({
        headers: input.headers,
        outputPath,
        url: ref.url
      });
    } else {
      continue;
    }
    records.set(cacheKey, {
      localPath: path.posix.join("keys", fileName),
      playlistPath: path.posix.join("keys", fileName)
    });
  }
  return records;
}
function buildLocalPlaylist(input) {
  var _a2;
  if (!input.fragments.length || !input.fragmentPaths.length) {
    throw new Error("重写本地 playlist 失败：当前没有可写入 playlist 的本地分片");
  }
  const targetDuration = Math.max(
    1,
    Math.ceil(input.fragments.reduce((maxDuration, fragment) => Math.max(maxDuration, Number(fragment.duration || 0)), 0))
  );
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0"
  ];
  let previousDiscontinuity = ((_a2 = input.fragments[0]) == null ? void 0 : _a2.discontinuitySequence) ?? 0;
  let previousKeyCacheKey = "";
  let previousMapCacheKey = "";
  let hadKey = false;
  input.fragments.forEach((fragment, index) => {
    var _a3;
    if (index > 0 && fragment.discontinuitySequence !== previousDiscontinuity) {
      lines.push("#EXT-X-DISCONTINUITY");
      previousDiscontinuity = fragment.discontinuitySequence;
    }
    const nextKeyCacheKey = fragment.key ? createKeyRefCacheKey({
      manualKeyBase64: input.manualKeyBase64,
      method: fragment.key.method,
      url: fragment.key.url
    }) : "";
    if (fragment.key && nextKeyCacheKey !== previousKeyCacheKey) {
      const keyRecord = getRequiredLocalRef("key", input.keyRefs.get(nextKeyCacheKey), fragment.sequence);
      lines.push(createHlsKeyLine(fragment.key, keyRecord.playlistPath));
      previousKeyCacheKey = nextKeyCacheKey;
      hadKey = true;
    } else if (!fragment.key && hadKey) {
      lines.push("#EXT-X-KEY:METHOD=NONE");
      previousKeyCacheKey = "";
      hadKey = false;
    }
    const nextMapCacheKey = ((_a3 = fragment.initSegment) == null ? void 0 : _a3.url) ? createResourceCacheKey({
      byteRange: fragment.initSegment.byteRange,
      url: fragment.initSegment.url
    }) : "";
    if (fragment.initSegment && nextMapCacheKey !== previousMapCacheKey) {
      const mapRecord = getRequiredLocalRef("map", input.mapRefs.get(nextMapCacheKey), fragment.sequence);
      lines.push(createHlsMapLine(mapRecord.playlistPath));
      previousMapCacheKey = nextMapCacheKey;
    }
    const fragmentPath = input.fragmentPaths[index];
    if (!fragmentPath) {
      throw new Error(`重写本地 playlist 失败：分片序号 ${fragment.sequence} 缺少本地输出路径`);
    }
    lines.push(`#EXTINF:${fragment.duration || 0},${fragment.title || ""}`);
    lines.push(fragmentPath);
  });
  lines.push("#EXT-X-ENDLIST");
  return `${lines.filter(Boolean).join("\n")}
`;
}
async function filterExistingPlaylistFragments(input) {
  const existence = await Promise.all(input.fragmentPaths.map(async (relativePath) => {
    try {
      await access(path.join(input.outputDirectoryPath, relativePath));
      return true;
    } catch {
      return false;
    }
  }));
  return input.fragments.reduce((accumulator, fragment, index) => {
    if (!existence[index]) {
      return accumulator;
    }
    accumulator.fragments.push(fragment);
    accumulator.fragmentPaths.push(input.fragmentPaths[index] || "");
    return accumulator;
  }, {
    fragmentPaths: [],
    fragments: []
  });
}
async function downloadEmbeddedBrowserHlsToLocalWorkDirectory(request) {
  var _a2, _b, _c, _d, _e, _f;
  const { plan } = request;
  const requestedFragmentIndexes = Array.isArray(request.fragmentIndexes) ? new Set(request.fragmentIndexes.filter((value) => Number.isFinite(value) && value >= 0)) : null;
  (_a2 = request.onEvent) == null ? void 0 : _a2.call(request, {
    message: "开始准备本地 HLS 工作目录",
    stage: "preparing",
    status: "running",
    totalFragments: plan.fragments.length
  });
  const outputDirectoryPath = request.workDirectoryPath ? path.resolve(request.workDirectoryPath) : request.outputDirectoryPath ? path.resolve(request.outputDirectoryPath) : await mkdtemp(path.join(os.tmpdir(), "omniflow-hls-download-"));
  const segmentsDirectoryPath = path.join(outputDirectoryPath, "segments");
  await mkdir(segmentsDirectoryPath, { recursive: true });
  const keyRefs = await prepareKeyRefs({
    headers: plan.headers,
    manualKeyBase64: request.manualKeyBase64,
    outputDirectoryPath,
    refs: plan.fragments.map((fragment) => {
      var _a3, _b2;
      return {
        method: (_a3 = fragment.key) == null ? void 0 : _a3.method,
        url: (_b2 = fragment.key) == null ? void 0 : _b2.url
      };
    })
  });
  const mapRefs = await prepareStaticRefs({
    directoryName: "maps",
    headers: plan.headers,
    outputDirectoryPath,
    refs: plan.fragments.map((fragment) => {
      var _a3, _b2;
      return {
        byteRange: (_a3 = fragment.initSegment) == null ? void 0 : _a3.byteRange,
        url: (_b2 = fragment.initSegment) == null ? void 0 : _b2.url
      };
    }),
    resourcePathBuilder: (index, ref) => {
      const extension = inferExtensionFromUrl(ref.url || "", "bin");
      const fileName = `map-${String(index + 1).padStart(3, "0")}.${extension}`;
      return {
        localPath: path.posix.join("maps", fileName),
        outputPath: path.join(outputDirectoryPath, "maps", fileName)
      };
    }
  });
  const fragmentPaths = plan.fragments.map((fragment, index) => {
    const extension = inferExtensionFromUrl(fragment.url, fragment.part ? "m4s" : "ts");
    const fragmentIndex = typeof fragment.index === "number" ? fragment.index : index;
    const fileName = `${String(fragmentIndex + 1).padStart(5, "0")}.${extension}`;
    return path.posix.join("segments", fileName);
  });
  const fragmentsToDownload = requestedFragmentIndexes ? plan.fragments.filter((fragment, index) => requestedFragmentIndexes.has(typeof fragment.index === "number" ? fragment.index : index)).map((fragment) => {
    const sourceIndex = typeof fragment.index === "number" ? fragment.index : plan.fragments.indexOf(fragment);
    return {
      ...fragment,
      outputRelativePath: fragmentPaths[sourceIndex],
      sourceIndex
    };
  }) : plan.fragments.map((fragment, index) => {
    const sourceIndex = typeof fragment.index === "number" ? fragment.index : index;
    return {
      ...fragment,
      outputRelativePath: fragmentPaths[sourceIndex],
      sourceIndex
    };
  });
  const initialCompletedFragments = requestedFragmentIndexes ? (await Promise.all(fragmentPaths.map(async (relativePath, index) => {
    var _a3, _b2;
    const sourceIndex = typeof ((_a3 = plan.fragments[index]) == null ? void 0 : _a3.index) === "number" ? Number((_b2 = plan.fragments[index]) == null ? void 0 : _b2.index) : index;
    if (requestedFragmentIndexes.has(sourceIndex)) {
      return 0;
    }
    try {
      await access(path.join(outputDirectoryPath, relativePath));
      return 1;
    } catch {
      return 0;
    }
  }))).reduce((sum, value) => sum + value, 0) : 0;
  const downloader = new EmbeddedBrowserFragmentDownloader({
    fragments: fragmentsToDownload,
    headers: plan.headers,
    maxRetries: request.maxRetries,
    thread: plan.suggestedThreadCount || 6
  });
  const pendingWrites = [];
  let downloadError = null;
  let downloadErrorMessage = "";
  const fragmentReceivedBytes = /* @__PURE__ */ new Map();
  const fragmentTotalBytes = /* @__PURE__ */ new Map();
  const downloadStartedAt = Date.now();
  let lastProgressEmitAt = 0;
  const emitDownloadProgress = (force = false) => {
    var _a3;
    const now = Date.now();
    if (!force && now - lastProgressEmitAt < 220) {
      return;
    }
    lastProgressEmitAt = now;
    const bytesReceived = Array.from(fragmentReceivedBytes.values()).reduce((sum, value) => sum + value, 0);
    const bytesTotal = Array.from(fragmentTotalBytes.values()).reduce((sum, value) => sum + value, 0);
    const elapsedSeconds = Math.max((now - downloadStartedAt) / 1e3, 1e-3);
    const speedBps = bytesReceived > 0 ? bytesReceived / elapsedSeconds : 0;
    const etaSeconds = bytesTotal > 0 && speedBps > 0 ? Math.max(0, Math.round((bytesTotal - bytesReceived) / speedBps)) : void 0;
    (_a3 = request.onEvent) == null ? void 0 : _a3.call(request, {
      bytesReceived,
      bytesTotal: bytesTotal > 0 ? bytesTotal : void 0,
      completedFragments: initialCompletedFragments + downloader.success,
      etaSeconds,
      message: "",
      speedBps: speedBps > 0 ? speedBps : void 0,
      stage: "downloading-fragments",
      status: "running",
      totalFragments: plan.fragments.length
    });
  };
  (_b = request.onEvent) == null ? void 0 : _b.call(request, {
    completedFragments: initialCompletedFragments,
    message: (requestedFragmentIndexes == null ? void 0 : requestedFragmentIndexes.size) ? `开始重试 ${fragmentsToDownload.length} 个失败分片` : "开始下载 HLS 分片",
    stage: "downloading-fragments",
    status: "running",
    totalFragments: plan.fragments.length
  });
  downloader.on("downloadError", (fragment, error, attempt) => {
    var _a3;
    const sourceIndex = Math.max(0, getFragmentSourceIndex(fragment));
    (_a3 = request.onEvent) == null ? void 0 : _a3.call(request, {
      completedFragments: initialCompletedFragments + downloader.success,
      error: error.message,
      message: `分片 #${sourceIndex + 1} 第 ${attempt} 次下载失败：${error.message}`,
      stage: "downloading-fragments",
      status: "running",
      totalFragments: plan.fragments.length
    });
    if (downloadError || attempt <= (request.maxRetries || 2)) {
      return;
    }
    downloadErrorMessage = `下载分片失败：#${sourceIndex + 1} ${error.message}`;
    downloadError = new Error(downloadErrorMessage);
  });
  downloader.on("itemProgress", (fragment, done, receivedLength, contentLength) => {
    var _a3;
    const sourceIndex = Math.max(0, getFragmentSourceIndex(fragment));
    fragmentReceivedBytes.set(sourceIndex, receivedLength);
    const knownTotal = ((_a3 = fragment.byteRange) == null ? void 0 : _a3.length) || contentLength || fragmentTotalBytes.get(sourceIndex) || 0;
    if (knownTotal > 0) {
      fragmentTotalBytes.set(sourceIndex, knownTotal);
    }
    emitDownloadProgress(done);
  });
  downloader.on("sequentialPush", (buffer, fragment) => {
    var _a3;
    const hlsFragment = fragment;
    const sourceIndex = getFragmentSourceIndex(fragment);
    const relativePath = hlsFragment.outputRelativePath || (sourceIndex >= 0 ? fragmentPaths[sourceIndex] : void 0);
    if (!relativePath) {
      return;
    }
    pendingWrites.push({
      promise: writeFile(
        path.join(outputDirectoryPath, relativePath),
        new Uint8Array(buffer)
      ),
      sourceIndex
    });
    (_a3 = request.onEvent) == null ? void 0 : _a3.call(request, {
      completedFragments: Math.min(plan.fragments.length, initialCompletedFragments + downloader.success + 1),
      message: `已写入分片 #${sourceIndex + 1}`,
      stage: "downloading-fragments",
      status: "running",
      totalFragments: plan.fragments.length
    });
  });
  await new Promise((resolve, reject) => {
    downloader.on("allCompleted", () => {
      resolve();
    });
    downloader.on("error", (message) => {
      reject(new Error(message));
    });
    downloader.on("failed", (_, errors) => {
      const firstErrorFragment = Array.from(errors)[0];
      const fragmentIndex = firstErrorFragment ? Math.max(0, getFragmentSourceIndex(firstErrorFragment)) : 0;
      reject(downloadError || new Error(`下载分片失败：#${fragmentIndex + 1}`));
    });
    downloader.start();
  });
  const pendingWriteResults = await Promise.allSettled(
    pendingWrites.map((entry) => entry.promise)
  );
  const completedWrittenFragments = pendingWriteResults.reduce((sum, result) => result.status === "fulfilled" ? sum + 1 : sum, 0);
  const failedWriteFragments = pendingWriteResults.reduce((accumulator, result, index) => {
    var _a3;
    if (result.status === "rejected") {
      const sourceIndex = (_a3 = pendingWrites[index]) == null ? void 0 : _a3.sourceIndex;
      if (typeof sourceIndex === "number" && sourceIndex >= 0) {
        accumulator.push(sourceIndex + 1);
      }
    }
    return accumulator;
  }, []);
  if (failedWriteFragments.length > 0) {
    const failureMessage = `写入分片失败：${failedWriteFragments.map((value) => `#${value}`).join(", ")}`;
    (_c = request.onEvent) == null ? void 0 : _c.call(request, {
      completedFragments: initialCompletedFragments + completedWrittenFragments,
      error: failureMessage,
      failedFragments: failedWriteFragments,
      message: failureMessage,
      stage: "error",
      status: "error",
      totalFragments: plan.fragments.length
    });
    throw new Error(failureMessage);
  }
  emitDownloadProgress(true);
  if (downloadError || downloader.errorItem.size > 0) {
    const failureMessage = downloadErrorMessage || `仍有 ${downloader.errorItem.size} 个分片下载失败`;
    (_d = request.onEvent) == null ? void 0 : _d.call(request, {
      completedFragments: initialCompletedFragments + downloader.success,
      error: failureMessage,
      failedFragments: Array.from(downloader.errorItem).map((fragment) => getFragmentSourceIndex(fragment) + 1).filter((value) => value > 0),
      message: failureMessage,
      stage: "error",
      status: "error",
      totalFragments: plan.fragments.length
    });
    throw downloadError || new Error(failureMessage);
  }
  (_e = request.onEvent) == null ? void 0 : _e.call(request, {
    completedFragments: plan.fragments.length,
    message: "开始重写本地 playlist",
    stage: "rewriting-playlist",
    status: "running",
    totalFragments: plan.fragments.length
  });
  const existingPlaylistContent = await filterExistingPlaylistFragments({
    fragmentPaths,
    fragments: plan.fragments,
    outputDirectoryPath
  });
  const playlistText = buildLocalPlaylist({
    fragmentPaths: existingPlaylistContent.fragmentPaths,
    fragments: existingPlaylistContent.fragments,
    keyRefs,
    manualKeyBase64: request.manualKeyBase64,
    mapRefs
  });
  const playlistPath = path.join(outputDirectoryPath, "local-playlist.m3u8");
  await writeFile(playlistPath, playlistText, "utf8");
  (_f = request.onEvent) == null ? void 0 : _f.call(request, {
    completedFragments: plan.fragments.length,
    message: "本地 playlist 重写完成",
    stage: "rewriting-playlist",
    status: "running",
    totalFragments: plan.fragments.length
  });
  return {
    downloadedFragmentCount: plan.fragments.length,
    keyCount: keyRefs.size,
    mapCount: mapRefs.size,
    playlistPath,
    workDirectoryPath: outputDirectoryPath
  };
}
function buildMpdFaststartArgs(outputPath) {
  const normalizedExtension = path.extname(String(outputPath || "")).trim().toLowerCase();
  return normalizedExtension === ".mp4" ? ["-movflags", "+faststart"] : [];
}
function sanitizeMpdTempSegmentExtension(value) {
  const normalized = String(value || "").trim().replace(/^\./, "").toLowerCase();
  if (/^[a-z0-9]{1,10}$/.test(normalized)) {
    return normalized;
  }
  return "";
}
function inferMpdRepresentationExtension(representation, fallback) {
  var _a2;
  const candidates = [
    representation.initializationUrl,
    (_a2 = representation.segments[0]) == null ? void 0 : _a2.url
  ];
  for (const candidate of candidates) {
    try {
      const extension = sanitizeMpdTempSegmentExtension(path.extname(new URL(String(candidate || "")).pathname));
      if (extension) {
        return extension;
      }
    } catch {
    }
  }
  const mimeType = String(representation.mimeType || "").toLowerCase();
  if (mimeType.includes("webm")) {
    return representation.contentType === "audio" ? "weba" : "webm";
  }
  if (mimeType.includes("mp4")) {
    return representation.contentType === "audio" ? "m4a" : "mp4";
  }
  return fallback;
}
function buildMpdTrackFragments(representation) {
  const fragments = [];
  if (representation.initializationUrl) {
    fragments.push({
      index: 0,
      url: representation.initializationUrl
    });
  }
  const baseIndex = fragments.length;
  representation.segments.forEach((segment, index) => {
    fragments.push({
      duration: segment.duration,
      index: baseIndex + index,
      url: segment.url
    });
  });
  return fragments;
}
async function downloadMpdRepresentationToFile(input) {
  const fragments = buildMpdTrackFragments(input.representation);
  if (!fragments.length) {
    throw new Error("当前 Representation 没有可下载的 init segment 或媒体分片");
  }
  await writeFile(input.outputPath, Buffer$1.alloc(0));
  const downloader = new EmbeddedBrowserFragmentDownloader({
    fragments,
    headers: input.headers,
    maxRetries: 2,
    thread: Math.max(1, Number(input.threadCount || 8))
  });
  let writeChain = Promise.resolve();
  let writeError = null;
  await new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    downloader.on("sequentialPush", (buffer) => {
      writeChain = writeChain.then(async () => {
        try {
          await appendFile(input.outputPath, Buffer$1.from(buffer));
        } catch (error) {
          writeError = error instanceof Error ? error : new Error(String(error));
          downloader.stop();
          fail(writeError);
        }
      });
    });
    downloader.on("error", (message) => {
      fail(new Error(message));
    });
    downloader.on("failed", (_fragments, errors) => {
      void writeChain.then(() => {
        const failedIndexes = Array.from(errors).map((fragment) => Number(fragment.index) + 1).filter((value) => Number.isFinite(value));
        fail(new Error(
          failedIndexes.length ? `MPD 分片下载失败：${failedIndexes.map((value) => `#${value}`).join(", ")}` : "MPD 分片下载失败"
        ));
      }).catch((error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
    downloader.on("allCompleted", () => {
      void writeChain.then(() => {
        if (writeError) {
          fail(writeError);
          return;
        }
        succeed();
      }).catch((error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
    downloader.start();
  }).finally(() => {
    downloader.destroy();
  });
}
async function mergeMpdTrackFilesToOutput(input) {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(input.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  }
  const faststartArgs = buildMpdFaststartArgs(input.outputPath);
  const commandArgs = input.videoTrackPath && input.audioTrackPath ? [
    "-y",
    "-i",
    input.videoTrackPath,
    "-i",
    input.audioTrackPath,
    "-map",
    "0:v:0?",
    "-map",
    "1:a:0?",
    "-c",
    "copy",
    ...faststartArgs,
    input.outputPath
  ] : input.videoTrackPath ? [
    "-y",
    "-i",
    input.videoTrackPath,
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    ...faststartArgs,
    input.outputPath
  ] : input.audioTrackPath ? [
    "-y",
    "-i",
    input.audioTrackPath,
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    input.outputPath
  ] : [];
  if (!commandArgs.length) {
    throw new Error("缺少可合并的 MPD 轨道文件");
  }
  await new Promise((resolve, reject) => {
    const stderr = [];
    const child = spawn(ffmpegPath, commandArgs, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(String(chunk));
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.join("").trim() || `ffmpeg 退出码异常: ${code}`));
    });
  });
  return {
    ffmpegPath,
    outputPath: input.outputPath
  };
}
async function downloadEmbeddedBrowserMpdToOutput(input) {
  if (!input.selectedVideoRepresentation && !input.selectedAudioRepresentation) {
    throw new Error("至少需要选择一条 MPD 轨道");
  }
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "omniflow-mpd-download-"));
  try {
    const videoTrackPath = input.selectedVideoRepresentation ? path.join(
      tempDirectory,
      `video-track.${inferMpdRepresentationExtension(input.selectedVideoRepresentation, "mp4")}`
    ) : void 0;
    const audioTrackPath = input.selectedAudioRepresentation ? path.join(
      tempDirectory,
      `audio-track.${inferMpdRepresentationExtension(input.selectedAudioRepresentation, "m4a")}`
    ) : void 0;
    if (input.selectedVideoRepresentation && videoTrackPath) {
      await downloadMpdRepresentationToFile({
        headers: input.headers,
        outputPath: videoTrackPath,
        representation: input.selectedVideoRepresentation
      });
    }
    if (input.selectedAudioRepresentation && audioTrackPath) {
      await downloadMpdRepresentationToFile({
        headers: input.headers,
        outputPath: audioTrackPath,
        representation: input.selectedAudioRepresentation
      });
    }
    return mergeMpdTrackFilesToOutput({
      audioTrackPath,
      ffmpegPath: input.ffmpegPath,
      outputPath: input.outputPath,
      videoTrackPath
    });
  } finally {
    await rm(tempDirectory, { force: true, recursive: true }).catch(() => void 0);
  }
}
function parseNumber(value) {
  if (!value) {
    return void 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function parseBoolean(value) {
  const normalizedValue = String(value || "").trim().toUpperCase();
  if (normalizedValue === "YES") {
    return true;
  }
  if (normalizedValue === "NO") {
    return false;
  }
  return void 0;
}
function parseHlsAttributeList(input) {
  const result = {};
  let key = "";
  let value = "";
  let readingKey = true;
  let inQuotes = false;
  function commit() {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      key = "";
      value = "";
      readingKey = true;
      return;
    }
    let normalizedValue = value.trim();
    if (normalizedValue.startsWith('"') && normalizedValue.endsWith('"')) {
      normalizedValue = normalizedValue.slice(1, -1);
    }
    result[normalizedKey] = normalizedValue;
    key = "";
    value = "";
    readingKey = true;
  }
  Array.from(String(input || "")).forEach((char) => {
    if (readingKey) {
      if (char === "=") {
        readingKey = false;
      } else {
        key += char;
      }
      return;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      value += char;
      return;
    }
    if (char === "," && !inQuotes) {
      commit();
      return;
    }
    value += char;
  });
  commit();
  return result;
}
function getTagValue(line) {
  const colonIndex = line.indexOf(":");
  return colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : "";
}
function parseHlsByteRange(input) {
  const normalizedInput = String(input || "").trim();
  if (!normalizedInput) {
    return void 0;
  }
  const [lengthText, offsetText] = normalizedInput.split("@");
  const length = parseNumber(lengthText);
  if (!length || length <= 0) {
    return void 0;
  }
  const offset = parseNumber(offsetText);
  return {
    length,
    offset,
    raw: normalizedInput
  };
}
function resolveHlsUrl(uri, baseUrl) {
  const normalizedUri = String(uri || "").trim();
  if (!normalizedUri) {
    return "";
  }
  if (/^(data|blob|javascript):/i.test(normalizedUri)) {
    return normalizedUri;
  }
  try {
    return new URL(normalizedUri, baseUrl).toString();
  } catch {
    return normalizedUri;
  }
}
function parseExtinf(line) {
  const value = getTagValue(line);
  const commaIndex = value.indexOf(",");
  const durationText = commaIndex >= 0 ? value.slice(0, commaIndex) : value;
  const title = commaIndex >= 0 ? value.slice(commaIndex + 1).trim() : void 0;
  return {
    duration: parseNumber(durationText) || 0,
    title: title || void 0
  };
}
function createHlsKey(line, baseUrl) {
  const attributes = parseHlsAttributeList(getTagValue(line));
  const uri = attributes.URI;
  return {
    iv: attributes.IV,
    keyFormat: attributes.KEYFORMAT,
    keyFormatVersions: attributes["KEYFORMATVERSIONS"],
    method: attributes.METHOD || "NONE",
    rawAttributes: attributes,
    rawLine: line,
    uri,
    url: uri ? resolveHlsUrl(uri, baseUrl) : void 0
  };
}
function createHlsMap(line, baseUrl) {
  const attributes = parseHlsAttributeList(getTagValue(line));
  const uri = attributes.URI;
  if (!uri) {
    return null;
  }
  return {
    byteRange: parseHlsByteRange(attributes.BYTERANGE),
    rawAttributes: attributes,
    rawLine: line,
    uri,
    url: resolveHlsUrl(uri, baseUrl)
  };
}
function createHlsVariant(line, uri, baseUrl) {
  const attributes = parseHlsAttributeList(getTagValue(line));
  return {
    audioGroupId: attributes.AUDIO,
    averageBandwidth: parseNumber(attributes["AVERAGE-BANDWIDTH"]),
    bandwidth: parseNumber(attributes.BANDWIDTH),
    codecs: attributes.CODECS,
    frameRate: parseNumber(attributes["FRAME-RATE"]),
    rawAttributes: attributes,
    rawLine: line,
    resolution: attributes.RESOLUTION,
    subtitlesGroupId: attributes.SUBTITLES,
    uri,
    url: resolveHlsUrl(uri, baseUrl)
  };
}
function createHlsRendition(line, baseUrl) {
  const attributes = parseHlsAttributeList(getTagValue(line));
  const uri = attributes.URI;
  return {
    autoselect: parseBoolean(attributes.AUTOSELECT),
    default: parseBoolean(attributes.DEFAULT),
    forced: parseBoolean(attributes.FORCED),
    groupId: attributes["GROUP-ID"],
    language: attributes.LANGUAGE,
    name: attributes.NAME,
    rawAttributes: attributes,
    rawLine: line,
    type: attributes.TYPE,
    uri,
    url: uri ? resolveHlsUrl(uri, baseUrl) : void 0
  };
}
function parseEmbeddedBrowserHlsManifest(input) {
  const baseUrl = String(input.baseUrl || "").trim();
  const lines = String(input.text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let mediaSequence = 0;
  let targetDuration;
  let playlistType;
  let hasEndList = false;
  let discontinuitySequence = 0;
  let currentKey;
  let currentMap;
  let pendingSegment;
  let pendingByteRange;
  let pendingVariantLine;
  const keys = /* @__PURE__ */ new Map();
  const maps = /* @__PURE__ */ new Map();
  const segments = [];
  const variants = [];
  const renditions = [];
  function rememberKey(key) {
    const keyId = `${key.method}:${key.url || key.uri || key.rawLine}:${key.iv || ""}`;
    keys.set(keyId, key);
  }
  function rememberMap(map) {
    var _a2;
    maps.set(`${map.url}:${((_a2 = map.byteRange) == null ? void 0 : _a2.raw) || ""}`, map);
  }
  function addSegment(uri, part) {
    const normalizedUri = String(uri || "").trim();
    if (!normalizedUri) {
      return;
    }
    const index = segments.length;
    segments.push({
      byteRange: pendingByteRange,
      discontinuitySequence,
      duration: (pendingSegment == null ? void 0 : pendingSegment.duration) || 0,
      index,
      key: currentKey,
      map: currentMap,
      part,
      sequence: mediaSequence + index,
      title: pendingSegment == null ? void 0 : pendingSegment.title,
      uri: normalizedUri,
      url: resolveHlsUrl(normalizedUri, baseUrl)
    });
    pendingSegment = void 0;
    pendingByteRange = void 0;
  }
  lines.forEach((line) => {
    if (pendingVariantLine && !line.startsWith("#")) {
      variants.push(createHlsVariant(pendingVariantLine, line, baseUrl));
      pendingVariantLine = void 0;
      return;
    }
    if (!line.startsWith("#")) {
      addSegment(line, false);
      return;
    }
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      pendingVariantLine = line;
      return;
    }
    if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF")) {
      const attributes = parseHlsAttributeList(getTagValue(line));
      if (attributes.URI) {
        variants.push(createHlsVariant(line, attributes.URI, baseUrl));
      }
      return;
    }
    if (line.startsWith("#EXT-X-MEDIA:")) {
      renditions.push(createHlsRendition(line, baseUrl));
      return;
    }
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE")) {
      mediaSequence = parseNumber(getTagValue(line)) || 0;
      return;
    }
    if (line.startsWith("#EXT-X-TARGETDURATION")) {
      targetDuration = parseNumber(getTagValue(line));
      return;
    }
    if (line.startsWith("#EXT-X-PLAYLIST-TYPE")) {
      playlistType = getTagValue(line) || void 0;
      return;
    }
    if (line.startsWith("#EXT-X-KEY")) {
      const key = createHlsKey(line, baseUrl);
      rememberKey(key);
      currentKey = key.method.toUpperCase() === "NONE" ? void 0 : key;
      return;
    }
    if (line.startsWith("#EXT-X-MAP")) {
      const map = createHlsMap(line, baseUrl);
      if (map) {
        currentMap = map;
        rememberMap(map);
      }
      return;
    }
    if (line.startsWith("#EXT-X-BYTERANGE")) {
      pendingByteRange = parseHlsByteRange(getTagValue(line));
      return;
    }
    if (line.startsWith("#EXT-X-DISCONTINUITY")) {
      discontinuitySequence += 1;
      return;
    }
    if (line.startsWith("#EXTINF")) {
      pendingSegment = parseExtinf(line);
      return;
    }
    if (line.startsWith("#EXT-X-PART")) {
      const attributes = parseHlsAttributeList(getTagValue(line));
      pendingSegment = {
        duration: parseNumber(attributes.DURATION) || 0
      };
      addSegment(attributes.URI || "", true);
      return;
    }
    if (line.startsWith("#EXT-X-ENDLIST")) {
      hasEndList = true;
    }
  });
  const durationSeconds = segments.reduce((total, segment) => total + segment.duration, 0);
  return {
    baseUrl,
    discontinuityCount: discontinuitySequence,
    durationSeconds,
    hasEndList,
    isLive: !hasEndList,
    isMaster: variants.length > 0,
    keys: Array.from(keys.values()),
    maps: Array.from(maps.values()),
    mediaSequence,
    playlistType,
    renditions,
    segmentCount: segments.length,
    segments,
    targetDuration,
    variants
  };
}
function createEmbeddedBrowserHlsDownloadPlan(input) {
  var _a2;
  const { manifest } = input;
  const fragments = manifest.segments.map((segment) => ({
    byteRange: segment.byteRange,
    discontinuitySequence: segment.discontinuitySequence,
    duration: segment.duration,
    index: segment.index,
    initSegment: segment.map ? {
      byteRange: segment.map.byteRange,
      url: segment.map.url
    } : void 0,
    key: segment.key ? {
      iv: segment.key.iv,
      keyFormat: segment.key.keyFormat,
      method: segment.key.method,
      url: segment.key.url
    } : void 0,
    part: segment.part,
    sequence: segment.sequence,
    title: segment.title,
    url: segment.url
  }));
  const suggestedThreadCount = Math.min(6, Math.max(1, fragments.length || 1));
  return {
    durationSeconds: manifest.durationSeconds,
    encryptedSegmentCount: fragments.filter((fragment) => {
      var _a3, _b;
      return ((_a3 = fragment.key) == null ? void 0 : _a3.url) || ((_b = fragment.key) == null ? void 0 : _b.method) === "AES-128";
    }).length,
    fragmentCount: fragments.length,
    fragments,
    headers: input.headers || {},
    isLive: manifest.isLive,
    isMaster: manifest.isMaster,
    keys: manifest.keys.map((key) => ({
      iv: key.iv,
      keyFormat: key.keyFormat,
      method: key.method,
      url: key.url
    })),
    manifestUrl: input.manifestUrl,
    maps: manifest.maps.map((map) => ({
      byteRange: map.byteRange,
      url: map.url
    })),
    mapTag: ((_a2 = manifest.maps[0]) == null ? void 0 : _a2.url) || "",
    pageUrl: input.pageUrl,
    partCount: fragments.filter((fragment) => fragment.part).length,
    renditions: manifest.renditions.map((rendition) => ({
      autoselect: rendition.autoselect,
      default: rendition.default,
      forced: rendition.forced,
      groupId: rendition.groupId,
      language: rendition.language,
      name: rendition.name,
      type: rendition.type,
      url: rendition.url
    })),
    segmentCount: manifest.segmentCount,
    segments: manifest.segments.map((segment) => {
      var _a3, _b;
      return {
        byteRange: segment.byteRange,
        discontinuitySequence: segment.discontinuitySequence,
        duration: segment.duration,
        keyUrl: (_a3 = segment.key) == null ? void 0 : _a3.url,
        mapUrl: (_b = segment.map) == null ? void 0 : _b.url,
        part: segment.part,
        sequence: segment.sequence,
        url: segment.url
      };
    }),
    suggestedThreadCount,
    variants: manifest.variants.map((variant) => ({
      audioGroupId: variant.audioGroupId,
      averageBandwidth: variant.averageBandwidth,
      bandwidth: variant.bandwidth,
      codecs: variant.codecs,
      frameRate: variant.frameRate,
      resolution: variant.resolution,
      subtitlesGroupId: variant.subtitlesGroupId,
      url: variant.url
    }))
  };
}
function createLiveFragmentKey(fragment) {
  return `${fragment.sequence}|${fragment.url}`;
}
function mergeUniqueByKey(existing, nextItems, createKey) {
  const seen2 = new Set(existing.map((item) => createKey(item)));
  const appended = [];
  nextItems.forEach((item) => {
    const key = createKey(item);
    if (seen2.has(key)) {
      return;
    }
    seen2.add(key);
    appended.push(item);
  });
  return [...existing, ...appended];
}
async function fetchEmbeddedBrowserHlsLiveManifestSnapshot(input) {
  const response = await fetch(input.manifestUrl, {
    headers: input.headers
  });
  if (!response.ok) {
    throw new Error(`直播 playlist 请求失败：HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!text.includes("#EXTM3U")) {
    throw new Error("当前直播返回内容不像 HLS playlist");
  }
  const manifest = parseEmbeddedBrowserHlsManifest({
    baseUrl: input.manifestUrl,
    text
  });
  const plan = createEmbeddedBrowserHlsDownloadPlan({
    headers: input.headers || {},
    manifest,
    manifestUrl: input.manifestUrl,
    pageUrl: input.pageUrl
  });
  if (plan.isMaster) {
    throw new Error("直播录制当前只支持具体 media playlist，不直接录制 master playlist");
  }
  if (!plan.isLive) {
    throw new Error("当前 playlist 不是直播流");
  }
  return {
    manifest,
    plan: input.suggestedThreadCount && input.suggestedThreadCount > 0 ? {
      ...plan,
      suggestedThreadCount: input.suggestedThreadCount
    } : plan
  };
}
class EmbeddedBrowserHlsLiveRecorder {
  constructor(options) {
    __publicField(this, "activePollPromise", null);
    __publicField(this, "cumulativePlan", null);
    __publicField(this, "downloadedBytes", 0);
    __publicField(this, "isRecording", false);
    __publicField(this, "manualKeyBase64");
    __publicField(this, "manifestUrl");
    __publicField(this, "headers");
    __publicField(this, "onEvent");
    __publicField(this, "pageUrl");
    __publicField(this, "playlistPath", "");
    __publicField(this, "pollIntervalMs", 4e3);
    __publicField(this, "pollTimer", null);
    __publicField(this, "suggestedThreadCount");
    __publicField(this, "workDirectoryPath", "");
    this.headers = options.headers;
    this.manifestUrl = options.manifestUrl;
    this.manualKeyBase64 = options.manualKeyBase64;
    this.onEvent = options.onEvent;
    this.pageUrl = options.pageUrl;
    this.suggestedThreadCount = options.suggestedThreadCount;
    this.workDirectoryPath = options.workDirectoryPath || "";
  }
  getCurrentWorkDirectoryPath() {
    return this.workDirectoryPath;
  }
  async start() {
    if (this.isRecording) {
      throw new Error("直播录制已经在进行中");
    }
    this.isRecording = true;
    this.workDirectoryPath = this.workDirectoryPath || await mkdtemp(path.join(os.tmpdir(), "omniflow-hls-live-"));
    await this.pollOnce(true);
    this.scheduleNextPoll();
  }
  async stop() {
    this.isRecording = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.activePollPromise) {
      await this.activePollPromise.catch(() => void 0);
      this.activePollPromise = null;
    }
    if (!this.cumulativePlan || !this.playlistPath) {
      throw new Error("直播录制还没有可用的本地 playlist");
    }
    return {
      durationSeconds: this.cumulativePlan.durationSeconds,
      playlistPath: this.playlistPath,
      totalFragments: this.cumulativePlan.fragmentCount,
      workDirectoryPath: this.workDirectoryPath
    };
  }
  scheduleNextPoll() {
    if (!this.isRecording) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.activePollPromise = this.pollOnce(false).catch((error) => {
        var _a2, _b, _c, _d;
        (_d = this.onEvent) == null ? void 0 : _d.call(this, {
          completedFragments: ((_a2 = this.cumulativePlan) == null ? void 0 : _a2.fragmentCount) || 0,
          durationSeconds: (_b = this.cumulativePlan) == null ? void 0 : _b.durationSeconds,
          error: error instanceof Error ? error.message : String(error),
          message: error instanceof Error ? error.message : String(error),
          stage: "error",
          status: "error",
          totalFragments: ((_c = this.cumulativePlan) == null ? void 0 : _c.fragmentCount) || 0
        });
        this.isRecording = false;
      }).finally(() => {
        this.activePollPromise = null;
        if (this.isRecording) {
          this.scheduleNextPoll();
        }
      });
    }, this.pollIntervalMs);
  }
  async pollOnce(isInitial) {
    var _a2;
    const snapshot = await fetchEmbeddedBrowserHlsLiveManifestSnapshot({
      headers: this.headers,
      manifestUrl: this.manifestUrl,
      pageUrl: this.pageUrl,
      suggestedThreadCount: this.suggestedThreadCount
    });
    this.pollIntervalMs = Math.max(1500, Math.min(1e4, (snapshot.manifest.targetDuration || 4) * 1e3));
    if (!this.cumulativePlan) {
      this.cumulativePlan = {
        ...snapshot.plan,
        fragments: snapshot.plan.fragments.map((fragment, index) => ({
          ...fragment,
          index
        }))
      };
      await this.downloadFragments({
        fragmentIndexes: void 0,
        message: "开始录制直播流"
      });
      return;
    }
    const existingFragmentKeys = new Set(this.cumulativePlan.fragments.map((fragment) => createLiveFragmentKey(fragment)));
    const newFragments = snapshot.plan.fragments.filter((fragment) => !existingFragmentKeys.has(createLiveFragmentKey(fragment)));
    if (!newFragments.length) {
      (_a2 = this.onEvent) == null ? void 0 : _a2.call(this, {
        completedFragments: this.cumulativePlan.fragmentCount,
        durationSeconds: this.cumulativePlan.durationSeconds,
        message: isInitial ? "开始录制直播流" : "等待直播流产生新分片",
        stage: "downloading-fragments",
        status: "running",
        totalFragments: this.cumulativePlan.fragmentCount
      });
      return;
    }
    const nextStartIndex = this.cumulativePlan.fragments.length;
    const normalizedNewFragments = newFragments.map((fragment, index) => ({
      ...fragment,
      index: nextStartIndex + index
    }));
    this.cumulativePlan = {
      ...this.cumulativePlan,
      durationSeconds: this.cumulativePlan.durationSeconds + newFragments.reduce((sum, fragment) => sum + Number(fragment.duration || 0), 0),
      encryptedSegmentCount: this.cumulativePlan.encryptedSegmentCount + newFragments.filter((fragment) => {
        var _a3, _b;
        return Boolean(((_a3 = fragment.key) == null ? void 0 : _a3.url) || ((_b = fragment.key) == null ? void 0 : _b.method));
      }).length,
      fragmentCount: this.cumulativePlan.fragmentCount + normalizedNewFragments.length,
      fragments: [...this.cumulativePlan.fragments, ...normalizedNewFragments],
      keys: mergeUniqueByKey(
        this.cumulativePlan.keys,
        snapshot.plan.keys,
        (key) => `${key.method}|${key.url || ""}|${key.iv || ""}`
      ),
      maps: mergeUniqueByKey(
        this.cumulativePlan.maps,
        snapshot.plan.maps,
        (map) => {
          var _a3;
          return `${map.url}|${((_a3 = map.byteRange) == null ? void 0 : _a3.raw) || ""}`;
        }
      ),
      partCount: this.cumulativePlan.partCount + newFragments.filter((fragment) => fragment.part).length,
      segmentCount: this.cumulativePlan.segmentCount + newFragments.length,
      segments: [
        ...this.cumulativePlan.segments,
        ...newFragments.map((fragment) => {
          var _a3, _b;
          return {
            byteRange: fragment.byteRange,
            discontinuitySequence: fragment.discontinuitySequence,
            duration: fragment.duration,
            keyUrl: (_a3 = fragment.key) == null ? void 0 : _a3.url,
            mapUrl: (_b = fragment.initSegment) == null ? void 0 : _b.url,
            part: fragment.part,
            sequence: fragment.sequence,
            url: fragment.url
          };
        })
      ],
      suggestedThreadCount: snapshot.plan.suggestedThreadCount
    };
    await this.downloadFragments({
      fragmentIndexes: normalizedNewFragments.map((fragment) => Number(fragment.index || 0)),
      message: `检测到 ${normalizedNewFragments.length} 个新分片`
    });
  }
  async downloadFragments(input) {
    var _a2;
    if (!this.cumulativePlan) {
      throw new Error("直播录制计划还没有初始化");
    }
    const bytesOffset = this.downloadedBytes;
    let lastBatchBytes = 0;
    const localDownloadResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
      fragmentIndexes: input.fragmentIndexes,
      manualKeyBase64: this.manualKeyBase64,
      onEvent: (event) => {
        var _a3, _b, _c, _d;
        const nextBytesReceived = typeof event.bytesReceived === "number" ? bytesOffset + event.bytesReceived : bytesOffset;
        if (typeof event.bytesReceived === "number") {
          lastBatchBytes = event.bytesReceived;
        }
        (_d = this.onEvent) == null ? void 0 : _d.call(this, {
          bytesReceived: nextBytesReceived,
          bytesTotal: void 0,
          completedFragments: event.completedFragments ?? ((_a3 = this.cumulativePlan) == null ? void 0 : _a3.fragmentCount),
          durationSeconds: (_b = this.cumulativePlan) == null ? void 0 : _b.durationSeconds,
          error: event.error,
          etaSeconds: void 0,
          failedFragments: event.failedFragments,
          message: event.message || input.message,
          speedBps: event.speedBps,
          stage: event.stage,
          status: event.status,
          totalFragments: (_c = this.cumulativePlan) == null ? void 0 : _c.fragmentCount
        });
      },
      plan: {
        fragments: this.cumulativePlan.fragments,
        headers: this.cumulativePlan.headers,
        manifestUrl: this.cumulativePlan.manifestUrl,
        suggestedThreadCount: this.cumulativePlan.suggestedThreadCount
      },
      workDirectoryPath: this.workDirectoryPath
    });
    this.playlistPath = localDownloadResult.playlistPath;
    this.workDirectoryPath = localDownloadResult.workDirectoryPath;
    this.downloadedBytes = bytesOffset + lastBatchBytes;
    (_a2 = this.onEvent) == null ? void 0 : _a2.call(this, {
      bytesReceived: this.downloadedBytes,
      completedFragments: this.cumulativePlan.fragmentCount,
      durationSeconds: this.cumulativePlan.durationSeconds,
      message: input.message,
      stage: "downloading-fragments",
      status: "running",
      totalFragments: this.cumulativePlan.fragmentCount
    });
  }
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
  const embeddedBrowserHlsRetrySessions = /* @__PURE__ */ new Map();
  const embeddedBrowserHlsLiveRecordingSessions = /* @__PURE__ */ new Map();
  const embeddedBrowserMseSpoolFiles = /* @__PURE__ */ new Map();
  const embeddedBrowserMseSpoolWriteQueues = /* @__PURE__ */ new Map();
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
  function emitEmbeddedBrowserHlsTask(payload) {
    const mainWindow2 = options.getMainWindow();
    if (!mainWindow2 || mainWindow2.isDestroyed()) {
      return;
    }
    mainWindow2.webContents.send("embedded-browser:hls-task", payload);
  }
  function buildEmbeddedBrowserMseSpoolKey(tabId, resourceKey) {
    return `${String(tabId || "").trim()}:${String(resourceKey || "").trim()}`;
  }
  async function clearEmbeddedBrowserMseSpoolFiles(options2) {
    const normalizedTabId = String(options2.tabId || "").trim();
    const normalizedResourceKey = String(options2.resourceKey || "").trim();
    if (!normalizedTabId && !normalizedResourceKey) {
      return;
    }
    const matchedEntries = Array.from(embeddedBrowserMseSpoolFiles.entries()).filter(([, file]) => {
      if (normalizedTabId && file.tabId !== normalizedTabId) {
        return false;
      }
      if (normalizedResourceKey && file.resourceKey !== normalizedResourceKey) {
        return false;
      }
      return true;
    });
    await Promise.all(matchedEntries.map(async ([key, file]) => {
      embeddedBrowserMseSpoolFiles.delete(key);
      embeddedBrowserMseSpoolWriteQueues.delete(key);
      await rm(file.directoryPath, { force: true, recursive: true }).catch(() => void 0);
    }));
  }
  async function waitForEmbeddedBrowserMseSpoolWrites(tabId, resourceKey) {
    const spoolKey = buildEmbeddedBrowserMseSpoolKey(tabId, resourceKey);
    const pendingWrite = embeddedBrowserMseSpoolWriteQueues.get(spoolKey);
    if (!pendingWrite) {
      return;
    }
    await pendingWrite.catch(() => void 0);
  }
  async function appendEmbeddedBrowserMseSpoolChunk(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    const normalizedResourceKey = String(payload.resourceKey || "").trim();
    const normalizedBase64 = String(payload.base64 || "").trim();
    if (!normalizedTabId || !normalizedResourceKey || !normalizedBase64) {
      return null;
    }
    const spoolKey = buildEmbeddedBrowserMseSpoolKey(normalizedTabId, normalizedResourceKey);
    const chunk = Buffer.from(normalizedBase64, "base64");
    const nextWrite = (embeddedBrowserMseSpoolWriteQueues.get(spoolKey) || Promise.resolve(null)).then(async (existingSpoolFile) => {
      let spoolFile2 = existingSpoolFile || embeddedBrowserMseSpoolFiles.get(spoolKey) || null;
      if (!spoolFile2) {
        const directoryPath = await mkdtemp(path.join(os.tmpdir(), "omniflow-mse-spool-"));
        const fileName = sanitizeEmbeddedBrowserOutputFileName(
          String(payload.fileName || normalizedResourceKey || "media").trim()
        );
        spoolFile2 = {
          bytesWritten: 0,
          directoryPath,
          fileName,
          filePath: path.join(directoryPath, fileName),
          mimeType: payload.mimeType,
          resourceKey: normalizedResourceKey,
          streamType: payload.streamType,
          tabId: normalizedTabId
        };
        embeddedBrowserMseSpoolFiles.set(spoolKey, spoolFile2);
      }
      if (chunk.byteLength) {
        await appendFile(spoolFile2.filePath, chunk);
        spoolFile2.bytesWritten += chunk.byteLength;
      }
      if (payload.mimeType) {
        spoolFile2.mimeType = payload.mimeType;
      }
      if (payload.streamType === "audio" || payload.streamType === "video") {
        spoolFile2.streamType = payload.streamType;
      }
      return spoolFile2;
    });
    embeddedBrowserMseSpoolWriteQueues.set(spoolKey, nextWrite);
    const spoolFile = await nextWrite;
    return spoolFile;
  }
  async function clearEmbeddedBrowserHlsRetrySessions(options2) {
    const normalizedRequestId = String(options2.requestId || "").trim();
    const normalizedTabId = String(options2.tabId || "").trim();
    if (!normalizedRequestId && !normalizedTabId) {
      return;
    }
    const matchedSessions = Array.from(embeddedBrowserHlsRetrySessions.entries()).filter(([requestId, session2]) => {
      if (normalizedRequestId && requestId === normalizedRequestId) {
        return true;
      }
      if (normalizedTabId && session2.tabId === normalizedTabId) {
        return true;
      }
      return false;
    });
    if (!matchedSessions.length) {
      return;
    }
    await Promise.all(matchedSessions.map(async ([requestId, session2]) => {
      embeddedBrowserHlsRetrySessions.delete(requestId);
      await rm(session2.workDirectoryPath, { force: true, recursive: true }).catch(() => void 0);
    }));
  }
  async function clearEmbeddedBrowserHlsLiveRecordingSessions(options2) {
    const normalizedRequestId = String(options2.requestId || "").trim();
    const normalizedTabId = String(options2.tabId || "").trim();
    if (!normalizedRequestId && !normalizedTabId) {
      return;
    }
    const matchedSessions = Array.from(embeddedBrowserHlsLiveRecordingSessions.entries()).filter(([requestId, session2]) => {
      if (normalizedRequestId && requestId === normalizedRequestId) {
        return true;
      }
      if (normalizedTabId && session2.tabId === normalizedTabId) {
        return true;
      }
      return false;
    });
    if (!matchedSessions.length) {
      return;
    }
    await Promise.all(matchedSessions.map(async ([requestId, session2]) => {
      embeddedBrowserHlsLiveRecordingSessions.delete(requestId);
      try {
        await session2.recorder.stop().catch(() => void 0);
      } catch {
      }
      const workDirectoryPath = session2.workDirectoryPath || session2.recorder.getCurrentWorkDirectoryPath();
      if (workDirectoryPath) {
        await rm(workDirectoryPath, { force: true, recursive: true }).catch(() => void 0);
      }
    }));
  }
  function emitCredentialCaptured(payload) {
    const mainWindow2 = options.getMainWindow();
    if (!mainWindow2 || mainWindow2.isDestroyed()) {
      return;
    }
    mainWindow2.webContents.send("embedded-browser:credential-captured", payload);
  }
  function emitCredentialAutoFilled(payload) {
    const mainWindow2 = options.getMainWindow();
    if (!mainWindow2 || mainWindow2.isDestroyed()) {
      return;
    }
    mainWindow2.webContents.send("embedded-browser:credential-autofilled", payload);
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
  function handleActiveViewInputShortcut(input) {
    if (!activeEmbeddedBrowserTabId) {
      return false;
    }
    const view = getEmbeddedBrowserView(activeEmbeddedBrowserTabId);
    if (!view) {
      activeEmbeddedBrowserTabId = null;
      return false;
    }
    return handleEmbeddedBrowserInputShortcut(view.webContents, input);
  }
  function toggleActiveViewDevTools() {
    if (!activeEmbeddedBrowserTabId) {
      return false;
    }
    const view = getEmbeddedBrowserView(activeEmbeddedBrowserTabId);
    if (!view) {
      activeEmbeddedBrowserTabId = null;
      return false;
    }
    toggleEmbeddedBrowserDevTools(view.webContents);
    return true;
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
  async function extractEmbeddedBrowserMseResourceFromFrames(tabId, view, resourceKey) {
    const spoolKey = buildEmbeddedBrowserMseSpoolKey(tabId, resourceKey);
    const currentSpoolFile = embeddedBrowserMseSpoolFiles.get(spoolKey);
    if (currentSpoolFile) {
      await waitForEmbeddedBrowserMseSpoolWrites(tabId, resourceKey);
    }
    const frames = getEmbeddedBrowserFrameList(view);
    const drainFromExecutor = async (executeScript) => drainEmbeddedBrowserMseResourceFromPage(executeScript, resourceKey);
    const drained = !frames.length ? await drainFromExecutor((script) => view.webContents.executeJavaScript(script, true)) : await (async () => {
      for (const frame of frames) {
        try {
          const resource = await drainFromExecutor((script) => frame.executeJavaScript(script, true));
          if (resource) {
            return resource;
          }
        } catch {
        }
      }
      return null;
    })();
    if (!currentSpoolFile) {
      if (!(drained == null ? void 0 : drained.base64)) {
        return null;
      }
      return {
        base64: drained.base64,
        fileName: drained.fileName,
        mimeType: drained.mimeType,
        resourceKey,
        streamType: drained.streamType
      };
    }
    if (drained == null ? void 0 : drained.base64) {
      await appendEmbeddedBrowserMseSpoolChunk(tabId, {
        base64: drained.base64,
        fileName: drained.fileName,
        mimeType: drained.mimeType,
        resourceKey,
        streamType: drained.streamType
      });
    }
    await waitForEmbeddedBrowserMseSpoolWrites(tabId, resourceKey);
    const nextSpoolFile = embeddedBrowserMseSpoolFiles.get(spoolKey) || currentSpoolFile;
    return {
      fileName: (drained == null ? void 0 : drained.fileName) || nextSpoolFile.fileName,
      filePath: nextSpoolFile.filePath,
      mimeType: (drained == null ? void 0 : drained.mimeType) || nextSpoolFile.mimeType,
      resourceKey,
      streamType: (drained == null ? void 0 : drained.streamType) || nextSpoolFile.streamType
    };
  }
  async function extractEmbeddedBrowserResourceFromFrames(tabId, view, resourceKey) {
    if (String(resourceKey || "").startsWith("mse-stream:")) {
      const mseResource = await extractEmbeddedBrowserMseResourceFromFrames(tabId, view, resourceKey);
      if (mseResource) {
        return mseResource;
      }
    }
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
  function sanitizeEmbeddedBrowserOutputFileName(input) {
    return String(input || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || "download";
  }
  async function deriveEmbeddedBrowserPreferredOutputPath(directoryPath, fileName) {
    const normalizedDirectory = path.resolve(String(directoryPath || "").trim());
    if (!normalizedDirectory) {
      throw new Error("无效的输出目录");
    }
    await mkdir(normalizedDirectory, { recursive: true });
    const parsedName = path.parse(sanitizeEmbeddedBrowserOutputFileName(fileName));
    const extension = parsedName.ext || "";
    const baseName = parsedName.name || parsedName.base || "download";
    for (let attempt = 0; attempt < 5e3; attempt += 1) {
      const suffix = attempt === 0 ? "" : ` (${attempt})`;
      const candidatePath = path.join(normalizedDirectory, `${baseName}${suffix}${extension}`);
      const exists = await access(candidatePath).then(() => true).catch(() => false);
      if (!exists) {
        return candidatePath;
      }
    }
    return path.join(normalizedDirectory, `${baseName}-${Date.now()}${extension}`);
  }
  async function resolveEmbeddedBrowserOutputPath(payload) {
    const defaultFileName = sanitizeEmbeddedBrowserOutputFileName(payload.defaultFileName);
    const preferredDirectory = String(payload.outputDirectoryPath || "").trim();
    const shouldUseSystemSaveDialog = payload.useSystemSaveDialog !== false && !preferredDirectory;
    if (!shouldUseSystemSaveDialog) {
      const targetDirectory = preferredDirectory || app.getPath("downloads");
      return deriveEmbeddedBrowserPreferredOutputPath(targetDirectory, defaultFileName);
    }
    const mainWindow2 = options.getMainWindow();
    const targetWindow = mainWindow2 && !mainWindow2.isDestroyed() ? mainWindow2 : void 0;
    const saveDialogOptions = {
      defaultPath: path.join(app.getPath("downloads"), defaultFileName),
      filters: payload.filters,
      showsTagField: false
    };
    const saveResult = targetWindow ? await dialog.showSaveDialog(targetWindow, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
    if (saveResult.canceled || !saveResult.filePath) {
      return null;
    }
    return saveResult.filePath;
  }
  function deriveEmbeddedBrowserDirectFileName(url, fallbackName) {
    try {
      const fileName = decodeURIComponent(path.basename(new URL(url).pathname)).trim();
      if (fileName) {
        return sanitizeEmbeddedBrowserOutputFileName(fileName);
      }
    } catch {
    }
    return sanitizeEmbeddedBrowserOutputFileName(fallbackName);
  }
  async function downloadEmbeddedBrowserDirectFile(_tabId, payload) {
    const resourceUrl = String(payload.url || "").trim();
    if (!/^https?:\/\//i.test(resourceUrl)) {
      return {
        error: "缺少可下载的字幕或文件链接",
        ok: false
      };
    }
    try {
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName: deriveEmbeddedBrowserDirectFileName(resourceUrl, String(payload.suggestedFileName || "").trim() || "resource.txt"),
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog
      });
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      const response = await fetch(resourceUrl, {
        headers: payload.headers
      });
      if (!response.ok) {
        throw new Error(`下载失败：HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, buffer);
      return {
        ok: true,
        outputPath
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    }
  }
  async function mergeEmbeddedBrowserCapturedMseResources(tabId, payload) {
    var _a2, _b, _c, _d;
    const normalizedTabId = String(tabId || "").trim();
    const audioResourceKey = String(payload.audioResourceKey || ((_a2 = payload.audioResource) == null ? void 0 : _a2.resourceKey) || "").trim();
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
            audioResourceKey ? extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, audioResourceKey) : null,
            videoResourceKey ? extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, videoResourceKey) : null
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
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog
      });
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      const mergeResult = await mergeEmbeddedBrowserResourceTracks({
        audio: audioResource,
        ffmpegPath: payload.ffmpegPath,
        outputPath,
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
        async (view) => extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, resourceKey)
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
  function createPayloadTranscodeResource(input) {
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
      fileName: fileName || "media",
      mimeType: input == null ? void 0 : input.mimeType,
      requestHeaders: input == null ? void 0 : input.requestHeaders,
      resourceKey: input == null ? void 0 : input.resourceKey,
      streamType: input == null ? void 0 : input.streamType,
      url
    };
  }
  function deriveTranscodedFileName(fileName, outputFormat) {
    const parsedName = path.parse(String(fileName || "").trim() || "media");
    const baseName = parsedName.name || parsedName.base || "media";
    return `${baseName}.${outputFormat}`;
  }
  async function transcodeEmbeddedBrowserCapturedResourceForRenderer(tabId, payload) {
    var _a2, _b;
    const normalizedTabId = String(tabId || "").trim();
    const resourceKey = String(payload.resourceKey || ((_a2 = payload.resource) == null ? void 0 : _a2.resourceKey) || "").trim();
    const outputFormat = normalizeEmbeddedBrowserResourceTranscodeFormat(payload.outputFormat || "mp4");
    if (!normalizedTabId || !resourceKey && !((_b = payload.resource) == null ? void 0 : _b.url)) {
      return {
        error: "缺少要转格式的媒体资源",
        ok: false
      };
    }
    if (!outputFormat) {
      return {
        error: "请输入 1-12 位字母或数字格式，例如 mp3、m4a、mp4",
        ok: false
      };
    }
    try {
      let resource = createPayloadTranscodeResource(payload.resource);
      if (resourceKey) {
        const extractedResource = await withEmbeddedBrowserView(
          normalizedTabId,
          async (view) => extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, resourceKey)
        );
        resource = extractedResource || resource;
      }
      if (!resource) {
        return {
          error: "当前媒体资源还没有整理完成，先继续播放几秒再试试",
          ok: false
        };
      }
      const defaultFileName = String(payload.suggestedFileName || "").trim() || deriveTranscodedFileName(resource.fileName, outputFormat);
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: [outputFormat], name: `${outputFormat.toUpperCase()} Media` }
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog
      });
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      const result = await transcodeEmbeddedBrowserResource({
        ffmpegPath: payload.ffmpegPath,
        outputFormat,
        outputPath,
        resource
      });
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath
      };
    } catch (error) {
      runtimeLogger.warn("embedded browser resource transcode failed", {
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
      const requestId = String(payload.requestId || "").trim() || void 0;
      const defaultFileName = String(payload.suggestedFileName || "").trim() || deriveEmbeddedBrowserManifestOutputFileName(manifestUrl, kind);
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog
      });
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      if (kind === "hls") {
        emitEmbeddedBrowserHlsTask({
          durationSeconds: payload.durationSeconds,
          manifestUrl,
          message: "开始准备网络 manifest 下载",
          mode: "direct-manifest",
          requestId,
          stage: "preparing",
          status: "running",
          tabId: normalizedTabId
        });
        emitEmbeddedBrowserHlsTask({
          durationSeconds: payload.durationSeconds,
          manifestUrl,
          message: "已交给 ffmpeg 直拉处理",
          mode: "direct-manifest",
          requestId,
          stage: "ffmpeg",
          status: "running",
          tabId: normalizedTabId
        });
      }
      const result = await downloadEmbeddedBrowserManifestResource({
        durationSeconds: payload.durationSeconds,
        ffmpegPath: payload.ffmpegPath,
        headers: payload.headers,
        kind,
        manifestUrl,
        onProgress: kind === "hls" ? (progress) => {
          emitEmbeddedBrowserHlsTask({
            durationSeconds: payload.durationSeconds,
            ffmpegSpeedText: progress.speedText,
            manifestUrl,
            mode: "direct-manifest",
            processedSeconds: progress.processedSeconds,
            requestId,
            stage: "ffmpeg",
            status: "running",
            tabId: normalizedTabId
          });
        } : void 0,
        outputPath
      });
      if (kind === "hls") {
        emitEmbeddedBrowserHlsTask({
          durationSeconds: payload.durationSeconds,
          manifestUrl,
          message: "HLS 下载完成",
          mode: "direct-manifest",
          outputPath: result.outputPath,
          requestId,
          stage: "completed",
          status: "success",
          tabId: normalizedTabId
        });
      }
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath
      };
    } catch (error) {
      if (kind === "hls") {
        emitEmbeddedBrowserHlsTask({
          durationSeconds: payload.durationSeconds,
          error: error instanceof Error ? error.message : String(error),
          manifestUrl,
          message: error instanceof Error ? error.message : String(error),
          mode: "direct-manifest",
          requestId: String(payload.requestId || "").trim() || void 0,
          stage: "error",
          status: "error",
          tabId: normalizedTabId
        });
      }
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
  async function downloadEmbeddedBrowserHlsTracksResource(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    const videoManifestUrl = String(payload.videoManifestUrl || "").trim();
    const audioManifestUrl = String(payload.audioManifestUrl || "").trim();
    const requestId = String(payload.requestId || "").trim() || void 0;
    if (!normalizedTabId || !/^https?:\/\//i.test(videoManifestUrl) || !/^https?:\/\//i.test(audioManifestUrl)) {
      return {
        error: "缺少可合并的视频或音轨 manifest",
        ok: false
      };
    }
    let outputPath = null;
    try {
      outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName: String(payload.suggestedFileName || "").trim() || deriveEmbeddedBrowserManifestOutputFileName(videoManifestUrl, "hls"),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog
      });
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      emitEmbeddedBrowserHlsTask({
        durationSeconds: payload.durationSeconds,
        manifestUrl: videoManifestUrl,
        message: "开始下载并合并视频/音轨",
        mode: "direct-manifest",
        requestId,
        stage: "preparing",
        status: "running",
        tabId: normalizedTabId
      });
      const result = await downloadEmbeddedBrowserManifestTracks({
        audioManifestUrl,
        durationSeconds: payload.durationSeconds,
        ffmpegPath: payload.ffmpegPath,
        headers: payload.headers,
        onProgress: payload.durationSeconds ? (progress) => {
          emitEmbeddedBrowserHlsTask({
            durationSeconds: payload.durationSeconds,
            ffmpegSpeedText: progress.speedText,
            manifestUrl: videoManifestUrl,
            message: "正在通过 ffmpeg 合并视频和音轨",
            mode: "direct-manifest",
            processedSeconds: progress.processedSeconds,
            requestId,
            stage: "ffmpeg",
            status: "running",
            tabId: normalizedTabId
          });
        } : void 0,
        outputPath,
        videoManifestUrl
      });
      emitEmbeddedBrowserHlsTask({
        durationSeconds: payload.durationSeconds,
        manifestUrl: videoManifestUrl,
        message: "HLS 视频/音轨合并完成",
        mode: "direct-manifest",
        outputPath: result.outputPath,
        requestId,
        stage: "completed",
        status: "success",
        tabId: normalizedTabId
      });
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitEmbeddedBrowserHlsTask({
        durationSeconds: payload.durationSeconds,
        error: message,
        manifestUrl: videoManifestUrl,
        message,
        mode: "direct-manifest",
        requestId,
        stage: "error",
        status: "error",
        tabId: normalizedTabId
      });
      return {
        error: message,
        ok: false
      };
    }
  }
  async function downloadEmbeddedBrowserHlsPlanResource(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    await clearEmbeddedBrowserHlsRetrySessions({ tabId: normalizedTabId });
    if (!normalizedTabId || !payload.plan || !Array.isArray(payload.plan.fragments) || payload.plan.fragments.length === 0) {
      return {
        error: "缺少可下载的 HLS 计划",
        ok: false
      };
    }
    let latestFailedFragments;
    let outputPath = null;
    let retainRetrySession = false;
    let workDirectoryPath = "";
    const requestId = String(payload.requestId || "").trim() || void 0;
    try {
      const defaultFileName = String(payload.suggestedFileName || "").trim() || deriveEmbeddedBrowserManifestOutputFileName(payload.plan.manifestUrl, "hls");
      outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog
      });
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      emitEmbeddedBrowserHlsTask({
        manifestUrl: payload.plan.manifestUrl,
        message: "开始准备本地 HLS 下载任务",
        mode: "local-plan",
        requestId,
        stage: "preparing",
        status: "running",
        tabId: normalizedTabId,
        durationSeconds: payload.plan.durationSeconds,
        totalFragments: payload.plan.fragmentCount,
        usingManualKey: Boolean(payload.manualKeyBase64)
      });
      workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "omniflow-hls-download-"));
      const localDownloadResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        onEvent: (event) => {
          var _a2;
          if ((_a2 = event.failedFragments) == null ? void 0 : _a2.length) {
            latestFailedFragments = event.failedFragments;
          }
          emitEmbeddedBrowserHlsTask({
            bytesReceived: event.bytesReceived,
            bytesTotal: event.bytesTotal,
            completedFragments: event.completedFragments,
            durationSeconds: payload.plan.durationSeconds,
            error: event.error,
            etaSeconds: event.etaSeconds,
            failedFragments: event.failedFragments,
            manifestUrl: payload.plan.manifestUrl,
            message: event.message,
            mode: "local-plan",
            processedSeconds: void 0,
            requestId,
            speedBps: event.speedBps,
            stage: event.stage,
            status: event.status,
            tabId: normalizedTabId,
            totalFragments: event.totalFragments || payload.plan.fragmentCount,
            usingManualKey: Boolean(payload.manualKeyBase64)
          });
        },
        manualKeyBase64: payload.manualKeyBase64,
        plan: {
          fragments: payload.plan.fragments,
          headers: payload.plan.headers,
          manifestUrl: payload.plan.manifestUrl,
          suggestedThreadCount: payload.plan.suggestedThreadCount
        },
        workDirectoryPath
      });
      workDirectoryPath = localDownloadResult.workDirectoryPath;
      latestFailedFragments = void 0;
      emitEmbeddedBrowserHlsTask({
        completedFragments: payload.plan.fragmentCount,
        durationSeconds: payload.plan.durationSeconds,
        manifestUrl: payload.plan.manifestUrl,
        message: "本地 playlist 已生成，开始交给 ffmpeg",
        mode: "local-plan",
        requestId,
        stage: "ffmpeg",
        status: "running",
        tabId: normalizedTabId,
        totalFragments: payload.plan.fragmentCount,
        usingManualKey: Boolean(payload.manualKeyBase64)
      });
      const result = await downloadEmbeddedBrowserManifestResource({
        durationSeconds: payload.plan.durationSeconds,
        ffmpegPath: payload.ffmpegPath,
        kind: "hls",
        manifestUrl: localDownloadResult.playlistPath,
        onProgress: (progress) => {
          emitEmbeddedBrowserHlsTask({
            completedFragments: payload.plan.fragmentCount,
            durationSeconds: payload.plan.durationSeconds,
            ffmpegSpeedText: progress.speedText,
            manifestUrl: payload.plan.manifestUrl,
            mode: "local-plan",
            processedSeconds: progress.processedSeconds,
            requestId,
            stage: "ffmpeg",
            status: "running",
            tabId: normalizedTabId,
            totalFragments: payload.plan.fragmentCount,
            usingManualKey: Boolean(payload.manualKeyBase64)
          });
        },
        outputPath
      });
      emitEmbeddedBrowserHlsTask({
        completedFragments: payload.plan.fragmentCount,
        durationSeconds: payload.plan.durationSeconds,
        manifestUrl: payload.plan.manifestUrl,
        message: "HLS 下载完成",
        mode: "local-plan",
        outputPath: result.outputPath,
        requestId,
        stage: "completed",
        status: "success",
        tabId: normalizedTabId,
        totalFragments: payload.plan.fragmentCount,
        usingManualKey: Boolean(payload.manualKeyBase64)
      });
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath
      };
    } catch (error) {
      if (requestId && workDirectoryPath && outputPath && (latestFailedFragments == null ? void 0 : latestFailedFragments.length)) {
        embeddedBrowserHlsRetrySessions.set(requestId, {
          failedFragments: latestFailedFragments,
          ffmpegPath: payload.ffmpegPath,
          manualKeyBase64: payload.manualKeyBase64,
          outputPath,
          plan: payload.plan,
          requestId,
          tabId: normalizedTabId,
          workDirectoryPath
        });
        retainRetrySession = true;
      } else if (requestId) {
        embeddedBrowserHlsRetrySessions.delete(requestId);
      }
      emitEmbeddedBrowserHlsTask({
        durationSeconds: payload.plan.durationSeconds,
        error: error instanceof Error ? error.message : String(error),
        manifestUrl: payload.plan.manifestUrl,
        message: error instanceof Error ? error.message : String(error),
        mode: "local-plan",
        requestId,
        stage: "error",
        status: "error",
        tabId: normalizedTabId,
        totalFragments: payload.plan.fragmentCount,
        usingManualKey: Boolean(payload.manualKeyBase64)
      });
      runtimeLogger.warn("embedded browser hls plan download failed", {
        error: error instanceof Error ? error.message : String(error),
        manifestUrl: payload.plan.manifestUrl,
        tabId: normalizedTabId
      });
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    } finally {
      if (workDirectoryPath && !retainRetrySession) {
        await rm(workDirectoryPath, { force: true, recursive: true }).catch(() => void 0);
      }
    }
  }
  async function startEmbeddedBrowserHlsRecordingResource(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    const manifestUrl = String(payload.manifestUrl || "").trim();
    const requestId = String(payload.requestId || "").trim() || void 0;
    if (!normalizedTabId || !requestId || !/^https?:\/\//i.test(manifestUrl)) {
      return {
        error: "缺少可录制的直播 manifest",
        ok: false
      };
    }
    const existingSession = Array.from(embeddedBrowserHlsLiveRecordingSessions.values()).find((session2) => session2.tabId === normalizedTabId);
    if (existingSession) {
      return {
        error: "当前 tab 仍有未完成的直播录制，请先停止录制或重试导出",
        ok: false
      };
    }
    let outputPath = null;
    try {
      const suggestedFileName = String(payload.suggestedFileName || "").trim() || deriveEmbeddedBrowserManifestOutputFileName(manifestUrl, "hls");
      outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName: suggestedFileName,
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog
      });
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      emitEmbeddedBrowserHlsTask({
        manifestUrl,
        message: "开始准备直播录制任务",
        mode: "local-plan",
        requestId,
        stage: "preparing",
        status: "running",
        tabId: normalizedTabId,
        usingManualKey: Boolean(payload.manualKeyBase64)
      });
      const recorder = new EmbeddedBrowserHlsLiveRecorder({
        headers: payload.headers,
        manifestUrl,
        manualKeyBase64: payload.manualKeyBase64,
        onEvent: (event) => {
          emitEmbeddedBrowserHlsTask({
            bytesReceived: event.bytesReceived,
            bytesTotal: event.bytesTotal,
            completedFragments: event.completedFragments,
            durationSeconds: event.durationSeconds,
            error: event.error,
            etaSeconds: event.etaSeconds,
            failedFragments: event.failedFragments,
            manifestUrl,
            message: event.message,
            mode: "local-plan",
            requestId,
            speedBps: event.speedBps,
            stage: event.stage,
            status: event.status,
            tabId: normalizedTabId,
            totalFragments: event.totalFragments,
            usingManualKey: Boolean(payload.manualKeyBase64)
          });
        },
        pageUrl: payload.pageUrl,
        suggestedThreadCount: payload.suggestedThreadCount
      });
      embeddedBrowserHlsLiveRecordingSessions.set(requestId, {
        ffmpegPath: payload.ffmpegPath,
        manifestUrl,
        outputPath,
        recorder,
        requestId,
        tabId: normalizedTabId
      });
      await recorder.start();
      embeddedBrowserHlsLiveRecordingSessions.set(requestId, {
        ffmpegPath: payload.ffmpegPath,
        manifestUrl,
        outputPath,
        recorder,
        requestId,
        tabId: normalizedTabId,
        workDirectoryPath: recorder.getCurrentWorkDirectoryPath()
      });
      emitEmbeddedBrowserHlsTask({
        manifestUrl,
        message: "直播录制已开始，继续等待你手动停止",
        mode: "local-plan",
        requestId,
        stage: "downloading-fragments",
        status: "running",
        tabId: normalizedTabId,
        usingManualKey: Boolean(payload.manualKeyBase64)
      });
      return {
        ok: true,
        requestId
      };
    } catch (error) {
      await clearEmbeddedBrowserHlsLiveRecordingSessions({ requestId, tabId: normalizedTabId });
      emitEmbeddedBrowserHlsTask({
        error: error instanceof Error ? error.message : String(error),
        manifestUrl,
        message: error instanceof Error ? error.message : String(error),
        mode: "local-plan",
        requestId,
        stage: "error",
        status: "error",
        tabId: normalizedTabId,
        usingManualKey: Boolean(payload.manualKeyBase64)
      });
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    }
  }
  async function stopEmbeddedBrowserHlsRecordingResource(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    const requestId = String(payload.requestId || "").trim();
    if (!normalizedTabId || !requestId) {
      return {
        error: "缺少可停止的直播录制任务",
        ok: false
      };
    }
    const session2 = embeddedBrowserHlsLiveRecordingSessions.get(requestId);
    if (!session2 || session2.tabId !== normalizedTabId) {
      return {
        error: "直播录制任务不存在或已结束",
        ok: false
      };
    }
    let stopResult = null;
    try {
      emitEmbeddedBrowserHlsTask({
        manifestUrl: session2.manifestUrl,
        message: "正在停止直播录制并整理本地 playlist",
        mode: "local-plan",
        requestId,
        stage: "rewriting-playlist",
        status: "running",
        tabId: normalizedTabId
      });
      stopResult = await session2.recorder.stop();
      const completedRecording = stopResult;
      session2.workDirectoryPath = completedRecording.workDirectoryPath;
      emitEmbeddedBrowserHlsTask({
        completedFragments: completedRecording.totalFragments,
        durationSeconds: completedRecording.durationSeconds,
        manifestUrl: session2.manifestUrl,
        message: "直播录制已停止，开始交给 ffmpeg",
        mode: "local-plan",
        requestId,
        stage: "ffmpeg",
        status: "running",
        tabId: normalizedTabId,
        totalFragments: completedRecording.totalFragments
      });
      const result = await downloadEmbeddedBrowserManifestResource({
        durationSeconds: completedRecording.durationSeconds,
        ffmpegPath: session2.ffmpegPath,
        kind: "hls",
        manifestUrl: completedRecording.playlistPath,
        onProgress: (progress) => {
          emitEmbeddedBrowserHlsTask({
            completedFragments: completedRecording.totalFragments,
            durationSeconds: completedRecording.durationSeconds,
            ffmpegSpeedText: progress.speedText,
            manifestUrl: session2.manifestUrl,
            mode: "local-plan",
            processedSeconds: progress.processedSeconds,
            requestId,
            stage: "ffmpeg",
            status: "running",
            tabId: normalizedTabId,
            totalFragments: completedRecording.totalFragments
          });
        },
        outputPath: session2.outputPath
      });
      emitEmbeddedBrowserHlsTask({
        completedFragments: completedRecording.totalFragments,
        durationSeconds: completedRecording.durationSeconds,
        manifestUrl: session2.manifestUrl,
        message: "直播录制文件已完成",
        mode: "local-plan",
        outputPath: result.outputPath,
        requestId,
        stage: "completed",
        status: "success",
        tabId: normalizedTabId,
        totalFragments: completedRecording.totalFragments
      });
      embeddedBrowserHlsLiveRecordingSessions.delete(requestId);
      await rm(completedRecording.workDirectoryPath, { force: true, recursive: true }).catch(() => void 0);
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath
      };
    } catch (error) {
      emitEmbeddedBrowserHlsTask({
        error: error instanceof Error ? error.message : String(error),
        manifestUrl: session2.manifestUrl,
        message: error instanceof Error ? error.message : String(error),
        mode: "local-plan",
        requestId,
        stage: "error",
        status: "error",
        tabId: normalizedTabId
      });
      if (!stopResult) {
        embeddedBrowserHlsLiveRecordingSessions.delete(requestId);
      }
      if (!stopResult && session2.workDirectoryPath) {
        await rm(session2.workDirectoryPath, { force: true, recursive: true }).catch(() => void 0);
      }
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    }
  }
  async function discardEmbeddedBrowserHlsRecordingResource(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    const requestId = String(payload.requestId || "").trim();
    if (!normalizedTabId || !requestId) {
      return {
        error: "缺少可清理的直播录制任务",
        ok: false
      };
    }
    const session2 = embeddedBrowserHlsLiveRecordingSessions.get(requestId);
    if (!session2 || session2.tabId !== normalizedTabId) {
      return {
        ok: true
      };
    }
    await clearEmbeddedBrowserHlsLiveRecordingSessions({ requestId });
    return {
      ok: true
    };
  }
  async function retryEmbeddedBrowserHlsPlanFailedFragments(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    const requestId = String(payload.requestId || "").trim();
    if (!normalizedTabId || !requestId) {
      return {
        error: "缺少可重试的 HLS 任务",
        ok: false
      };
    }
    const session2 = embeddedBrowserHlsRetrySessions.get(requestId);
    if (!session2 || session2.tabId !== normalizedTabId) {
      return {
        error: "这条 HLS 失败任务已经过期，请重新执行一次完整下载",
        ok: false
      };
    }
    let latestFailedFragments = session2.failedFragments;
    let retainRetrySession = false;
    try {
      emitEmbeddedBrowserHlsTask({
        completedFragments: Math.max(0, session2.plan.fragmentCount - session2.failedFragments.length),
        durationSeconds: session2.plan.durationSeconds,
        failedFragments: session2.failedFragments,
        manifestUrl: session2.plan.manifestUrl,
        message: `开始重试 ${session2.failedFragments.length} 个失败分片`,
        mode: "local-plan",
        requestId,
        stage: "downloading-fragments",
        status: "running",
        tabId: normalizedTabId,
        totalFragments: session2.plan.fragmentCount,
        usingManualKey: Boolean(session2.manualKeyBase64)
      });
      const localDownloadResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fragmentIndexes: session2.failedFragments.map((value) => value - 1).filter((value) => value >= 0),
        manualKeyBase64: session2.manualKeyBase64,
        onEvent: (event) => {
          var _a2;
          if ((_a2 = event.failedFragments) == null ? void 0 : _a2.length) {
            latestFailedFragments = event.failedFragments;
          }
          emitEmbeddedBrowserHlsTask({
            bytesReceived: event.bytesReceived,
            bytesTotal: event.bytesTotal,
            completedFragments: event.completedFragments,
            durationSeconds: session2.plan.durationSeconds,
            error: event.error,
            etaSeconds: event.etaSeconds,
            failedFragments: event.failedFragments,
            manifestUrl: session2.plan.manifestUrl,
            message: event.message,
            mode: "local-plan",
            processedSeconds: void 0,
            requestId,
            speedBps: event.speedBps,
            stage: event.stage,
            status: event.status,
            tabId: normalizedTabId,
            totalFragments: event.totalFragments || session2.plan.fragmentCount,
            usingManualKey: Boolean(session2.manualKeyBase64)
          });
        },
        plan: {
          fragments: session2.plan.fragments,
          headers: session2.plan.headers,
          manifestUrl: session2.plan.manifestUrl,
          suggestedThreadCount: session2.plan.suggestedThreadCount
        },
        workDirectoryPath: session2.workDirectoryPath
      });
      latestFailedFragments = void 0;
      emitEmbeddedBrowserHlsTask({
        completedFragments: session2.plan.fragmentCount,
        durationSeconds: session2.plan.durationSeconds,
        manifestUrl: session2.plan.manifestUrl,
        message: "失败分片已补齐，开始交给 ffmpeg",
        mode: "local-plan",
        requestId,
        stage: "ffmpeg",
        status: "running",
        tabId: normalizedTabId,
        totalFragments: session2.plan.fragmentCount,
        usingManualKey: Boolean(session2.manualKeyBase64)
      });
      const result = await downloadEmbeddedBrowserManifestResource({
        durationSeconds: session2.plan.durationSeconds,
        ffmpegPath: session2.ffmpegPath,
        kind: "hls",
        manifestUrl: localDownloadResult.playlistPath,
        onProgress: (progress) => {
          emitEmbeddedBrowserHlsTask({
            completedFragments: session2.plan.fragmentCount,
            durationSeconds: session2.plan.durationSeconds,
            ffmpegSpeedText: progress.speedText,
            manifestUrl: session2.plan.manifestUrl,
            mode: "local-plan",
            processedSeconds: progress.processedSeconds,
            requestId,
            stage: "ffmpeg",
            status: "running",
            tabId: normalizedTabId,
            totalFragments: session2.plan.fragmentCount,
            usingManualKey: Boolean(session2.manualKeyBase64)
          });
        },
        outputPath: session2.outputPath
      });
      embeddedBrowserHlsRetrySessions.delete(requestId);
      emitEmbeddedBrowserHlsTask({
        completedFragments: session2.plan.fragmentCount,
        durationSeconds: session2.plan.durationSeconds,
        manifestUrl: session2.plan.manifestUrl,
        message: "HLS 下载完成",
        mode: "local-plan",
        outputPath: result.outputPath,
        requestId,
        stage: "completed",
        status: "success",
        tabId: normalizedTabId,
        totalFragments: session2.plan.fragmentCount,
        usingManualKey: Boolean(session2.manualKeyBase64)
      });
      await rm(session2.workDirectoryPath, { force: true, recursive: true }).catch(() => void 0);
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath
      };
    } catch (error) {
      if (latestFailedFragments == null ? void 0 : latestFailedFragments.length) {
        embeddedBrowserHlsRetrySessions.set(requestId, {
          ...session2,
          failedFragments: latestFailedFragments
        });
        retainRetrySession = true;
      } else {
        embeddedBrowserHlsRetrySessions.delete(requestId);
      }
      emitEmbeddedBrowserHlsTask({
        durationSeconds: session2.plan.durationSeconds,
        error: error instanceof Error ? error.message : String(error),
        failedFragments: latestFailedFragments,
        manifestUrl: session2.plan.manifestUrl,
        message: error instanceof Error ? error.message : String(error),
        mode: "local-plan",
        requestId,
        stage: "error",
        status: "error",
        tabId: normalizedTabId,
        totalFragments: session2.plan.fragmentCount,
        usingManualKey: Boolean(session2.manualKeyBase64)
      });
      if (!retainRetrySession) {
        await rm(session2.workDirectoryPath, { force: true, recursive: true }).catch(() => void 0);
      }
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    }
  }
  async function downloadEmbeddedBrowserMpdResource(tabId, payload) {
    return downloadEmbeddedBrowserManifestResourceForRenderer(tabId, payload, "mpd");
  }
  async function downloadEmbeddedBrowserMpdPlanResource(tabId, payload) {
    const normalizedTabId = String(tabId || "").trim();
    const requestId = String(payload.requestId || "").trim() || void 0;
    const plan = payload.plan;
    if (!normalizedTabId || !plan || !Array.isArray(plan.representations) || plan.representations.length === 0) {
      return {
        error: "缺少可下载的 MPD 计划",
        ok: false
      };
    }
    if (plan.hasDrm) {
      return {
        error: "当前 MPD 检测到 DRM，第一版下载器暂不支持",
        ok: false
      };
    }
    const selectedVideoRepresentation = String(payload.selectedVideoRepresentationId || "").trim() ? plan.representations.find((item) => item.id === String(payload.selectedVideoRepresentationId || "").trim()) : void 0;
    const selectedAudioRepresentation = String(payload.selectedAudioRepresentationId || "").trim() ? plan.representations.find((item) => item.id === String(payload.selectedAudioRepresentationId || "").trim()) : void 0;
    if (!selectedVideoRepresentation && !selectedAudioRepresentation) {
      return {
        error: "至少需要选择一条 MPD 轨道",
        ok: false
      };
    }
    try {
      const defaultFileName = String(payload.suggestedFileName || "").trim() || deriveEmbeddedBrowserManifestOutputFileName(plan.manifestUrl, "mpd");
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: ["mp4", "m4a", "webm"], name: "媒体文件" }
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog
      });
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false
        };
      }
      const result = await downloadEmbeddedBrowserMpdToOutput({
        ffmpegPath: payload.ffmpegPath,
        headers: plan.headers,
        outputPath,
        selectedAudioRepresentation,
        selectedVideoRepresentation
      });
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath
      };
    } catch (error) {
      runtimeLogger.warn("embedded browser mpd plan download failed", {
        error: error instanceof Error ? error.message : String(error),
        manifestUrl: plan.manifestUrl,
        requestId,
        tabId: normalizedTabId
      });
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      };
    }
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
    const recordProbeResource = buildEmbeddedBrowserProbeResourceRecorder(tabId);
    return createEmbeddedBrowserView({
      createIfMissingProbe: tryInstallEmbeddedBrowserResourceProbe,
      currentUrls: embeddedBrowserLastCommittedUrls,
      debugEnabled: options.debugEnabled,
      emitTabState: emitEmbeddedBrowserTabState,
      iconSourceUrls: embeddedBrowserIconSourceUrls,
      iconUrls: embeddedBrowserIconUrls,
      onAutoFillReady: (autoFillTabId, domain) => {
        const entries = getEmbeddedBrowserPasswordsForDomain(domain);
        if (!entries.length) {
          return;
        }
        const target = entries[0];
        const password = decryptEmbeddedBrowserPasswordForAutoFill(target.id);
        if (!password) {
          return;
        }
        const view = getEmbeddedBrowserView(autoFillTabId);
        if (!view || view.webContents.isDestroyed()) {
          return;
        }
        const fillScript = `window.__OMNIFLOW_FILL_CREDENTIAL__(${JSON.stringify(target.username)}, ${JSON.stringify(password)})`;
        view.webContents.executeJavaScript(fillScript, true).catch(() => {
        });
        if (entries.length > 1) {
          emitCredentialAutoFilled({
            tabId: autoFillTabId,
            domain,
            filledUsername: target.username,
            alternatives: entries.map((e) => ({ id: e.id, username: e.username }))
          });
        }
      },
      onCredentialPayload: (credentialTabId, payload) => {
        const username = typeof payload.username === "string" ? payload.username.trim() : "";
        const password = typeof payload.password === "string" ? payload.password : "";
        const domain = typeof payload.domain === "string" ? payload.domain.trim().toLowerCase() : "";
        const pageUrl = typeof payload.pageUrl === "string" ? payload.pageUrl : "";
        if (!username || !password || !domain) {
          return;
        }
        if (isEmbeddedBrowserBlacklistedDomain(domain)) {
          return;
        }
        if (hasEmbeddedBrowserMatchingPassword(domain, username)) {
          return;
        }
        const credentialRequestId = cacheEmbeddedBrowserCredential({
          domain,
          username,
          password,
          pageUrl,
          tabId: credentialTabId
        });
        emitCredentialCaptured({
          credentialRequestId,
          domain,
          username,
          pageUrl,
          tabId: credentialTabId
        });
      },
      onProbePayload: (payload) => {
        const event = typeof payload.event === "string" ? payload.event : "";
        const resourceKey = typeof payload.resourceKey === "string" ? payload.resourceKey : "";
        if (event === "mse-flush") {
          void appendEmbeddedBrowserMseSpoolChunk(tabId, {
            base64: typeof payload.base64 === "string" ? payload.base64 : "",
            fileName: typeof payload.fileName === "string" ? payload.fileName : void 0,
            mimeType: typeof payload.mimeType === "string" ? payload.mimeType : void 0,
            resourceKey,
            streamType: payload.streamType === "audio" || payload.streamType === "video" ? payload.streamType : void 0
          });
          return;
        }
        if (event === "mse-reset") {
          void clearEmbeddedBrowserMseSpoolFiles({ resourceKey, tabId });
          return;
        }
        recordProbeResource(payload);
      },
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
    void clearEmbeddedBrowserHlsRetrySessions({ tabId: normalizedTabId });
    void clearEmbeddedBrowserHlsLiveRecordingSessions({ tabId: normalizedTabId });
    void clearEmbeddedBrowserMseSpoolFiles({ tabId: normalizedTabId });
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
  async function handleClearCacheAndReload(tabId) {
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return false;
    }
    const view = getEmbeddedBrowserView(normalizedTabId);
    if (!view || view.webContents.isDestroyed()) {
      return false;
    }
    const browserSession = view.webContents.session;
    await browserSession.clearCache();
    await browserSession.clearStorageData({
      storages: ["cachestorage", "serviceworkers"]
    }).catch(() => void 0);
    const clearHostResolverCache = browserSession.clearHostResolverCache;
    if (typeof clearHostResolverCache === "function") {
      await clearHostResolverCache.call(browserSession).catch(() => void 0);
    }
    emitEmbeddedBrowserTabState(normalizedTabId, view, {
      details: "clear-cache-reload",
      state: "loading",
      url: embeddedBrowserLastCommittedUrls.get(normalizedTabId) || view.webContents.getURL() || void 0
    });
    view.webContents.reloadIgnoringCache();
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: "clear-cache-reload-requested"
    });
    return true;
  }
  async function handleResetPageStorageAndReload(tabId) {
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return false;
    }
    const currentView = getEmbeddedBrowserView(normalizedTabId);
    if (!currentView || currentView.webContents.isDestroyed()) {
      return false;
    }
    const targetWindow = options.getMainWindow();
    if (!targetWindow || targetWindow.isDestroyed()) {
      return false;
    }
    const reloadUrl = embeddedBrowserLastCommittedUrls.get(normalizedTabId) || currentView.webContents.getURL() || "";
    if (!reloadUrl) {
      return false;
    }
    let reloadOrigin = "";
    try {
      const parsedUrl = new URL(reloadUrl);
      reloadOrigin = parsedUrl.origin === "null" ? "" : parsedUrl.origin;
    } catch {
      reloadOrigin = "";
    }
    if (!reloadOrigin) {
      return false;
    }
    const previousCaptureState = getEmbeddedBrowserResourceCaptureSnapshot(normalizedTabId);
    const browserSession = currentView.webContents.session;
    await browserSession.clearStorageData({
      origin: reloadOrigin,
      storages: ["cachestorage", "serviceworkers", "indexdb", "websql"]
    }).catch(() => void 0);
    emitEmbeddedBrowserTabState(normalizedTabId, currentView, {
      details: "reset-page-storage",
      state: "loading",
      url: reloadUrl
    });
    closeEmbeddedBrowserTab(targetWindow, normalizedTabId);
    if (previousCaptureState.deepCaptureEnabled) {
      startEmbeddedBrowserDeepResourceCapture(normalizedTabId);
    } else if (previousCaptureState.enabled) {
      startEmbeddedBrowserResourceCapture(normalizedTabId);
    }
    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, reloadUrl, "navigate-exception");
    return true;
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
        const normalizedTabId = String(tabId || "").trim();
        const normalizedResourceKey = String(resourceKey || "").trim();
        if (normalizedResourceKey.startsWith("mse-stream:")) {
          const resource = await extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, normalizedResourceKey);
          if (resource && "filePath" in resource && resource.filePath) {
            const openError = await shell.openPath(resource.filePath);
            return !openError;
          }
        }
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
        const normalizedTabId = String(tabId || "").trim();
        const normalizedResourceKey = String(resourceKey || "").trim();
        if (normalizedResourceKey.startsWith("mse-stream:")) {
          const resource = await extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, normalizedResourceKey);
          if (resource) {
            const defaultFileName = deriveEmbeddedBrowserExtractedResourceOutputFileName(
              resource.fileName
            );
            const mainWindow2 = options.getMainWindow();
            const targetWindow = mainWindow2 && !mainWindow2.isDestroyed() ? mainWindow2 : void 0;
            const saveDialogOptions = {
              defaultPath: path.join(app.getPath("downloads"), defaultFileName),
              showsTagField: false
            };
            const saveResult = targetWindow ? await dialog.showSaveDialog(targetWindow, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
            if (saveResult.canceled || !saveResult.filePath) {
              return false;
            }
            await saveEmbeddedBrowserExtractedResourceFile(resource, saveResult.filePath);
            return true;
          }
        }
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
        const resource = await extractEmbeddedBrowserResourceFromFrames(String(tabId || "").trim(), view, resourceKey);
        if (!resource) {
          return null;
        }
        if (typeof resource.base64 === "string") {
          return {
            base64: resource.base64,
            fileName: resource.fileName,
            mimeType: resource.mimeType,
            resourceKey: resource.resourceKey || String(resourceKey || "").trim(),
            streamType: resource.streamType
          };
        }
        if (!("filePath" in resource) || !resource.filePath) {
          return null;
        }
        const fileBuffer = await readFile(resource.filePath);
        return {
          base64: fileBuffer.toString("base64"),
          fileName: resource.fileName,
          mimeType: resource.mimeType,
          resourceKey: resource.resourceKey || String(resourceKey || "").trim(),
          streamType: resource.streamType
        };
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
      clearBrowserCache: handleClearCacheAndReload,
      clearCapturedResources: (tabId) => clearEmbeddedBrowserCapturedResources(String(tabId || "").trim()),
      clearCatchMediaCache: (tabId) => handleCatchToolkitAction(tabId, "clearCatchMediaCache", "clear cache"),
      closeAll: handleCloseAll,
      closeTab: handleCloseTab,
      deactivate: handleDeactivate,
      downloadCatchMedia: (tabId) => handleCatchToolkitAction(tabId, "downloadCatchMedia", "download"),
      downloadHlsManifest: downloadEmbeddedBrowserHlsResource,
      startHlsRecording: startEmbeddedBrowserHlsRecordingResource,
      stopHlsRecording: stopEmbeddedBrowserHlsRecordingResource,
      discardHlsRecording: discardEmbeddedBrowserHlsRecordingResource,
      downloadHlsTracks: downloadEmbeddedBrowserHlsTracksResource,
      downloadHlsPlan: downloadEmbeddedBrowserHlsPlanResource,
      retryHlsPlanFailed: retryEmbeddedBrowserHlsPlanFailedFragments,
      downloadMpdManifest: downloadEmbeddedBrowserMpdResource,
      downloadMpdPlan: downloadEmbeddedBrowserMpdPlanResource,
      downloadDirectFile: downloadEmbeddedBrowserDirectFile,
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
      resetPageStorage: handleResetPageStorageAndReload,
      resolveFavicon: resolveEmbeddedBrowserBookmarkFavicon,
      restartCatchMediaCapture: (tabId) => handleCatchToolkitAction(tabId, "restartCatchMediaCapture", "restart"),
      saveResource: saveEmbeddedBrowserCapturedResourceForRenderer,
      setBounds: handleSetBounds,
      startCapturedResources: (tabId) => startEmbeddedBrowserResourceCapture(String(tabId || "").trim()),
      startDeepResourceCapture: handleStartDeepResourceCapture,
      stopCapturedResources: (tabId) => stopEmbeddedBrowserResourceCapture(String(tabId || "").trim()),
      transcodeResource: transcodeEmbeddedBrowserCapturedResourceForRenderer,
      updateCatchToolkitState: handleUpdateCatchToolkitState,
      getCookies: getEmbeddedBrowserCookies,
      removeCookie: removeEmbeddedBrowserCookie,
      removeCookiesByDomain: removeEmbeddedBrowserCookiesByDomain,
      removeAllCookies: removeAllEmbeddedBrowserCookies,
      getResourceCaptureRules: async () => listEmbeddedBrowserResourceCaptureRules(),
      updateResourceCaptureRules: async (ruleSet) => updateEmbeddedBrowserResourceCaptureRules(ruleSet),
      resetResourceCaptureRules: async () => resetEmbeddedBrowserResourceCaptureRules(),
      getExternalToolSettings: async () => listEmbeddedBrowserExternalToolSettings(),
      updateExternalToolSettings: async (settings) => updateEmbeddedBrowserExternalToolSettings(settings),
      resetExternalToolSettings: async () => resetEmbeddedBrowserExternalToolSettings(),
      listEnabledExternalTools: async () => listEnabledEmbeddedBrowserExternalToolOptions(),
      dispatchExternalTool: async (toolKey, payload) => dispatchEmbeddedBrowserExternalTool(toolKey, payload),
      listPasswords: listEmbeddedBrowserPasswords,
      getDecryptedPassword: getEmbeddedBrowserDecryptedPassword,
      saveCapturedCredential: async (credentialRequestId) => {
        const credential = consumeEmbeddedBrowserCachedCredential(credentialRequestId);
        if (!credential) {
          throw new Error("凭据已过期或不存在，请重新登录后再保存");
        }
        return saveEmbeddedBrowserPassword(credential);
      },
      deletePassword: deleteEmbeddedBrowserPassword,
      deleteAllPasswords: deleteAllEmbeddedBrowserPasswords,
      blacklistDomain: addEmbeddedBrowserBlacklistedDomain,
      isBlacklistedDomain: isEmbeddedBrowserBlacklistedDomain,
      autoFillPassword: async (autoFillTabId, passwordId) => {
        const store = listEmbeddedBrowserPasswords();
        const entry = store.find((p) => p.id === passwordId);
        if (!entry) {
          return null;
        }
        const password = decryptEmbeddedBrowserPasswordForAutoFill(passwordId);
        if (!password) {
          return null;
        }
        const view = getEmbeddedBrowserView(autoFillTabId);
        if (!view || view.webContents.isDestroyed()) {
          return null;
        }
        const fillScript = `window.__OMNIFLOW_FILL_CREDENTIAL__(${JSON.stringify(entry.username)}, ${JSON.stringify(password)})`;
        await view.webContents.executeJavaScript(fillScript, true).catch(() => {
        });
        return { username: entry.username };
      }
    });
  }
  return {
    configureSession,
    handleActiveViewInputShortcut,
    initializeBridges,
    registerIpcHandlers: registerIpcHandlers2,
    toggleActiveViewDevTools
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
function createOverlayWindowController(options) {
  let overlayWin = null;
  let readyPromise = null;
  let readyResolve = null;
  let boundsSyncScheduled = false;
  let screenListenerAttached = false;
  function ensureCreated() {
    if (overlayWin && !overlayWin.isDestroyed()) {
      return overlayWin;
    }
    const mainWindow2 = options.getMainWindow();
    if (!mainWindow2 || mainWindow2.isDestroyed()) {
      return null;
    }
    if (!screenListenerAttached) {
      screen.on("display-metrics-changed", () => {
        syncBoundsFromMain();
      });
      screenListenerAttached = true;
    }
    const win = new BrowserWindow({
      parent: mainWindow2,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: true,
      show: false,
      backgroundColor: "#00000000",
      acceptFirstMouse: true,
      webPreferences: {
        preload: options.preloadPath,
        devTools: true
      }
    });
    overlayWin = win;
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setContentBounds(mainWindow2.getContentBounds());
    readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error("[overlay] render-process-gone", details);
    });
    if (options.devServerUrl) {
      const url = options.devServerUrl.replace(/\/$/, "") + "/overlay.html";
      void win.loadURL(url);
    } else {
      void win.loadFile(path.join(options.rendererDist, "overlay.html"));
    }
    win.on("closed", () => {
      if (overlayWin === win) {
        overlayWin = null;
        readyPromise = null;
        readyResolve = null;
      }
    });
    return win;
  }
  async function ensureReady() {
    const win = ensureCreated();
    if (!win) return;
    if (readyPromise) await readyPromise;
  }
  function markReady(fromWebContents) {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    if (fromWebContents !== overlayWin.webContents) return;
    if (readyResolve) {
      const resolve = readyResolve;
      readyResolve = null;
      resolve();
    }
  }
  function syncBoundsFromMain() {
    if (boundsSyncScheduled) return;
    boundsSyncScheduled = true;
    setImmediate(() => {
      boundsSyncScheduled = false;
      if (!overlayWin || overlayWin.isDestroyed()) return;
      const mainWindow2 = options.getMainWindow();
      if (!mainWindow2 || mainWindow2.isDestroyed()) return;
      try {
        overlayWin.setContentBounds(mainWindow2.getContentBounds());
      } catch {
      }
    });
  }
  function showSpec(spec) {
    const win = ensureCreated();
    if (!win) return;
    void (async () => {
      await ensureReady();
      if (!overlayWin || overlayWin.isDestroyed()) return;
      syncBoundsFromMain();
      if (!overlayWin.isVisible()) {
        overlayWin.show();
      }
      overlayWin.webContents.send("overlay:host:show", spec);
      overlayWin.focus();
    })();
  }
  function dismissSpec(payload) {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    overlayWin.webContents.send("overlay:host:dismiss-from-main", payload);
  }
  function setClickThrough(ignore) {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    if (ignore) {
      overlayWin.setIgnoreMouseEvents(true, { forward: true });
      const mainWindow2 = options.getMainWindow();
      if (mainWindow2 && !mainWindow2.isDestroyed()) {
        mainWindow2.focus();
      }
    } else {
      overlayWin.setIgnoreMouseEvents(false);
    }
  }
  function hideIdle() {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    if (overlayWin.isVisible()) {
      overlayWin.hide();
    }
  }
  function destroy() {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.destroy();
    }
    overlayWin = null;
    readyPromise = null;
  }
  return {
    ensureReady,
    markReady,
    getWindow: () => overlayWin,
    showSpec,
    dismissSpec,
    setClickThrough,
    hideIdle,
    syncBoundsFromMain,
    destroy
  };
}
const OVERLAY_REQUEST_TIMEOUT_MS = 10 * 60 * 1e3;
function registerOverlayWindowIpcHandlers(controller) {
  let currentRequest = null;
  const queue = [];
  function cleanupPending(pending) {
    clearTimeout(pending.timeoutTimer);
    if (!pending.senderContents.isDestroyed()) {
      pending.senderContents.removeListener("destroyed", pending.senderDestroyedListener);
    }
  }
  function promote(next) {
    currentRequest = next;
    controller.setClickThrough(false);
    const spec = {
      requestId: next.requestId,
      type: next.type,
      props: next.props
    };
    controller.showSpec(spec);
  }
  function advanceQueueOrIdle() {
    const next = queue.shift();
    if (next) {
      promote(next);
    } else {
      currentRequest = null;
      controller.setClickThrough(true);
      controller.hideIdle();
    }
  }
  function rejectAndDrop(pending, reason) {
    cleanupPending(pending);
    pending.reject(reason);
  }
  function handleSenderDestroyed(pending) {
    if (currentRequest === pending) {
      controller.dismissSpec({ requestId: pending.requestId });
      rejectAndDrop(pending, new Error("overlay sender destroyed"));
      advanceQueueOrIdle();
      return;
    }
    const index = queue.indexOf(pending);
    if (index >= 0) {
      queue.splice(index, 1);
      rejectAndDrop(pending, new Error("overlay sender destroyed"));
    }
  }
  function handleTimeout(pending) {
    if (currentRequest === pending) {
      controller.dismissSpec({ requestId: pending.requestId });
      rejectAndDrop(pending, new Error("overlay request timed out"));
      advanceQueueOrIdle();
      return;
    }
    const index = queue.indexOf(pending);
    if (index >= 0) {
      queue.splice(index, 1);
      rejectAndDrop(pending, new Error("overlay request timed out"));
    }
  }
  ipcMain.handle("overlay:open", async (event, payload) => {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const pending = {
        requestId,
        type: payload == null ? void 0 : payload.type,
        props: payload == null ? void 0 : payload.props,
        resolve,
        reject,
        senderContents: event.sender,
        senderDestroyedListener: () => handleSenderDestroyed(pending),
        timeoutTimer: setTimeout(() => handleTimeout(pending), OVERLAY_REQUEST_TIMEOUT_MS)
      };
      event.sender.once("destroyed", pending.senderDestroyedListener);
      if (currentRequest) {
        queue.push(pending);
      } else {
        promote(pending);
      }
    });
  });
  ipcMain.on("overlay:host:resolve", (_event, payload) => {
    if (!currentRequest || currentRequest.requestId !== (payload == null ? void 0 : payload.requestId)) return;
    const pending = currentRequest;
    cleanupPending(pending);
    pending.resolve(payload.result);
    advanceQueueOrIdle();
  });
  ipcMain.on("overlay:host:ready", (event) => {
    controller.markReady(event.sender);
  });
  ipcMain.on("overlay:host:dismiss", (_event, payload) => {
    if (!currentRequest || currentRequest.requestId !== (payload == null ? void 0 : payload.requestId)) return;
    const pending = currentRequest;
    cleanupPending(pending);
    pending.resolve({ type: "cancel", reason: payload.reason ?? "dismiss" });
    advanceQueueOrIdle();
  });
}
var __freeze = Object.freeze;
var __defProp2 = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp2(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
function createSystemVideoWindowDataUrl() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(SYSTEM_VIDEO_WINDOW_HTML)}`;
}
const SYSTEM_VIDEO_WINDOW_HTML = String.raw(_a || (_a = __template([`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: http: https:; media-src http: https: blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src http: https: blob: data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>视频</title>
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #08090b;
      color: #f6f7fb;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      user-select: none;
    }
    .shell {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: #08090b;
    }
    .header {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      box-sizing: border-box;
      background: rgba(18, 20, 25, 0.96);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      -webkit-app-region: drag;
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 12px;
      font-weight: 650;
      color: rgba(246, 247, 251, 0.9);
    }
    .close {
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(246, 247, 251, 0.9);
      font-size: 16px;
      line-height: 22px;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    .close:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .video-host {
      flex: 1;
      min-height: 0;
      display: flex;
      background: #000;
    }
    video {
      width: 100%;
      height: 100%;
      background: #000;
      outline: none;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <div class="title" id="title">视频</div>
      <button class="close" id="close" type="button" aria-label="关闭">×</button>
    </div>
    <div class="video-host">
      <video id="video" controls playsinline></video>
    </div>
  </div>
  <script>
    const video = document.getElementById('video');
    const title = document.getElementById('title');
    const closeButton = document.getElementById('close');
    let pendingCurrentTime = null;
    let lastReportAt = 0;

    function report(force = false) {
      const now = Date.now();
      if (!force && now - lastReportAt < 180) return;
      lastReportAt = now;
      window.electronSystemVideoHost?.reportState({
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        isPlaying: !video.paused && !video.ended,
        volume: Number.isFinite(video.volume) ? video.volume : 1,
        muted: Boolean(video.muted),
        ended: Boolean(video.ended),
      });
    }

    function applyCurrentTime(time) {
      if (!Number.isFinite(time) || time < 0) return;
      if (video.readyState >= 1) {
        video.currentTime = time;
      } else {
        pendingCurrentTime = time;
      }
    }

    window.electronSystemVideoHost?.onInit((payload) => {
      title.textContent = payload.title || '视频';
      title.title = payload.title || '视频';
      document.title = payload.title || '视频';
      video.src = payload.src;
      video.volume = Number.isFinite(payload.volume) ? Math.min(Math.max(payload.volume, 0), 1) : 1;
      video.muted = Boolean(payload.muted);
      applyCurrentTime(payload.currentTime || 0);
      if (payload.isPlaying) {
        video.play().catch(() => undefined);
      }
      report(true);
    });

    window.electronSystemVideoHost?.onCommand((command) => {
      if (command.type === 'play') {
        video.play().catch(() => undefined);
      } else if (command.type === 'pause') {
        video.pause();
      } else if (command.type === 'seek') {
        applyCurrentTime(command.time);
      }
      report(true);
    });

    video.addEventListener('loadedmetadata', () => {
      if (pendingCurrentTime != null) {
        video.currentTime = pendingCurrentTime;
        pendingCurrentTime = null;
      }
      report(true);
    });
    ['play', 'pause', 'ended', 'volumechange', 'seeked'].forEach((eventName) => {
      video.addEventListener(eventName, () => report(true));
    });
    video.addEventListener('timeupdate', () => report(false));
    closeButton.addEventListener('click', () => {
      video.pause();
      report(true);
      window.electronSystemVideoHost?.close();
    });
    window.electronSystemVideoHost?.reportReady();
  <\/script>
</body>
</html>`])));
const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 360;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 240;
function createSystemVideoWindowController(options) {
  let videoWin = null;
  let readyPromise = null;
  let readyResolve = null;
  let lastState = null;
  function ensureCreated() {
    if (videoWin && !videoWin.isDestroyed()) {
      return videoWin;
    }
    const mainWindow2 = options.getMainWindow();
    const mainBounds = mainWindow2 && !mainWindow2.isDestroyed() ? mainWindow2.getBounds() : screen.getPrimaryDisplay().workArea;
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
      backgroundColor: "#08090b",
      autoHideMenuBar: true,
      webPreferences: {
        preload: options.preloadPath,
        devTools: true
      }
    });
    videoWin = win;
    readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error("[system-video-window] render-process-gone", details);
    });
    win.on("closed", () => {
      if (videoWin === win) {
        videoWin = null;
        readyPromise = null;
        readyResolve = null;
      }
      const main = options.getMainWindow();
      if (main && !main.isDestroyed()) {
        main.webContents.send("system-video-window:closed", lastState);
      }
    });
    void win.loadURL(createSystemVideoWindowDataUrl());
    return win;
  }
  async function ensureReady(win) {
    if (win.isDestroyed()) return;
    if (readyPromise) await readyPromise;
  }
  async function open(payload) {
    const win = ensureCreated();
    if (!win) return false;
    lastState = {
      currentTime: payload.currentTime,
      duration: payload.duration ?? 0,
      isPlaying: payload.isPlaying,
      volume: payload.volume,
      muted: payload.muted,
      ended: false
    };
    await ensureReady(win);
    if (!videoWin || videoWin.isDestroyed()) return false;
    videoWin.setTitle(payload.title || "视频");
    videoWin.webContents.send("system-video-window:host:init", payload);
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
  function sendCommand(payload) {
    if (!videoWin || videoWin.isDestroyed()) return false;
    videoWin.webContents.send("system-video-window:host:command", payload);
    return true;
  }
  function markReady(fromWebContents) {
    if (!videoWin || videoWin.isDestroyed()) return;
    if (fromWebContents !== videoWin.webContents) return;
    if (readyResolve) {
      const resolve = readyResolve;
      readyResolve = null;
      resolve();
    }
  }
  function updateState(payload) {
    lastState = payload;
    const main = options.getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send("system-video-window:state", payload);
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
    destroy
  };
}
function registerSystemVideoWindowIpcHandlers(controller) {
  ipcMain.handle("system-video-window:open", (_event, payload) => controller.open(payload));
  ipcMain.handle("system-video-window:close", () => controller.close());
  ipcMain.handle("system-video-window:command", (_event, payload) => controller.sendCommand(payload));
  ipcMain.on("system-video-window:host:ready", (event) => {
    controller.markReady(event.sender);
  });
  ipcMain.on("system-video-window:host:state", (_event, payload) => {
    controller.updateState(payload);
  });
  ipcMain.on("system-video-window:host:close", () => {
    controller.close();
  });
}
const MACOS_TRAFFIC_LIGHT_POSITION = { x: 14, y: 11 };
function getMacOSMainWindowOptions() {
  return {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
    vibrancy: "sidebar",
    visualEffectState: "active"
  };
}
function applyMacOSMainWindowBehavior(win) {
  win.setWindowButtonPosition(MACOS_TRAFFIC_LIGHT_POSITION);
}
function getWindowsMainWindowOptions() {
  return {
    titleBarStyle: "default"
  };
}
const DEFAULT_MAIN_WINDOW_OPTIONS = {
  titleBarStyle: "default"
};
function getMainWindowPlatformOptions(platform = process.platform) {
  if (platform === "darwin") {
    return getMacOSMainWindowOptions();
  }
  if (platform === "win32") {
    return getWindowsMainWindowOptions();
  }
  return DEFAULT_MAIN_WINDOW_OPTIONS;
}
function applyMainWindowPlatformBehavior(win, platform = process.platform) {
  if (platform === "darwin") {
    applyMacOSMainWindowBehavior(win);
  }
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_PREVIEW_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);
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
const MIN_WINDOW_WIDTH = 1120;
const MIN_WINDOW_HEIGHT = 720;
const WINDOW_STATE_FILENAME = "window-state.json";
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 200;
const ENABLE_EMBEDDED_BROWSER_DEBUG = process.env.NODE_ENV === "test" || Boolean(VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true";
const ENABLE_CHROMIUM_RUNTIME_LOGS = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
function resolveUserDataDirname() {
  const suffix = String(process.env.OMNIFLOW_USER_DATA_SUFFIX || "").trim();
  if (!suffix) {
    return LEGACY_USER_DATA_DIRNAME;
  }
  const normalizedSuffix = suffix.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalizedSuffix ? `${LEGACY_USER_DATA_DIRNAME}-${normalizedSuffix}` : LEGACY_USER_DATA_DIRNAME;
}
if (!ENABLE_CHROMIUM_RUNTIME_LOGS) {
  app.commandLine.appendSwitch("disable-logging");
  app.commandLine.appendSwitch("log-level", "3");
}
app.setName(APP_DISPLAY_NAME);
try {
  const stableUserDataPath = path.join(app.getPath("appData"), resolveUserDataDirname());
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
function getChromiumPageZoomShortcutAction(input) {
  if (input.type !== "keyDown" || !(input.meta || input.control)) {
    return null;
  }
  const key = (input.key || "").toLowerCase();
  const code = input.code || "";
  if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") {
    return "zoom-in";
  }
  if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") {
    return "zoom-out";
  }
  if (key === "0" || code === "Digit0" || code === "Numpad0") {
    return "reset";
  }
  return null;
}
const embeddedBrowserMainController = createEmbeddedBrowserMainController({
  debugEnabled: ENABLE_EMBEDDED_BROWSER_DEBUG,
  getMainWindow: () => mainWindow
});
const overlayWindowController = createOverlayWindowController({
  getMainWindow: () => mainWindow,
  preloadPath: path.join(MAIN_DIST, "preload.mjs"),
  rendererDist: RENDERER_DIST,
  devServerUrl: VITE_DEV_SERVER_URL
});
const systemVideoWindowController = createSystemVideoWindowController({
  getMainWindow: () => mainWindow,
  preloadPath: path.join(MAIN_DIST, "preload.mjs")
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
    ...getMainWindowPlatformOptions(),
    ...isFiniteNumber(persistedWindowState == null ? void 0 : persistedWindowState.x) && isFiniteNumber(persistedWindowState == null ? void 0 : persistedWindowState.y) ? { x: persistedWindowState.x, y: persistedWindowState.y } : {},
    webPreferences: {
      preload: path.join(MAIN_DIST, "preload.mjs"),
      devTools: true
    },
    autoHideMenuBar: true,
    ...appIconPath ? { icon: appIconPath } : {}
  });
  mainWindow = win;
  applyMainWindowPlatformBehavior(win);
  if (persistedWindowState == null ? void 0 : persistedWindowState.maximized) {
    win.maximize();
  }
  win.on("move", () => {
    scheduleSaveWindowState(win);
    overlayWindowController.syncBoundsFromMain();
  });
  win.on("resize", () => {
    scheduleSaveWindowState(win);
    overlayWindowController.syncBoundsFromMain();
  });
  win.on("maximize", () => {
    scheduleSaveWindowState(win);
    overlayWindowController.syncBoundsFromMain();
  });
  win.on("unmaximize", () => {
    scheduleSaveWindowState(win);
    overlayWindowController.syncBoundsFromMain();
  });
  win.on("enter-full-screen", () => {
    overlayWindowController.syncBoundsFromMain();
    setTimeout(() => overlayWindowController.syncBoundsFromMain(), 300);
  });
  win.on("leave-full-screen", () => {
    overlayWindowController.syncBoundsFromMain();
    setTimeout(() => overlayWindowController.syncBoundsFromMain(), 300);
  });
  win.on("minimize", () => {
    const overlay = overlayWindowController.getWindow();
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
      overlay.hide();
    }
  });
  win.on("restore", () => {
    overlayWindowController.syncBoundsFromMain();
  });
  win.on("hide", () => {
    const overlay = overlayWindowController.getWindow();
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
      overlay.hide();
    }
  });
  win.on("show", () => {
    overlayWindowController.syncBoundsFromMain();
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
    overlayWindowController.destroy();
    systemVideoWindowController.destroy();
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (embeddedBrowserMainController.handleActiveViewInputShortcut(input)) {
      event.preventDefault();
      return;
    }
    const zoomShortcutAction = getChromiumPageZoomShortcutAction(input);
    if (zoomShortcutAction) {
      event.preventDefault();
      win.webContents.setZoomFactor(1);
      win.webContents.send("app:viewer-zoom-shortcut", { action: zoomShortcutAction });
      return;
    }
    if (!isDevToolsToggleShortcut(input)) {
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
  overlayWindowController.destroy();
  systemVideoWindowController.destroy();
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
  registerImagePreviewProtocol();
  embeddedBrowserMainController.initializeBridges();
  registerIpcHandlers();
  registerWindowControlIpcHandlers({
    getMainWindow: () => mainWindow
  });
  embeddedBrowserMainController.registerIpcHandlers();
  registerOverlayWindowIpcHandlers(overlayWindowController);
  registerSystemVideoWindowIpcHandlers(systemVideoWindowController);
  const toggleActiveDevToolsFromMenu = () => {
    if (embeddedBrowserMainController.toggleActiveViewDevTools()) {
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  };
  const template = [
    ...process.platform === "darwin" ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : [],
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          accelerator: process.platform === "darwin" ? "Command+Alt+I" : "CommandOrControl+Shift+I",
          click: toggleActiveDevToolsFromMenu,
          label: "Toggle Developer Tools"
        },
        ...process.platform === "darwin" ? [] : [{
          accelerator: "F12",
          click: toggleActiveDevToolsFromMenu,
          label: "Toggle Developer Tools (F12)"
        }]
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" },
        ...process.platform === "darwin" ? [
          { type: "separator" },
          { role: "front" }
        ] : []
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  void overlayWindowController.ensureReady();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
