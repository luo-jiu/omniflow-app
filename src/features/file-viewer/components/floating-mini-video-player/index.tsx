import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconClose, IconChevronDown, IconPause, IconPlay } from '@douyinfe/semi-icons';
import { setPendingActivation } from '@/contexts/file-viewer-pending-activation';
import { floatingVideoService } from '@/features/file-viewer/services/floating-video.service';
import { FloatingMiniVideoPlayerWrapper } from './style';

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '00:00';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const FloatingMiniVideoPlayer: React.FC = () => {
  const state = useSyncExternalStore(
    floatingVideoService.subscribe,
    floatingVideoService.getState,
    floatingVideoService.getState,
  );
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const visible = state.visible && state.key !== null;

  useEffect(() => {
    console.log('[floating-video-ui]', {
      visible,
      rawVisible: state.visible,
      hostMode: state.hostMode,
      key: state.key,
      fileName: state.fileName,
      isPlaying: state.isPlaying,
    });
  }, [state.fileName, state.hostMode, state.isPlaying, state.key, state.visible, visible]);

  const onExpand = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (state.libraryId == null) return;
    if (state.tabId) {
      setPendingActivation(state.libraryId, state.tabId);
    }
    navigate(`/libraries/${state.libraryId}`);
  };

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const onHeaderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const wrapper = wrapperRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !wrapper) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      drag.moved = true;
      suppressClickRef.current = true;
    }
    const width = wrapper.offsetWidth;
    const height = wrapper.offsetHeight;
    const maxLeft = Math.max(window.innerWidth - width - 8, 8);
    const maxTop = Math.max(window.innerHeight - height - 8, 8);
    const left = Math.min(Math.max(drag.startLeft + dx, 8), maxLeft);
    const top = Math.min(Math.max(drag.startTop + dy, 8), maxTop);
    setPosition({ left, top });
  };

  const onHeaderPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore release after pointer cancellation */
    }
  };

  useEffect(() => {
    if (!visible) {
      dragRef.current = null;
      setIsDragging(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !position) return;
    const clampPosition = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const maxLeft = Math.max(window.innerWidth - wrapper.offsetWidth - 8, 8);
      const maxTop = Math.max(window.innerHeight - wrapper.offsetHeight - 8, 8);
      setPosition((current) => {
        if (!current) return current;
        const next = {
          left: Math.min(Math.max(current.left, 8), maxLeft),
          top: Math.min(Math.max(current.top, 8), maxTop),
        };
        if (next.left === current.left && next.top === current.top) return current;
        return next;
      });
    };
    window.addEventListener('resize', clampPosition);
    return () => window.removeEventListener('resize', clampPosition);
  }, [position, visible]);

  // × 软关闭：暂停 + 收起浮窗，但 tab/元素/hub entry 都保留。
  // 完全释放走的是「关闭 tab」或 hub × 路径。详见 docs/media-hub-contract.md。
  const onClose = (event: React.MouseEvent) => {
    event.stopPropagation();
    floatingVideoService.softClose();
  };

  // 收起：不暂停，仅收起浮窗 UI。后台继续播放。
  const onHide = (event: React.MouseEvent) => {
    event.stopPropagation();
    floatingVideoService.hide();
  };

  const onTogglePlay = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (state.isPlaying) {
      floatingVideoService.pause();
    } else {
      floatingVideoService.play();
    }
  };

  // 始终渲染 wrapper（host ref 始终挂载），靠 data-visible 控制显隐。
  // 这样 service 任何时刻 handoff 时 floatingHostEl 都已就绪，避免视频元素短暂脱离 connected document 触发 Chromium 自动 pause。
  return (
    <FloatingMiniVideoPlayerWrapper
      ref={wrapperRef}
      data-dragging={isDragging ? 'true' : 'false'}
      data-visible={visible ? 'true' : 'false'}
      style={position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' } : undefined}
    >
      <div
        className="floating-header"
        onClick={onExpand}
        onPointerCancel={onHeaderPointerUp}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        title={state.libraryId != null ? '回到资料库 tab 继续观看' : ''}
      >
        <span className="floating-title" title={state.fileName}>{state.fileName || '视频'}</span>
        <button
          className="floating-hide"
          type="button"
          onClick={onHide}
          aria-label="收起"
          title="后台播放，收起浮窗"
        >
          <IconChevronDown size="small" />
        </button>
        <button
          className="floating-close"
          type="button"
          onClick={onClose}
          aria-label="关闭"
          title="暂停并收起浮窗"
        >
          <IconClose size="small" />
        </button>
      </div>
      <div
        className="floating-video-host"
        ref={floatingVideoService.attachFloatingHost}
        onClick={onExpand}
      />
      <div className="floating-footer">
        <button
          className="floating-play-toggle"
          type="button"
          onClick={onTogglePlay}
          aria-label={state.isPlaying ? '暂停' : '播放'}
        >
          {state.isPlaying ? <IconPause size="small" /> : <IconPlay size="small" />}
        </button>
        <span className="floating-time">
          {formatTime(state.currentTime)} / {formatTime(state.duration)}
        </span>
      </div>
    </FloatingMiniVideoPlayerWrapper>
  );
};

export default FloatingMiniVideoPlayer;
