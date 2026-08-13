import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@douyinfe/semi-ui';
import { 
  IconPlay, 
  IconPause, 
  IconForward, 
  IconBackward, 
  IconVolume1, 
  IconVolume2, 
  IconMute,
  IconMusic,
  IconList,
  IconSync
} from '@douyinfe/semi-icons';
import { AudioViewerWrapper } from './style';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { resolveAudioOwnerKey } from '@/features/file-viewer/utils/audio-owner-key';
import { deriveAudioTrackName } from '@/features/file-viewer/utils/audio-track-name';
import { useGlobalAudioPlayback } from '@/features/file-viewer/hooks/useGlobalAudioPlayback';
import {
  isTextEditingKeyboardTarget,
  isViewerInteractiveKeyboardTarget,
  releaseExternalKeyboardFocus,
} from '@/features/file-viewer/utils/media-keyboard-target';
import type {
  FileViewerAudioPlaylist,
  FileViewerReturnTarget,
  FileViewerSubtitleSource,
} from '@/contexts/file-viewer.context';
import { useTimedText } from '@/features/file-viewer/timed-text/useTimedText';
import { useFileViewer } from '@/hooks/useFileViewer';
import { getFileLink } from '@/features/file-explorer/services/file.api';

interface AudioViewerProps {
  nodeId: number | null;
  url: string;
  fileName?: string | null;
  active?: boolean;
  tabId: string;
  returnTarget?: FileViewerReturnTarget | null;
  subtitleSources?: FileViewerSubtitleSource[];
  playlist?: FileViewerAudioPlaylist | null;
  autoPlay?: boolean;
  coverUrl?: string | null;
}

const AUDIO_KEYBOARD_SEEK_SECONDS = 10;
const AUDIO_KEYBOARD_FAST_SEEK_SECONDS = 30;
const AUDIO_KEYBOARD_VOLUME_STEP = 0.05;
const PLAYLIST_LINK_EXPIRY_MINUTES = 120;

