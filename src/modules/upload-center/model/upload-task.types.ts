export const UPLOAD_TASK_STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELED: 'canceled',
  PAUSED: 'paused',
} as const;

export type UploadTaskStatus = typeof UPLOAD_TASK_STATUS[keyof typeof UPLOAD_TASK_STATUS];

export interface UploadTaskError {
  code?: string;
  message: string;
  retriable: boolean;
}

export interface UploadTaskMeta {
  fileName: string;
  fileSize: number;
  mimeType?: string;
  localPath?: string;
  relativePath?: string;
  libraryId: number;
  parentId: number;
  folderGroupId?: string;
}

export interface UploadTaskProgress {
  totalBytes: number;
  uploadedBytes: number;
  percentage: number;
  speedBps: number;
  etaSeconds: number | null;
}

export interface UploadTask {
  id: string;
  status: UploadTaskStatus;
  meta: UploadTaskMeta;
  progress: UploadTaskProgress;
  error: UploadTaskError | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface CreateUploadTaskInput {
  id: string;
  meta: UploadTaskMeta;
  createdAt?: number;
}

export type UploadTaskEvent =
  | { type: 'START'; at?: number }
  | { type: 'PROGRESS'; uploadedBytes: number; speedBps?: number; at?: number }
  | { type: 'PAUSE'; at?: number }
  | { type: 'RESUME'; at?: number }
  | { type: 'SUCCESS'; at?: number }
  | { type: 'FAIL'; error: UploadTaskError; at?: number }
  | { type: 'CANCEL'; at?: number }
  | { type: 'RETRY'; at?: number };

