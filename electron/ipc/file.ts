// 所有与文件相关的通信逻辑

import { app, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'node:path';

import { downloadUrlToFile } from '../service/fileTransfer';

interface DesktopUploadFileEntry {
  name: string;
  size: number;
  localPath: string;
  relativePath: string;
}

interface DesktopUploadPickResult {
  canceled: boolean;
  files: DesktopUploadFileEntry[];
}

interface DesktopDirectoryPickResult {
  canceled: boolean;
  directoryPath: string;
}

interface DesktopTextFileReadResult {
  canceled: boolean;
  content: string;
  filePath: string;
}

interface DesktopSaveFileResult {
  canceled: boolean;
  filePath: string;
}

interface DesktopDialogFileFilter {
  name: string;
  extensions: string[];
}

interface DesktopTextFileOpenOptions {
  filters?: DesktopDialogFileFilter[];
}

interface DesktopSaveFileOptions {
  filters?: DesktopDialogFileFilter[];
}

interface DesktopStagedTextFileResult {
  filePath: string;
  size: number;
}

const AUTO_IMPORT_DEFAULT_DIR_NAME = 'Omniflow Inbox';
const AUTO_IMPORT_OBSERVE_TTL_MS = 10 * 60 * 1000;
const AUTO_IMPORT_MIN_STABLE_COUNT = 2;
const AUTO_IMPORT_MIN_MTIME_AGE_MS = 2_000;
const AUTO_IMPORT_DEFAULT_MAX_FILES = 12;
const MAC_CHROME_BOOKMARK_RELATIVE_PATH = path.join(
  'Library',
  'Application Support',
  'Google',
  'Chrome',
  'Default',
  'Bookmarks',
);

interface AutoImportObservedFileState {
  size: number;
  mtimeMs: number;
  stableCount: number;
  lastSeenAt: number;
}

const autoImportObservedFiles = new Map<string, AutoImportObservedFileState>();

function shouldIgnoreSystemEntry(entryName: string): boolean {
  const normalized = String(entryName || '');
  if (!normalized) return true;
  if (normalized === '.DS_Store') return true;
  if (normalized.startsWith('._')) return true;
  if (normalized === 'Thumbs.db') return true;
  return false;
}

function normalizeRelativePath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function isTransientDownloadEntry(entryName: string): boolean {
  const normalized = String(entryName || '').toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith('.')) return true;
  return (
    normalized.endsWith('.crdownload')
    || normalized.endsWith('.part')
    || normalized.endsWith('.tmp')
    || normalized.endsWith('.opdownload')
    || normalized.endsWith('.download')
  );
}

function getAutoImportStagingRoot(): string {
  return path.join(app.getPath('userData'), 'auto-import-staging');
}

function getEmbeddedBrowserDownloadStagingRoot(): string {
  return path.join(app.getPath('userData'), 'embedded-browser-downloads');
}

function getTextFileStagingRoot(): string {
  return path.join(app.getPath('userData'), 'text-file-staging');
}

function normalizeDialogFilters(
  filters: DesktopDialogFileFilter[] | undefined,
  fallback: DesktopDialogFileFilter[],
): DesktopDialogFileFilter[] {
  const normalized = Array.isArray(filters)
    ? filters
        .map((filter) => ({
          name: String(filter?.name || '').trim() || 'Files',
          extensions: Array.isArray(filter?.extensions)
            ? filter.extensions
                .map((extension) => String(extension || '').trim().replace(/^\./, ''))
                .filter(Boolean)
            : [],
        }))
        .filter((filter) => filter.extensions.length > 0)
    : [];

  return normalized.length > 0 ? normalized : fallback;
}

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedDirectoryPath = path.resolve(directoryPath);
  if (resolvedFilePath === resolvedDirectoryPath) return true;
  return resolvedFilePath.startsWith(`${resolvedDirectoryPath}${path.sep}`);
}

function buildStagedFileName(fileName: string): string {
  const safeName = String(fileName || 'unknown')
    .replace(/[/\\]/g, '_')
    .trim() || 'unknown';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}

