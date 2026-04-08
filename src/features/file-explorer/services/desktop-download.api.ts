export interface DesktopDownloadDirectoryPickResult {
  canceled: boolean;
  directoryPath: string;
}

function normalizeRelativePath(input: string): string {
  return String(input || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function assertDesktopSupport() {
  if (!window.electronAPI) {
    throw new Error('当前环境不支持本地下载');
  }
}

export async function pickDownloadDirectoryFromDesktop(): Promise<DesktopDownloadDirectoryPickResult> {
  assertDesktopSupport();
  const result = await window.electronAPI.pickDownloadDirectory();
  if (!result || result.canceled || !result.directoryPath) {
    return { canceled: true, directoryPath: '' };
  }
  return {
    canceled: false,
    directoryPath: String(result.directoryPath),
  };
}

export async function ensureDesktopDirectory(baseDirectory: string, relativePath: string): Promise<string> {
  assertDesktopSupport();
  const normalized = normalizeRelativePath(relativePath);
  return window.electronAPI.ensureDirectory(baseDirectory, normalized);
}

export async function downloadUrlToDesktopPath(
  url: string,
  baseDirectory: string,
  relativePath: string,
  headers?: Record<string, string>,
): Promise<string> {
  assertDesktopSupport();
  const normalized = normalizeRelativePath(relativePath);
  return window.electronAPI.downloadUrlToPath(url, baseDirectory, normalized, headers);
}

export function normalizeDownloadRelativePath(input: string): string {
  return normalizeRelativePath(input);
}
