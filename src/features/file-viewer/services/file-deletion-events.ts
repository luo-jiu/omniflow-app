import { runtimeLogger } from '@/utils/runtimeLogger';

export interface LibraryFileDeletion {
  accountScope: string;
  backendScope: string;
  libraryId: number;
  nodeIds: number[];
}
const listeners = new Set<(event: LibraryFileDeletion) => void>();
export function notifyLibraryFilesDeleted(event: LibraryFileDeletion): void {
  for (const listener of listeners) {
    try { listener(event); } catch (error) { runtimeLogger.warn('文件删除通知失败', error); }
  }
}
export function subscribeLibraryFilesDeleted(listener: (event: LibraryFileDeletion) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
