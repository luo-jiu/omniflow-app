import React from 'react';
import styled from 'styled-components';
import { Button } from '@douyinfe/semi-ui';
import { IconPlay, IconPause, IconMute, IconVolume2, IconMusic, IconClose } from '@douyinfe/semi-icons';
import { globalAudioPlayer, type GlobalAudioPlayerState } from '@/features/file-viewer/services/global-audio-player';
import { runtimeLogger } from '@/utils/runtimeLogger';

const BarSlot = styled.div<{ $visible: boolean }>`
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(760px, calc(100% - 24px));
  z-index: 20;
  opacity: ${props => (props.$visible ? 1 : 0)};
  pointer-events: ${props => (props.$visible ? 'auto' : 'none')};
  transition: opacity 0.18s ease;
`;

const BarInner = styled.div`
  height: 48px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--semi-color-bg-1) 88%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);

  .track {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .track-name {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--app-text);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .time {
    width: 90px;
    text-align: right;
    font-size: 12px;
    color: var(--app-text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    flex-shrink: 0;
  }

  .progress {
    width: 180px;
    accent-color: var(--semi-color-primary);
    flex-shrink: 0;
  }
`;

function formatTime(time: number) {
  if (!Number.isFinite(time)) return '00:00';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function deriveTrackName(state: GlobalAudioPlayerState): string {
  if (state.trackName && state.trackName.trim()) {
    return state.trackName;
  }

  if (!state.src) return '音频播放中';

  try {
    const noQuery = state.src.split('?')[0];
    const name = decodeURIComponent(noQuery.substring(noQuery.lastIndexOf('/') + 1));
    return name || '音频播放中';
  } catch {
    return '音频播放中';
  }
}

const GlobalAudioMiniBar: React.FC = () => {
  const [state, setState] = React.useState<GlobalAudioPlayerState>(() => globalAudioPlayer.getState());

  React.useEffect(() => globalAudioPlayer.subscribe(setState), []);

  const visible = Boolean(state.src) && state.hasStarted;
  const trackName = deriveTrackName(state);

  return (
    <BarSlot $visible={visible}>
      <BarInner>
        <div className="track">
          <IconMusic />
          <span className="track-name" title={trackName}>{trackName}</span>
        </div>

        <div className="controls">
          <Button
            theme="borderless"
            size="small"
            icon={state.isPlaying ? <IconPause /> : <IconPlay />}
            onClick={() => {
              void globalAudioPlayer.togglePlay().catch((error) => {
                runtimeLogger.error('failed to toggle global audio playback:', error);
              });
            }}
          />
          <Button
            theme="borderless"
            size="small"
            icon={state.isMuted ? <IconMute /> : <IconVolume2 />}
            onClick={() => {
              globalAudioPlayer.setMuted(!state.isMuted);
            }}
          />
          <Button
            theme="borderless"
            size="small"
            icon={<IconClose />}
            onClick={() => {
              globalAudioPlayer.clear();
            }}
          />
        </div>

        <input
          className="progress"
          type="range"
          min={0}
          max={Math.max(state.duration, 0)}
          step={0.1}
          value={Math.min(state.currentTime, Math.max(state.duration, 0))}
          onChange={(e) => {
            const next = Number(e.target.value);
            globalAudioPlayer.seekTo(next);
          }}
        />

        <div className="time">
          {formatTime(state.currentTime)} / {formatTime(state.duration)}
        </div>
      </BarInner>
    </BarSlot>
  );
};

export default GlobalAudioMiniBar;