async function moveFileSafe(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    await fs.copyFile(sourcePath, targetPath);
    await fs.rm(sourcePath, { force: true });
  }
}

function cleanupObservedState(seenPaths: Set<string>) {
  const nowTs = Date.now();
  for (const [observedPath, observedState] of autoImportObservedFiles.entries()) {
    if (seenPaths.has(observedPath)) continue;
    if (nowTs - observedState.lastSeenAt <= AUTO_IMPORT_OBSERVE_TTL_MS) continue;
    autoImportObservedFiles.delete(observedPath);
  }
}

async function claimStableInboxFiles(
  watchDirectory: string,
  maxFiles = AUTO_IMPORT_DEFAULT_MAX_FILES,
): Promise<DesktopUploadFileEntry[]> {
  const rawDirectory = String(watchDirectory || '').trim();
  const normalizedDirectory = rawDirectory
    ? path.resolve(rawDirectory)
    : path.join(app.getPath('downloads'), AUTO_IMPORT_DEFAULT_DIR_NAME);

  const stat = await fs.stat(normalizedDirectory).catch(() => null);
  if (!stat?.isDirectory()) {
    return [];
  }

  const entries = await fs.readdir(normalizedDirectory, { withFileTypes: true });
  const seenPaths = new Set<string>();
  const nowTs = Date.now();
  const readyCandidates: Array<{
    sourcePath: string;
    name: string;
    size: number;
    mtimeMs: number;
  }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (shouldIgnoreSystemEntry(entry.name)) continue;
    if (isTransientDownloadEntry(entry.name)) continue;

    const sourcePath = path.join(normalizedDirectory, entry.name);
    const fileStat = await fs.stat(sourcePath).catch(() => null);
    if (!fileStat?.isFile()) continue;

    seenPaths.add(sourcePath);
    const previous = autoImportObservedFiles.get(sourcePath);
    const unchanged = previous
      ? previous.size === fileStat.size && previous.mtimeMs === fileStat.mtimeMs
      : false;
    const stableCount = unchanged && previous ? previous.stableCount + 1 : 1;

    autoImportObservedFiles.set(sourcePath, {
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      stableCount,
      lastSeenAt: nowTs,
    });

    if (stableCount < AUTO_IMPORT_MIN_STABLE_COUNT) continue;
    if (nowTs - fileStat.mtimeMs < AUTO_IMPORT_MIN_MTIME_AGE_MS) continue;

    readyCandidates.push({
      sourcePath,
      name: entry.name,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    });
  }

  cleanupObservedState(seenPaths);
  if (readyCandidates.length === 0) {
    return [];
  }

  readyCandidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const stagingRoot = getAutoImportStagingRoot();
  await fs.mkdir(stagingRoot, { recursive: true });

  const claimedFiles: DesktopUploadFileEntry[] = [];
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
      relativePath: normalizeRelativePath(candidate.name),
    });
  }

  return claimedFiles;
}

async function cleanupStagedFile(stagedPath: string): Promise<boolean> {
  const normalizedPath = path.resolve(String(stagedPath || '').trim());
  const stagingRoot = getAutoImportStagingRoot();
  if (!normalizedPath || !isPathInsideDirectory(normalizedPath, stagingRoot)) {
    return false;
  }

  await fs.rm(normalizedPath, { force: true });
  return true;
}

function resolveTargetPath(baseDirectory: string, relativePath: string): string {
  const normalizedRelativePath = normalizeRelativePath(relativePath || '');
  if (!normalizedRelativePath) {
    return baseDirectory;
  }
  const segments = normalizedRelativePath.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`非法下载路径片段: ${segment}`);
    }
    if (segment.includes('\0')) {
      throw new Error('非法下载路径：包含空字符');
    }
  }
  return path.join(baseDirectory, ...segments);
}

function byRelativePath(a: DesktopUploadFileEntry, b: DesktopUploadFileEntry): number {
  return a.relativePath.localeCompare(b.relativePath, 'zh-Hans-CN');
}

