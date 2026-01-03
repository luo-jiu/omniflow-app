import React, { useState, WheelEvent, MouseEvent, useEffect } from 'react';
import { Popover } from '@douyinfe/semi-ui';
import { ImageViewerWrapper } from './style';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';

interface ImageViewerProps {
  url: string;
  fileName?: string | null;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ url, fileName }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const [menuState, setMenuState] = useState({
    visible: false,
    x: 0,
    y: 0
  });

  // 处理缩放：Ctrl + 滚轮
  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newScale = Math.min(Math.max(0.1, scale + delta), 5);
      setScale(newScale);
    }
  };

  // 鼠标按下：开始拖拽（仅当空格按下时）
  const handleMouseDown = (e: MouseEvent) => {
    if (isSpacePressed) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  // 鼠标移动
  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging && isSpacePressed) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  // 鼠标松开
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 处理右键菜单
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // 防止冒泡，避免触发其他地方的关闭逻辑
    
    // 如果菜单已经打开，先关闭再打开，确保位置更新和重新渲染
    if (menuState.visible) {
      setMenuState(prev => ({ ...prev, visible: false }));
      setTimeout(() => {
        setMenuState({
          visible: true,
          x: e.clientX,
          y: e.clientY
        });
      }, 0);
    } else {
      setMenuState({
        visible: true,
        x: e.clientX,
        y: e.clientY
      });
    }
  };

  // 菜单项配置
  const menuItems: ContextMenuItem[] = [
    {
      key: 'reset',
      label: '重置视图',
      icon: '🔄',
      onClick: () => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      }
    },
    {
      key: 'copy-link',
      label: '复制链接',
      icon: '🔗',
      onClick: () => {
        navigator.clipboard.writeText(url);
      }
    },
    { type: 'divider', key: 'd1' },
    {
      key: 'save',
      label: '保存图片',
      icon: '💾',
      onClick: () => console.log('保存功能占位')
    }
  ];

  // 监听空格键和其他快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true);
      }
      
      if (e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setScale(s => Math.min(s + 0.1, 5));
        } else if (e.key === '-') {
          e.preventDefault();
          setScale(s => Math.max(s - 0.1, 0.1));
        } else if (e.key === '0') {
          e.preventDefault();
          setScale(1);
          setPosition({ x: 0, y: 0 });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsDragging(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <ImageViewerWrapper 
      onWheel={handleWheel} 
      onContextMenu={handleContextMenu}
      className={`${isSpacePressed ? 'can-pan' : ''} ${isDragging ? 'is-panning' : ''}`}
    >
      <div 
        className="image-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={url}
          alt={fileName || 'Image'}
          className="viewer-image"
          style={{ 
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
          }}
        />
      </div>
      
      {fileName && (
        <div className="viewer-floating-bar">
          <span className="info-tag">{fileName}</span>
          <span className="scale-tag">{(scale * 100).toFixed(0)}%</span>
        </div>
      )}

      {/* 右键菜单层 */}
      <Popover
        trigger="custom"
        visible={menuState.visible}
        onClickOutSide={() => setMenuState(prev => ({ ...prev, visible: false }))}
        position="bottomLeft" // 改为 bottomLeft：对齐左侧，向右展开
        showArrow={false}
        spacing={4}
        getPopupContainer={() => document.body} // 渲染到 body，避免容器溢出和遮挡
        content={
          <ContextMenu
            items={menuItems}
            title={fileName || '图片操作'}
            onItemClick={() => setMenuState(prev => ({ ...prev, visible: false }))}
          />
        }
      >
        <div
          style={{
            position: 'fixed',
            left: menuState.x,
            top: menuState.y,
            width: 1, // 给 1px 宽度确保有参考点
            height: 1,
            pointerEvents: 'none', // 不干扰点击
            zIndex: 9999
          }}
        />
      </Popover>
    </ImageViewerWrapper>
  );
};

export default ImageViewer;

