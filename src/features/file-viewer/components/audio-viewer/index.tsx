import React, { useState, useRef, useEffect, useCallback } from 'react';
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
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';

interface AudioViewerProps {
  url: string;
  fileName?: string | null;
}

const AudioViewer: React.FC<AudioViewerProps> = ({ url, fileName }) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [playerState, setPlayerState] = useState(() => globalAudioPlayer.getState());
  const [dragPreviewTime, setDragPreviewTime] = useState<number | null>(null);

  // Dragging state (managed via refs to avoid re-renders during high-frequency events)
  const isDraggingRef = useRef(false);
  const displayTime = dragPreviewTime ?? playerState.currentTime;

  const formatTime = (time: number) => {
    if (!isFinite(time)) return '00:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    void globalAudioPlayer.togglePlay().catch(console.error);
  };

  // --- Custom Progress Bar Logic ---

  const updateProgress = useCallback((clientX: number) => {
    if (!progressBarRef.current || !playerState.duration) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = percentage * playerState.duration;
    
    // Update visual immediately
    setDragPreviewTime(newTime);
    
    return newTime;
  }, [playerState.duration]);

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingRef.current) {
      updateProgress(e.clientX);
    }
  }, [updateProgress]);

  const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
    if (isDraggingRef.current) {
      const finalTime = updateProgress(e.clientX);
      if (finalTime !== undefined && Number.isFinite(finalTime)) {
        globalAudioPlayer.seekTo(finalTime);
      }
      isDraggingRef.current = false;
      setDragPreviewTime(null);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [handleGlobalMouseMove, updateProgress]);

  const handleMouseDown = (e: React.MouseEvent) => {
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
    globalAudioPlayer.setVolume(vol);
  };

  useEffect(() => {
    return globalAudioPlayer.subscribe(setPlayerState);
  }, []);

  useEffect(() => {
    globalAudioPlayer.ensureSource(url, fileName || null);
    setDragPreviewTime(null);
  }, [url, fileName]);

  return (
    <AudioViewerWrapper>
      <div className="main-display">
        <div className="record-player">
          <div className={`record-needle ${playerState.isPlaying ? 'playing' : ''}`} />
          <div className={`album-art ${playerState.isPlaying ? 'playing' : ''}`}>
            <div className="inner-cover">
              <IconMusic />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{fileName || '正在播放'}</div>
          <div style={{ color: 'var(--semi-color-text-2)', marginTop: 8 }}>—— 歌词区域预留 ——</div>
        </div>
      </div>

      <div className="player-bar">
        {/* Custom Progress Bar */}
        <div 
            className="progress-wrapper" 
            ref={progressBarRef}
            onMouseDown={handleMouseDown}
            style={{ cursor: 'pointer', height: 20, display: 'flex', alignItems: 'center' }}
        >
          {/* Rail */}
          <div style={{ width: '100%', height: 4, background: 'var(--semi-color-fill-0)', position: 'relative' }}>
             {/* Track */}
             <div style={{ 
                 width: `${(displayTime / (playerState.duration || 1)) * 100}%`, 
                 height: '100%', 
                 background: 'var(--semi-color-primary)',
                 position: 'absolute',
                 left: 0,
                 top: 0
             }} />
             {/* Handle (optional, can be added if needed, or just keep it minimal like Spotify) */}
             <div style={{
                 width: 12,
                 height: 12,
                 borderRadius: '50%',
                 background: '#fff',
                 position: 'absolute',
                 top: '50%',
                 left: `${(displayTime / (playerState.duration || 1)) * 100}%`,
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
            <Button icon={<IconBackward />} theme="borderless" size="large" />
            <Button
              className="play-btn"
              icon={playerState.isPlaying ? <IconPause /> : <IconPlay />}
              theme="solid"
              shape="circle"
              onClick={togglePlay}
            />
            <Button icon={<IconForward />} theme="borderless" size="large" />
            <Button icon={<IconList />} theme="borderless" style={{ color: 'var(--semi-color-text-2)' }} />
          </div>

          <div className="extra-controls">
            <div className="time-display">
              {formatTime(displayTime)} / {formatTime(playerState.duration)}
            </div>
            <div className="volume-pop">
              <Button
                icon={playerState.isMuted ? <IconMute /> : playerState.volume < 0.5 ? <IconVolume1 /> : <IconVolume2 />}
                theme="borderless"
                size="small"
                onClick={() => {
                    globalAudioPlayer.setMuted(!playerState.isMuted);
                }}
              />
              <input 
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={playerState.isMuted ? 0 : playerState.volume}
                onChange={handleVolumeChange}
                style={{ width: 80, accentColor: 'var(--semi-color-primary)' }}
              />
            </div>
          </div>
        </div>
      </div>
    </AudioViewerWrapper>
  );
};

export default AudioViewer;
