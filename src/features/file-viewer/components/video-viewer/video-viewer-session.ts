import {
  DEFAULT_SUBTITLE_BOTTOM_OFFSET,
  DEFAULT_SUBTITLE_FONT_SIZE,
  MAX_SUBTITLE_BOTTOM_OFFSET,
  MAX_SUBTITLE_FONT_SIZE,
  MIN_SUBTITLE_BOTTOM_OFFSET,
  MIN_SUBTITLE_FONT_SIZE,
} from '@/features/file-viewer/timed-text/useTimedText';

export const VIDEO_VIEWER_SESSION_SCHEMA_VERSION = 1;
export const VIDEO_VIEWER_SESSION_ESTIMATED_BYTES = 384;

const MAX_MEDIA_DURATION_SECONDS = 60 * 60 * 24 * 14;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 4;

export interface VideoPlaybackProgress {
  currentTime: number;
  duration: number;
  updatedAt: string;
}

export interface VideoViewerSessionSnapshot extends VideoPlaybackProgress {
  playbackRate: number;
  subtitleEnabled: boolean;
  subtitleSourceId: string | null;
  subtitleFontSize: number;
  subtitleBottomOffset: number;
  consoleOpen: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseVideoViewerSessionSnapshot(value: unknown): VideoViewerSessionSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<VideoViewerSessionSnapshot>;
  const currentTime = readFiniteNumber(candidate.currentTime);
  const duration = readFiniteNumber(candidate.duration);
  const playbackRate = readFiniteNumber(candidate.playbackRate);
  const subtitleFontSize = readFiniteNumber(candidate.subtitleFontSize);
  const subtitleBottomOffset = readFiniteNumber(candidate.subtitleBottomOffset);
  const subtitleSourceId = candidate.subtitleSourceId;
  if (
    currentTime == null
    || duration == null
    || currentTime < 0
    || duration < 0
    || playbackRate == null
    || typeof candidate.subtitleEnabled !== 'boolean'
    || !(subtitleSourceId === null || typeof subtitleSourceId === 'string')
    || subtitleFontSize == null
    || subtitleBottomOffset == null
    || typeof candidate.consoleOpen !== 'boolean'
    || typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    currentTime: clamp(currentTime, 0, MAX_MEDIA_DURATION_SECONDS),
    duration: clamp(duration, 0, MAX_MEDIA_DURATION_SECONDS),
    updatedAt: candidate.updatedAt,
    playbackRate: clamp(playbackRate, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE),
    subtitleEnabled: candidate.subtitleEnabled,
    subtitleSourceId: subtitleSourceId == null ? null : subtitleSourceId.slice(0, 512),
    subtitleFontSize: clamp(
      Math.round(subtitleFontSize || DEFAULT_SUBTITLE_FONT_SIZE),
      MIN_SUBTITLE_FONT_SIZE,
      MAX_SUBTITLE_FONT_SIZE,
    ),
    subtitleBottomOffset: clamp(
      Math.round(subtitleBottomOffset || DEFAULT_SUBTITLE_BOTTOM_OFFSET),
      MIN_SUBTITLE_BOTTOM_OFFSET,
      MAX_SUBTITLE_BOTTOM_OFFSET,
    ),
    consoleOpen: candidate.consoleOpen,
  };
}
