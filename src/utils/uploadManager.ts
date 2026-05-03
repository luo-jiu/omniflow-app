import { uploadAndCreateNode } from '@/features/file-explorer/services/file.api';
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
  const result = await uploadAndCreateNode(
    payload.input.file,
    payload.input.parentId,
    payload.input.libraryId,
    {
      onProgress: (uploadedBytes, _totalBytes, _percentage, speedBps) => {
        payload.onProgress(uploadedBytes, speedBps);
      },
      setAbort: (aborter) => {
        payload.setAbort(aborter);
      },
      storageProvider: payload.input.storageProvider,
    },
  );
  return result;
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
