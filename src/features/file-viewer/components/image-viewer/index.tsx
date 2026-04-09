import React, { useState, WheelEvent, MouseEvent, useEffect, useCallback, useRef } from 'react';
import { Popover } from '@douyinfe/semi-ui';
import { ImageViewerWrapper } from './style';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface ImageViewerProps {
  url: string;
  fileName?: string | null;
}

interface Point {
  x: number;
  y: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;
const WHEEL_ZOOM_RATIO = 0.08;
const FIT_RETRY_FRAMES = 6;

const ImageViewer: React.FC<ImageViewerProps> = ({ url, fileName }) => {
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [isPanMode, setIsPanMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragAnchor, setDragAnchor] = useState<Point>({ x: 0, y: 0 });
  const [menuState, setMenuState] = useState({
    visible: false,
    x: 0,
    y: 0
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageNaturalRef = useRef({ width: 0, height: 0 });

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const computeContainScale = useCallback((
    containerWidth: number,
    containerHeight: number,
    imageWidth: number,
    imageHeight: number
  ) => {
    if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return 1;
    return Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  }, []);

  const fitToViewport = useCallback((attempt = 0) => {
    const container = containerRef.current;
    const { width: imageWidth, height: imageHeight } = imageNaturalRef.current;
    if (!container || imageWidth <= 0 || imageHeight <= 0) return;

    const viewportWidth = Math.round(container.clientWidth);
    const viewportHeight = Math.round(container.clientHeight);

    // 初次渲染时容器高度可能还没稳定，延后一两帧再测
    if ((viewportWidth <= 0 || viewportHeight <= 0) && attempt < FIT_RETRY_FRAMES) {
      requestAnimationFrame(() => fitToViewport(attempt + 1));
      return;
    }

    const nextBase = computeContainScale(viewportWidth, viewportHeight, imageWidth, imageHeight);
    setBaseScale(Number.isFinite(nextBase) && nextBase > 0 ? nextBase : 1);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    setIsPanMode(false);
  }, [computeContainScale]);

  // 重置视图：完整显示图片（上下左右都可见）并尽量大
  const resetView = useCallback(() => {
    fitToViewport(0);
  }, [fitToViewport]);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    imageNaturalRef.current = {
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
    setNaturalSize({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    fitToViewport(0);
  }, [fitToViewport]);

  // 切换图片时清空上一张图的尺寸和拖拽状态，避免“旧尺寸残留”
  useEffect(() => {
    setNaturalSize({ width: 0, height: 0 });
    setBaseScale(1);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    setIsPanMode(false);
    imageNaturalRef.current = { width: 0, height: 0 };
  }, [url]);

  // 滚轮缩放（不需要 Ctrl）
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY > 0 ? -1 : 1;
    setZoom(prev => clamp(prev + direction * prev * WHEEL_ZOOM_RATIO, MIN_ZOOM, MAX_ZOOM));
  }, []);

  // 鼠标按下：空格 或 中键 开始拖拽
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (isPanMode || e.button === 1) {
      e.preventDefault();
      setIsDragging(true);
      setDragAnchor({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  }, [isPanMode, offset]);

  // 鼠标移动
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragAnchor.x,
        y: e.clientY - dragAnchor.y
      });
    }
  }, [isDragging, dragAnchor]);

  // 鼠标松开
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 处理右键菜单
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (menuState.visible) {
      setMenuState(prev => ({ ...prev, visible: false }));
      setTimeout(() => {
        setMenuState({ visible: true, x: e.clientX, y: e.clientY });
      }, 0);
    } else {
      setMenuState({ visible: true, x: e.clientX, y: e.clientY });
    }
  };

  // 菜单项
  const menuItems: ContextMenuItem[] = [
    {
      key: 'reset',
      label: '重置视图',
      onClick: resetView
    },
    {
      key: 'copy-link',
      label: '复制链接',
      onClick: () => {
        navigator.clipboard.writeText(url);
      }
    },
    { type: 'divider', key: 'd1' },
    {
      key: 'save',
      label: '保存图片',
      onClick: () => runtimeLogger.info('保存功能占位')
    }
  ];

  // 空格键平移 + 快捷键缩放
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsPanMode(true);
      }

      if (e.ctrlKey || e.metaKey) {
        if (isEditableTarget(e.target)) {
          return;
        }

        const code = e.code;
        const key = e.key;
        const isPlus = key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd';
        const isMinus = key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract';
        const isReset = key === '0' || code === 'Digit0' || code === 'Numpad0';

        if (isPlus) {
          e.preventDefault();
          setZoom(s => clamp(s * 1.15, MIN_ZOOM, MAX_ZOOM));
        } else if (isMinus) {
          e.preventDefault();
          setZoom(s => clamp(s / 1.15, MIN_ZOOM, MAX_ZOOM));
        } else if (isReset) {
          e.preventDefault();
          resetView();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsPanMode(false);
        setIsDragging(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [resetView]);

  return (
    <ImageViewerWrapper
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      className={`${isPanMode ? 'can-pan' : ''} ${isDragging ? 'is-panning' : ''}`}
    >
      <div
        ref={containerRef}
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
          onLoad={handleImageLoad}
          style={{
            width: naturalSize.width > 0 ? `${naturalSize.width}px` : undefined,
            height: naturalSize.height > 0 ? `${naturalSize.height}px` : undefined,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${baseScale * zoom})`,
            transition: 'none'
          }}
        />
      </div>

      {fileName && (
        <div className="viewer-floating-bar">
          <span className="info-tag">{fileName}</span>
          <span className="scale-tag">{(zoom * 100).toFixed(0)}%</span>
        </div>
      )}

      <Popover
        trigger="custom"
        visible={menuState.visible}
        onClickOutSide={() => setMenuState(prev => ({ ...prev, visible: false }))}
        position="bottomLeft"
        showArrow={false}
        spacing={4}
        getPopupContainer={() => document.body}
        content={
          <ContextMenu
            items={menuItems}
            className="directory-context-menu"
            onItemClick={() => setMenuState(prev => ({ ...prev, visible: false }))}
          />
        }
      >
        <div
          style={{
            position: 'fixed',
            left: menuState.x,
            top: menuState.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
            zIndex: 9999
          }}
        />
      </Popover>
    </ImageViewerWrapper>
  );
};

export default ImageViewer;
