import {
  createUploadTaskStoreState,
  dispatchUploadTaskEvent,
  enqueueUploadTask,
  getUploadTaskSummary,
} from './upload-task.store';
import { UPLOAD_TASK_STATUS } from './upload-task.types';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(`[upload-task-scenario] ${message}`);
  }
}

/**
 * Step 1 验收场景：
 * 1) queued -> uploading -> paused -> uploading -> success
 * 2) queued -> uploading -> failed -> queued(retry) -> uploading -> canceled
 */
export function runUploadTaskScenario() {
  let state = createUploadTaskStoreState();

  state = enqueueUploadTask(state, {
    id: 'task-image-1',
    meta: {
      fileName: 'cover.png',
      fileSize: 2_048_000,
      mimeType: 'image/png',
      libraryId: 1,
      parentId: 1,
    },
  });

  state = enqueueUploadTask(state, {
    id: 'task-audio-1',
    meta: {
      fileName: 'song.mp3',
      fileSize: 8_192_000,
      mimeType: 'audio/mpeg',
      libraryId: 1,
      parentId: 1,
      folderGroupId: 'group-demo',
      relativePath: 'album/song.mp3',
    },
  });

  state = dispatchUploadTaskEvent(state, 'task-image-1', { type: 'START' });
  state = dispatchUploadTaskEvent(state, 'task-image-1', { type: 'PROGRESS', uploadedBytes: 1024 * 1024, speedBps: 256000 });
  state = dispatchUploadTaskEvent(state, 'task-image-1', { type: 'PAUSE' });
  state = dispatchUploadTaskEvent(state, 'task-image-1', { type: 'RESUME' });
  state = dispatchUploadTaskEvent(state, 'task-image-1', { type: 'SUCCESS' });

  state = dispatchUploadTaskEvent(state, 'task-audio-1', { type: 'START' });
  state = dispatchUploadTaskEvent(state, 'task-audio-1', {
    type: 'FAIL',
    error: { message: 'network timeout', retriable: true, code: 'NETWORK_TIMEOUT' },
  });
  state = dispatchUploadTaskEvent(state, 'task-audio-1', { type: 'RETRY' });
  state = dispatchUploadTaskEvent(state, 'task-audio-1', { type: 'START' });
  state = dispatchUploadTaskEvent(state, 'task-audio-1', { type: 'CANCEL' });

  const task1 = state.tasks['task-image-1'];
  const task2 = state.tasks['task-audio-1'];
  const summary = getUploadTaskSummary(state);

  assert(task1.status === UPLOAD_TASK_STATUS.SUCCESS, 'task-image-1 should be success');
  assert(task1.progress.percentage === 100, 'task-image-1 progress should be 100%');
  assert(task1.attempts === 2, 'task-image-1 attempts should be 2 after resume');

  assert(task2.status === UPLOAD_TASK_STATUS.CANCELED, 'task-audio-1 should be canceled');
  assert(task2.attempts === 2, 'task-audio-1 attempts should be 2 after retry start');
  assert(task2.error === null, 'task-audio-1 error should be reset after retry');

  assert(summary.total === 2, 'summary total should be 2');
  assert(summary.success === 1, 'summary success should be 1');
  assert(summary.canceled === 1, 'summary canceled should be 1');
  assert(summary.uploading === 0, 'summary uploading should be 0');

  return {
    state,
    summary,
  };
}

