import { describe, expect, it, vi } from 'vitest';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { saveAsmrMetadata, type AsmrMetadataDraft } from './asmr-metadata-editor';

const baseline: AsmrMetadataDraft = { name: '作品', sn: 'old', coverNodeId: 20, tagIds: [1, 2] };
function dependencies() {
  return {
    readNode: vi.fn(async () => ({ id: 9, libraryId: 3, parentId: 8, type: 'dir' as const, name: '作品',
      updatedAt: '2026-10-02T00:00:00.123456Z', viewMeta: JSON.stringify({ sn: 'old', coverNodeId: 21, extra: 'fresh', tagIds: [1, 2, 4], tag: 'legacy' }) })),
    updateConfig: vi.fn(async () => undefined), rename: vi.fn(async () => undefined),
    updateTags: vi.fn(async () => ({ nodeId: 9, libraryId: 3, parentId: 8, tagIds: [1, 3, 4], affectedParentIds: [8], dryRun: false })),
  };
}

describe('ASMR metadata save', () => {
  it('updates only the user tag delta and preserves tags added during editing', async () => {
    const deps = dependencies();
    const result = await saveAsmrMetadata(3, 9, baseline, { ...baseline, tagIds: [1, 3] }, deps);
    expect(result).toMatchObject({ status: 'saved', baseline: { tagIds: [1, 3, 4] } });
    expect(deps.updateTags).toHaveBeenCalledWith(9, { libraryId: 3, addTagIds: [3], removeTagIds: [2] });
    expect(deps.readNode).not.toHaveBeenCalled();
    expect(deps.updateConfig).not.toHaveBeenCalled();
    expect(deps.rename).not.toHaveBeenCalled();
  });
  it('does not dispatch unchanged values', async () => {
    const deps = dependencies();
    expect((await saveAsmrMetadata(3, 9, baseline, { ...baseline, tagIds: [2, 1] }, deps)).status).toBe('saved');
    expect(deps.updateTags).not.toHaveBeenCalled();
    expect(deps.updateConfig).not.toHaveBeenCalled();
  });
  it('merges changed metadata with a compare-and-set while preserving legacy tag text', async () => {
    const deps = dependencies();
    expect((await saveAsmrMetadata(3, 9, baseline, { ...baseline, sn: 'new' }, deps)).status).toBe('saved');
    expect(deps.updateConfig).toHaveBeenCalledWith({ id: 9, libraryId: 3,
      expectedUpdatedAt: '2026-10-02T00:00:00.123456Z', viewMeta: JSON.stringify({ sn: 'new', coverNodeId: 21, extra: 'fresh', tag: 'legacy' }) });
    expect(deps.updateTags).not.toHaveBeenCalled();
  });
  it('keeps committed stages when a later stage is rejected and retries only the remaining delta', async () => {
    const deps = dependencies();
    deps.updateTags.mockRejectedValueOnce(new IpcRequestError('标签已删除', 409));
    const desired = { ...baseline, sn: 'new', tagIds: [1, 3] };
    const partial = await saveAsmrMetadata(3, 9, baseline, desired, deps);
    expect(partial).toMatchObject({ status: 'partial', savedParts: ['元信息'], baseline: { sn: 'new', tagIds: [1, 2] } });
    expect((await saveAsmrMetadata(3, 9, partial.baseline, desired, deps)).status).toBe('saved');
    expect(deps.updateConfig).toHaveBeenCalledTimes(1);
    expect(deps.updateTags).toHaveBeenCalledTimes(2);
  });
  it('reports uncertain writes without proceeding to later stages', async () => {
    const deps = dependencies();
    deps.updateConfig.mockRejectedValue(new Error('connection lost'));
    const result = await saveAsmrMetadata(3, 9, baseline, { ...baseline, sn: 'new', tagIds: [3] }, deps);
    expect(result).toMatchObject({ status: 'unknown', message: expect.stringContaining('不要重复提交') });
    expect(deps.updateTags).not.toHaveBeenCalled();
  });
  it('stops on stale revisions and does not treat malformed tag receipts as committed', async () => {
    const deps = dependencies();
    deps.updateConfig.mockRejectedValue(new IpcRequestError('配置已变化', 409));
    expect((await saveAsmrMetadata(3, 9, baseline, { ...baseline, sn: 'new', tagIds: [3] }, deps)).status).toBe('failed');
    expect(deps.updateTags).not.toHaveBeenCalled();
    deps.updateTags.mockResolvedValue({ nodeId: 9, libraryId: 3, parentId: 8, tagIds: [1], affectedParentIds: [8], dryRun: true });
    expect((await saveAsmrMetadata(3, 9, baseline, { ...baseline, tagIds: [1] }, deps)).status).toBe('unknown');
  });
  it('does not continue writing after the editor target is invalidated', async () => {
    const deps = dependencies();
    const assertCurrent = vi.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => undefined)
      .mockImplementation(() => { throw new Error('target changed'); });
    const result = await saveAsmrMetadata(3, 9, baseline, { ...baseline, sn: 'new', tagIds: [3] }, { ...deps, assertCurrent });
    expect(result.status).toBe('partial');
    expect(deps.updateConfig).toHaveBeenCalledOnce();
    expect(deps.updateTags).not.toHaveBeenCalled();
  });
});
