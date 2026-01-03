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

interface AudioViewerProps {
  url: string;
  fileName?: string | null;
}

const AudioViewer: React.FC<AudioViewerProps> = ({ url, fileName }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  
  // Audio state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);

  // Dragging state (managed via refs to avoid re-renders during high-frequency events)
  const isDraggingRef = useRef(false);

  const formatTime = (time: number) => {
    if (!isFinite(time)) return '00:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (audio) {
      if (audio.paused) {
        audio.play().catch(console.error);
      } else {
        audio.pause();
      }
    }
  };

  // --- Custom Progress Bar Logic ---

  const updateProgress = useCallback((clientX: number) => {
    if (!progressBarRef.current || !audioRef.current || !duration) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    
    // Update visual immediately
    setCurrentTime(newTime);
    
    // Only update audio if we are committing (mouseup) or if we want live scrubbing (optional)
    // Here we update audio immediately for live scrubbing
    if (isFinite(newTime)) {
         // Optionally: audioRef.current.currentTime = newTime; 
    }
    
    return newTime;
  }, [duration]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    updateProgress(e.clientX);
    
    // Bind global listeners
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  const handleGlobalMouseMove = (e: MouseEvent) => {
    if (isDraggingRef.current) {
        updateProgress(e.clientX);
    }
  };

  const handleGlobalMouseUp = (e: MouseEvent) => {
    if (isDraggingRef.current) {
        const finalTime = updateProgress(e.clientX);
        if (audioRef.current && finalTime !== undefined && isFinite(finalTime)) {
            audioRef.current.currentTime = finalTime;
        }
        isDraggingRef.current = false;
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  };

  // Cleanup listeners on unmount
  useEffect(() => {
      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.volume = vol;
      setVolume(vol);
      setIsMuted(vol === 0);
    }
  };

  // --- Audio Event Listeners ---

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => setDuration(audio.duration);
    
    let lastUpdate = 0;
    const onTimeUpdate = () => {
      if (!isDraggingRef.current) {
          const now = Date.now();
          if (now - lastUpdate > 50) { // Throttle updates
            setCurrentTime(audio.currentTime);
            lastUpdate = now;
          }
      }
    };
    
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  // URL change handling
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.load();
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, [url]);

  return (
    <AudioViewerWrapper>
      <audio ref={audioRef} preload="metadata" />

      <div className="main-display">
        <div className="record-player">
          <div className={`record-needle ${isPlaying ? 'playing' : ''}`} />
          <div className={`album-art ${isPlaying ? 'playing' : ''}`}>
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
                 width: `${(currentTime / (duration || 1)) * 100}%`, 
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
                 left: `${(currentTime / (duration || 1)) * 100}%`,
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
              icon={isPlaying ? <IconPause /> : <IconPlay />}
              theme="solid"
              shape="circle"
              onClick={togglePlay}
            />
            <Button icon={<IconForward />} theme="borderless" size="large" />
            <Button icon={<IconList />} theme="borderless" style={{ color: 'var(--semi-color-text-2)' }} />
          </div>

          <div className="extra-controls">
            <div className="time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
            <div className="volume-pop">
              <Button
                icon={isMuted ? <IconMute /> : volume < 0.5 ? <IconVolume1 /> : <IconVolume2 />}
                theme="borderless"
                size="small"
                onClick={() => {
                    if (audioRef.current) {
                        const newMute = !isMuted;
                        setIsMuted(newMute);
                        audioRef.current.muted = newMute;
                    }
                }}
              />
              <input 
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
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