import { describe, expect, it, vi } from 'vitest';
import { resolveTextSaveFeedback, saveTextWithRevision, TextFileConflictError } from './text-viewer-save';
import { createTextContentRevision } from './text-viewer-session';
import { IpcRequestError } from '@/service/request/ipcRequest';

describe('text editor conditional save', () => {
  it('blocks an outdated buffer before writing and guards against changes after validation', async () => {
    const deps = { detail: vi.fn(async () => ({ id: 9, libraryId: 3, type: 'file', storageKey: 'new' })) as any,
      link: vi.fn(async () => 'test-url'), read: vi.fn(async () => 'new content'), update: vi.fn() };
    const input = { nodeId: 9, libraryId: 3, content: 'edited', baseRevision: await createTextContentRevision('old content'), assertCurrent: vi.fn() };
    await expect(saveTextWithRevision(input, deps)).rejects.toBeInstanceOf(TextFileConflictError);
    expect(deps.update).not.toHaveBeenCalled();
    input.baseRevision = await createTextContentRevision('new content');
    deps.update.mockRejectedValueOnce(new IpcRequestError('conflict', 409));
    await expect(saveTextWithRevision(input, deps)).rejects.toBeInstanceOf(TextFileConflictError);
    expect(deps.update).toHaveBeenCalledWith(expect.objectContaining({ expectedStorageKey: 'new' }));
    deps.update.mockResolvedValueOnce({ id: 9 });
    await expect(saveTextWithRevision(input, deps)).resolves.toMatchObject({ savedNode: { id: 9 } });
  });
});

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
