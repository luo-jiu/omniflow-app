import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  globalAudioPlayer,
  type GlobalAudioPlayerState,
} from '@/features/file-viewer/services/global-audio-player';

type GlobalAudioOwnerType = GlobalAudioPlayerState['ownerType'];

interface UseGlobalAudioPlaybackOptions {
  ownerType?: GlobalAudioOwnerType;
  ownerKey: string | null;
  tabId?: string | null;
  libraryId?: number | null;
}

export function useGlobalAudioPlayback({
  ownerType = 'default',
  ownerKey,
  tabId = null,
  libraryId = null,
}: UseGlobalAudioPlaybackOptions) {
  const [playerState, setPlayerState] = useState(() => globalAudioPlayer.getState());

  useEffect(() => {
    setPlayerState(globalAudioPlayer.getState());
    return globalAudioPlayer.subscribe(setPlayerState);
  }, []);

  const isOwnedSource = Boolean(
    ownerKey
    && playerState.ownerType === ownerType
    && playerState.ownerKey === ownerKey,
  );

  const ensureSource = useCallback((
    url: string,
    trackName?: string | null,
    thumbnailUrl?: string | null,
  ) => {
    globalAudioPlayer.ensureSource(
      url,
      trackName ?? null,
      { ownerType, ownerKey, tabId, libraryId, thumbnailUrl: thumbnailUrl ?? null },
    );
  }, [ownerKey, ownerType, tabId, libraryId]);

  const play = useCallback(async () => {
    await globalAudioPlayer.play();
  }, []);

  const pause = useCallback(() => {
    globalAudioPlayer.pause();
  }, []);

  const togglePlay = useCallback(async () => {
    await globalAudioPlayer.togglePlay();
  }, []);

  const getPlayerState = useCallback(() => globalAudioPlayer.getState(), []);

  const seekTo = useCallback((time: number) => {
    globalAudioPlayer.seekTo(time);
  }, []);

  const seekBy = useCallback((delta: number) => {
    const state = globalAudioPlayer.getState();
    if (!Number.isFinite(state.duration) || state.duration <= 0) return;
    const next = Math.min(Math.max(state.currentTime + delta, 0), state.duration);
    globalAudioPlayer.seekTo(next);
  }, []);

  const setVolume = useCallback((volume: number) => {
    globalAudioPlayer.setVolume(volume);
  }, []);

  const adjustVolumeBy = useCallback((delta: number) => {
    const state = globalAudioPlayer.getState();
    globalAudioPlayer.setVolume(state.volume + delta);
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    globalAudioPlayer.setMuted(muted);
  }, []);

  // clear/dispose 由 FileViewerContext.closeTab → globalAudioPlayer.releaseForTab 兜底，
  // hook 不再暴露组件层主动 clear 的能力。

  return useMemo(() => ({
    adjustVolumeBy,
    ensureSource,
    getPlayerState,
    isOwnedSource,
    pause,
    play,
    playerState,
    seekBy,
    seekTo,
    setMuted,
    setVolume,
    togglePlay,
  }), [
    adjustVolumeBy,
    ensureSource,
    getPlayerState,
    isOwnedSource,
    pause,
    play,
    playerState,
    seekBy,
    seekTo,
    setMuted,
    setVolume,
    togglePlay,
  ]);
}
