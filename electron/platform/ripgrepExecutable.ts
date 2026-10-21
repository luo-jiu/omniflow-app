import path from 'node:path';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';

export interface DesktopRipgrepLocation {
  platform: NodeJS.Platform;
  architecture: string;
  appPath: string;
  resourcesPath?: string;
  isPackaged: boolean;
}

/** Main-private executable resource. Never derives a command from PATH or user input. */
export function getDesktopRipgrepPath(location: DesktopRipgrepLocation): string | null {
  if (!['darwin', 'linux', 'win32'].includes(location.platform)
    || !['arm64', 'x64'].includes(location.architecture)) return null;
  const api = location.platform === 'win32' ? path.win32 : path.posix;
  const binaryName = location.platform === 'win32' ? 'rg.exe' : 'rg';
  if (location.isPackaged) {
    return location.resourcesPath && api.isAbsolute(location.resourcesPath)
      ? api.join(location.resourcesPath, 'ripgrep', binaryName) : null;
  }
  if (!api.isAbsolute(location.appPath)) return null;
  return api.join(location.appPath, 'build', 'native', 'ripgrep', location.platform === 'darwin'
    ? 'darwin-universal' : `${location.platform}-${location.architecture}`, binaryName);
}

export async function resolveDesktopRipgrepExecutable(location: DesktopRipgrepLocation): Promise<string | null> {
  const candidate = getDesktopRipgrepPath(location);
  if (!candidate) return null;
  try {
    await access(candidate, constants.X_OK);
    return (await stat(candidate)).isFile() ? candidate : null;
  } catch { return null; }
}
