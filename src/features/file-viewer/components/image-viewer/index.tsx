import React, { useState, WheelEvent, MouseEvent, useEffect, useCallback, useMemo, useRef } from 'react';
import { Popover, Spin, Toast } from '@douyinfe/semi-ui';
import { IconCrop } from '@douyinfe/semi-icons';
import { ImageViewerWrapper } from './style';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import ImageCropOverlay from '../image-crop-overlay';
import {
  createDefaultCropSelection,
  getDisplayedImageBounds,
  getImageRectInContainer,
  isCropBoundsUsable,
  saveCroppedImageCopy,
  type CropBounds,
  type CropSelection,
} from '../../services/image-crop.service';
import {
  fetchNodeDetailById,
  getChildrenByNodeId,
} from '@/features/file-explorer/services/file.api';
import { buildFileFullName } from '@/utils/fileTreeSettings';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { useViewerSession, type ViewerSessionAdapter } from '@/features/file-viewer/session';
import {
  IMAGE_VIEWER_SESSION_ESTIMATED_BYTES,
  IMAGE_VIEWER_SESSION_SCHEMA_VERSION,
  parseImageViewerSessionSnapshot,
  type ImageViewerSessionSnapshot,
} from './image-viewer-session';

interface ImageViewerProps {
  accountScope: string | null;
  libraryId: number | null;
  nodeId?: number | null;
  url: string;
  fileName?: string | null;
  active?: boolean;
  contentRevision: string | null;
  reloadToken?: number;
  tabId: string;
}

interface Point {
  x: number;
  y: number;
}

type ViewerZoomShortcutAction = 'zoom-in' | 'zoom-out' | 'reset';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;
const WHEEL_ZOOM_RATIO = 0.08;
const FIT_RETRY_FRAMES = 6;

function normalizeExt(value?: string | null): string {
  return String(value || '').trim().toLowerCase().replace(/^\./, '');
}

function extFromFileName(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  const dotIndex = raw.lastIndexOf('.');
  return dotIndex >= 0 ? normalizeExt(raw.slice(dotIndex + 1)) : '';
}

function isHeicFile(fileName?: string | null): boolean {
  const ext = extFromFileName(fileName);
  return ext === 'heic' || ext === 'heif' || ext === 'heics' || ext === 'heifs';
}

