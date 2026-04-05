import { DirectorySidebarWrapper } from './components/directory-tree/style';
import DirectoryTree from './components/directory-tree';
import { useRepositoryTree } from './hooks/useRepositoryTree';
import React from "react";

interface Props {
  libraryId: number;
  onFileOpen?: (fileUrl: string, fileName: string, fileType: 'image' | 'video' | 'audio' | 'other') => void;
}

const DirectorySidebar: React.FC<Props> = ({ libraryId, onFileOpen }) => {
  const {
    expandedKeys,
    currentTreeData,
    handleExpand,
    handleDoubleClick,
    loadChildren,
    appendNodeUnderParent,
    removeNode,
    updateNodeName,
  } = useRepositoryTree(libraryId, onFileOpen);

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
            if (!parentNode || parentNode.key === 'root' || parentNode.id === 1) {
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
          libraryId={libraryId}
        />
      </div>
    </DirectorySidebarWrapper>
  );
}

export default DirectorySidebar;
