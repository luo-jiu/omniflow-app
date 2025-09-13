import {FC, ReactNode, useEffect, useRef, useState} from "react";
import DirectorySidebarWrapper from "@/components/app-directory-sidebar/style.ts";
import {Tree} from "@douyinfe/semi-ui";

interface IProps {
  children?: ReactNode
}

const DirectorySidebar: FC<IProps> = () => {
  const [width, setWidth] = useState(240);
  const isResizing = useRef(false);

  const treeData = [
    {
      label: 'C盘',
      key: 'c',
      children: [{ label: 'Users', key: 'c-1' }]
    },
    {
      label: 'D盘',
      key: 'd',
      children: [{ label: 'Projects', key: 'd-1' }]
    }
  ];

  const onMouseDown = () => {
    isResizing.current = true;
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = e.clientX - 60; // 60 = A栏宽度
    if (newWidth > 150 && newWidth < 400) {
      setWidth(newWidth);
    }
  };

  const onMouseUp = () => {
    isResizing.current = false;
  };

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <DirectorySidebarWrapper>
      {/* 侧边栏 */}
      <div className="sidebar" style={{ width }}>
        <Tree treeData={treeData} defaultExpandAll style={{ padding: 8, flex: 1 }} />
      </div>

      {/* 拖拽条 */}
      <div className="resize-handle" onMouseDown={onMouseDown} />
    </DirectorySidebarWrapper>
  )
}

export default DirectorySidebar