import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  globalAudioPlayer,
  type GlobalAudioPlayerState,
} from '@/features/file-viewer/services/global-audio-player';
import { isGlobalAudioOwnedBy } from '@/features/file-viewer/services/global-audio-owner';

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

  const isOwnedSource = isGlobalAudioOwnedBy(playerState, {
    libraryId,
    ownerKey,
    ownerType,
    tabId,
  });

  const ensureSource = useCallback((
    url: string,
    trackName?: string | null,
    thumbnailUrl?: string | null,
    sourceNodeId?: number | null,
    playbackRequestId?: number,
  ) => {
    return globalAudioPlayer.ensureSource(
      url,
      trackName ?? null,
      {
        ownerType,
        ownerKey,
        tabId,
        libraryId,
        thumbnailUrl: thumbnailUrl ?? null,
        sourceNodeId: sourceNodeId ?? null,
        playbackRequestId,
      },
    );
  }, [ownerKey, ownerType, tabId, libraryId]);

  const play = useCallback(async (playbackRequestId?: number) => {
    return globalAudioPlayer.play(playbackRequestId);
  }, []);

  const beginPlaybackRequest = useCallback(
    () => globalAudioPlayer.beginPlaybackRequest(),
    [],
  );

  const cancelPlaybackRequest = useCallback(
    (playbackRequestId: number) => globalAudioPlayer.cancelPlaybackRequest(playbackRequestId),
    [],
  );

  const isPlaybackRequestCurrent = useCallback(
    (playbackRequestId: number) => globalAudioPlayer.isPlaybackRequestCurrent(playbackRequestId),
    [],
  );

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
    beginPlaybackRequest,
    cancelPlaybackRequest,
    ensureSource,
    getPlayerState,
    isOwnedSource,
    isPlaybackRequestCurrent,
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
    beginPlaybackRequest,
    cancelPlaybackRequest,
    ensureSource,
    getPlayerState,
    isOwnedSource,
    isPlaybackRequestCurrent,
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
