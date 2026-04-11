import { DirectorySidebarWrapper } from './components/directory-tree/style';
import DirectoryTree from './components/directory-tree';
import { useRepositoryTree } from './hooks/useRepositoryTree';
import type { NodeRespDTO } from './hooks/useRepositoryTree';
import React from 'react';
import { useDesktopAutoImport } from './hooks/useDesktopAutoImport';

interface Props {
  libraryId: number;
  onFileOpen?: (
    fileUrl: string,
    fileName: string,
    fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'comic_archive' | 'other',
    nodeId: number,
    options?: {
      tabTypeLabel?: string | null;
      returnTarget?: {
        fileUrl: string;
        fileName: string | null;
        fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'comic_archive' | 'other';
        nodeId: number | null;
        tabTypeLabel?: string | null;
      } | null;
    },
  ) => void;
}

function isNodeRespDTO(value: unknown): value is NodeRespDTO {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    Number.isFinite(Number(payload.id))
    && typeof payload.name === 'string'
    && (payload.type === 'dir' || payload.type === 'file')
    && Number.isFinite(Number(payload.parentId))
    && Number.isFinite(Number(payload.libraryId))
  );
}

const DirectorySidebar: React.FC<Props> = ({ libraryId, onFileOpen }) => {
  const {
    rootNodeId,
    expandedKeys,
    currentTreeData,
    handleExpand,
    handleDoubleClick,
    loadChildren,
    appendNodeUnderParent,
    appendNodesUnderParentsByRepository,
    removeNode,
    updateNodeName,
    updateNodeBuiltInConfig,
    refreshAfterMove,
  } = useRepositoryTree(libraryId, onFileOpen);

  const handleAutoImportNodeCreated = React.useCallback((newNode: unknown) => {
    if (!isNodeRespDTO(newNode)) {
      return;
    }
    appendNodeUnderParent('root', newNode);
  }, [appendNodeUnderParent]);

  const uploadAppendQueueRef = React.useRef<Array<{ repositoryId: number; parentNodeKey: string; newNodeDTO: NodeRespDTO }>>([]);
  const uploadAppendTimerRef = React.useRef<number | null>(null);
  const UPLOAD_APPEND_FLUSH_MS = 240;
  const UPLOAD_APPEND_BATCH_SIZE = 220;

  const flushUploadAppendQueue = React.useCallback(() => {
    uploadAppendTimerRef.current = null;
    if (uploadAppendQueueRef.current.length === 0) {
      return;
    }

    const batch = uploadAppendQueueRef.current.splice(0, UPLOAD_APPEND_BATCH_SIZE);
    const groupedByRepository = new Map<number, Array<{ parentNodeKey: string; newNodeDTO: NodeRespDTO }>>();
    batch.forEach((item) => {
      const bucket = groupedByRepository.get(item.repositoryId) || [];
      bucket.push({ parentNodeKey: item.parentNodeKey, newNodeDTO: item.newNodeDTO });
      groupedByRepository.set(item.repositoryId, bucket);
    });
    groupedByRepository.forEach((items, repositoryId) => {
      appendNodesUnderParentsByRepository(repositoryId, items);
    });

    if (uploadAppendQueueRef.current.length > 0) {
      uploadAppendTimerRef.current = window.setTimeout(flushUploadAppendQueue, UPLOAD_APPEND_FLUSH_MS);
    }
  }, [appendNodesUnderParentsByRepository]);

  const enqueueUploadedNodeAppend = React.useCallback((parentNode: any, newNode: unknown) => {
    if (!isNodeRespDTO(newNode)) {
      return;
    }

    const parentNodeKey = (!parentNode || parentNode.key === 'root' || (rootNodeId !== null && parentNode.id === rootNodeId))
      ? 'root'
      : String(parentNode.key);

    uploadAppendQueueRef.current.push({
      repositoryId: libraryId,
      parentNodeKey,
      newNodeDTO: newNode,
    });

    if (uploadAppendQueueRef.current.length >= UPLOAD_APPEND_BATCH_SIZE && uploadAppendTimerRef.current !== null) {
      window.clearTimeout(uploadAppendTimerRef.current);
      uploadAppendTimerRef.current = null;
      flushUploadAppendQueue();
      return;
    }

    if (uploadAppendTimerRef.current === null) {
      uploadAppendTimerRef.current = window.setTimeout(flushUploadAppendQueue, UPLOAD_APPEND_FLUSH_MS);
    }
  }, [flushUploadAppendQueue, libraryId, rootNodeId]);

  React.useEffect(() => () => {
    if (uploadAppendTimerRef.current !== null) {
      window.clearTimeout(uploadAppendTimerRef.current);
      uploadAppendTimerRef.current = null;
    }
    uploadAppendQueueRef.current.length = 0;
  }, []);

  useDesktopAutoImport({
    libraryId,
    rootNodeId,
    onNodeCreated: handleAutoImportNodeCreated,
  });

  return (
    <DirectorySidebarWrapper>
      <div className="sidebar-container">
        <DirectoryTree
          treeData={currentTreeData}
          expandedKeys={expandedKeys}
          onExpand={handleExpand}
          onDoubleClick={handleDoubleClick}
          loadData={loadChildren}
          onUploadSuccess={(parentNode, newNode) => {
            enqueueUploadedNodeAppend(parentNode, newNode);
          }}
          onDeleteSuccess={(_parentNode, deletedNodeKey) => {
            removeNode(deletedNodeKey);
          }}
          onRenameSuccess={(nodeKey, payload) => {
            updateNodeName(nodeKey, payload);
          }}
          onConfigSuccess={(nodeKey, payload) => {
            updateNodeBuiltInConfig(nodeKey, payload);
          }}
          onMoveSuccess={({ affectedParentIds }) => {
            void refreshAfterMove(affectedParentIds);
          }}
          libraryId={libraryId}
          rootNodeId={rootNodeId}
        />
      </div>
    </DirectorySidebarWrapper>
  );
};

export default DirectorySidebar;
