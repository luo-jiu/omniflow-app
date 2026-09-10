import { runtimeLogger } from '@/utils/runtimeLogger';

export interface LibraryNodeMutation {
  accountScope: string;
  backendScope: string;
  libraryId: number;
  affectedParentIds: number[];
  nodeId?: number;
  name?: string;
  ext?: string;
  type?: 'dir' | 'file';
  parentId?: number;
}

export function matchesLibraryMutationScope(
  event: Pick<LibraryNodeMutation, 'accountScope' | 'backendScope' | 'libraryId'>,
  accountScope: string | null,
  backendScope: string,
  libraryId: number | null,
): boolean {
  return accountScope !== null && event.accountScope === accountScope
    && event.backendScope === backendScope && event.libraryId === libraryId;
}

const listeners = new Set<(event: LibraryNodeMutation) => void | Promise<void>>();
const dirtyScopes = new Set<string>();
const scopeKey = (event: Pick<LibraryNodeMutation, 'accountScope' | 'backendScope' | 'libraryId'>) =>
  JSON.stringify([event.accountScope, event.backendScope, event.libraryId]);

export function consumeLibraryNodeMutationDirty(accountScope: string | null, backendScope: string, libraryId: number): boolean {
  return accountScope !== null && dirtyScopes.delete(scopeKey({ accountScope, backendScope, libraryId }));
}

/** Publish committed facts only; refresh failures must never undo business success. */
export function notifyLibraryNodesMutated(event: LibraryNodeMutation): void {
  dirtyScopes.add(scopeKey(event));
  for (const listener of listeners) {
    try {
      void Promise.resolve(listener(event)).catch(error => runtimeLogger.warn('节点变更同步失败', error));
    } catch (error) { runtimeLogger.warn('节点变更同步失败', error); }
  }
}

export function subscribeLibraryNodesMutated(listener: (event: LibraryNodeMutation) => void | Promise<void>): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
