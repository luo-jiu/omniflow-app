export interface DesktopUploadFileEntry {
  name: string;
  size: number;
  localPath: string;
  relativePath: string;
}

export interface DesktopUploadPickResult {
  canceled: boolean;
  files: DesktopUploadFileEntry[];
}

function getFileBaseName(input: string): string {
  const normalized = String(input || '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

export function isIgnoredSystemFilePath(input: string): boolean {
  const baseName = getFileBaseName(input);
  if (!baseName) return true;
  if (baseName === '.DS_Store') return true;
  if (baseName.startsWith('._')) return true;
  if (baseName === 'Thumbs.db') return true;
  return false;
}

function normalizeRelativePath(input: string): string {
  return String(input || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function buildFileNameFromLocalPath(localPath: string): string {
  return getFileBaseName(localPath) || 'unknown';
}

export interface UploadCandidateFile {
  file: File;
  relativePath: string;
}

type FileWithPath = File & { path: string };

function toUploadCandidateFile(entry: DesktopUploadFileEntry): UploadCandidateFile {
  const normalizedRelativePath = normalizeRelativePath(entry.relativePath || entry.name);
  const fileName = buildFileNameFromLocalPath(entry.localPath);
  const fileLike: FileWithPath = {
    name: normalizedRelativePath || fileName,
    size: Number(entry.size || 0),
    type: '',
    path: entry.localPath,
  } as FileWithPath;

  return {
    file: fileLike,
    relativePath: normalizedRelativePath || fileName,
  };
}

async function pickBy(method: 'pickUploadFiles' | 'pickUploadFolders'): Promise<UploadCandidateFile[]> {
  const picker = window.electronAPI?.[method];
  if (typeof picker !== 'function') {
    throw new Error('当前环境不支持系统文件选择');
  }
  const result = (await picker()) as DesktopUploadPickResult;
  if (!result || result.canceled || !Array.isArray(result.files) || result.files.length === 0) {
    return [];
  }
  return result.files
    .filter(entry => !isIgnoredSystemFilePath(entry.relativePath || entry.name || entry.localPath))
    .map(toUploadCandidateFile);
}

export async function pickUploadFilesFromDesktop(): Promise<UploadCandidateFile[]> {
  return pickBy('pickUploadFiles');
}

export async function pickUploadFoldersFromDesktop(): Promise<UploadCandidateFile[]> {
  return pickBy('pickUploadFolders');
}
