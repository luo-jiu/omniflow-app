import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { API_CONFIG } from '@/config/api';
import { subscribeLibraryFilesDeleted } from '@/features/file-viewer/services/file-deletion-events';
import { matchesLibraryMutationScope } from '../services/node-mutation-events';

export function useLibraryTreeDeletionSelection(
  accountScope: string | null,
  libraryId: number,
  setSelectedNodeIds: Dispatch<SetStateAction<number[]>>,
  setSelectionAnchorKey: Dispatch<SetStateAction<string | null>>,
) {
  useEffect(() => subscribeLibraryFilesDeleted(event => {
    if (!matchesLibraryMutationScope(event, accountScope, API_CONFIG.BASE_URL, libraryId)) return;
    const deleted = new Set(event.nodeIds);
    setSelectedNodeIds(previous => previous.some(id => deleted.has(id)) ? previous.filter(id => !deleted.has(id)) : previous);
    // Tree keys use parentId:nodeId; root is not a deletable selection anchor.
    setSelectionAnchorKey(previous => previous && deleted.has(Number(previous.split(':').pop())) ? null : previous);
  }), [accountScope, libraryId, setSelectedNodeIds, setSelectionAnchorKey]);
}
