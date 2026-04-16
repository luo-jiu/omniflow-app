import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Spin, Switch } from '@douyinfe/semi-ui';
import {
  IconBackward,
  IconForward,
  IconMute,
  IconPause,
  IconPlay,
  IconUpload,
  IconVolume1,
  IconVolume2,
} from '@douyinfe/semi-icons';
import { VideoViewerWrapper } from './style';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { findActiveSubtitleCue, parseVideoSubtitle, type VideoSubtitleCue } from './subtitle';

interface VideoViewerProps {
  url: string;
  fileName?: string | null;
  active?: boolean;
}

const SEEK_SECONDS = 5;
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const PLACEHOLDER_TOOL_OPTIONS = ['同名字幕自动发现', '双语字幕', '片段标注', 'AI 字幕'];
const DEFAULT_SUBTITLE_FONT_SIZE = 44;
const MIN_SUBTITLE_FONT_SIZE = 28;
const MAX_SUBTITLE_FONT_SIZE = 72;
const DEFAULT_SUBTITLE_BOTTOM_OFFSET = 72;
const MIN_SUBTITLE_BOTTOM_OFFSET = 36;
const MAX_SUBTITLE_BOTTOM_OFFSET = 160;

const VideoViewer: React.FC<VideoViewerProps> = ({ url, fileName, active = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const rateControlRef = useRef<HTMLDivElement>(null);
  const subtitleLoadRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const isDraggingProgress = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isConsoleOpen, setIsConsoleOpen] = useState(true);
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitleFileName, setSubtitleFileName] = useState('');
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<VideoSubtitleCue[]>([]);
  const [subtitleFontSize, setSubtitleFontSize] = useState(DEFAULT_SUBTITLE_FONT_SIZE);
  const [subtitleBottomOffset, setSubtitleBottomOffset] = useState(DEFAULT_SUBTITLE_BOTTOM_OFFSET);
  const [isVolumePanelOpen, setIsVolumePanelOpen] = useState(false);
  const [isRatePanelOpen, setIsRatePanelOpen] = useState(false);

  const formatTime = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return '00:00';
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const seekToByClientX = useCallback((clientX: number) => {
    const video = videoRef.current;
    const progress = progressRef.current;
    if (!video || !progress || !duration) return;

    const rect = progress.getBoundingClientRect();
    const offsetX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const next = (offsetX / rect.width) * duration;
    video.currentTime = next;
    setCurrentTime(next);
  }, [duration]);

  const handleGlobalMouseMove = useCallback((event: MouseEvent) => {
    if (!isDraggingProgress.current) return;
    seekToByClientX(event.clientX);
  }, [seekToByClientX]);

  const handleGlobalMouseUp = useCallback((event: MouseEvent) => {
    if (!isDraggingProgress.current) return;
    seekToByClientX(event.clientX);
    isDraggingProgress.current = false;
    window.removeEventListener('mousemove', handleGlobalMouseMove);
    window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleGlobalMouseMove, seekToByClientX]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      subtitleLoadRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      setDuration(video.duration || 0);
      setCurrentTime(video.currentTime || 0);
      setIsBuffering(false);
    };
    const onTimeUpdate = () => {
      if (!isDraggingProgress.current) {
        setCurrentTime(video.currentTime || 0);
      }
    };
    const onPlay = () => {
      setIsPlaying(true);
      globalAudioPlayer.pause();
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onCanPlay);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onCanPlay);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return globalAudioPlayer.registerVideo(video);
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    subtitleLoadRequestIdRef.current += 1;
    video.src = url;
    video.load();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsBuffering(true);
    setSubtitleFileName('');
    setSubtitleError(null);
    setSubtitleCues([]);
    setSubtitleEnabled(true);
  }, [url]);

  useEffect(() => {
    if (active) return;
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
    }
  }, [active]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
  }, [volume, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
  }, [isMuted, url]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (volumeControlRef.current && !volumeControlRef.current.contains(target)) {
        setIsVolumePanelOpen(false);
      }
      if (rateControlRef.current && !rateControlRef.current.contains(target)) {
        setIsRatePanelOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((error) => {
        runtimeLogger.error('failed to start video playback:', error);
      });
    } else {
      video.pause();
    }
  };

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.min(Math.max((video.currentTime || 0) + delta, 0), duration || 0);
    video.currentTime = next;
    setCurrentTime(next);
  };

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setVolume(next);
    setIsMuted(next === 0);
  };

  const toggleVolumePanel = useCallback(() => {
    setIsVolumePanelOpen(prev => !prev);
    setIsRatePanelOpen(false);
  }, []);

  const toggleRatePanel = useCallback(() => {
    setIsRatePanelOpen(prev => !prev);
    setIsVolumePanelOpen(false);
  }, []);

  const handleProgressMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    isDraggingProgress.current = true;
    seekToByClientX(event.clientX);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await containerRef.current?.requestFullscreen();
    } catch (error) {
      runtimeLogger.warn('切换全屏失败:', error);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const activeSubtitleCue = useMemo(() => {
    if (!subtitleEnabled) return null;
    return findActiveSubtitleCue(subtitleCues, currentTime);
  }, [currentTime, subtitleCues, subtitleEnabled]);

  const openSubtitlePicker = useCallback(() => {
    subtitleInputRef.current?.click();
  }, []);

  const clearSubtitle = useCallback(() => {
    subtitleLoadRequestIdRef.current += 1;
    setSubtitleFileName('');
    setSubtitleError(null);
    setSubtitleCues([]);
    setSubtitleEnabled(true);
  }, []);

  const handleSubtitleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const requestId = subtitleLoadRequestIdRef.current + 1;
    subtitleLoadRequestIdRef.current = requestId;

    try {
      const raw = await file.text();
      if (!isMountedRef.current || requestId !== subtitleLoadRequestIdRef.current) {
        return;
      }
      const cues = parseVideoSubtitle(raw);
      if (cues.length === 0) {
        setSubtitleFileName('');
        setSubtitleCues([]);
        setSubtitleError('字幕文件没有解析出有效时间轴，当前先支持常见的 .srt / .vtt 格式。');
        return;
      }
      setSubtitleFileName(file.name);
      setSubtitleCues(cues);
      setSubtitleError(null);
      setSubtitleEnabled(true);
    } catch (error) {
      if (!isMountedRef.current || requestId !== subtitleLoadRequestIdRef.current) {
        return;
      }
      runtimeLogger.error('读取字幕文件失败:', error);
      setSubtitleFileName('');
      setSubtitleCues([]);
      setSubtitleError('字幕文件读取失败，请重新选择。');
    } finally {
      event.target.value = '';
    }
  }, []);

  const displayedVolume = Math.round((isMuted ? 0 : volume) * 100);

  return (
    <VideoViewerWrapper>
      <div className="viewer-layout">
        <div className={`viewer-main ${isConsoleOpen ? 'console-open' : ''}`}>
          <input
            ref={subtitleInputRef}
            className="subtitle-file-input"
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            onChange={handleSubtitleFileChange}
          />

          <div className="video-stage">
            <div className="video-shell" ref={containerRef}>
              <video
                ref={videoRef}
                className="video-element"
                preload="metadata"
                playsInline
                onDoubleClick={toggleFullscreen}
              />
              {activeSubtitleCue && (
                <div
                  className="subtitle-overlay"
                  style={{
                    bottom: `${subtitleBottomOffset}px`,
                    fontSize: `${subtitleFontSize}px`,
                  }}
                >
                  {activeSubtitleCue.lines.map((line, index) => (
                    <span key={`${activeSubtitleCue.id}-${index}`} className="subtitle-line">
                      {line}
                    </span>
                  ))}
                </div>
              )}
              {isBuffering && (
                <div className="buffering-overlay">
                  <Spin size="large" tip="视频加载中..." />
                </div>
              )}
            </div>
          </div>

          <div className="controls-panel">
            <div className="timeline-hitbox" onMouseDown={handleProgressMouseDown}>
              <div className="timeline-rail" ref={progressRef}>
                <div className="timeline-track" style={{ width: `${progressPercent}%` }} />
                <div className="timeline-thumb" style={{ left: `${progressPercent}%` }} />
              </div>
            </div>

            <div className="controls-row">
              <div className="left-controls">
                <Button icon={<IconBackward />} theme="borderless" onClick={() => seekBy(-SEEK_SECONDS)} />
                <Button
                  icon={isPlaying ? <IconPause /> : <IconPlay />}
                  theme="solid"
                  type="primary"
                  onClick={togglePlay}
                />
                <Button icon={<IconForward />} theme="borderless" onClick={() => seekBy(SEEK_SECONDS)} />
                <span className="time-text">{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>

              <div className="right-controls">
                <div className="control-popover-box" ref={volumeControlRef}>
                  <Button
                    icon={isMuted ? <IconMute /> : volume < 0.5 ? <IconVolume1 /> : <IconVolume2 />}
                    theme="borderless"
                    onClick={toggleVolumePanel}
                  />
                  {isVolumePanelOpen && (
                    <div className="floating-control-panel volume-panel">
                      <input
                        className="volume-slider-vertical"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                      />
                      <button
                        type="button"
                        className="floating-action-chip"
                        onClick={() => setIsMuted(prev => !prev)}
                      >
                        {displayedVolume}%
                      </button>
                    </div>
                  )}
                </div>

                <div className="control-popover-box" ref={rateControlRef}>
                  <Button theme="borderless" onClick={toggleRatePanel}>
                    {playbackRate}x
                  </Button>
                  {isRatePanelOpen && (
                    <div className="floating-control-panel rate-panel">
                      {PLAYBACK_RATES.map(rate => (
                        <button
                          type="button"
                          key={rate}
                          className={`floating-action-chip ${playbackRate === rate ? 'active' : ''}`}
                          onClick={() => {
                            setPlaybackRate(rate);
                            setIsRatePanelOpen(false);
                          }}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <Button theme="borderless" onClick={() => setIsConsoleOpen(prev => !prev)}>
                  {isConsoleOpen ? '隐藏工具台' : '工具台'}
                </Button>

                <Button theme="borderless" onClick={toggleFullscreen}>
                  {isFullscreen ? '退出全屏' : '全屏'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <aside className={`console-panel ${isConsoleOpen ? 'open' : 'closed'}`}>
          <div className="console-body">
              <div className="console-section">
                <div className="section-header">
                  <span className="section-title">视频操作台</span>
                  <span className="section-meta">{fileName || '当前视频'}</span>
                </div>
                <p className="section-description">
                  这是视频专属的右侧控制区，后面可以继续往这里加字幕、标注、片段和更多播放能力。
                </p>
              </div>

              <div className="console-section">
                <div className="section-header">
                  <span className="section-title">字幕</span>
                  <Switch checked={subtitleEnabled} disabled={subtitleCues.length === 0} onChange={setSubtitleEnabled} />
                </div>
                <div className="section-actions">
                  <Button icon={<IconUpload />} onClick={openSubtitlePicker}>
                    加载字幕
                  </Button>
                  <Button disabled={subtitleCues.length === 0} onClick={clearSubtitle}>
                    清除字幕
                  </Button>
                </div>
                <div className="info-card">
                  <span className="info-label">当前文件</span>
                  <span className="info-value">{subtitleFileName || '未加载字幕文件'}</span>
                </div>
                {subtitleError && (
                  <div className="inline-alert error">{subtitleError}</div>
                )}
                {!subtitleError && subtitleCues.length > 0 && (
                  <>
                    <div className="info-grid">
                      <div className="info-card">
                        <span className="info-label">字幕片段</span>
                        <span className="info-value">{subtitleCues.length}</span>
                      </div>
                      <div className="info-card">
                        <span className="info-label">当前状态</span>
                        <span className="info-value">{activeSubtitleCue ? '跟随播放中' : '等待下一句'}</span>
                      </div>
                    </div>
                    <label className="slider-field">
                      <span>字号</span>
                      <div className="slider-row">
                        <input
                          type="range"
                          min={String(MIN_SUBTITLE_FONT_SIZE)}
                          max={String(MAX_SUBTITLE_FONT_SIZE)}
                          step="1"
                          value={subtitleFontSize}
                          onChange={event => setSubtitleFontSize(Number(event.target.value))}
                        />
                        <strong>{subtitleFontSize}px</strong>
                      </div>
                    </label>
                    <label className="slider-field">
                      <span>底部位置</span>
                      <div className="slider-row">
                        <input
                          type="range"
                          min={String(MIN_SUBTITLE_BOTTOM_OFFSET)}
                          max={String(MAX_SUBTITLE_BOTTOM_OFFSET)}
                          step="2"
                          value={subtitleBottomOffset}
                          onChange={event => setSubtitleBottomOffset(Number(event.target.value))}
                        />
                        <strong>{subtitleBottomOffset}px</strong>
                      </div>
                    </label>
                    <div className="subtitle-preview">
                      {activeSubtitleCue ? (
                        activeSubtitleCue.lines.map((line, index) => (
                          <span key={`${activeSubtitleCue.id}-preview-${index}`}>{line}</span>
                        ))
                      ) : (
                        <span>字幕已加载，播放到对应时间点后会固定显示在主画面底部。</span>
                      )}
                    </div>
                  </>
                )}
                {!subtitleError && subtitleCues.length === 0 && (
                  <div className="console-empty">
                    <Empty
                      title="还没有字幕"
                      description="先加载一个 .srt 或 .vtt 文件，字幕会固定显示在视频主内容区域。"
                    />
                  </div>
                )}
              </div>

              <div className="console-section">
                <div className="section-header">
                  <span className="section-title">播放状态</span>
                  <span className="section-meta">{isPlaying ? '播放中' : '已暂停'}</span>
                </div>
                <div className="info-grid">
                  <div className="info-card">
                    <span className="info-label">播放速率</span>
                    <span className="info-value">{playbackRate}x</span>
                  </div>
                  <div className="info-card">
                    <span className="info-label">音量</span>
                    <span className="info-value">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
                  </div>
                </div>
                <p className="section-description">
                  基础播放控制仍然放在底部控制条；右侧操作台主要承接视频扩展能力，避免和其他 viewer 混在一起。
                </p>
              </div>

              <div className="console-section">
                <div className="section-header">
                  <span className="section-title">预留能力</span>
                  <span className="section-meta">后续扩展</span>
                </div>
                <div className="placeholder-grid">
                  {PLACEHOLDER_TOOL_OPTIONS.map(item => (
                    <span key={item} className="placeholder-chip">{item}</span>
                  ))}
                </div>
              </div>
          </div>
        </aside>
      </div>
    </VideoViewerWrapper>
  );
};

export default VideoViewer;