async function collectFilesFromSelectedFilePaths(filePaths: string[]): Promise<DesktopUploadFileEntry[]> {
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
      relativePath: normalizeRelativePath(fileName),
    } as DesktopUploadFileEntry;
  }));
  return files.filter((item): item is DesktopUploadFileEntry => Boolean(item)).sort(byRelativePath);
}

async function walkDirectoryFiles(
  rootPath: string,
  currentPath: string,
  rootDisplayName: string,
): Promise<DesktopUploadFileEntry[]> {
  interface PendingFileCandidate {
    absolutePath: string;
    name: string;
  }

  const pendingDirectories: string[] = [currentPath];
  const pendingFiles: PendingFileCandidate[] = [];

  while (pendingDirectories.length > 0) {
    const directoryPath = pendingDirectories.pop() as string;
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') {
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
        name: entry.name,
      });
    }
  }

  const files: DesktopUploadFileEntry[] = [];
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
      const stat = await fs.stat(candidate.absolutePath).catch(() => null);
      if (!stat?.isFile()) {
        continue;
      }
      const relativeInsideRoot = normalizeRelativePath(path.relative(rootPath, candidate.absolutePath));
      const relativePath = normalizeRelativePath(path.join(rootDisplayName, relativeInsideRoot));
      files.push({
        name: candidate.name,
        size: stat.size,
        localPath: candidate.absolutePath,
        relativePath,
      });
    }
  };

  const workerCount = Math.min(STAT_CONCURRENCY, Math.max(1, pendingFiles.length));
  await Promise.all(Array.from({ length: workerCount }, () => statWorker()));
  return files;
}

