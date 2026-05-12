const disposingLibraries = new Map<number, number>();
let sessionDisposeCount = 0;

export function normalizeLibraryId(libraryId: number): number | null {
  const normalized = Number(libraryId);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return Math.trunc(normalized);
}

function hasWindow() {
  return typeof window !== 'undefined';
}

function deferAfterCurrentCleanup(callback: () => void) {
  if (!hasWindow()) {
    callback();
    return;
  }
  window.setTimeout(callback, 0);
}

export function beginLibraryDisposing(libraryId: number) {
  disposingLibraries.set(libraryId, (disposingLibraries.get(libraryId) ?? 0) + 1);
  return () => {
    deferAfterCurrentCleanup(() => {
      const nextCount = (disposingLibraries.get(libraryId) ?? 0) - 1;
      if (nextCount > 0) {
        disposingLibraries.set(libraryId, nextCount);
        return;
      }
      disposingLibraries.delete(libraryId);
    });
  };
}

export function beginSessionDisposing() {
  sessionDisposeCount += 1;
  return () => {
    deferAfterCurrentCleanup(() => {
      sessionDisposeCount = Math.max(0, sessionDisposeCount - 1);
    });
  };
}

export function isDisposingSessionWorkspaces() {
  return sessionDisposeCount > 0;
}

export function isDisposingLibraryWorkspace(libraryId: number | null | undefined) {
  if (isDisposingSessionWorkspaces()) {
    return true;
  }
  if (libraryId == null) {
    return false;
  }
  const normalized = normalizeLibraryId(libraryId);
  if (normalized == null) {
    return false;
  }
  return (disposingLibraries.get(normalized) ?? 0) > 0;
}

export function isDisposingAnyWorkspace() {
  return isDisposingSessionWorkspaces() || disposingLibraries.size > 0;
}
