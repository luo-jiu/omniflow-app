import path from 'node:path';

export const STAGED_FILE_NAME_MAX_BYTES = 240;
export const TEMP_IMPORT_STAGING_DIR_NAME = 'omniflow-import-staging';

export function resolveTempImportStagingRoot(tempDirectoryPath: string): string {
  return path.join(path.resolve(tempDirectoryPath), TEMP_IMPORT_STAGING_DIR_NAME);
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

export function normalizeStagedFileName(
  input: string,
  fallback: string,
  maximumBytes = STAGED_FILE_NAME_MAX_BYTES,
): string {
  const normalized = String(input || fallback).replace(/[/\\]/gu, '_').trim() || fallback;
  const extension = normalized.toLowerCase().endsWith('.qrc.xml')
    ? normalized.slice(-8)
    : path.extname(normalized);
  const extensionBytes = Buffer.byteLength(extension, 'utf8');
  if (extensionBytes >= maximumBytes) {
    return truncateUtf8(normalized, maximumBytes) || 'unknown';
  }
  const stem = extension ? normalized.slice(0, -extension.length) : normalized;
  return `${truncateUtf8(stem, maximumBytes - extensionBytes)}${extension}` || 'unknown';
}

export function isPathInsideAllowedRoots(filePath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const relativePath = path.relative(path.resolve(root), path.resolve(filePath));
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  });
}
