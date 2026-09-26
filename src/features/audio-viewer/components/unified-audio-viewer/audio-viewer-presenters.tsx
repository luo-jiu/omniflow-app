import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp, IconMusic } from '@douyinfe/semi-icons';
import {
  resolveFocusedTimedTextCueIndex,
  resolveTimedTextCueSweepPercent,
  type TimedTextCue,
} from '@/features/file-viewer/timed-text/subtitle';

export const AudioCover: React.FC<{
  coverUrl?: string | null;
  title: string;
  className?: string;
  showPlaceholder?: boolean;
}> = ({ coverUrl, title, className, showPlaceholder = true }) => (
  <div className={`audio-cover ${coverUrl ? '' : 'is-empty'} ${className || ''}`}>
    {coverUrl ? (
      <img src={coverUrl} alt={title} draggable={false} />
    ) : showPlaceholder ? (
      <IconMusic />
    ) : null}
  </div>
);

export const AudioPlayerBrief: React.FC<{
  archiveMode: boolean;
  bareAudioMode: boolean;
  coverUrl?: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  subtitleFileName?: string | null;
  title?: string | null;
}> = ({ archiveMode, bareAudioMode, coverUrl, expanded, onToggleExpanded, subtitleFileName, title }) => {
  const toggleLabel = expanded ? '收起播放器' : '展开播放器';
  const cover = (
    <>
      <AudioCover coverUrl={coverUrl} title={title || '音频'} className="mini" showPlaceholder={!bareAudioMode} />
      {!bareAudioMode && (
        <span className="player-cover-toggle" aria-hidden="true">
          {expanded ? <IconChevronDown /> : <IconChevronUp />}
        </span>
      )}
    </>
  );
  const track = (
    <div className="player-track">
      <span className="player-title" title={title || ''}>{title || '选择一首歌'}</span>
      <span className="player-artist">{subtitleFileName || '未知艺术家'}</span>
    </div>
  );

  if (archiveMode) {
    return (
      <div className="player-brief">
        <button
          type="button"
          className="player-cover-trigger"
          onClick={onToggleExpanded}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={expanded}
        >
          {cover}
        </button>
        {track}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="player-brief"
      disabled={bareAudioMode}
      onClick={bareAudioMode ? undefined : onToggleExpanded}
      title={bareAudioMode ? title || undefined : toggleLabel}
      aria-label={bareAudioMode ? title || '当前音频' : toggleLabel}
    >
      <span className="player-cover-trigger">{cover}</span>
      {track}
    </button>
  );
};

export const ExpandedLyricsRoller: React.FC<{
  currentAudioUrl: string | null;
  currentTime: number;
  duration: number;
  getPlayerState: () => { src: string | null; currentTime: number };
  isOwnedSource: boolean;
  isPlaying: boolean;
  onLyricJump: (cue: TimedTextCue) => void;
  subtitleCues: TimedTextCue[];
  subtitleError: string | null;
  emptyText?: string;
}> = React.memo(({
  currentAudioUrl,
  currentTime,
  duration,
  getPlayerState,
  isOwnedSource,
  isPlaying,
  onLyricJump,
  subtitleCues,
  subtitleError,
  emptyText = '当前歌曲没有可用歌词',
}) => {
  const focusedLyricLineRef = useRef<HTMLButtonElement | null>(null);
  const [lyricDisplayTime, setLyricDisplayTime] = useState(currentTime);
  const focusedLyricIndex = useMemo(
    () => resolveFocusedTimedTextCueIndex(subtitleCues, lyricDisplayTime),
    [lyricDisplayTime, subtitleCues],
  );

  useEffect(() => {
    if (focusedLyricIndex < 0) return;
    const lineEl = focusedLyricLineRef.current;
    if (!lineEl) return;
    const frame = window.requestAnimationFrame(() => {
      lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedLyricIndex]);

  useEffect(() => {
    if (isOwnedSource && isPlaying) return;
    setLyricDisplayTime(currentTime);
  }, [currentTime, isOwnedSource, isPlaying]);

  useEffect(() => {
    if (!isOwnedSource || !isPlaying || subtitleCues.length === 0) return;
    let frameId = 0;
    const tick = () => {
      const liveState = getPlayerState();
      const liveTime = liveState.src === currentAudioUrl ? liveState.currentTime : 0;
      const nextTime = duration > 0 ? Math.min(liveTime, duration) : liveTime;
      setLyricDisplayTime(Number.isFinite(nextTime) ? Math.max(nextTime, 0) : 0);
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    currentAudioUrl,
    duration,
    getPlayerState,
    isOwnedSource,
    isPlaying,
    subtitleCues.length,
  ]);

  if (subtitleCues.length === 0) {
    return subtitleError ? (
      <p className="lyric-line muted">{subtitleError}</p>
    ) : (
      <p className="lyric-line muted">{emptyText}</p>
    );
  }

  return (
    <div className="lyric-roller" role="list" aria-label="歌词">
      {subtitleCues.flatMap((cue, cueIndex) => {
        const isFocused = cueIndex === focusedLyricIndex;
        return cue.lines.map((line, lineIndex) => {
          const sweepPercent = isFocused
            ? resolveTimedTextCueSweepPercent(cue, lineIndex, lyricDisplayTime)
            : 0;
          return (
            <button
              key={`${cue.id}-${lineIndex}`}
              ref={isFocused && lineIndex === 0 ? focusedLyricLineRef : undefined}
              type="button"
              role="listitem"
              className={`lyric-line ${isFocused ? 'is-focus' : ''}`}
              style={{ '--lyric-progress': `${sweepPercent}%` } as React.CSSProperties}
              onClick={() => onLyricJump(cue)}
              title="跳转到这句歌词"
            >
              {line}
            </button>
          );
        });
      })}
    </div>
  );
});
