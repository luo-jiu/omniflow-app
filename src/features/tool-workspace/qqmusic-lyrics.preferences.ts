export type QQMusicLyricsSaveDirectory = {
  parentId: number;
  pathLabel: string;
};

const STORAGE_KEY_PREFIX = 'qqmusic-lyrics-preferences:v1:';

function storageKey(libraryId: number) {
  return `${STORAGE_KEY_PREFIX}${libraryId}`;
}

function removeStoredDirectory(libraryId: number) {
  if (!Number.isInteger(libraryId) || libraryId <= 0 || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(storageKey(libraryId));
  } catch {
    // Storage cleanup is best-effort; callers still fall back to in-memory state.
  }
}

function normalizeSaveDirectory(value: unknown): QQMusicLyricsSaveDirectory | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<QQMusicLyricsSaveDirectory>;
  const parentId = Number(candidate.parentId);
  const pathLabel = typeof candidate.pathLabel === 'string' ? candidate.pathLabel.trim() : '';
  if (!Number.isInteger(parentId) || parentId <= 0 || !pathLabel) return null;
  return { parentId, pathLabel };
}

export function loadQQMusicLyricsSaveDirectory(
  libraryId: number,
): QQMusicLyricsSaveDirectory | null {
  if (!Number.isInteger(libraryId) || libraryId <= 0 || typeof localStorage === 'undefined') {
    return null;
  }
  const key = storageKey(libraryId);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { saveDirectory?: unknown };
    const directory = normalizeSaveDirectory(parsed?.saveDirectory);
    if (!directory) removeStoredDirectory(libraryId);
    return directory;
  } catch {
    removeStoredDirectory(libraryId);
    return null;
  }
}

export function clearQQMusicLyricsSaveDirectory(libraryId: number) {
  removeStoredDirectory(libraryId);
}

export function saveQQMusicLyricsSaveDirectory(
  libraryId: number,
  directory: QQMusicLyricsSaveDirectory,
) {
  if (!Number.isInteger(libraryId) || libraryId <= 0 || typeof localStorage === 'undefined') {
    return;
  }
  const normalized = normalizeSaveDirectory(directory);
  const key = storageKey(libraryId);
  if (!normalized) {
    removeStoredDirectory(libraryId);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify({ saveDirectory: normalized }));
  } catch {
    // Storage can be unavailable or full; the component still keeps the current in-memory choice.
  }
}
