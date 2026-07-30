import { applyUploadTaskEvent, createUploadTask } from './upload-task.state-machine';
import {
  CreateUploadTaskInput,
  UploadTask,
  UploadTaskEvent,
  UploadTaskStatus,
  UPLOAD_TASK_STATUS,
} from './upload-task.types';

export interface UploadTaskStoreState {
  order: string[];
  tasks: Record<string, UploadTask>;
}

export interface UploadTaskSummary {
  total: number;
  queued: number;
  uploading: number;
  paused: number;
  failed: number;
  success: number;
  canceled: number;
}

export function createUploadTaskStoreState(): UploadTaskStoreState {
  return {
    order: [],
    tasks: {},
  };
}

export function enqueueUploadTask(
  state: UploadTaskStoreState,
  input: CreateUploadTaskInput,
): UploadTaskStoreState {
  return enqueueUploadTasks(state, [input]);
}

export function enqueueUploadTasks(
  state: UploadTaskStoreState,
  inputs: CreateUploadTaskInput[],
): UploadTaskStoreState {
  if (inputs.length === 0) {
    return state;
  }

  const nextOrder = [...state.order];
  const nextTasks: Record<string, UploadTask> = { ...state.tasks };

  for (const input of inputs) {
    if (nextTasks[input.id]) {
      throw new Error(`Task id already exists: ${input.id}`);
    }
    const task = createUploadTask(input);
    nextOrder.push(task.id);
    nextTasks[task.id] = task;
  }

  return {
    order: nextOrder,
    tasks: nextTasks,
  };
}

export function dispatchUploadTaskEvent(
  state: UploadTaskStoreState,
  taskId: string,
  event: UploadTaskEvent,
): UploadTaskStoreState {
  const current = state.tasks[taskId];
  if (!current) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const updated = applyUploadTaskEvent(current, event);
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskId]: updated,
    },
  };
}

export function removeUploadTasks(state: UploadTaskStoreState, taskIds: string[]): UploadTaskStoreState {
  if (taskIds.length === 0) {
    return state;
  }

  const removeSet = new Set(taskIds);
  let changed = false;
  const nextOrder = state.order.filter((taskId) => {
    if (removeSet.has(taskId) && state.tasks[taskId]) {
      changed = true;
      return false;
    }
    return true;
  });

  if (!changed) {
    return state;
  }

  const nextTasks: Record<string, UploadTask> = { ...state.tasks };
  removeSet.forEach((taskId) => {
    delete nextTasks[taskId];
  });

  return {
    order: nextOrder,
    tasks: nextTasks,
  };
}

export function getUploadTasks(state: UploadTaskStoreState): UploadTask[] {
  return state.order.map(id => state.tasks[id]).filter(Boolean);
}

export function getUploadTaskSummary(state: UploadTaskStoreState): UploadTaskSummary {
  const summary: UploadTaskSummary = {
    total: 0,
    queued: 0,
    uploading: 0,
    paused: 0,
    failed: 0,
    success: 0,
    canceled: 0,
  };

  const bump = (status: UploadTaskStatus) => {
    switch (status) {
      case UPLOAD_TASK_STATUS.QUEUED:
        summary.queued += 1;
        break;
      case UPLOAD_TASK_STATUS.UPLOADING:
        summary.uploading += 1;
        break;
      case UPLOAD_TASK_STATUS.PAUSED:
        summary.paused += 1;
        break;
      case UPLOAD_TASK_STATUS.FAILED:
        summary.failed += 1;
        break;
      case UPLOAD_TASK_STATUS.SUCCESS:
        summary.success += 1;
        break;
      case UPLOAD_TASK_STATUS.CANCELED:
        summary.canceled += 1;
        break;
      default:
        break;
    }
  };

  for (const taskId of state.order) {
    const task = state.tasks[taskId];
    if (!task) continue;
    summary.total += 1;
    bump(task.status);
  }

  return summary;
}