const ImageViewer: React.FC<ImageViewerProps> = ({
  accountScope,
  libraryId,
  nodeId,
  url,
  fileName,
  active = true,
  contentRevision,
  reloadToken = 0,
  tabId,
}) => {
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragAnchor, setDragAnchor] = useState<Point>({ x: 0, y: 0 });
  const [rotateSteps, setRotateSteps] = useState(0);
  const [cropMode, setCropMode] = useState(false);
  const [cropBounds, setCropBounds] = useState<CropBounds | null>(null);
  const [cropSelection, setCropSelection] = useState<CropSelection | null>(null);
  const [cropApplying, setCropApplying] = useState(false);
  const [menuState, setMenuState] = useState({
    visible: false,
    x: 0,
    y: 0
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageNaturalRef = useRef({ width: 0, height: 0 });
  const activeRef = useRef(active);
  const loadedResourceUrlRef = useRef('');
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const pendingSessionRestoreRef = useRef<{
    resourceUrl: string;
    snapshot: ImageViewerSessionSnapshot;
  } | null>(null);
  const rotateStepsRef = useRef(0);
  const zoomRef = useRef(1);
  activeRef.current = active;
  offsetRef.current = offset;
  rotateStepsRef.current = rotateSteps;
  zoomRef.current = zoom;
  const isHeic = useMemo(() => isHeicFile(fileName), [fileName]);
  const imageUrl = isHeic ? previewUrl : url;

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

  const applySessionSnapshot = useCallback((snapshot: ImageViewerSessionSnapshot) => {
    const container = containerRef.current;
    const viewportWidth = Math.round(container?.clientWidth ?? 0);
    const viewportHeight = Math.round(container?.clientHeight ?? 0);
    const nextOffset = {
      x: snapshot.offsetRatioX != null && viewportWidth > 0
        ? snapshot.offsetRatioX * viewportWidth
        : snapshot.offsetX,
      y: snapshot.offsetRatioY != null && viewportHeight > 0
        ? snapshot.offsetRatioY * viewportHeight
        : snapshot.offsetY,
    };
    zoomRef.current = snapshot.zoom;
    offsetRef.current = nextOffset;
    rotateStepsRef.current = snapshot.rotateSteps;
    setZoom(snapshot.zoom);
    setOffset(nextOffset);
    setRotateSteps(snapshot.rotateSteps);
  }, []);

  const resetTransformState = useCallback(() => {
    zoomRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    rotateStepsRef.current = 0;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setRotateSteps(0);
    setIsDragging(false);
    setIsPanMode(false);
    setCropMode(false);
    setCropBounds(null);
    setCropSelection(null);
  }, []);

  const captureImageSnapshot = useCallback((): ImageViewerSessionSnapshot | null => {
    if (imageNaturalRef.current.width <= 0 || imageNaturalRef.current.height <= 0) return null;
    const container = containerRef.current;
    const viewportWidth = Math.round(container?.clientWidth ?? 0);
    const viewportHeight = Math.round(container?.clientHeight ?? 0);
    return {
      zoom: zoomRef.current,
      offsetX: offsetRef.current.x,
      offsetY: offsetRef.current.y,
      offsetRatioX: viewportWidth > 0 ? offsetRef.current.x / viewportWidth : null,
      offsetRatioY: viewportHeight > 0 ? offsetRef.current.y / viewportHeight : null,
      rotateSteps: rotateStepsRef.current,
    };
  }, []);

  const restoreImageSnapshot = useCallback((payload: ImageViewerSessionSnapshot) => {
    const snapshot = parseImageViewerSessionSnapshot(payload);
    if (!snapshot) return;
    pendingSessionRestoreRef.current = { resourceUrl: url, snapshot };
    if (
      loadedResourceUrlRef.current === url
      && imageNaturalRef.current.width > 0
      && imageNaturalRef.current.height > 0
    ) {
      pendingSessionRestoreRef.current = null;
      applySessionSnapshot(snapshot);
    }
  }, [applySessionSnapshot, url]);

  const sessionAdapter = useMemo<ViewerSessionAdapter<ImageViewerSessionSnapshot>>(() => ({
    capture: captureImageSnapshot,
    restore: restoreImageSnapshot,
    suspend: () => undefined,
    resume: () => undefined,
    estimateCost: () => IMAGE_VIEWER_SESSION_ESTIMATED_BYTES,
    getPinReasons: () => (activeRef.current ? ['active'] : []),
  }), [captureImageSnapshot, restoreImageSnapshot]);

  useViewerSession({
    accountScope,
    active,
    adapter: sessionAdapter,
    contentRevision,
    libraryId,
    nodeId: nodeId ?? null,
    reloadToken,
    schemaVersion: IMAGE_VIEWER_SESSION_SCHEMA_VERSION,
    tabId,
    viewerKind: 'image',
  });

  const fitToViewport = useCallback((attempt = 0) => {
    if (loadedResourceUrlRef.current !== url) return;
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
    const pendingRestore = pendingSessionRestoreRef.current;
    if (pendingRestore?.resourceUrl === url) {
      pendingSessionRestoreRef.current = null;
      applySessionSnapshot(pendingRestore.snapshot);
      return;
    }
    resetTransformState();
  }, [applySessionSnapshot, computeContainScale, resetTransformState, url]);

  // 重置视图：完整显示图片（上下左右都可见）并尽量大
  const resetView = useCallback(() => {
    pendingSessionRestoreRef.current = null;
    fitToViewport(0);
  }, [fitToViewport]);

  const rotateCounterclockwise = useCallback(() => {
    if (cropMode) return;
    setRotateSteps(prev => (prev + 1) % 4);
  }, [cropMode]);

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
    loadedResourceUrlRef.current = url;
    fitToViewport(0);
  }, [fitToViewport, url]);

  // 切换图片时清空上一张图的尺寸和拖拽状态，避免“旧尺寸残留”
  useEffect(() => {
    loadedResourceUrlRef.current = '';
    if (pendingSessionRestoreRef.current?.resourceUrl !== url) {
      pendingSessionRestoreRef.current = null;
    }
    setNaturalSize({ width: 0, height: 0 });
    setBaseScale(1);
    resetTransformState();
    imageNaturalRef.current = { width: 0, height: 0 };
  }, [resetTransformState, url]);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl('');
    setPreviewError(null);
    if (!isHeic) {
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const api = window.electronAPI?.prepareImagePreview;
    if (!api) {
      setPreviewLoading(false);
      setPreviewError('当前环境不支持 HEIC 预览');
      return () => {
        cancelled = true;
      };
    }

    async function preparePreview() {
      setPreviewLoading(true);
      try {
        const result = await api({
          nodeId: nodeId || undefined,
          url,
          fileName: fileName || undefined,
          ext: extFromFileName(fileName),
          mimeType: 'image/heic',
        });
        const nextPreviewUrl = result?.previewUrl || result?.previewDataUrl || '';
        if (!result?.ok || !nextPreviewUrl) {
          throw new Error(result?.error || '生成 HEIC 预览失败');
        }
        if (!cancelled) {
          setPreviewUrl(nextPreviewUrl);
          setPreviewError(null);
        }
      } catch (error: any) {
        runtimeLogger.warn('普通图片查看器生成 HEIC 预览失败:', error);
        if (!cancelled) {
          setPreviewError(error?.message || '生成 HEIC 预览失败');
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }

    void preparePreview();
    return () => {
      cancelled = true;
    };
  }, [fileName, isHeic, nodeId, url]);

  // 滚轮缩放（不需要 Ctrl）
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (cropMode) return;
    const direction = e.deltaY > 0 ? -1 : 1;
    setZoom(prev => clamp(prev + direction * prev * WHEEL_ZOOM_RATIO, MIN_ZOOM, MAX_ZOOM));
  }, [cropMode]);

  // 鼠标按下：左键或中键直接拖拽平移
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (cropMode || !imageUrl) return;
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      setIsDragging(true);
      setDragAnchor({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  }, [cropMode, imageUrl, offset]);

  // 鼠标移动
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (cropMode) return;
    if (isDragging) {
      setOffset({
        x: e.clientX - dragAnchor.x,
        y: e.clientY - dragAnchor.y
      });
    }
  }, [cropMode, isDragging, dragAnchor]);

  // 鼠标松开
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const enterCropMode = useCallback(() => {
    if (!nodeId || nodeId <= 0) {
      Toast.warning('当前图片缺少节点信息，无法保存裁剪副本');
      return;
    }
    if (!imageUrl || naturalSize.width <= 0 || naturalSize.height <= 0) {
      Toast.warning('图片尚未加载完成');
      return;
    }
    if (rotateSteps !== 0) {
      Toast.warning('请先重置旋转后再裁剪');
      return;
    }
    const nextBounds = getDisplayedImageBounds(containerRef.current, imageRef.current);
    if (!isCropBoundsUsable(nextBounds)) {
      Toast.warning('当前可裁剪区域过小');
      return;
    }
    setIsDragging(false);
    setIsPanMode(false);
    setCropBounds(nextBounds);
    setCropSelection(createDefaultCropSelection(nextBounds));
    setCropMode(true);
  }, [imageUrl, naturalSize.height, naturalSize.width, nodeId, rotateSteps]);

  const cancelCropMode = useCallback(() => {
    if (cropApplying) return;
    setCropMode(false);
    setCropBounds(null);
    setCropSelection(null);
  }, [cropApplying]);

  const applyCrop = useCallback(async () => {
    if (!nodeId || !imageUrl || !cropSelection) return;
    const imageRect = getImageRectInContainer(containerRef.current, imageRef.current);
    if (!imageRect) {
      Toast.warning('无法读取图片位置');
      return;
    }

    setCropApplying(true);
    try {
      const detail = await fetchNodeDetailById(nodeId);
      const parentId = Number(detail.parentId);
      const libraryId = Number(detail.libraryId);
      if (!Number.isFinite(parentId) || parentId <= 0 || !Number.isFinite(libraryId) || libraryId <= 0) {
        throw new Error('当前图片目录信息异常');
      }
      const siblings = await getChildrenByNodeId(parentId, libraryId);
      const existingNames = siblings
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(item => buildFileFullName(String(item.name || ''), item.ext as string | undefined))
        .filter(Boolean);
      await saveCroppedImageCopy({
        beforeNodeId: nodeId,
        existingNames,
        imageRect,
        libraryId,
        naturalSize: imageNaturalRef.current,
        parentId,
        selection: cropSelection,
        sourceFileName: fileName,
        sourceUrl: imageUrl,
      });
      Toast.success('已保存裁剪副本');
      setCropMode(false);
      setCropBounds(null);
      setCropSelection(null);
    } catch (error: any) {
      runtimeLogger.error('保存裁剪图片失败:', error);
      Toast.error(error?.message || '保存裁剪副本失败');
    } finally {
      setCropApplying(false);
    }
  }, [cropSelection, fileName, imageUrl, nodeId]);

  // 处理右键菜单
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!active) {
      return;
    }

    if (menuState.visible) {
      setMenuState(prev => ({ ...prev, visible: false }));
      setTimeout(() => {
        setMenuState({ visible: true, x: e.clientX, y: e.clientY });
      }, 0);
    } else {
      setMenuState({ visible: true, x: e.clientX, y: e.clientY });
    }
  };

  useEffect(() => {
    if (active) return;
    setMenuState(prev => (prev.visible ? { ...prev, visible: false } : prev));
    setIsDragging(false);
    setIsPanMode(false);
    setCropMode(false);
    setCropBounds(null);
    setCropSelection(null);
  }, [active]);

  // 菜单项
  const menuItems: ContextMenuItem[] = [
    {
      key: 'reset',
      label: '重置视图',
      onClick: resetView
    },
    {
      key: 'rotate-ccw',
      label: '旋转（逆时针90°）',
      onClick: rotateCounterclockwise
    },
    {
      key: 'crop-copy',
      label: '裁剪为副本',
      icon: <IconCrop />,
      onClick: enterCropMode,
      disabled: !nodeId || !imageUrl || cropMode
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

  const applyViewerZoomShortcut = useCallback((action: ViewerZoomShortcutAction) => {
    if (!active || cropMode) return;
    if (action === 'zoom-in') {
      setZoom(s => clamp(s * 1.15, MIN_ZOOM, MAX_ZOOM));
      return;
    }
    if (action === 'zoom-out') {
      setZoom(s => clamp(s / 1.15, MIN_ZOOM, MAX_ZOOM));
      return;
    }
    resetView();
  }, [active, cropMode, resetView]);

  // 空格键平移 + 快捷键缩放
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.code === 'Space' && !e.repeat) {
        if (!cropMode) {
          e.preventDefault();
          setIsPanMode(true);
        }
        return;
      }

      if (e.key === 'Escape' && cropMode) {
        e.preventDefault();
        cancelCropMode();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !cropMode) {
        if (isEditableTarget(e.target)) {
          return;
        }

        const code = e.code;
        const key = e.key;
        const isPlus = key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd';
        const isMinus = key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract';
        const isReset = key === '0' || code === 'Digit0' || code === 'Numpad0';
        if (!isPlus && !isMinus && !isReset) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (isPlus) {
          applyViewerZoomShortcut('zoom-in');
        } else if (isMinus) {
          applyViewerZoomShortcut('zoom-out');
        } else if (isReset) {
          applyViewerZoomShortcut('reset');
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.code === 'Space') {
        setIsPanMode(false);
        setIsDragging(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true } as EventListenerOptions);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [active, applyViewerZoomShortcut, cancelCropMode, cropMode]);

  useEffect(() => {
    const off = window.electronAPI?.onViewerZoomShortcut?.(({ action }) => {
      applyViewerZoomShortcut(action);
    });
    return () => {
      off?.();
    };
  }, [applyViewerZoomShortcut]);

  return (
    <ImageViewerWrapper
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      className={`${imageUrl && !cropMode ? 'can-pan' : ''} ${isPanMode ? 'space-pan' : ''} ${isDragging ? 'is-panning' : ''}`}
    >
      <div
        ref={containerRef}
        className="image-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {imageUrl ? (
          <img
            ref={imageRef}
            src={imageUrl}
            alt={fileName || 'Image'}
            className="viewer-image"
            onLoad={handleImageLoad}
            style={{
              width: naturalSize.width > 0 ? `${naturalSize.width}px` : undefined,
              height: naturalSize.height > 0 ? `${naturalSize.height}px` : undefined,
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${baseScale * zoom}) rotate(${-90 * rotateSteps}deg)`,
              transition: 'none'
            }}
          />
        ) : (
          <div className="image-preview-placeholder">
            {previewLoading ? (
              <>
                <Spin />
                <span>正在生成 HEIC 预览...</span>
              </>
            ) : (
              <span>{previewError || '无法预览图片'}</span>
            )}
          </div>
        )}
        {cropMode ? (
          <ImageCropOverlay
            applying={cropApplying}
            bounds={cropBounds}
            selection={cropSelection}
            onApply={applyCrop}
            onCancel={cancelCropMode}
            onSelectionChange={setCropSelection}
          />
        ) : null}
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
