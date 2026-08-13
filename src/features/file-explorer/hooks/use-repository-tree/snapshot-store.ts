import type { RepositoryTreeSnapshot } from './types';

const REPOSITORY_TREE_SNAPSHOT_MAX_ENTRIES = 20;
const repositoryTreeSnapshotStore = new Map<number, RepositoryTreeSnapshot>();
const repositoryTreeDirtyLibraries = new Set<number>();

export function getRepositoryTreeSnapshot(libraryId: number): RepositoryTreeSnapshot | undefined {
  return repositoryTreeSnapshotStore.get(libraryId);
}

export function hasRepositoryTreeSnapshot(libraryId: number): boolean {
  return repositoryTreeSnapshotStore.has(libraryId);
}

export function invalidateRepositoryTreeSnapshot(libraryId: number) {
  repositoryTreeSnapshotStore.delete(libraryId);
}

export function clearRepositoryTreeSnapshot(libraryId: number) {
  repositoryTreeSnapshotStore.delete(libraryId);
  repositoryTreeDirtyLibraries.delete(libraryId);
}

export function clearAllRepositoryTreeSnapshots() {
  repositoryTreeSnapshotStore.clear();
  repositoryTreeDirtyLibraries.clear();
}

export function markRepositoryTreeSnapshotDirty(libraryId: number) {
  repositoryTreeDirtyLibraries.add(libraryId);
}

export function isRepositoryTreeSnapshotDirty(libraryId: number): boolean {
  return repositoryTreeDirtyLibraries.has(libraryId);
}

export function clearRepositoryTreeSnapshotDirty(libraryId: number) {
  repositoryTreeDirtyLibraries.delete(libraryId);
}

export function saveRepositoryTreeSnapshot(libraryId: number, snapshot: RepositoryTreeSnapshot) {
  if (repositoryTreeSnapshotStore.has(libraryId)) {
    repositoryTreeSnapshotStore.delete(libraryId);
  }
  repositoryTreeSnapshotStore.set(libraryId, snapshot);
  if (repositoryTreeSnapshotStore.size > REPOSITORY_TREE_SNAPSHOT_MAX_ENTRIES) {
    const oldestLibraryId = repositoryTreeSnapshotStore.keys().next().value;
    if (oldestLibraryId !== undefined) {
      repositoryTreeSnapshotStore.delete(oldestLibraryId);
    }
  }
}
