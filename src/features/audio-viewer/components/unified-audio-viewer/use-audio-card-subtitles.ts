import { useEffect, useState } from 'react';
import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';
import { getChildrenByNodeId } from '@/features/file-explorer/services/file.api';
import { useTimedText } from '@/features/file-viewer/timed-text/useTimedText';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { buildAudioSubtitleSources, type AudioArchiveChildNode, type AudioViewerMode } from './audio-viewer-content';

interface AudioCardSubtitleOptions {
  cardNodeId: number | null;
  mediaNodeId: number | null;
  currentTime: number;
  folderSubtitleSources: FileViewerSubtitleSource[] | undefined;
  libraryId: number | null;
  resourceKey: string;
  viewerMode: AudioViewerMode;
}

export function useAudioCardSubtitles({
  cardNodeId,
  mediaNodeId,
  currentTime,
  folderSubtitleSources,
  libraryId,
  resourceKey,
  viewerMode,
}: AudioCardSubtitleOptions) {
  const cardKey = JSON.stringify([libraryId, resourceKey, cardNodeId, mediaNodeId]);
  const [discovered, setDiscovered] = useState<{
    key: string;
    sources: FileViewerSubtitleSource[] | undefined;
  } | null>(null);

  useEffect(() => {
    if (viewerMode !== 'archive' || !libraryId || !cardNodeId || !mediaNodeId || cardNodeId === mediaNodeId) return;
    let cancelled = false;
    void getChildrenByNodeId(cardNodeId, libraryId).then((children) => {
      if (cancelled) return;
      const sources = buildAudioSubtitleSources(children as AudioArchiveChildNode[], libraryId);
      setDiscovered({ key: cardKey, sources: sources.length > 0 ? sources : undefined });
    }).catch((error) => {
      if (cancelled) return;
      runtimeLogger.warn('加载歌曲文件夹歌词失败:', error);
      setDiscovered({ key: cardKey, sources: undefined });
    });
    return () => { cancelled = true; };
  }, [cardKey, cardNodeId, libraryId, mediaNodeId, viewerMode]);

  const subtitleSources = viewerMode === 'folder'
    ? folderSubtitleSources
    : viewerMode === 'archive' && discovered?.key === cardKey
      ? discovered.sources
      : undefined;

  // The displayed song owns lyrics; starting playback must not reset them.
  return useTimedText({ currentTime, subtitleSources, url: cardKey });
}
