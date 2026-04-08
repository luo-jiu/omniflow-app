// 所有与文件相关的通信逻辑

import { dialog } from 'electron';
import fs from 'fs/promises';
import fsRaw from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';

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

const DOWNLOAD_REQUEST_TIMEOUT_MS = 60_000;

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

async function downloadUrlToFile(
  url: string,
  targetPath: string,
  headers: Record<string, string> = {},
  redirectDepth = 0,
): Promise<void> {
  const MAX_REDIRECT_DEPTH = 3;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`不支持的下载协议: ${parsed.protocol}`);
  }
  const transport = parsed.protocol === 'https:' ? https : http;

  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers,
    }, (response: IncomingMessage) => {
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
        downloadUrlToFile(nextUrl, targetPath, headers, redirectDepth + 1)
          .then(settleResolve)
          .catch(settleReject);
        return;
      }

      if (statusCode >= 400) {
        response.resume();
        settleReject(new Error(`下载失败: HTTP ${statusCode} (${url})`));
        return;
      }

      const fileStream = fsRaw.createWriteStream(targetPath);
      const cleanupAndReject = async (error: unknown) => {
        try {
          fileStream.destroy();
        } catch {
          // ignore
        }
        try {
          await fs.rm(targetPath, { force: true });
        } catch {
          // ignore
        }
        settleReject(error);
      };

      response.on('error', (error) => {
        void cleanupAndReject(error);
      });
      fileStream.on('error', (error) => {
        void cleanupAndReject(error);
      });
      fileStream.on('finish', () => settleResolve());

      response.pipe(fileStream);
    });

    request.setTimeout(DOWNLOAD_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`下载请求超时: ${DOWNLOAD_REQUEST_TIMEOUT_MS}ms`));
    });
    request.on('error', (error) => settleReject(error));
    request.end();
  });
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
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const files: DesktopUploadFileEntry[] = [];

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') {
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
      relativePath,
    });
  }

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
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return await fs.readFile(result.filePaths[0], 'utf-8');
  });

  ipcMain.handle('file:save', async (_e, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
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
}
