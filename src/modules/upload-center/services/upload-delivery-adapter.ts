import {
  classifyUploadBatchResults,
  type UploadBatchHandle,
  type UploadBatchTerminal,
  type UploadTaskInput,
} from '../engine/upload-manager';

export type FrozenUploadDeliveryTarget = Readonly<{
  fileName: string;
  libraryId: number;
  parentId: number;
  relativePath: string;
}>;

export type UploadBatchLike = {
  done: Promise<ReadonlyArray<{ taskStatus?: string }>>;
  terminal?: Promise<UploadBatchTerminal>;
};

type UploadDeliveryTargetInput = {
  fileName: string;
  libraryId: number;
  parentId: number;
  relativePath?: string;
};

/** Freezes routing metadata before a batch enters the asynchronous queue. */
export function freezeUploadDeliveryTarget(
  input: UploadDeliveryTargetInput,
): FrozenUploadDeliveryTarget {
  const libraryId = Number(input.libraryId);
  const parentId = Number(input.parentId);
  const fileName = String(input.fileName || '').trim();
  const relativePath = String(input.relativePath || fileName).trim() || fileName;
  if (!Number.isInteger(libraryId) || libraryId <= 0) {
    throw new Error('上传目标缺少有效的资料库');
  }
  if (!Number.isInteger(parentId) || parentId <= 0) {
    throw new Error('上传目标缺少有效的目录');
  }
  if (!fileName) {
    throw new Error('上传目标缺少文件名');
  }
  return Object.freeze({ fileName, libraryId, parentId, relativePath });
}

export function createUploadTaskInput(
  file: File,
  target: FrozenUploadDeliveryTarget,
): UploadTaskInput {
  return {
    file,
    libraryId: target.libraryId,
    parentId: target.parentId,
    relativePath: target.relativePath,
  };
}

/** Uses UploadManager's native terminal when present, with a safe legacy fallback. */
export function resolveUploadBatchTerminal(
  batch: UploadBatchLike | Pick<UploadBatchHandle, 'done' | 'terminal'>,
): Promise<UploadBatchTerminal> {
  if (batch.terminal) {
    return batch.terminal;
  }
  return batch.done.then((results) => classifyUploadBatchResults(results));
}
