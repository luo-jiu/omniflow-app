import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spin } from '@douyinfe/semi-ui';
import {
  IconBackward,
  IconForward,
  IconMute,
  IconPause,
  IconPlay,
  IconVolume1,
  IconVolume2,
} from '@douyinfe/semi-icons';
import { VideoViewerWrapper } from './style';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface VideoViewerProps {
  url: string;
  fileName?: string | null;
  active?: boolean;
}

const SEEK_SECONDS = 5;
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

const VideoViewer: React.FC<VideoViewerProps> = ({ url, fileName, active = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const isDraggingProgress = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

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
    video.src = url;
    video.load();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsBuffering(true);
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

  return (
    <VideoViewerWrapper>
      <div className="viewer-header">
        <div className="title-group">
          <span className="title-badge">MP4</span>
          <span className="file-name">{fileName || '视频文件'}</span>
        </div>
        <div className="header-meta">{formatTime(currentTime)} / {formatTime(duration)}</div>
      </div>

      <div className="video-stage">
        <div className="video-shell" ref={containerRef}>
          <video
            ref={videoRef}
            className="video-element"
            preload="metadata"
            playsInline
            onDoubleClick={toggleFullscreen}
          />
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
            <div className="volume-box">
              <Button
                icon={isMuted ? <IconMute /> : volume < 0.5 ? <IconVolume1 /> : <IconVolume2 />}
                theme="borderless"
                onClick={() => setIsMuted(prev => !prev)}
              />
              <input
                className="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
              />
            </div>

            <div className="rate-group">
              {PLAYBACK_RATES.map(rate => (
                <span
                  key={rate}
                  className={`rate-chip ${playbackRate === rate ? 'active' : ''}`}
                  onClick={() => setPlaybackRate(rate)}
                >
                  {rate}x
                </span>
              ))}
            </div>

            <Button theme="borderless" onClick={toggleFullscreen}>
              {isFullscreen ? '退出全屏' : '全屏'}
            </Button>
          </div>
        </div>
      </div>
    </VideoViewerWrapper>
  );
};

export default VideoViewer;
