import { runDirectUpload } from '@/modules/upload-center/services/upload-direct';
import {
  UploadBatchHandle,
  UploadBatchOptions,
  UploadManager,
  UploadManagerEvent,
  UploadResult,
  UploadTaskExecutor,
  UploadTaskExecutorPayload,
  UploadTaskInput as UploadTask,
} from '@/modules/upload-center/engine/upload-manager';

const defaultExecutor: UploadTaskExecutor = async (payload: UploadTaskExecutorPayload) => {
  const filePath = (payload.input.file as unknown as { path?: string }).path;
  if (!filePath) {
    throw new Error('未获取到上传文件的本地路径，无法直传 MinIO');
  }

  const file = payload.input.file;
  return runDirectUpload({
    filePath,
    fileName: file.name,
    fileSize: file.size,
    contentType: file.type || undefined,
    libraryId: payload.input.libraryId,
    parentId: payload.input.parentId,
    storageProvider: payload.input.storageProvider,
    onProgress: (uploadedBytes) => payload.onProgress(uploadedBytes),
    setAbort: payload.setAbort,
  });
};

export const uploadManager = new UploadManager(defaultExecutor);
uploadManager.setMaxConcurrent(10);

export type {
  UploadBatchHandle,
  UploadBatchOptions,
  UploadManagerEvent,
  UploadResult,
  UploadTask,
};
