import { DirectorySidebarWrapper } from './style';
import DirectoryTree from './DirectoryTree';
import { useRepositoryTree } from '@/hooks/directory-sidebar/useRepositoryTree';
import { useResizableSidebar } from '@/hooks/directory-sidebar/useResizableSidebar';
import React from "react";

interface Props {
  libraryId: number;
}

const DirectorySidebar: React.FC<Props> = ({ libraryId }) => {
  const {
    expandedKeys,
    currentTreeData,
    handleExpand,
    handleDoubleClick,
    appendNodeUnderParent,
  } = useRepositoryTree(libraryId);

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
            appendNodeUnderParent(parentNode.key, newNode);
          }}
        />
      </div>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
    </DirectorySidebarWrapper>
  );
}

export default DirectorySidebar;