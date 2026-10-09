import { fetchNodeDetailById, renameNode, updateNodeConfig } from '@/features/file-explorer/services/file.api';
import { updateNodeTags } from '@/features/tag-management/services/tag.api';
import { IpcRequestError } from '@/service/request/ipcRequest';

export interface AsmrMetadataDraft {
  name: string;
  sn: string;
  coverNodeId: number | null;
  tagIds: number[];
}

export interface AsmrMetadataSaveResult {
  status: 'saved' | 'failed' | 'partial' | 'unknown';
  baseline: AsmrMetadataDraft;
  savedParts: string[];
  affectedParentIds: number[];
  message?: string;
}

interface Dependencies {
  readNode?: typeof fetchNodeDetailById;
  rename?: typeof renameNode;
  updateConfig?: typeof updateNodeConfig;
  updateTags?: typeof updateNodeTags;
  assertCurrent?: () => void;
}

/** Saves only changes made in this editor; successful stages are never replayed on retry. */
export async function saveAsmrMetadata(
  libraryId: number, nodeId: number, baseline: AsmrMetadataDraft, desired: AsmrMetadataDraft,
  deps: Dependencies = {},
): Promise<AsmrMetadataSaveResult> {
  let current = { ...baseline, tagIds: [...baseline.tagIds] };
  const savedParts: string[] = [];
  const affectedParentIds = new Set<number>([nodeId]);
  let dispatched = false;
  try {
    const previousIds = new Set(baseline.tagIds);
    const selectedIds = new Set(desired.tagIds);
    const addTagIds = [...selectedIds].filter(id => !previousIds.has(id));
    const removeTagIds = [...previousIds].filter(id => !selectedIds.has(id));
    if (addTagIds.length > 100 || removeTagIds.length > 100) throw new Error('一次最多增加或移除 100 个标签');
    const snChanged = desired.sn !== baseline.sn;
    const coverChanged = desired.coverNodeId !== baseline.coverNodeId;
    if (snChanged || coverChanged) {
      deps.assertCurrent?.();
      const fresh = await (deps.readNode || fetchNodeDetailById)(nodeId);
      deps.assertCurrent?.();
      if (fresh.id !== nodeId || fresh.libraryId !== libraryId || fresh.type !== 'dir' || !fresh.updatedAt) {
        throw new Error('无法确认集合当前版本，请重新打开编辑');
      }
      const meta: Record<string, unknown> = fresh.viewMeta ? JSON.parse(fresh.viewMeta) : {};
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('集合元信息格式异常');
      // 标签关系单独增量更新；其余未编辑字段来自刚读取的最新版本。
      delete meta.tagIds;
      if (snChanged) { if (desired.sn) meta.sn = desired.sn; else delete meta.sn; }
      if (coverChanged) { if (desired.coverNodeId) meta.coverNodeId = desired.coverNodeId; else delete meta.coverNodeId; }
      dispatched = true;
      await (deps.updateConfig || updateNodeConfig)({ id: nodeId, libraryId, expectedUpdatedAt: fresh.updatedAt,
        viewMeta: JSON.stringify(meta) });
      dispatched = false;
      current = { ...current, sn: desired.sn, coverNodeId: desired.coverNodeId };
      savedParts.push('元信息');
      if (fresh.parentId > 0) affectedParentIds.add(fresh.parentId);
    }
    if (desired.name !== baseline.name) {
      deps.assertCurrent?.();
      const fresh = await (deps.readNode || fetchNodeDetailById)(nodeId);
      deps.assertCurrent?.();
      if (fresh.id !== nodeId || fresh.libraryId !== libraryId || fresh.type !== 'dir' || fresh.name !== baseline.name) {
        throw new Error('集合名称已变化，请重新打开编辑');
      }
      dispatched = true;
      await (deps.rename || renameNode)({ id: nodeId, name: desired.name });
      dispatched = false;
      current = { ...current, name: desired.name };
      savedParts.push('名称');
      if (fresh.parentId > 0) affectedParentIds.add(fresh.parentId);
    }
    if (addTagIds.length || removeTagIds.length) {
      deps.assertCurrent?.();
      dispatched = true;
      const state = await (deps.updateTags || updateNodeTags)(nodeId, { libraryId, addTagIds, removeTagIds });
      if (state.nodeId !== nodeId || state.libraryId !== libraryId || state.dryRun !== false) {
        throw new Error('标签保存回执异常');
      }
      dispatched = false;
      current = { ...current, tagIds: state.tagIds };
      savedParts.push('标签');
      state.affectedParentIds.forEach(id => affectedParentIds.add(id));
    }
    return { status: 'saved', baseline: current, savedParts, affectedParentIds: [...affectedParentIds] };
  } catch (error) {
    const rejected = error instanceof IpcRequestError && error.status >= 400 && error.status < 500
      && ![408, 429].includes(error.status);
    const unknown = dispatched && !rejected;
    const status = unknown ? 'unknown' : savedParts.length ? 'partial' : 'failed';
    const detail = error instanceof Error ? error.message : '保存失败';
    return { status, baseline: current, savedParts, affectedParentIds: [...affectedParentIds], message: unknown
      ? `${savedParts.length ? `${savedParts.join('、')}已保存；` : ''}其余保存结果尚未确认，请重新打开核对，不要重复提交`
      : `${savedParts.length ? `${savedParts.join('、')}已保存；` : ''}${detail}` };
  }
}
