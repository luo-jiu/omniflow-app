import {
  dispatchUploadTaskEvent,
  enqueueUploadTasks,
  getUploadTaskSummary,
  getUploadTasks,
  UploadTaskStoreState,
  createUploadTaskStoreState,
} from '../model/upload-task.store';
import { UploadTask, UploadTaskEvent, UploadTaskStatus, UPLOAD_TASK_STATUS } from '../model/upload-task.types';
import { runtimeLogger } from '@/utils/runtimeLogger';

export interface UploadTaskInput {
  file: File;
  parentId: number;
  libraryId: number;
  localPath?: string;
  relativePath?: string;
  storageProvider?: string;
  folderGroupId?: string;
}

export interface UploadResult {
  status: 'fulfilled' | 'rejected';
  value?: unknown;
  reason?: unknown;
  fileName: string;
  taskStatus: UploadTaskStatus;
}

export interface UploadTaskExecutorPayload {
  taskId: string;
  input: UploadTaskInput;
  onProgress: (uploadedBytes: number, speedBps?: number) => void;
  setAbort: (aborter: () => void | Promise<void | boolean>) => void;
}

export type UploadTaskExecutor = (payload: UploadTaskExecutorPayload) => Promise<unknown>;

export type UploadManagerEvent =
  | {
    type: 'task';
    reason: UploadTaskEvent['type'] | 'ENQUEUE';
    task: UploadTask;
    prevStatus?: UploadTaskStatus;
    summary: ReturnType<typeof getUploadTaskSummary>;
  }
  | {
    type: 'batch';
    reason: 'COMPLETE';
    batchId: string;
    summary: ReturnType<typeof getUploadTaskSummary>;
    results: UploadResult[];
  };

export interface UploadBatchOptions {
  onSingleSuccess?: (newNode: unknown) => void;
  onEvent?: (event: UploadManagerEvent) => void;
}

export interface UploadBatchHandle {
  batchId: string;
  taskIds: string[];
  done: Promise<UploadResult[]>;
  cancelAll: () => void;
}

interface BatchRuntime {
  id: string;
  taskIds: string[];
  results: Map<string, UploadResult>;
  resolve: (results: UploadResult[]) => void;
  onEvent?: (event: UploadManagerEvent) => void;
}

interface TaskRuntime {
  taskId: string;
  input: UploadTaskInput;
  batchId: string;
  onSingleSuccess?: (newNode: unknown) => void;
  aborter?: () => void | Promise<void | boolean>;
}

const DEFAULT_MAX_CONCURRENT = 10;

const now = () => Date.now();