const AudioViewer: React.FC<AudioViewerProps> = ({
  nodeId,
  url,
  fileName,
  active = true,
  tabId,
  returnTarget,
  subtitleSources,
  playlist,
  autoPlay = false,
  coverUrl,
}) => {
  const { setFileUrl } = useFileViewer();
  const { id: libraryIdParam } = useParams<{ id: string }>();
  const libraryId = useMemo(() => {
    const parsed = Number(libraryIdParam);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [libraryIdParam]);
  const viewerRootRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [dragPreviewTime, setDragPreviewTime] = useState<number | null>(null);
  const ownerKey = React.useMemo(() => resolveAudioOwnerKey(url, nodeId), [nodeId, url]);
  const {
    adjustVolumeBy,
    ensureSource,
    isOwnedSource,
    play,
    playerState,
    seekTo,
    setMuted,
    setVolume,
    togglePlay: toggleOwnedPlay,
  } = useGlobalAudioPlayback({ ownerType: 'default', ownerKey, tabId, libraryId });
  const effectiveCurrentTime = isOwnedSource ? playerState.currentTime : 0;
  const effectiveDuration = isOwnedSource ? playerState.duration : 0;

  // Dragging state (managed via refs to avoid re-renders during high-frequency events)
  const isDraggingRef = useRef(false);
  const displayTime = dragPreviewTime ?? effectiveCurrentTime;
  const currentPlaylistIndex = React.useMemo(() => (
    playlist?.items.findIndex(item => item.nodeId === nodeId) ?? -1
  ), [nodeId, playlist]);
  const hasPlaylistPrev = currentPlaylistIndex > 0;
  const hasPlaylistNext = Boolean(playlist && currentPlaylistIndex >= 0 && currentPlaylistIndex < playlist.items.length - 1);
  const {
    activeSubtitleCue,
    subtitleCues,
    subtitleError,
    subtitleFileName,
  } = useTimedText({
    currentTime: effectiveCurrentTime,
    subtitleSources,
    url,
  });

  const formatTime = (time: number) => {
    if (!isFinite(time)) return '00:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const ensureOwnedSource = useCallback(() => {
    ensureSource(url, deriveAudioTrackName(url, fileName), coverUrl ?? null);
  }, [ensureSource, fileName, url, coverUrl]);

  const togglePlay = useCallback(() => {
    if (isOwnedSource) {
      void toggleOwnedPlay().catch((error) => {
        runtimeLogger.error('failed to toggle audio playback:', error);
      });
      return;
    }

    ensureOwnedSource();
    void play().catch((error) => {
      runtimeLogger.error('failed to start audio playback:', error);
    });
  }, [ensureOwnedSource, isOwnedSource, play, toggleOwnedPlay]);

  const openPlaylistItem = useCallback(async (direction: -1 | 1) => {
    if (!playlist || currentPlaylistIndex < 0) return;
    const item = playlist.items[currentPlaylistIndex + direction];
    if (!item) return;
    try {
      const nextUrl = await getFileLink(item.nodeId, item.libraryId, PLAYLIST_LINK_EXPIRY_MINUTES);
      if (!nextUrl) {
        throw new Error('未获取到音频访问链接');
      }
      setFileUrl(
        nextUrl,
        item.title,
        'audio',
        item.nodeId,
        {
          tabTypeLabel: 'AUDIO',
          returnTarget,
          replaceTabId: tabId,
          audioSubtitleSources: item.subtitleSources,
          audioPlaylist: playlist,
          audioAutoPlay: true,
          audioCoverUrl: item.coverUrl,
        },
      );
    } catch (error: any) {
      runtimeLogger.error('切换音频播放列表失败:', error);
    }
  }, [currentPlaylistIndex, playlist, returnTarget, setFileUrl, tabId]);

  const seekBy = useCallback((delta: number) => {
    if (!isOwnedSource || !effectiveDuration) return;
    const next = Math.min(Math.max(effectiveCurrentTime + delta, 0), effectiveDuration);
    seekTo(next);
  }, [effectiveCurrentTime, effectiveDuration, isOwnedSource, seekTo]);

  // --- Custom Progress Bar Logic ---

  const updateProgress = useCallback((clientX: number) => {
    if (!progressBarRef.current || !effectiveDuration) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = percentage * effectiveDuration;
    
    // Update visual immediately
    setDragPreviewTime(newTime);
    
    return newTime;
  }, [effectiveDuration]);

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingRef.current) {
      updateProgress(e.clientX);
    }
  }, [updateProgress]);

  const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
    if (isDraggingRef.current) {
      const finalTime = updateProgress(e.clientX);
      if (finalTime !== undefined && Number.isFinite(finalTime)) {
        seekTo(finalTime);
      }
      isDraggingRef.current = false;
      setDragPreviewTime(null);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [handleGlobalMouseMove, seekTo, updateProgress]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isOwnedSource) {
      return;
    }
    isDraggingRef.current = true;
    updateProgress(e.clientX);
    
    // Bind global listeners
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  // Cleanup listeners on unmount
  useEffect(() => {
      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
  };

  // MediaHub 注册由 globalAudioPlayer 服务层完成，组件不再参与；详见 docs/media-hub-contract.md。
  // viewer 卸载时也不主动 clear——tab 关闭由 FileViewerContext 通过 releaseForTab 释放。

  useEffect(() => {
    if (!active) return;
    setDragPreviewTime(null);
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEditingKeyboardTarget(event.target)) return;
      if (isViewerInteractiveKeyboardTarget(event.target, viewerRootRef.current)) return;
      let handled = true;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          if (!event.repeat) {
            togglePlay();
          }
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seekBy(event.shiftKey ? -AUDIO_KEYBOARD_FAST_SEEK_SECONDS : -AUDIO_KEYBOARD_SEEK_SECONDS);
          break;
        case 'ArrowRight':
          event.preventDefault();
          seekBy(event.shiftKey ? AUDIO_KEYBOARD_FAST_SEEK_SECONDS : AUDIO_KEYBOARD_SEEK_SECONDS);
          break;
        case 'j':
        case 'J':
          event.preventDefault();
          seekBy(-AUDIO_KEYBOARD_SEEK_SECONDS);
          break;
        case 'l':
        case 'L':
          event.preventDefault();
          seekBy(AUDIO_KEYBOARD_SEEK_SECONDS);
          break;
        case 'ArrowUp':
          event.preventDefault();
          adjustVolumeBy(AUDIO_KEYBOARD_VOLUME_STEP);
          break;
        case 'ArrowDown':
          event.preventDefault();
          adjustVolumeBy(-AUDIO_KEYBOARD_VOLUME_STEP);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          if (!event.repeat) {
            setMuted(!playerState.isMuted);
          }
          break;
        default:
          handled = false;
          break;
      }
      if (handled) {
        event.stopPropagation();
        releaseExternalKeyboardFocus(event.target, viewerRootRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [active, adjustVolumeBy, playerState.isMuted, seekBy, setMuted, togglePlay]);

  useEffect(() => {
    if (!autoPlay) return;
    ensureOwnedSource();
    void play().catch((error) => {
      runtimeLogger.warn('自动播放音频失败:', error);
    });
  }, [autoPlay, ensureOwnedSource, play, url]);

  return (
    <AudioViewerWrapper ref={viewerRootRef}>
      <div className="main-display">
        <div className="record-player">
          <div className={`record-needle ${isOwnedSource && playerState.isPlaying ? 'playing' : ''}`} />
          <div className={`album-art ${isOwnedSource && playerState.isPlaying ? 'playing' : ''}`}>
            <div className="inner-cover">
              {coverUrl ? <img src={coverUrl} alt={fileName || '音频封面'} draggable={false} /> : <IconMusic />}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 16, lineHeight: 1.3, fontWeight: 700 }}>{fileName || '正在播放'}</div>
          <div className="audio-lyric-preview">
            {activeSubtitleCue ? (
              activeSubtitleCue.lines.map((line, index) => {
                const segments = activeSubtitleCue.segmentLines?.[index];
                return (
                  <span key={`${activeSubtitleCue.id}-${index}`}>
                    {segments?.length ? segments.map((segment, segmentIndex) => (
                      <span
                        key={`${activeSubtitleCue.id}-${index}-${segmentIndex}`}
                        className={`lyric-segment ${effectiveCurrentTime >= segment.end ? 'is-past' : ''} ${effectiveCurrentTime >= segment.start && effectiveCurrentTime < segment.end ? 'is-active' : ''}`}
                      >
                        {segment.text}
                      </span>
                    )) : line}
                  </span>
                );
              })
            ) : subtitleError ? (
              <span>{subtitleError}</span>
            ) : subtitleCues.length > 0 ? (
              <span>等待歌词时间轴...</span>
            ) : (
              <span>{subtitleFileName ? '歌词已加载' : '暂无歌词'}</span>
            )}
          </div>
        </div>
      </div>

      <div className="player-bar">
        {/* Custom Progress Bar */}
        <div 
            className="progress-wrapper" 
            ref={progressBarRef}
            onMouseDown={handleMouseDown}
            style={{ cursor: 'pointer', height: 14, display: 'flex', alignItems: 'center' }}
        >
          {/* Rail */}
          <div style={{ width: '100%', height: 4, background: 'var(--semi-color-fill-0)', position: 'relative' }}>
             {/* Track */}
             <div style={{ 
                 width: `${(displayTime / (effectiveDuration || 1)) * 100}%`, 
                 height: '100%', 
                 background: 'var(--semi-color-primary)',
                 position: 'absolute',
                 left: 0,
                 top: 0
             }} />
             {/* Handle (optional, can be added if needed, or just keep it minimal like Spotify) */}
             <div style={{
                 width: 9,
                 height: 9,
                 borderRadius: '50%',
                 background: '#fff',
                 position: 'absolute',
                 top: '50%',
                 left: `${(displayTime / (effectiveDuration || 1)) * 100}%`,
                 transform: 'translate(-50%, -50%)',
                 boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                 pointerEvents: 'none' // Let the wrapper handle clicks
             }} />
          </div>
        </div>

        <div className="controls-content">
          <div className="song-brief">
            <div className="mini-cover"><IconMusic /></div>
            <div className="info">
              <span className="name">{fileName}</span>
              <span className="author">未知艺术家</span>
            </div>
          </div>

          <div className="main-btns">
            <Button icon={<IconSync />} theme="borderless" style={{ color: 'var(--semi-color-text-2)' }} />
            <Button
              icon={<IconBackward />}
              theme="borderless"
              size="large"
              onClick={() => {
                if (hasPlaylistPrev) {
                  void openPlaylistItem(-1);
                  return;
                }
                seekBy(-AUDIO_KEYBOARD_SEEK_SECONDS);
              }}
            />
            <Button
              className="play-btn"
              icon={isOwnedSource && playerState.isPlaying ? <IconPause /> : <IconPlay />}
              theme="solid"
              shape="circle"
              onClick={togglePlay}
            />
            <Button
              icon={<IconForward />}
              theme="borderless"
              size="large"
              onClick={() => {
                if (hasPlaylistNext) {
                  void openPlaylistItem(1);
                  return;
                }
                seekBy(AUDIO_KEYBOARD_SEEK_SECONDS);
              }}
            />
            <Button icon={<IconList />} theme="borderless" style={{ color: 'var(--semi-color-text-2)' }} />
          </div>

          <div className="extra-controls">
            <div className="time-display">
              {formatTime(displayTime)} / {formatTime(effectiveDuration)}
            </div>
            <div className="volume-pop">
              <Button
                icon={playerState.isMuted ? <IconMute /> : playerState.volume < 0.5 ? <IconVolume1 /> : <IconVolume2 />}
                theme="borderless"
                size="small"
                onClick={() => {
                  setMuted(!playerState.isMuted);
                }}
              />
              <input 
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={playerState.isMuted ? 0 : playerState.volume}
                onChange={handleVolumeChange}
                style={{ width: 58, height: 4, accentColor: 'var(--semi-color-primary)' }}
              />
            </div>
          </div>
        </div>
      </div>
    </AudioViewerWrapper>
  );
};

export default AudioViewer;
