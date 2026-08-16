import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { IconMute, IconVolume1, IconVolume2 } from '@douyinfe/semi-icons';
import { MediaVolumeControlWrapper } from './style';

interface MediaVolumeControlProps {
  className?: string;
  muted: boolean;
  volume: number;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
}

export const MediaVolumeControl: React.FC<MediaVolumeControlProps> = ({
  className,
  muted,
  volume,
  onMutedChange,
  onVolumeChange,
}) => {
  const displayedVolume = muted ? 0 : Math.min(Math.max(volume, 0), 1);
  const percentage = Math.round(displayedVolume * 100);
  const volumeLabel = muted ? '恢复音量' : '静音';

  return (
    <MediaVolumeControlWrapper
      className={className}
      style={{ '--media-volume-progress': `${percentage}%` } as React.CSSProperties}
    >
      <Button
        className="media-volume-toggle"
        icon={muted || displayedVolume === 0
          ? <IconMute />
          : displayedVolume < 0.5 ? <IconVolume1 /> : <IconVolume2 />}
        theme="borderless"
        size="small"
        onClick={() => onMutedChange(!muted)}
        title={volumeLabel}
        aria-label={volumeLabel}
      />
      <input
        className="media-volume-range"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={displayedVolume}
        onChange={(event) => onVolumeChange(Number(event.target.value))}
        aria-label="音量"
        aria-valuetext={`${percentage}%`}
      />
      <output className="media-volume-value" aria-live="off">{percentage}%</output>
    </MediaVolumeControlWrapper>
  );
};
