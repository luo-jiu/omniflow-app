import type { FloatingVideoState } from './floating-video.service';

export const FLOATING_VIDEO_RETENTION_PLAYING_MASK = 1;
export const FLOATING_VIDEO_RETENTION_PIP_MASK = 2;

export function readOwnedFloatingVideoRetentionPinMask(
  state: FloatingVideoState,
  tabId: string,
  libraryId: number | null,
): number {
  const ownsVideo = state.tabId === tabId && state.libraryId === libraryId;
  if (!ownsVideo) return 0;
  const playingMask = state.isPlaying ? FLOATING_VIDEO_RETENTION_PLAYING_MASK : 0;
  const pipMask = state.hostMode === 'document-pip' || state.hostMode === 'system-window'
    ? FLOATING_VIDEO_RETENTION_PIP_MASK
    : 0;
  return playingMask | pipMask;
}
