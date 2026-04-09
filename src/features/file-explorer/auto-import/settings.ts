const AUTO_IMPORT_ENABLED_KEY = 'app-auto-import-enabled';
const AUTO_IMPORT_WATCH_DIRECTORY_KEY = 'app-auto-import-watch-directory';

export const AUTO_IMPORT_SCAN_INTERVAL_MS = 4_000;
export const AUTO_IMPORT_MAX_FILES_PER_BATCH = 8;

function normalizeWatchDirectory(input: string): string {
  return String(input || '').trim();
}

export function getAutoImportEnabled(): boolean {
  const raw = localStorage.getItem(AUTO_IMPORT_ENABLED_KEY);
  if (raw === null) return false;

  try {
    return JSON.parse(raw) === true;
  } catch {
    return raw === 'true';
  }
}

export function setAutoImportEnabled(enabled: boolean) {
  localStorage.setItem(AUTO_IMPORT_ENABLED_KEY, JSON.stringify(Boolean(enabled)));
}

export function getAutoImportWatchDirectory(): string {
  const raw = localStorage.getItem(AUTO_IMPORT_WATCH_DIRECTORY_KEY);
  if (!raw) return '';
  return normalizeWatchDirectory(raw);
}

export function setAutoImportWatchDirectory(directoryPath: string) {
  const normalizedPath = normalizeWatchDirectory(directoryPath);
  if (!normalizedPath) {
    localStorage.removeItem(AUTO_IMPORT_WATCH_DIRECTORY_KEY);
    return;
  }
  localStorage.setItem(AUTO_IMPORT_WATCH_DIRECTORY_KEY, normalizedPath);
}
