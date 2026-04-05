import {
  CreateUploadTaskInput,
  UploadTask,
  UploadTaskEvent,
  UploadTaskStatus,
  UPLOAD_TASK_STATUS,
} from './upload-task.types';

const TERMINAL_STATUSES: UploadTaskStatus[] = [UPLOAD_TASK_STATUS.SUCCESS, UPLOAD_TASK_STATUS.CANCELED];

const ALLOWED_EVENT_BY_STATUS: Record<UploadTaskStatus, UploadTaskEvent['type'][]> = {
  [UPLOAD_TASK_STATUS.QUEUED]: ['START', 'CANCEL'],
  [UPLOAD_TASK_STATUS.UPLOADING]: ['PROGRESS', 'PAUSE', 'SUCCESS', 'FAIL', 'CANCEL'],
  [UPLOAD_TASK_STATUS.PAUSED]: ['RESUME', 'CANCEL'],
  [UPLOAD_TASK_STATUS.FAILED]: ['RETRY', 'CANCEL'],
  [UPLOAD_TASK_STATUS.SUCCESS]: [],
  [UPLOAD_TASK_STATUS.CANCELED]: [],
};

const now = (at?: number) => at ?? Date.now();

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const calculatePercentage = (uploadedBytes: number, totalBytes: number): number => {
  if (!totalBytes || totalBytes <= 0) return 0;
  return clamp((uploadedBytes / totalBytes) * 100, 0, 100);
};

const calculateEtaSeconds = (remainingBytes: number, speedBps: number): number | null => {
  if (speedBps <= 0) return null;
  if (remainingBytes <= 0) return 0;
  return Math.ceil(remainingBytes / speedBps);
};

export function createUploadTask(input: CreateUploadTaskInput): UploadTask {
  const createdAt = now(input.createdAt);
  const totalBytes = Math.max(0, input.meta.fileSize);

  return {
    id: input.id,
    status: UPLOAD_TASK_STATUS.QUEUED,
    meta: input.meta,
    progress: {
      totalBytes,
      uploadedBytes: 0,
      percentage: 0,
      speedBps: 0,
      etaSeconds: totalBytes === 0 ? 0 : null,
    },
    error: null,
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
  };
}

export function canApplyUploadTaskEvent(task: UploadTask, eventType: UploadTaskEvent['type']): boolean {
  return ALLOWED_EVENT_BY_STATUS[task.status].includes(eventType);
}

function assertAllowed(task: UploadTask, event: UploadTaskEvent) {
  if (!canApplyUploadTaskEvent(task, event.type)) {
    throw new Error(`Invalid transition: ${task.status} -> ${event.type}`);
  }
}

function assertNotTerminal(task: UploadTask) {
  if (TERMINAL_STATUSES.includes(task.status)) {
    throw new Error(`Task ${task.id} is terminal (${task.status})`);
  }
}

function withCommonMeta(at: number): Pick<UploadTask, 'updatedAt'> {
  return { updatedAt: at };
}

export function applyUploadTaskEvent(task: UploadTask, event: UploadTaskEvent): UploadTask {
  assertNotTerminal(task);
  assertAllowed(task, event);

  const at = now(event.at);
  const base = withCommonMeta(at);

  switch (event.type) {
    case 'START': {
      return {
        ...task,
        ...base,
        status: UPLOAD_TASK_STATUS.UPLOADING,
        attempts: task.attempts + 1,
        startedAt: task.startedAt ?? at,
        finishedAt: null,
        error: null,
      };
    }
    case 'PROGRESS': {
      const uploadedBytes = clamp(event.uploadedBytes, 0, task.progress.totalBytes);
      const speedBps = Math.max(0, event.speedBps ?? task.progress.speedBps);
      const remainingBytes = Math.max(task.progress.totalBytes - uploadedBytes, 0);
      return {
        ...task,
        ...base,
        progress: {
          ...task.progress,
          uploadedBytes,
          percentage: calculatePercentage(uploadedBytes, task.progress.totalBytes),
          speedBps,
          etaSeconds: calculateEtaSeconds(remainingBytes, speedBps),
        },
      };
    }
    case 'PAUSE': {
      return {
        ...task,
        ...base,
        status: UPLOAD_TASK_STATUS.PAUSED,
        progress: {
          ...task.progress,
          speedBps: 0,
          etaSeconds: null,
        },
      };
    }
    case 'RESUME': {
      return {
        ...task,
        ...base,
        status: UPLOAD_TASK_STATUS.UPLOADING,
        attempts: task.attempts + 1,
        startedAt: task.startedAt ?? at,
        error: null,
      };
    }
    case 'SUCCESS': {
      return {
        ...task,
        ...base,
        status: UPLOAD_TASK_STATUS.SUCCESS,
        finishedAt: at,
        progress: {
          ...task.progress,
          uploadedBytes: task.progress.totalBytes,
          percentage: 100,
          speedBps: 0,
          etaSeconds: 0,
        },
        error: null,
      };
    }
    case 'FAIL': {
      return {
        ...task,
        ...base,
        status: UPLOAD_TASK_STATUS.FAILED,
        finishedAt: at,
        progress: {
          ...task.progress,
          speedBps: 0,
          etaSeconds: null,
        },
        error: event.error,
      };
    }
    case 'CANCEL': {
      return {
        ...task,
        ...base,
        status: UPLOAD_TASK_STATUS.CANCELED,
        finishedAt: at,
        progress: {
          ...task.progress,
          speedBps: 0,
          etaSeconds: null,
        },
      };
    }
    case 'RETRY': {
      return {
        ...task,
        ...base,
        status: UPLOAD_TASK_STATUS.QUEUED,
        finishedAt: null,
        error: null,
        progress: {
          ...task.progress,
          uploadedBytes: 0,
          percentage: 0,
          speedBps: 0,
          etaSeconds: task.progress.totalBytes === 0 ? 0 : null,
        },
      };
    }
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Unhandled event ${(exhaustiveCheck as { type: string }).type}`);
    }
  }
}
