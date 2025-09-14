import { DirectorySidebarWrapper } from './style';
import SidebarHeader from './SidebarHeader';
import DirectoryTree from './DirectoryTree';
import { useRepositoryTree } from '@/hooks/directory-sidebar/useRepositoryTree';
import { useResizableSidebar } from '@/hooks/directory-sidebar/useResizableSidebar';

export default function DirectorySidebar() {
  const {
    expandedKeys,
    currentTreeData,
    handleExpand,
    handleDoubleClick,
  } = useRepositoryTree();

  const { width, isDragging, containerRef, handleMouseDown } = useResizableSidebar();

  return (
    <DirectorySidebarWrapper ref={containerRef} $isDragging={isDragging}>
      <div className="sidebar-container" style={{ width: `${width}px` }}>
        <SidebarHeader />
        <DirectoryTree
          treeData={currentTreeData}
          expandedKeys={expandedKeys}
          onExpand={handleExpand}
          onDoubleClick={handleDoubleClick}
        />
      </div>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
    </DirectorySidebarWrapper>
  );
}
