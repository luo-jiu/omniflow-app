import React, { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconClose, IconChevronDown, IconPause, IconPlay } from '@douyinfe/semi-icons';
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

  const visible = state.visible && state.key !== null;

  const onExpand = () => {
    if (state.libraryId == null) return;
    navigate(`/libraries/${state.libraryId}`);
  };

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
    <FloatingMiniVideoPlayerWrapper data-visible={visible ? 'true' : 'false'}>
      <div
        className="floating-header"
        onClick={onExpand}
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
