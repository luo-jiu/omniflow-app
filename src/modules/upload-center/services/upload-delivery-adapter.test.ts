import { describe, expect, it } from 'vitest';

import { classifyUploadBatchResults } from '../engine/upload-manager';
import { UPLOAD_TASK_STATUS } from '../model/upload-task.types';
import {
  createUploadTaskInput,
  freezeUploadDeliveryTarget,
  resolveUploadBatchTerminal,
} from './upload-delivery-adapter';

describe('upload delivery adapter', () => {
  it('freezes the library target and derives the relative path once', () => {
    const target = freezeUploadDeliveryTarget({
      fileName: 'clip.mp4',
      libraryId: 7,
      parentId: 42,
    });

    expect(target).toEqual({
      fileName: 'clip.mp4',
      libraryId: 7,
      parentId: 42,
      relativePath: 'clip.mp4',
    });
    expect(Object.isFrozen(target)).toBe(true);
    expect(createUploadTaskInput({ name: 'clip.mp4', size: 12, type: 'video/mp4' } as File, target))
      .toMatchObject({ libraryId: 7, parentId: 42, relativePath: 'clip.mp4' });
  });

  it('classifies complete, failed, cancelled, partial and unknown batches', async () => {
    expect(classifyUploadBatchResults([{ taskStatus: UPLOAD_TASK_STATUS.SUCCESS }])).toBe('completed');
    expect(classifyUploadBatchResults([{ taskStatus: UPLOAD_TASK_STATUS.CANCELED }])).toBe('cancelled');
    expect(classifyUploadBatchResults([{ taskStatus: UPLOAD_TASK_STATUS.FAILED }])).toBe('failed');
    expect(classifyUploadBatchResults([
      { taskStatus: UPLOAD_TASK_STATUS.SUCCESS },
      { taskStatus: UPLOAD_TASK_STATUS.FAILED },
    ])).toBe('failed');
    expect(classifyUploadBatchResults([])).toBe('unknown');
    await expect(resolveUploadBatchTerminal({
      done: Promise.resolve([{ taskStatus: 'unexpected' }]),
    })).resolves.toBe('unknown');
    await expect(resolveUploadBatchTerminal({
      done: Promise.resolve([]),
      terminal: Promise.resolve('completed'),
    })).resolves.toBe('completed');
  });
});
