import { describe, expect, it } from 'vitest';
import { resolveTextSaveFeedback } from './text-viewer-save';

describe('Text viewer save feedback', () => {
  it('does not claim follow-up edits were persisted when the draft flush failed', () => {
    expect(resolveTextSaveFeedback({
      draftCleanupFailed: false,
      editedDuringSave: true,
      followUpDraftPersisted: false,
    })).toEqual({
      level: 'warning',
      message: '文件已保存，但后续修改尚未写入草稿，请尽快再次保存',
    });
  });

  it('reports draft cleanup failures without adding a contradictory success message', () => {
    expect(resolveTextSaveFeedback({
      draftCleanupFailed: true,
      editedDuringSave: false,
      followUpDraftPersisted: true,
    }).level).toBe('warning');
  });

  it('confirms persisted edits only after a successful follow-up flush', () => {
    expect(resolveTextSaveFeedback({
      draftCleanupFailed: false,
      editedDuringSave: true,
      followUpDraftPersisted: true,
    })).toEqual({
      level: 'success',
      message: '已保存，后续修改已保留为草稿',
    });
  });
});