async function collectFilesFromSelectedFolders(folderPaths: string[]): Promise<DesktopUploadFileEntry[]> {
  const allFiles: DesktopUploadFileEntry[] = [];
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

export function registerFileIpc(ipcMain: Electron.IpcMain) {
  ipcMain.handle('file:open', async (
    _event,
    options?: DesktopTextFileOpenOptions,
  ): Promise<DesktopTextFileReadResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'dontAddToRecent'],
      filters: normalizeDialogFilters(options?.filters, [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ]),
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, content: '', filePath: '' };
    }
    const filePath = result.filePaths[0];
    return {
      canceled: false,
      content: await fs.readFile(filePath, 'utf-8'),
      filePath,
    };
  });

  ipcMain.handle('file:save', async (_e, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  });

  ipcMain.handle('fs:write-text-file', async (
    _event,
    filePath: string,
    content: string,
  ): Promise<string> => {
    const normalizedPath = path.resolve(String(filePath || '').trim());
    if (!normalizedPath) {
      throw new Error('无效的文本保存路径');
    }
    await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
    await fs.writeFile(normalizedPath, String(content ?? ''), 'utf-8');
    return normalizedPath;
  });

  ipcMain.handle('file:read-text', async (_event, filePath: string): Promise<DesktopTextFileReadResult> => {
    const normalizedPath = path.resolve(String(filePath || '').trim());
    return {
      canceled: false,
      content: await fs.readFile(normalizedPath, 'utf-8'),
      filePath: normalizedPath,
    };
  });

  ipcMain.handle('file:read-local-chrome-bookmarks', async (): Promise<DesktopTextFileReadResult> => {
    const filePath = path.join(app.getPath('home'), MAC_CHROME_BOOKMARK_RELATIVE_PATH);
    return {
      canceled: false,
      content: await fs.readFile(filePath, 'utf-8'),
      filePath,
    };
  });

  ipcMain.handle('dialog:pick-upload-files', async (): Promise<DesktopUploadPickResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, files: [] };
    }
    const files = await collectFilesFromSelectedFilePaths(result.filePaths);
    return { canceled: false, files };
  });

  ipcMain.handle('dialog:pick-upload-folders', async (): Promise<DesktopUploadPickResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, files: [] };
    }
    const files = await collectFilesFromSelectedFolders(result.filePaths);
    return { canceled: false, files };
  });

  ipcMain.handle('dialog:pick-download-directory', async (): Promise<DesktopDirectoryPickResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, directoryPath: '' };
    }
    return { canceled: false, directoryPath: result.filePaths[0] };
  });

  ipcMain.handle('dialog:save-download-file', async (
    _event,
    defaultFileName: string,
    options?: DesktopSaveFileOptions,
  ): Promise<DesktopSaveFileResult> => {
    const result = await dialog.showSaveDialog({
      defaultPath: String(defaultFileName || 'download'),
      filters: normalizeDialogFilters(options?.filters, [
        { name: 'All Files', extensions: ['*'] },
      ]),
      showsTagField: false,
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: '' };
    }
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('dialog:pick-auto-import-directory', async (): Promise<DesktopDirectoryPickResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, directoryPath: '' };
    }
    return { canceled: false, directoryPath: result.filePaths[0] };
  });

  ipcMain.handle('fs:claim-auto-import-files', async (
    _event,
    watchDirectory: string,
    maxFiles: number = AUTO_IMPORT_DEFAULT_MAX_FILES,
  ): Promise<DesktopUploadPickResult> => {
    const files = await claimStableInboxFiles(watchDirectory, maxFiles);
    return { canceled: false, files };
  });

  ipcMain.handle('fs:cleanup-auto-import-staged-file', async (
    _event,
    stagedPath: string,
  ): Promise<boolean> => {
    try {
      return await cleanupStagedFile(stagedPath);
    } catch {
      return false;
    }
  });

  ipcMain.handle('fs:ensure-directory', async (
    _event,
    baseDirectory: string,
    relativePath: string = '',
  ): Promise<string> => {
    const targetPath = resolveTargetPath(baseDirectory, relativePath);
    await fs.mkdir(targetPath, { recursive: true });
    return targetPath;
  });

  ipcMain.handle('fs:download-url-to-path', async (
    _event,
    url: string,
    baseDirectory: string,
    relativePath: string,
    headers: Record<string, string> = {},
  ): Promise<string> => {
    const targetPath = resolveTargetPath(baseDirectory, relativePath);
    await downloadUrlToFile(url, targetPath, headers);
    return targetPath;
  });

  ipcMain.handle('fs:save-staged-download-file', async (
    _event,
    stagedPath: string,
    targetFilePath: string,
  ): Promise<string> => {
    const normalizedSourcePath = path.resolve(String(stagedPath || '').trim());
    const normalizedTargetPath = path.resolve(String(targetFilePath || '').trim());
    const stagingRoot = getEmbeddedBrowserDownloadStagingRoot();

    if (!normalizedSourcePath || !isPathInsideDirectory(normalizedSourcePath, stagingRoot)) {
      throw new Error('无效的下载临时文件');
    }
    if (!normalizedTargetPath) {
      throw new Error('无效的保存路径');
    }

    await fs.mkdir(path.dirname(normalizedTargetPath), { recursive: true });
    await fs.copyFile(normalizedSourcePath, normalizedTargetPath);
    return normalizedTargetPath;
  });

  ipcMain.handle('fs:create-staged-text-file', async (
    _event,
    fileName: string,
    content: string,
  ): Promise<DesktopStagedTextFileResult> => {
    const stagingRoot = getTextFileStagingRoot();
    await fs.mkdir(stagingRoot, { recursive: true });

    const stagedPath = path.join(stagingRoot, buildStagedFileName(fileName || 'subtitle.txt'));
    const normalizedContent = String(content ?? '');
    await fs.writeFile(stagedPath, normalizedContent, 'utf-8');
    return {
      filePath: stagedPath,
      size: Buffer.byteLength(normalizedContent, 'utf-8'),
    };
  });

  ipcMain.handle('fs:cleanup-staged-text-file', async (
    _event,
    stagedPath: string,
  ): Promise<boolean> => {
    const normalizedPath = path.resolve(String(stagedPath || '').trim());
    const stagingRoot = getTextFileStagingRoot();
    if (!normalizedPath || !isPathInsideDirectory(normalizedPath, stagingRoot)) {
      return false;
    }
    await fs.rm(normalizedPath, { force: true });
    return true;
  });
}
