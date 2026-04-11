import { dialog, app, net, ipcMain, BrowserWindow, screen, WebContentsView } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs$1, { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import fs from "fs/promises";
import http from "node:http";
import https from "node:https";
import require$$0 from "os";
import require$$1 from "child_process";
import fs$2 from "fs";
const DOWNLOAD_REQUEST_TIMEOUT_MS = 6e4;
const AUTO_IMPORT_DEFAULT_DIR_NAME = "Omniflow Inbox";
const AUTO_IMPORT_OBSERVE_TTL_MS = 10 * 60 * 1e3;
const AUTO_IMPORT_MIN_STABLE_COUNT = 2;
const AUTO_IMPORT_MIN_MTIME_AGE_MS = 2e3;
const AUTO_IMPORT_DEFAULT_MAX_FILES = 12;
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
function isPathInsideDirectory(filePath, directoryPath) {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedDirectoryPath = path.resolve(directoryPath);
  if (resolvedFilePath === resolvedDirectoryPath) return true;
  return resolvedFilePath.startsWith(`${resolvedDirectoryPath}${path.sep}`);
}
function buildStagedFileName(fileName) {
  const safeName = String(fileName || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}
async function moveFileSafe(sourcePath, targetPath) {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if ((error == null ? void 0 : error.code) !== "EXDEV") {
      throw error;
    }
    await fs.copyFile(sourcePath, targetPath);
    await fs.rm(sourcePath, { force: true });
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
  const stat = await fs.stat(normalizedDirectory).catch(() => null);
  if (!(stat == null ? void 0 : stat.isDirectory())) {
    return [];
  }
  const entries = await fs.readdir(normalizedDirectory, { withFileTypes: true });
  const seenPaths = /* @__PURE__ */ new Set();
  const nowTs = Date.now();
  const readyCandidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (shouldIgnoreSystemEntry(entry.name)) continue;
    if (isTransientDownloadEntry(entry.name)) continue;
    const sourcePath = path.join(normalizedDirectory, entry.name);
    const fileStat = await fs.stat(sourcePath).catch(() => null);
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
  await fs.mkdir(stagingRoot, { recursive: true });
  const claimedFiles = [];
  const claimLimit = Math.max(1, Math.floor(Number(maxFiles) || AUTO_IMPORT_DEFAULT_MAX_FILES));
  for (const candidate of readyCandidates.slice(0, claimLimit)) {
    const stagedPath = path.join(stagingRoot, buildStagedFileName(candidate.name));
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
  if (!normalizedPath || !isPathInsideDirectory(normalizedPath, stagingRoot)) {
    return false;
  }
  await fs.rm(normalizedPath, { force: true });
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
  const pendingDirectories = [currentPath];
  const pendingFiles = [];
  while (pendingDirectories.length > 0) {
    const directoryPath = pendingDirectories.pop();
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
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
    while (true) {
      const workIndex = currentIndex;
      currentIndex += 1;
      if (workIndex >= pendingFiles.length) {
        return;
      }
      const candidate = pendingFiles[workIndex];
      const stat = await fs.stat(candidate.absolutePath).catch(() => null);
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
  ipcMain2.handle("dialog:pick-download-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, directoryPath: "" };
    }
    return { canceled: false, directoryPath: result.filePaths[0] };
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
    await fs.mkdir(targetPath, { recursive: true });
    return targetPath;
  });
  ipcMain2.handle("fs:download-url-to-path", async (_event, url, baseDirectory, relativePath, headers = {}) => {
    const targetPath = resolveTargetPath(baseDirectory, relativePath);
    await downloadUrlToFile(url, targetPath, headers);
    return targetPath;
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
  const stats = fs$2.statfsSync(process.platform === "win32" ? "C:" : "/");
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
let windowHandlersRegistered = false;
let isQuitting = false;
const WINDOW_ACTIVATE_TOPMOST_DURATION_MS = 240;
let windowStateSaveTimer = null;
const embeddedBrowserViews = /* @__PURE__ */ new Map();
const embeddedBrowserLastCommittedUrls = /* @__PURE__ */ new Map();
let activeEmbeddedBrowserTabId = null;
let embeddedBrowserPendingBounds = null;
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
  if (win.isDestroyed()) return;
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
  const emitEmbeddedBrowserState = (payload) => {
    runtimeLogger.log("[embedded-browser:main]", payload);
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("embedded-browser:state", payload);
  };
  const collectEmbeddedBrowserDebugMeta = async (view) => {
    if (!ENABLE_EMBEDDED_BROWSER_DEBUG || view.webContents.isDestroyed()) {
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
  };
  const getEmbeddedBrowserTitle = (view) => {
    const runtimeTitle = view.webContents.getTitle().trim();
    if (runtimeTitle) {
      return runtimeTitle;
    }
    return void 0;
  };
  const emitEmbeddedBrowserTabState = (tabId, view, payload) => {
    emitEmbeddedBrowserState({
      tabId,
      title: payload.title ?? getEmbeddedBrowserTitle(view),
      ...payload
    });
  };
  const getEmbeddedBrowserView = (tabId) => {
    const view = embeddedBrowserViews.get(tabId);
    if (!view || view.webContents.isDestroyed()) {
      embeddedBrowserViews.delete(tabId);
      embeddedBrowserLastCommittedUrls.delete(tabId);
      return null;
    }
    return view;
  };
  const syncEmbeddedBrowserViewBounds = (view) => {
    view.setBounds(embeddedBrowserPendingBounds ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  };
  const detachActiveEmbeddedBrowserView = (targetWindow) => {
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
  };
  const createEmbeddedBrowserView = (tabId) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null;
    }
    const existingView = getEmbeddedBrowserView(tabId);
    if (existingView) {
      return existingView;
    }
    const view = new WebContentsView({
      webPreferences: {
        devTools: true
      }
    });
    view.webContents.setZoomFactor(1);
    const currentUserAgent = view.webContents.getUserAgent();
    if (currentUserAgent.includes("Electron")) {
      view.webContents.setUserAgent(
        currentUserAgent.replace(/\sElectron\/[^\s]+/g, "")
      );
    }
    syncEmbeddedBrowserViewBounds(view);
    embeddedBrowserViews.set(tabId, view);
    view.webContents.on("did-start-loading", () => {
      emitEmbeddedBrowserTabState(tabId, view, {
        details: "did-start-loading",
        state: "loading",
        url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(tabId) || void 0
      });
    });
    view.webContents.on("did-stop-loading", async () => {
      if (view.webContents.isDestroyed()) {
        return;
      }
      const committedUrl = view.webContents.getURL() || "";
      embeddedBrowserLastCommittedUrls.set(tabId, committedUrl);
      const meta = await collectEmbeddedBrowserDebugMeta(view);
      emitEmbeddedBrowserTabState(tabId, view, {
        details: "did-stop-loading",
        ...meta.length ? { meta } : {},
        state: "ready",
        url: committedUrl || void 0
      });
    });
    view.webContents.on("did-navigate", (_event, url) => {
      embeddedBrowserLastCommittedUrls.set(tabId, url);
      emitEmbeddedBrowserTabState(tabId, view, { details: "did-navigate", state: "ready", url });
    });
    view.webContents.on("did-navigate-in-page", (_event, url) => {
      embeddedBrowserLastCommittedUrls.set(tabId, url);
      emitEmbeddedBrowserTabState(tabId, view, { details: "did-navigate-in-page", state: "ready", url });
    });
    view.webContents.on("page-title-updated", (_event, title) => {
      emitEmbeddedBrowserTabState(tabId, view, {
        details: "page-title-updated",
        state: "ready",
        title: title || void 0,
        url: embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || void 0
      });
    });
    view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) {
        return;
      }
      emitEmbeddedBrowserTabState(tabId, view, {
        details: `did-fail-load(${errorCode})`,
        state: "error",
        message: `页面加载失败：${errorDescription || "未知错误"}`,
        url: validatedURL
      });
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      emitEmbeddedBrowserTabState(tabId, view, {
        details: `render-process-gone:${details.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${details.reason}`,
        url: embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || void 0
      });
    });
    view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (ENABLE_EMBEDDED_BROWSER_DEBUG && level >= 2) {
        emitEmbeddedBrowserTabState(tabId, view, {
          details: `console:${sourceId}:${line}`,
          state: "ready",
          message,
          meta: [`console-level=${level}`],
          url: embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || void 0
        });
      }
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      void view.webContents.loadURL(url);
      return { action: "deny" };
    });
    return view;
  };
  const activateEmbeddedBrowserTab = (targetWindow, tabId, options) => {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null;
    }
    if (!tabId) {
      detachActiveEmbeddedBrowserView(targetWindow);
      return null;
    }
    const createIfMissing = (options == null ? void 0 : options.createIfMissing) ?? false;
    const nextView = createIfMissing ? createEmbeddedBrowserView(tabId) : getEmbeddedBrowserView(tabId);
    if (!nextView) {
      detachActiveEmbeddedBrowserView(targetWindow);
      return null;
    }
    if (!nextView || nextView.webContents.isDestroyed()) {
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
  };
  const loadEmbeddedBrowserUrl = async (targetWindow, tabId, url, errorDetails, activateOnly = false) => {
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
  };
  const closeEmbeddedBrowserTab = (targetWindow, tabId) => {
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
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false });
    }
  };
  ipcMain.handle("embedded-browser:open-tab", async (event, tabId, url) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      emitEmbeddedBrowserState({
        state: "ready",
        tabId,
        title: "新标签页"
      });
      return;
    }
    await loadEmbeddedBrowserUrl(targetWindow, tabId, normalizedUrl, "open-exception", true);
  });
  ipcMain.handle("embedded-browser:activate-tab", (event, tabId) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    activateEmbeddedBrowserTab(targetWindow, tabId, { createIfMissing: false });
  });
  ipcMain.handle("embedded-browser:navigate", async (event, tabId, url) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    await loadEmbeddedBrowserUrl(targetWindow, tabId, url, "navigate-exception");
  });
  ipcMain.handle("embedded-browser:reload", async (_event, tabId) => {
    var _a;
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) {
      return;
    }
    (_a = getEmbeddedBrowserView(normalizedTabId)) == null ? void 0 : _a.webContents.reload();
  });
  ipcMain.handle("embedded-browser:set-bounds", (event, bounds) => {
    const nextBounds = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const zoomFactor = targetWindow && !targetWindow.isDestroyed() ? Math.max(targetWindow.webContents.getZoomFactor(), 0.01) : 1;
    nextBounds.x = Math.max(0, Math.round(bounds.x * zoomFactor));
    nextBounds.y = Math.max(0, Math.round(bounds.y * zoomFactor));
    nextBounds.width = Math.max(0, Math.round(bounds.width * zoomFactor));
    nextBounds.height = Math.max(0, Math.round(bounds.height * zoomFactor));
    embeddedBrowserPendingBounds = nextBounds;
    runtimeLogger.log("[embedded-browser:bounds]", { raw: bounds, zoomFactor, applied: nextBounds });
    if (!activeEmbeddedBrowserTabId) {
      return;
    }
    const activeView = getEmbeddedBrowserView(activeEmbeddedBrowserTabId);
    if (!activeView) {
      return;
    }
    activeView.setBounds(nextBounds);
  });
  ipcMain.handle("embedded-browser:close-tab", (event, tabId) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    closeEmbeddedBrowserTab(targetWindow, tabId);
  });
  ipcMain.handle("embedded-browser:deactivate", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    detachActiveEmbeddedBrowserView(targetWindow);
  });
  ipcMain.handle("embedded-browser:close-all", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    Array.from(embeddedBrowserViews.keys()).forEach((tabId) => {
      closeEmbeddedBrowserTab(targetWindow, tabId);
    });
    activeEmbeddedBrowserTabId = null;
    emitEmbeddedBrowserState({ state: "idle" });
  });
}
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
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...isFiniteNumber(persistedWindowState == null ? void 0 : persistedWindowState.x) && isFiniteNumber(persistedWindowState == null ? void 0 : persistedWindowState.y) ? { x: persistedWindowState.x, y: persistedWindowState.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: path.join(MAIN_DIST, "preload.mjs"),
      // Electron 安全推荐配置
      devTools: true
      // nodeIntegration: false,     // 禁用 Node.js 集成
      // contextIsolation: true,     // 启用上下文隔离
      // webSecurity: true           // 启用同源策略
    },
    autoHideMenuBar: true,
    // 自动隐藏菜单栏
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowState(mainWindow);
  }
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
