import { fetchNodeDetailById, getFileLink, updateNodeFileContent } from '@/features/file-explorer/services/file.api';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { readTextResource } from '@/service/request/read-text-resource';
import { createTextContentRevision } from './text-viewer-session';

export class TextFileConflictError extends Error {
  constructor() { super('文件已被其他操作修改，草稿已保留，请核对最新内容后再保存'); }
}

export async function saveTextWithRevision(input: {
  nodeId: number; libraryId: number; content: string; baseRevision: string | null; assertCurrent: () => void;
}, deps = {
  detail: fetchNodeDetailById, link: getFileLink, update: updateNodeFileContent,
  read: readTextResource,
}) {
  if (!input.baseRevision) throw new Error('文件缺少读取版本，请重新加载后再保存');
  input.assertCurrent();
  const detail = await deps.detail(input.nodeId);
  if (detail.libraryId !== input.libraryId || detail.id !== input.nodeId || detail.type !== 'file') throw new Error('文件身份已变化');
  const remote = !detail.storageKey && Number(detail.fileSize) === 0 ? ''
    : await deps.read(await deps.link(input.nodeId, input.libraryId));
  if (await createTextContentRevision(remote) !== input.baseRevision) throw new TextFileConflictError();
  input.assertCurrent();
  try {
    const savedNode = await deps.update({ nodeId: input.nodeId, libraryId: input.libraryId, content: input.content,
      contentType: detail.mimeType || 'text/plain; charset=utf-8', expectedStorageKey: detail.storageKey || '' });
    return { detail, savedNode };
  } catch (error) {
    if (error instanceof IpcRequestError && error.status === 409) throw new TextFileConflictError();
    throw error;
  }
}

export interface TextSaveFeedback {
  level: 'success' | 'warning';
  message: string;
}

export function resolveTextSaveFeedback(options: {
  draftCleanupFailed: boolean;
  editedDuringSave: boolean;
  followUpDraftPersisted: boolean;
}): TextSaveFeedback {
  if (options.editedDuringSave && !options.followUpDraftPersisted) {
    return {
      level: 'warning',
      message: '文件已保存，但后续修改尚未写入草稿，请尽快再次保存',
    };
  }
  if (options.draftCleanupFailed) {
    return {
      level: 'warning',
      message: '文件已保存，但旧草稿清理失败',
    };
  }
  return {
    level: 'success',
    message: options.editedDuringSave ? '已保存，后续修改已保留为草稿' : '已保存',
  };
}
