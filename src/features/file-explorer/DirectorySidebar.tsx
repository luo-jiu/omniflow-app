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
            if (!parentNode || parentNode.key === 'root' || (rootNodeId !== null && parentNode.id === rootNodeId)) {
              appendNodeUnderParent('root', newNode);
            } else {
              appendNodeUnderParent(parentNode.key, newNode);
            }
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
          onMoveSuccess={({ oldParentId, newParentId }) => {
            void refreshAfterMove(oldParentId, newParentId);
          }}
          libraryId={libraryId}
          rootNodeId={rootNodeId}
        />
      </div>
    </DirectorySidebarWrapper>
  );
};

export default DirectorySidebar;
