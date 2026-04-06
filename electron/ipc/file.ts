// 所有与文件相关的通信逻辑

import { dialog } from 'electron';
import fs from 'fs/promises';
import path from 'node:path';

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
}
