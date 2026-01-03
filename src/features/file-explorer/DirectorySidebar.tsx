import { DirectorySidebarWrapper } from './components/directory-tree/style';
import DirectoryTree from './components/directory-tree';
import { useRepositoryTree } from './hooks/useRepositoryTree';
import { useResizableSidebar } from './hooks/useResizableSidebar';
import React from "react";

interface Props {
  libraryId: number;
  onFileOpen?: (fileUrl: string, fileName: string, fileType: 'image' | 'video' | 'other') => void;
}

const DirectorySidebar: React.FC<Props> = ({ libraryId, onFileOpen }) => {
  const {
    expandedKeys,
    currentTreeData,
    handleExpand,
    handleDoubleClick,
    appendNodeUnderParent,
    removeNode,
    updateNodeName,
  } = useRepositoryTree(libraryId, onFileOpen);

  const { width, isDragging, containerRef, handleMouseDown } = useResizableSidebar();

  return (
    <DirectorySidebarWrapper ref={containerRef} $isDragging={isDragging}>
      <div className="sidebar-container" style={{ width: `${width}px` }}>
        <DirectoryTree
          treeData={currentTreeData}
          expandedKeys={expandedKeys}
          onExpand={handleExpand}
          onDoubleClick={handleDoubleClick}
          onUploadSuccess={(parentNode, newNode) => {
            // parentNode 就是 DirectoryTree 里传出来的 treeNode
            // 如果是根目录（parentNode 为 null 或 parentNode.key === 'root'），需要特殊处理
            if (!parentNode || parentNode.key === 'root' || parentNode.id === 1) {
              // 根目录新建，直接添加到根节点列表
              // 由于 useRepositoryTree 的 treesCache 是私有的，我们通过 appendNodeUnderParent 传入一个虚拟的 key
              // 但更好的方式是直接刷新根节点，这里先简单处理：添加到根节点
              // 注意：这里需要确保 newNode 的格式正确
              appendNodeUnderParent('root', newNode);
            } else {
              appendNodeUnderParent(parentNode.key, newNode);
            }
          }}
          onDeleteSuccess={(_parentNode, deletedNodeKey) => {
            // 删除成功后，从本地 treeData 中移除节点
            // deletedNodeKey 是节点的 key，格式为 `${parentId}:${id}`
            removeNode(deletedNodeKey);
          }}
          onRenameSuccess={(nodeKey, newName) => {
            updateNodeName(nodeKey, newName);
          }}
          libraryId={libraryId}
        />
      </div>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
    </DirectorySidebarWrapper>
  );
}

export default DirectorySidebar;