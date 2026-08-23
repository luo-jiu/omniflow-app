import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

interface DesktopMediaExecutableEnvironment {
  OMNIFLOW_FFMPEG_PATH?: string;
  OMNIFLOW_FFPROBE_PATH?: string;
  PATH?: string;
}

interface DesktopMediaExecutableCandidateOptions {
  environment?: DesktopMediaExecutableEnvironment;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
}

function siblingExecutablePath(
  sourcePath: string,
  sourceBaseName: string,
  targetBaseName: string,
  pathApi: path.PlatformPath,
): string | null {
  const normalized = String(sourcePath || '').trim();
  if (!pathApi.isAbsolute(normalized)) return null;
  const extension = pathApi.extname(normalized);
  const baseName = pathApi.basename(normalized, extension);
  if (baseName.toLowerCase() !== sourceBaseName) return null;
  return pathApi.join(pathApi.dirname(normalized), `${targetBaseName}${extension}`);
}

export function getDesktopFfprobeCandidates(
  options: DesktopMediaExecutableCandidateOptions = {},
): string[] {
  const environment = options.environment || process.env;
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  const resourcesPath = String(options.resourcesPath ?? process.resourcesPath ?? '').trim();
  const executableName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const pathCandidates = String(environment.PATH || '')
    .split(pathDelimiter)
    .filter(Boolean)
    .map(directory => pathApi.join(directory, executableName));
  const configuredSibling = siblingExecutablePath(
    String(environment.OMNIFLOW_FFMPEG_PATH || ''),
    'ffmpeg',
    'ffprobe',
    pathApi,
  );
  return [
    String(environment.OMNIFLOW_FFPROBE_PATH || '').trim(),
    configuredSibling || '',
    ...(resourcesPath
      ? [pathApi.join(resourcesPath, executableName), pathApi.join(resourcesPath, 'bin', executableName)]
      : []),
    ...(platform === 'win32'
      ? []
      : ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe']),
    ...pathCandidates,
  ].filter((candidate, index, candidates) => (
    pathApi.isAbsolute(candidate) && candidates.indexOf(candidate) === index
  ));
}

export function getDesktopFfmpegCandidates(
  options: DesktopMediaExecutableCandidateOptions = {},
): string[] {
  const environment = options.environment || process.env;
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  const resourcesPath = String(options.resourcesPath ?? process.resourcesPath ?? '').trim();
  const executableName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const pathCandidates = String(environment.PATH || '')
    .split(pathDelimiter)
    .filter(Boolean)
    .map(directory => pathApi.join(directory, executableName));
  const configuredSibling = siblingExecutablePath(
    String(environment.OMNIFLOW_FFPROBE_PATH || ''),
    'ffprobe',
    'ffmpeg',
    pathApi,
  );
  return [
    String(environment.OMNIFLOW_FFMPEG_PATH || '').trim(),
    configuredSibling || '',
    ...(resourcesPath
      ? [pathApi.join(resourcesPath, executableName), pathApi.join(resourcesPath, 'bin', executableName)]
      : []),
    ...(platform === 'win32'
      ? []
      : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']),
    ...pathCandidates,
  ].filter((candidate, index, candidates) => (
    pathApi.isAbsolute(candidate) && candidates.indexOf(candidate) === index
  ));
}

export async function resolveDesktopFfprobePath(
  options: DesktopMediaExecutableCandidateOptions = {},
): Promise<string | null> {
  for (const candidate of getDesktopFfprobeCandidates(options)) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the bounded absolute-path candidate list.
    }
  }
  return null;
}

export async function resolveDesktopFfmpegPath(
  options: DesktopMediaExecutableCandidateOptions = {},
): Promise<string | null> {
  for (const candidate of getDesktopFfmpegCandidates(options)) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the bounded absolute-path candidate list.
    }
  }
  return null;
}
