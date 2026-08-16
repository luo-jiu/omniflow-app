import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconMusic } from '@douyinfe/semi-icons';
import type { TimedTextCue, TimedTextSegment } from '@/features/file-viewer/timed-text/subtitle';

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

function getTextUnitCount(text: string): number {
  return Math.max(Array.from(text).length, 1);
}

function resolveFocusedLyricIndex(cues: TimedTextCue[], currentTime: number): number {
  if (cues.length === 0) return -1;
  const activeIndex = cues.findIndex(cue => currentTime >= cue.start && currentTime <= cue.end);
  if (activeIndex >= 0) return activeIndex;
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    if (currentTime >= cues[index].start) {
      return Math.min(index + 1, cues.length - 1);
    }
  }
  return 0;
}

function resolveSegmentSweepPercent(segments: TimedTextSegment[], currentTime: number): number {
  if (segments.length === 0) return 0;
  const totalUnits = segments.reduce((sum, segment) => sum + getTextUnitCount(segment.text), 0);
  let elapsedUnits = 0;

  for (const segment of segments) {
    const segmentUnits = getTextUnitCount(segment.text);
    if (currentTime >= segment.end) {
      elapsedUnits += segmentUnits;
      continue;
    }
    if (currentTime <= segment.start) {
      return clampPercent((elapsedUnits / totalUnits) * 100);
    }
    const ratio = (currentTime - segment.start) / Math.max(segment.end - segment.start, 0.08);
    return clampPercent(((elapsedUnits + segmentUnits * ratio) / totalUnits) * 100);
  }

  return 100;
}

function resolveLyricSweepPercent(cue: TimedTextCue, lineIndex: number, currentTime: number): number {
  const segments = cue.segmentLines?.[lineIndex];
  if (segments?.length) {
    return resolveSegmentSweepPercent(segments, currentTime);
  }
  return clampPercent(((currentTime - cue.start) / Math.max(cue.end - cue.start, 0.1)) * 100);
}

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
    () => resolveFocusedLyricIndex(subtitleCues, lyricDisplayTime),
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
            ? resolveLyricSweepPercent(cue, lineIndex, lyricDisplayTime)
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
