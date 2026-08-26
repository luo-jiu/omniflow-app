import { DirectorySidebarWrapper } from './components/directory-tree/style';
import DirectoryTree from './components/directory-tree';
import { useRepositoryTree } from './hooks/useRepositoryTree';
import type { NodeRespDTO } from './hooks/useRepositoryTree';
import React from 'react';
import { useDesktopAutoImport } from './hooks/useDesktopAutoImport';
import { TREE_REFRESH_DIRECTORY_EVENT, type TreeRefreshDirectoryDetail } from './services/tree-locate';
import type { FileViewerFileType } from '@/shared/file-viewer-types';
import type { FileViewerOpenOptions } from '@/contexts/file-viewer.context';

interface Props {
  libraryId: number;
  onFileOpen?: (
    fileUrl: string,
    fileName: string,
    fileType: FileViewerFileType,
    nodeId: number,
    options?: FileViewerOpenOptions,
  ) => void;
  onOpenFileInBrowser?: (payload: {
    fileExt: string;
    fileName: string;
    nodeId: number;
  }) => void | Promise<void>;
  onOpenMediaTool?: (node: SelectedTreeNode) => void | Promise<void>;
  onSelectionChange?: (payload: {
    primaryNode: SelectedTreeNode | null;
    rootNodeId: number | null;
    selectedNodeIds: number[];
  }) => void;
  onRootNodeIdChange?: (rootNodeId: number | null) => void;
  browserModeOpen?: boolean;
}

export interface DirectorySidebarHandle {
  refreshNodeSubtree: (nodeId: number) => Promise<void>;
}

export interface SelectedTreeNode {
  archiveMode?: number;
  builtInType?: string;
  ext?: string;
  id: number;
  key: string;
  libraryId: number;
  mimeType?: string;
  name: string;
  parentId: number;
  type: 'dir' | 'file';
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

const DirectorySidebar = React.forwardRef<DirectorySidebarHandle, Props>(({
  libraryId,
  onFileOpen,
  onOpenFileInBrowser,
  onOpenMediaTool,
  onRootNodeIdChange,
  onSelectionChange,
  browserModeOpen = false,
}, ref) => {
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
    refreshNodeSubtree,
    toggleAudioArchiveSubtitles,
    isAudioArchiveSubtitlesVisible,
  } = useRepositoryTree(libraryId, onFileOpen);

  React.useEffect(() => {
    onRootNodeIdChange?.(rootNodeId);
  }, [onRootNodeIdChange, rootNodeId]);

  React.useImperativeHandle(ref, () => ({
    refreshNodeSubtree,
  }), [refreshNodeSubtree]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const { directoryNodeId } = (event as CustomEvent<TreeRefreshDirectoryDetail>).detail;
      if (directoryNodeId > 0) {
        refreshNodeSubtree(directoryNodeId);
      }
    };
    window.addEventListener(TREE_REFRESH_DIRECTORY_EVENT, handler);
    return () => { window.removeEventListener(TREE_REFRESH_DIRECTORY_EVENT, handler); };
  }, [refreshNodeSubtree]);

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
    const parentBuiltInType = String(parentNode?.builtInType || 'DEF').toUpperCase();
    const parentArchiveMode = Number(parentNode?.archiveMode ?? 0) === 1 ? 1 : 0;
    if (parentNode?.id && parentBuiltInType === 'AUDIO' && parentArchiveMode === 1) {
      void refreshNodeSubtree(Number(parentNode.id));
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
  }, [flushUploadAppendQueue, libraryId, refreshNodeSubtree, rootNodeId]);

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
          onCreateSuccess={(parentNode, newNode) => {
            if (!isNodeRespDTO(newNode)) {
              return;
            }
            const parentNodeKey = (
              !parentNode
              || parentNode.key === 'root'
              || (rootNodeId !== null && Number(parentNode.id) === Number(rootNodeId))
            )
              ? 'root'
              : String(parentNode.key);
            appendNodeUnderParent(parentNodeKey, newNode);
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
          onRefreshNode={(node) => {
            const targetNodeId = Number(node?.id);
            if (!Number.isFinite(targetNodeId) || targetNodeId <= 0) {
              return Promise.resolve();
            }
            return refreshNodeSubtree(targetNodeId);
          }}
          onToggleAudioArchiveSubtitles={toggleAudioArchiveSubtitles}
          isAudioArchiveSubtitlesVisible={isAudioArchiveSubtitlesVisible}
          onOpenFileInBrowser={onOpenFileInBrowser}
          onOpenMediaTool={(node) => {
            onOpenMediaTool?.({
              archiveMode: Number(node.archiveMode ?? 0),
              builtInType: String(node.builtInType || 'DEF'),
              ext: node.data?.rawExt ? String(node.data.rawExt) : node.ext ? String(node.ext) : undefined,
              id: Number(node.id),
              key: String(node.key || ''),
              libraryId: Number(node.libraryId || libraryId),
              mimeType: node.mimeType ? String(node.mimeType) : undefined,
              name: String(node.data?.rawName || node.name || node.label || ''),
              parentId: Number(node.parentId || 0),
              type: node.type === 'dir' ? 'dir' : 'file',
            });
          }}
          onSelectionChange={(payload) => {
            onSelectionChange?.({
              primaryNode: payload.primaryNode
                ? {
                  archiveMode: Number(payload.primaryNode.archiveMode ?? 0),
                  builtInType: String(payload.primaryNode.builtInType || 'DEF'),
                  ext: payload.primaryNode.ext ? String(payload.primaryNode.ext) : undefined,
                  id: Number(payload.primaryNode.id),
                  key: String(payload.primaryNode.key || ''),
                  libraryId: Number(payload.primaryNode.libraryId || libraryId),
                  mimeType: payload.primaryNode.mimeType ? String(payload.primaryNode.mimeType) : undefined,
                  name: String(payload.primaryNode.name || ''),
                  parentId: Number(payload.primaryNode.parentId || 0),
                  type: payload.primaryNode.type === 'dir' ? 'dir' : 'file',
                }
                : null,
              rootNodeId,
              selectedNodeIds: payload.selectedNodeIds,
            });
          }}
          libraryId={libraryId}
          rootNodeId={rootNodeId}
          browserModeOpen={browserModeOpen}
        />
      </div>
    </DirectorySidebarWrapper>
  );
});

DirectorySidebar.displayName = 'DirectorySidebar';

export default DirectorySidebar;
