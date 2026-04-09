export interface AutoImportDesktopFileEntry {
  name: string;
  size: number;
  localPath: string;
  relativePath: string;
}

interface AutoImportDesktopPickResult {
  canceled: boolean;
  files: AutoImportDesktopFileEntry[];
}

interface FileWithPath extends File {
  path: string;
}

export interface AutoImportUploadCandidate {
  file: FileWithPath;
  relativePath: string;
}

function normalizeRelativePath(input: string): string {
  return String(input || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function buildUploadCandidate(entry: AutoImportDesktopFileEntry): AutoImportUploadCandidate {
  const relativePath = normalizeRelativePath(entry.relativePath || entry.name);
  const fileName = relativePath.split('/').filter(Boolean).pop() || entry.name || 'unknown';
  const fileLike = {
    name: fileName,
    size: Number(entry.size || 0),
    type: '',
    path: entry.localPath,
  } as FileWithPath;
  return { file: fileLike, relativePath: relativePath || fileName };
}

export async function pickAutoImportDirectoryFromDesktop(): Promise<string | null> {
  if (!window.electronAPI || typeof window.electronAPI.pickAutoImportDirectory !== 'function') {
    throw new Error('当前环境不支持目录选择');
  }
  const result = await window.electronAPI.pickAutoImportDirectory();
  if (!result || result.canceled || !result.directoryPath) {
    return null;
  }
  return String(result.directoryPath || '').trim() || null;
}

export async function claimAutoImportFilesFromDesktop(
  watchDirectory: string,
  maxFiles?: number,
): Promise<AutoImportUploadCandidate[]> {
  if (!window.electronAPI || typeof window.electronAPI.claimAutoImportFiles !== 'function') {
    throw new Error('当前环境不支持自动导入');
  }
  const result = (await window.electronAPI.claimAutoImportFiles(
    watchDirectory,
    maxFiles,
  )) as AutoImportDesktopPickResult;
  if (!result || result.canceled || !Array.isArray(result.files) || result.files.length === 0) {
    return [];
  }
  return result.files
    .filter((entry) => Boolean(entry?.localPath))
    .map(buildUploadCandidate);
}

export async function cleanupAutoImportStagedFile(localPath: string): Promise<boolean> {
  if (!window.electronAPI || typeof window.electronAPI.cleanupAutoImportStagedFile !== 'function') {
    return false;
  }
  if (!String(localPath || '').trim()) {
    return false;
  }
  return Boolean(await window.electronAPI.cleanupAutoImportStagedFile(localPath));
}