const buildTaskId = () => `upload-task-${now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildBatchId = () => `upload-batch-${now()}-${Math.random().toString(36).slice(2, 8)}`;

const toError = (reason: unknown) => {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(String(reason ?? 'unknown upload error'));
};

export class UploadManager {
  private state: UploadTaskStoreState = createUploadTaskStoreState();
  private summary = getUploadTaskSummary(this.state);
  private queue: string[] = [];
  private runningTaskIds = new Set<string>();
  private taskInputMap = new Map<string, UploadTaskInput>();
  private taskRuntimeMap = new Map<string, TaskRuntime>();
  private batchRuntimeMap = new Map<string, BatchRuntime>();
  private listeners = new Set<(event: UploadManagerEvent) => void>();
  private maxConcurrent = DEFAULT_MAX_CONCURRENT;
  private executor: UploadTaskExecutor = async () => {
    throw new Error('Upload executor is not configured');
  };

  constructor(executor?: UploadTaskExecutor) {
    if (executor) {
      this.executor = executor;
    }
  }

  setMaxConcurrent(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.drainQueue();
  }

  setExecutor(executor: UploadTaskExecutor) {
    this.executor = executor;
  }

  subscribe(listener: (event: UploadManagerEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getTasks() {
    return getUploadTasks(this.state);
  }

  getTask(taskId: string) {
    return this.state.tasks[taskId] ?? null;
  }

  getSummary() {
    return this.summary;
  }

  getState() {
    return this.state;
  }

  createBatch(tasks: UploadTaskInput[], options?: UploadBatchOptions): UploadBatchHandle {
    if (tasks.length === 0) {
      return {
        batchId: buildBatchId(),
        taskIds: [],
        done: Promise.resolve([]),
        cancelAll: () => { /* no-op */ },
      };
    }

    const batchId = buildBatchId();
    const taskIds: string[] = [];
    const done = this.createBatchRuntime(batchId, options?.onEvent);

    const createInputs = tasks.map((input) => {
      const taskId = buildTaskId();
      taskIds.push(taskId);
      return {
        id: taskId,
        meta: {
          fileName: input.file.name,
          fileSize: input.file.size,
          mimeType: input.file.type || undefined,
          localPath: (input.file as unknown as { path?: string }).path,
          relativePath: input.relativePath,
          libraryId: input.libraryId,
          parentId: input.parentId,
          folderGroupId: input.folderGroupId,
        },
      };
    });

    this.state = enqueueUploadTasks(this.state, createInputs);
    this.summary = {
      ...this.summary,
      total: this.summary.total + createInputs.length,
      queued: this.summary.queued + createInputs.length,
    };

    tasks.forEach((input, index) => {
      const taskId = taskIds[index];

      this.taskInputMap.set(taskId, input);
      this.taskRuntimeMap.set(taskId, {
        taskId,
        input,
        batchId,
        onSingleSuccess: options?.onSingleSuccess,
      });
      this.queue.push(taskId);
      this.batchRuntimeMap.get(batchId)?.taskIds.push(taskId);
    });

    const firstQueuedTaskId = taskIds[0];
    const firstQueuedTask = this.state.tasks[firstQueuedTaskId];
    if (firstQueuedTask) {
      this.emitTaskEvent('ENQUEUE', firstQueuedTask);
    }

    this.drainQueue();

    return {
      batchId,
      taskIds,
      done,
      cancelAll: () => {
        taskIds.forEach((taskId) => this.cancelTask(taskId));
      },
    };
  }

  async uploadFiles(
    tasks: UploadTaskInput[],
    onSingleSuccess?: (newNode: unknown) => void,
    options?: Omit<UploadBatchOptions, 'onSingleSuccess'>,
  ): Promise<UploadResult[]> {
    const batch = this.createBatch(tasks, { onSingleSuccess, onEvent: options?.onEvent });
    return batch.done;
  }

  cancelTask(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;
    if (task.status === UPLOAD_TASK_STATUS.SUCCESS || task.status === UPLOAD_TASK_STATUS.CANCELED) return false;

    if (task.status === UPLOAD_TASK_STATUS.QUEUED) {
      this.queue = this.queue.filter((id) => id !== taskId);
    }

    const updated = this.applyTaskEvent(taskId, { type: 'CANCEL' });
    if (!updated) return false;

    const runtime = this.taskRuntimeMap.get(taskId);
    if (runtime?.aborter) {
      try {
        void runtime.aborter();
      } catch (error) {
        runtimeLogger.warn(`abort upload task failed: ${taskId}`, error);
      }
      runtime.aborter = undefined;
    }

    this.finishTask(taskId, {
      status: 'rejected',
      reason: new Error('upload canceled'),
      fileName: updated.meta.fileName,
      taskStatus: UPLOAD_TASK_STATUS.CANCELED,
    });
    return true;
  }

  retryTask(taskId: string, options?: UploadBatchOptions): UploadBatchHandle | null {
    const task = this.getTask(taskId);
    if (!task || task.status !== UPLOAD_TASK_STATUS.FAILED) return null;

    const input = this.taskInputMap.get(taskId);
    if (!input) return null;

    const runtime = this.taskRuntimeMap.get(taskId) ?? {
      taskId,
      input,
      batchId: '',
      onSingleSuccess: undefined,
    };
    this.taskRuntimeMap.set(taskId, runtime);

    const batchId = buildBatchId();
    const done = this.createBatchRuntime(batchId, options?.onEvent);
    runtime.batchId = batchId;
    runtime.onSingleSuccess = options?.onSingleSuccess;
    runtime.input = input;
    this.batchRuntimeMap.get(batchId)?.taskIds.push(taskId);
    this.applyTaskEvent(taskId, { type: 'RETRY' });
    this.queue.push(taskId);
    this.drainQueue();
    return {
      batchId,
      taskIds: [taskId],
      done,
      cancelAll: () => {
        this.cancelTask(taskId);
      },
    };
  }

  private drainQueue() {
    while (this.runningTaskIds.size < this.maxConcurrent && this.queue.length > 0) {
      const nextTaskId = this.queue.shift();
      if (!nextTaskId) return;

      const task = this.getTask(nextTaskId);
      const runtime = this.taskRuntimeMap.get(nextTaskId);
      if (!task || !runtime) continue;
      if (task.status !== UPLOAD_TASK_STATUS.QUEUED) continue;

      this.startTask(nextTaskId, runtime);
    }
  }

  private startTask(taskId: string, runtime: TaskRuntime) {
    const started = this.applyTaskEvent(taskId, { type: 'START' });
    if (!started) return;

    this.runningTaskIds.add(taskId);
    this.applyTaskEvent(taskId, { type: 'PROGRESS', uploadedBytes: 0, speedBps: 0 });

    const startedAt = now();
    let previousBytes = 0;
    let previousAt = startedAt;

    this.executor({
      taskId,
      input: runtime.input,
      setAbort: (aborter) => {
        runtime.aborter = aborter;
      },
      onProgress: (uploadedBytes, speedBps) => {
        const current = this.getTask(taskId);
        if (!current || current.status !== UPLOAD_TASK_STATUS.UPLOADING) return;

        const currentAt = now();
        const deltaBytes = Math.max(0, uploadedBytes - previousBytes);
        const deltaTimeMs = Math.max(1, currentAt - previousAt);
        previousBytes = uploadedBytes;
        previousAt = currentAt;
        const computedSpeed = speedBps ?? Math.floor((deltaBytes * 1000) / deltaTimeMs);
        this.applyTaskEvent(taskId, { type: 'PROGRESS', uploadedBytes, speedBps: computedSpeed });
      },
    })
      .then((value) => {
        const current = this.getTask(taskId);
        if (!current) return;

        if (current.status === UPLOAD_TASK_STATUS.CANCELED) {
          return;
        }

        const succeeded = this.applyTaskEvent(taskId, { type: 'SUCCESS' });
        if (!succeeded) return;

        if (runtime.onSingleSuccess) {
          runtime.onSingleSuccess(value);
        }

        this.finishTask(taskId, {
          status: 'fulfilled',
          value,
          fileName: succeeded.meta.fileName,
          taskStatus: UPLOAD_TASK_STATUS.SUCCESS,
        });
      })
      .catch((reason) => {
        const current = this.getTask(taskId);
        if (!current) return;

        if (current.status === UPLOAD_TASK_STATUS.CANCELED) {
          return;
        }

        const failed = this.applyTaskEvent(taskId, {
          type: 'FAIL',
          error: {
            message: toError(reason).message,
            retriable: true,
          },
        });

        if (!failed) return;

        this.finishTask(taskId, {
          status: 'rejected',
          reason,
          fileName: failed.meta.fileName,
          taskStatus: UPLOAD_TASK_STATUS.FAILED,
        });
      })
      .finally(() => {
        runtime.aborter = undefined;
        this.runningTaskIds.delete(taskId);
        this.drainQueue();
      });
  }

  private finishTask(taskId: string, result: UploadResult) {
    const runtime = this.taskRuntimeMap.get(taskId);
    if (!runtime) return;
    const batch = this.batchRuntimeMap.get(runtime.batchId);
    if (!batch) return;

    batch.results.set(taskId, result);
    if (batch.results.size < batch.taskIds.length) return;

    const orderedResults = batch.taskIds
      .map((id) => batch.results.get(id))
      .filter((item): item is UploadResult => Boolean(item));

    const event: UploadManagerEvent = {
      type: 'batch',
      reason: 'COMPLETE',
      batchId: batch.id,
      summary: this.getSummary(),
      results: orderedResults,
    };
    this.emit(event);
    if (batch.onEvent) {
      batch.onEvent(event);
    }
    batch.resolve(orderedResults);

    // 批次结束后释放运行时资源，避免长时间使用后对象不断累积。
    batch.taskIds.forEach((id) => {
      const task = this.getTask(id);
      const taskRuntime = this.taskRuntimeMap.get(id);
      if (taskRuntime) {
        taskRuntime.aborter = undefined;
        taskRuntime.onSingleSuccess = undefined;
      }
      // 失败任务要保留输入上下文，支持后续重试；其余状态释放。
      if (!task || task.status !== UPLOAD_TASK_STATUS.FAILED) {
        this.taskRuntimeMap.delete(id);
        this.taskInputMap.delete(id);
      }
    });

    this.batchRuntimeMap.delete(batch.id);
  }

  private createBatchRuntime(batchId: string, onEvent?: (event: UploadManagerEvent) => void): Promise<UploadResult[]> {
    return new Promise<UploadResult[]>((resolve) => {
      const batchRuntime: BatchRuntime = {
        id: batchId,
        taskIds: [],
        results: new Map<string, UploadResult>(),
        resolve,
        onEvent,
      };
      this.batchRuntimeMap.set(batchId, batchRuntime);
    });
  }

  private applyTaskEvent(taskId: string, event: UploadTaskEvent): UploadTask | null {
    const current = this.getTask(taskId);
    if (!current) return null;

    try {
      this.state = dispatchUploadTaskEvent(this.state, taskId, event);
      const updated = this.getTask(taskId);
      if (!updated) return null;
      this.applySummaryStatusTransition(current.status, updated.status);
      this.emitTaskEvent(event.type, updated, current.status);
      return updated;
    } catch (error) {
      runtimeLogger.warn(`upload task event ignored: ${taskId} ${event.type}`, error);
      return null;
    }
  }

  private emitTaskEvent(
    reason: UploadTaskEvent['type'] | 'ENQUEUE',
    task: UploadTask,
    prevStatus?: UploadTaskStatus,
  ) {
    const event: UploadManagerEvent = {
      type: 'task',
      reason,
      task,
      prevStatus,
      summary: this.getSummary(),
    };
    this.emit(event);

    const runtime = this.taskRuntimeMap.get(task.id);
    if (!runtime) return;
    const batch = this.batchRuntimeMap.get(runtime.batchId);
    if (!batch?.onEvent) return;
    batch.onEvent(event);
  }

  private emit(event: UploadManagerEvent) {
    this.listeners.forEach((listener) => {
      listener(event);
    });
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private applySummaryStatusTransition(from: UploadTaskStatus, to: UploadTaskStatus) {
    if (from === to) {
      return;
    }
    this.summary = { ...this.summary };
    this.bumpStatusCount(from, -1);
    this.bumpStatusCount(to, 1);
  }

  private bumpStatusCount(status: UploadTaskStatus, delta: number) {
    switch (status) {
      case UPLOAD_TASK_STATUS.QUEUED:
        this.summary.queued += delta;
        return;
      case UPLOAD_TASK_STATUS.UPLOADING:
        this.summary.uploading += delta;
        return;
      case UPLOAD_TASK_STATUS.PAUSED:
        this.summary.paused += delta;
        return;
      case UPLOAD_TASK_STATUS.FAILED:
        this.summary.failed += delta;
        return;
      case UPLOAD_TASK_STATUS.SUCCESS:
        this.summary.success += delta;
        return;
      case UPLOAD_TASK_STATUS.CANCELED:
        this.summary.canceled += delta;
        return;
      default:
        return;
    }
  }
}
