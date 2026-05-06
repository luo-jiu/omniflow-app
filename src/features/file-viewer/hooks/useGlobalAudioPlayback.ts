import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  globalAudioPlayer,
  type GlobalAudioPlayerState,
} from '@/features/file-viewer/services/global-audio-player';

type GlobalAudioOwnerType = GlobalAudioPlayerState['ownerType'];

interface UseGlobalAudioPlaybackOptions {
  ownerType?: GlobalAudioOwnerType;
  ownerKey: string | null;
}

export function useGlobalAudioPlayback({
  ownerType = 'default',
  ownerKey,
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

  const ensureSource = useCallback((url: string, trackName?: string | null) => {
    globalAudioPlayer.ensureSource(
      url,
      trackName ?? null,
      { ownerType, ownerKey },
    );
  }, [ownerKey, ownerType]);

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

  const clearIfOwned = useCallback(() => {
    const state = globalAudioPlayer.getState();
    if (ownerKey && state.ownerType === ownerType && state.ownerKey === ownerKey) {
      globalAudioPlayer.clear();
    }
  }, [ownerKey, ownerType]);

  return useMemo(() => ({
    adjustVolumeBy,
    clearIfOwned,
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
    clearIfOwned,
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
