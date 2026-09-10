import { useCallback, useEffect, useRef } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { API_CONFIG } from '@/config/api';
import { useViewerAccountScope } from '@/features/file-viewer/session';
import { fetchNodeDetailById, getLibraryRootNodeId, restoreNodeAndChildren, type RecycleBinItem } from '../services/file.api';
import { notifyLibraryNodesMutated } from '../services/node-mutation-events';
import { runtimeLogger } from '@/utils/runtimeLogger';

export function useRestoreRecycleBinNode(libraryId: number, onRestored: (nodeId: number) => void) {
  const accountScope = useViewerAccountScope();
  const identity = JSON.stringify([accountScope, API_CONFIG.BASE_URL, libraryId]);
  const current = useRef<string | null>(identity);
  current.current = identity;
  useEffect(() => {
    current.current = identity;
    return () => { current.current = null; };
  }, [identity]);

  return useCallback(async (item: RecycleBinItem) => {
    const backendScope = API_CONFIG.BASE_URL;
    const isCurrent = () => current.current === identity && API_CONFIG.BASE_URL === backendScope;
    if (!accountScope || item.libraryId !== libraryId || !isCurrent()) return;
    try {
      if (!await restoreNodeAndChildren(item.id, libraryId)) throw new Error('恢复未成功');
    } catch (error) {
      if (isCurrent()) Toast.error(error instanceof Error ? error.message : '恢复失败');
      return;
    }
    // A committed restore remains successful even when its follow-up reads fail.
    notifyLibraryNodesMutated({ accountScope, backendScope, libraryId, affectedParentIds: [] });
    if (!isCurrent()) return;
    onRestored(item.id);
    Toast.success('已恢复');
    try {
      const node = await fetchNodeDetailById(item.id);
      if (!isCurrent()) return;
      if (node.libraryId !== libraryId) throw new Error('恢复节点的资料库不匹配');
      notifyLibraryNodesMutated({ accountScope, backendScope, libraryId,
        affectedParentIds: [node.parentId], nodeId: item.id, name: node.name, ext: node.ext, type: node.type,
        parentId: node.parentId });
    } catch (error) {
      runtimeLogger.warn('节点已恢复，但读取恢复位置失败', error);
      if (!isCurrent()) return;
      try {
        const rootId = await getLibraryRootNodeId(libraryId);
        if (isCurrent()) notifyLibraryNodesMutated({ accountScope, backendScope, libraryId, affectedParentIds: [rootId] });
      } catch (refreshError) {
        runtimeLogger.warn('节点已恢复，但目录刷新失败', refreshError);
      }
      if (isCurrent()) Toast.warning('已恢复，但目录信息刷新不完整，请刷新目录');
    }
  }, [accountScope, identity, libraryId, onRestored]);
}
