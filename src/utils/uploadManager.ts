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
import { pollUploadProgress } from '@/modules/upload-center/services/upload-progress.api';

// proxy 上传链路下，IPC 进度只能反映 client→backend 那段；
// 而 backend→MinIO 的写入仍在继续，UI 进度条会提前到 100% 并停滞。
// 此处通过服务端轮询接管进度上报：
//   1. 客户端为每个任务生成独立 uploadId，透传给后端 form 字段；
//   2. 后端在 ProgressReader 上累加真实写入字节，前端轮询 GET 拉取；
//   3. 首个服务端样本到达前用 IPC 字节兜底，到达后切换到服务端样本，避免前端比真实进度跑得更靠前。
//
// 未来切到客户端直传 MinIO 时，该轮询整段可下线：保留客户端 uploadId、
// 删除轮询、把 onProgress 来源切回 IPC/XHR 的真实字节。详见
// `docs/upload-progress-architecture.md`。
const defaultExecutor: UploadTaskExecutor = async (payload: UploadTaskExecutorPayload) => {
  const uploadId = crypto.randomUUID();

  let lastReportedBytes = 0;
  let serverSampleSeen = false;

  // monotonic 保护：服务端短暂故障时不能让进度回退。
  const reportProgress = (uploadedBytes: number, speedBps?: number) => {
    if (uploadedBytes < lastReportedBytes) return;
    lastReportedBytes = uploadedBytes;
    payload.onProgress(uploadedBytes, speedBps);
  };

  const stopPoll = pollUploadProgress(uploadId, {
    onSample: (sample) => {
      serverSampleSeen = true;
      reportProgress(sample.uploadedBytes);
    },
  });

  try {
    return await uploadAndCreateNode(
      payload.input.file,
      payload.input.parentId,
      payload.input.libraryId,
      {
        uploadId,
        onProgress: (uploadedBytes, _totalBytes, _percentage, speedBps) => {
          // 服务端样本到达后丢弃 IPC 进度，避免 client→backend 段的瞬时 100% 把进度推到真实写入之前。
          if (serverSampleSeen) return;
          reportProgress(uploadedBytes, speedBps);
        },
        setAbort: (aborter) => {
          payload.setAbort(aborter);
        },
        storageProvider: payload.input.storageProvider,
      },
    );
  } finally {
    stopPoll();
  }
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
