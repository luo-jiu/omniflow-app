import { useCallback, useEffect, useRef } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { getFileLink } from '@/features/file-explorer/services/file.api';
import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';
import { runtimeLogger } from '@/utils/runtimeLogger';
import type { AudioArchiveCard } from './audio-viewer-content';

const LINK_EXPIRY_MINUTES = 120;

interface UseAudioCardPlaybackOptions {
  audioOwnerKey: string | null;
  bareAudioMode: boolean;
  beginPlaybackRequest: () => number;
  cancelPlaybackRequest: (playbackRequestId: number) => boolean;
  ensureSource: (
    url: string,
    trackName?: string | null,
    thumbnailUrl?: string | null,
    sourceNodeId?: number | null,
    playbackRequestId?: number,
  ) => boolean;
  fileUrl: string;
  getEndedSerial: () => number;
  libraryId: number | null;
  isPlaybackRequestCurrent: (playbackRequestId: number) => boolean;
  loadSubtitleSources: (
    card: AudioArchiveCard,
  ) => Promise<FileViewerSubtitleSource[] | undefined>;
  onStarted: (payload: {
    card: AudioArchiveCard;
    endedSerial: number;
    subtitleSources: FileViewerSubtitleSource[] | undefined;
    url: string;
  }) => void;
  play: (playbackRequestId?: number) => Promise<boolean>;
  seekTo: (time: number) => void;
}

export function useAudioCardPlayback({
  audioOwnerKey,
  bareAudioMode,
  beginPlaybackRequest,
  cancelPlaybackRequest,
  ensureSource,
  fileUrl,
  getEndedSerial,
  libraryId,
  isPlaybackRequestCurrent,
  loadSubtitleSources,
  onStarted,
  play,
  seekTo,
}: UseAudioCardPlaybackOptions) {
  const activeRequestIdRef = useRef<number | null>(null);

  const cancelPendingPlayback = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    activeRequestIdRef.current = null;
    if (requestId !== null) cancelPlaybackRequest(requestId);
  }, [cancelPlaybackRequest]);

  useEffect(() => cancelPendingPlayback, [
    audioOwnerKey,
    cancelPendingPlayback,
    fileUrl,
    libraryId,
  ]);

  const playCard = useCallback(async (
    card: AudioArchiveCard,
    options: { restart?: boolean } = {},
  ): Promise<boolean> => {
    if (!libraryId || !audioOwnerKey) {
      Toast.error('当前库参数异常');
      return false;
    }
    const requestId = beginPlaybackRequest();
    activeRequestIdRef.current = requestId;

    try {
      const [nextUrl, subtitleSources] = await Promise.all([
        bareAudioMode
          ? Promise.resolve(fileUrl)
          : getFileLink(card.mediaNodeId || card.id, libraryId, LINK_EXPIRY_MINUTES),
        loadSubtitleSources(card),
      ]);
      if (!nextUrl) throw new Error('未获取到音频访问链接');
      if (!isPlaybackRequestCurrent(requestId)) return false;

      const claimed = ensureSource(
        nextUrl,
        card.title,
        card.coverUrl ?? null,
        card.mediaNodeId || card.id,
        requestId,
      );
      if (!claimed) return false;
      if (options.restart) seekTo(0);
      const started = await play(requestId);
      if (!started || !isPlaybackRequestCurrent(requestId)) return false;

      onStarted({
        card,
        endedSerial: getEndedSerial(),
        subtitleSources,
        url: nextUrl,
      });
      return true;
    } catch (error: any) {
      if (!isPlaybackRequestCurrent(requestId)) return false;
      runtimeLogger.error('播放音频失败:', error);
      Toast.error(error?.message || '播放音频失败');
      return false;
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
      }
    }
  }, [
    audioOwnerKey,
    bareAudioMode,
    beginPlaybackRequest,
    ensureSource,
    fileUrl,
    getEndedSerial,
    libraryId,
    isPlaybackRequestCurrent,
    loadSubtitleSources,
    onStarted,
    play,
    seekTo,
  ]);

  const restartCard = useCallback((card: AudioArchiveCard) => (
    playCard(card, { restart: true })
  ), [playCard]);

  return {
    cancelPendingPlayback,
    playCard,
    restartCard,
  };
}
