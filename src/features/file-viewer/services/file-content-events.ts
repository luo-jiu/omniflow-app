import { runtimeLogger } from '@/utils/runtimeLogger';

export interface LibraryFileContentChange {
  accountScope: string;
  backendScope: string;
  libraryId: number;
  nodeId: number;
}

const listeners = new Set<(change: LibraryFileContentChange) => void>();

export function notifyLibraryFileContentChanged(change: LibraryFileContentChange): void {
  for (const listener of listeners) {
    try { listener(change); } catch (error) { runtimeLogger.warn('文件内容变更通知失败', error); }
  }
}

export function subscribeLibraryFileContentChanged(listener: (change: LibraryFileContentChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
