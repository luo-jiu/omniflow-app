import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Popover, Spin, Toast } from '@douyinfe/semi-ui';
import {
  IconBackward,
  IconChevronDown,
  IconChevronUp,
  IconForward,
  IconList,
  IconLoopTextStroked,
  IconMore,
  IconMusic,
  IconPause,
  IconPlay,
  IconSort,
  IconSync,
  IconVolume1,
  IconVolume2,
  IconMute,
} from '@douyinfe/semi-icons';
import {
  batchGetFileLinks,
  fetchArchiveCardsPage,
  getChildrenByNodeId,
  getFileLink,
} from '@/features/file-explorer/services/file.api';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { useFileViewer } from '@/hooks/useFileViewer';
import { useGlobalAudioPlayback } from '@/features/file-viewer/hooks/useGlobalAudioPlayback';
import { useTimedText } from '@/features/file-viewer/timed-text/useTimedText';
import type { TimedTextCue, TimedTextSegment } from '@/features/file-viewer/timed-text/subtitle';
import type {
  FileViewerAudioPlaylist,
  FileViewerSubtitleSource,
} from '@/contexts/file-viewer.context';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/context-menu';
import { useNodePropertiesOverlay } from '@/features/file-explorer/hooks/useNodePropertiesOverlay';
import {
  AUDIO_ARCHIVE_EMPTY_SIDECARS,
  buildAudioSubtitleSources,
  normalizeAudioArchiveMatchName,
  type AudioArchiveChildNode,
  type AudioArchiveSidecarIndex,
} from './audio-archive-sidecars';
import { AudioArchiveViewerWrapper } from './style';

interface AudioArchiveViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  active?: boolean;
  tabId: string;
}

interface AudioArchiveCard {
  id: number;
  mediaNodeId: number;
  title: string;
  sortOrder: number;
  coverNodeId: number | null;
  coverUrl: string | null;
  subtitleCount: number;
  durationSeconds?: number | null;
}

interface AudioArchiveSnapshot {
  hasLoadedList: boolean;
  cards: AudioArchiveCard[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  scrollTop: number;
  currentCardId: number | null;
  selectedCardId: number | null;
  currentAudioUrl: string | null;
  activeSubtitleSources?: FileViewerSubtitleSource[];
}

type AudioRepeatMode = 'order' | 'list-loop' | 'single-loop' | 'random';

const PAGE_SIZE = 60;
const LINK_EXPIRY_MINUTES = 120;
const AUDIO_ARCHIVE_CACHE_MAX_ENTRIES = 24;

const EMPTY_AUDIO_ARCHIVE_SNAPSHOT: AudioArchiveSnapshot = {
  hasLoadedList: false,
  cards: [],
  nextOffset: 0,
  total: 0,
  hasMore: false,
  scrollTop: 0,
  currentCardId: null,
  selectedCardId: null,
  currentAudioUrl: null,
  activeSubtitleSources: undefined,
};

const audioArchiveSnapshotCache = new Map<string, AudioArchiveSnapshot>();

function parseArchiveLibraryId(fileUrl: string): number | null {
  const matches = /^audio-archive:\/\/library\/(\d+)\/node\/\d+$/i.exec(String(fileUrl || '').trim());
  if (!matches) return null;
  const parsed = Number(matches[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeArchiveTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return 'AUDIO 归档';
  if (raw.startsWith('AUDIO 归档 ·')) {
    const stripped = raw.replace(/^AUDIO 归档 ·\s*/u, '').trim();
    if (stripped) return stripped;
  }
  return raw;
}

function formatPlaylistTitle(title: string): string {
  const normalized = String(title || '').trim() || '音乐';
  return normalized.endsWith('播放列表') ? normalized : `${normalized}播放列表`;
}

function resolveReaderCacheKey(fileUrl: string, folderNodeId: number | null): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) return null;
  return `${String(fileUrl || '').trim()}::${folderNodeId}`;
}

function formatDuration(durationSeconds?: number | null): string {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return '--:--';
  const totalSeconds = Math.max(Math.floor(duration), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

function getRepeatModeLabel(mode: AudioRepeatMode): string {
  if (mode === 'list-loop') return '列表循环';
  if (mode === 'single-loop') return '单曲循环';
  if (mode === 'random') return '随机播放';
  return '顺序播放';
}

function getNextRepeatMode(mode: AudioRepeatMode): AudioRepeatMode {
  if (mode === 'order') return 'list-loop';
  if (mode === 'list-loop') return 'single-loop';
  if (mode === 'single-loop') return 'random';
  return 'order';
}

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
  let previousIndex = -1;
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    if (currentTime >= cues[index].start) {
      previousIndex = index;
      break;
    }
  }
  if (previousIndex >= 0) return Math.min(previousIndex + 1, cues.length - 1);
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

function parseAudioNodeOwnerKey(ownerKey?: string | null): number | null {
  const match = /^audio:node:(\d+)$/u.exec(String(ownerKey || ''));
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasSnapshotPatchKey<Key extends keyof AudioArchiveSnapshot>(
  patch: Partial<AudioArchiveSnapshot>,
  key: Key,
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function setArchiveSnapshotCache(cacheKey: string, snapshot: AudioArchiveSnapshot) {
  if (audioArchiveSnapshotCache.has(cacheKey)) {
    audioArchiveSnapshotCache.delete(cacheKey);
  }
  audioArchiveSnapshotCache.set(cacheKey, snapshot);
  if (audioArchiveSnapshotCache.size > AUDIO_ARCHIVE_CACHE_MAX_ENTRIES) {
    const oldest = audioArchiveSnapshotCache.keys().next().value;
    if (oldest) {
      audioArchiveSnapshotCache.delete(oldest);
    }
  }
}

const AudioCover: React.FC<{
  coverUrl?: string | null;
  title: string;
  className?: string;
}> = ({ coverUrl, title, className }) => (
  <div className={`audio-cover ${className || ''}`}>
    {coverUrl ? (
      <img src={coverUrl} alt={title} draggable={false} />
    ) : (
      <IconMusic />
    )}
  </div>
);

const ExpandedLyricsRoller: React.FC<{
  currentAudioUrl: string | null;
  currentTime: number;
  duration: number;
  getPlayerState: () => { src: string | null; currentTime: number };
  isOwnedSource: boolean;
  isPlaying: boolean;
  onLyricJump: (cue: TimedTextCue) => void;
  subtitleCues: TimedTextCue[];
  subtitleError: string | null;
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
      lineEl.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
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

  if (subtitleCues.length > 0) {
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
                style={{
                  '--lyric-progress': `${sweepPercent}%`,
                } as React.CSSProperties}
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
  }

  return subtitleError ? (
    <p className="lyric-line muted">{subtitleError}</p>
  ) : (
    <p className="lyric-line muted">当前歌曲没有可用歌词</p>
  );
});

const AudioArchiveViewer: React.FC<AudioArchiveViewerProps> = ({
  folderNodeId,
  fileUrl,
  fileName,
  active = true,
  tabId,
}) => {
  const { setFileUrl } = useFileViewer();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const restoreScrollTopRef = useRef<number | null>(null);
  const persistScrollRafRef = useRef<number>(0);
  const activeSubtitleSourcesRef = useRef<FileViewerSubtitleSource[] | undefined>(undefined);
  const lastHandledEndedSerialRef = useRef(0);
  const coverClickTimerRef = useRef<number>(0);

  const libraryId = useMemo(() => parseArchiveLibraryId(fileUrl), [fileUrl]);
  const title = useMemo(() => normalizeArchiveTitle(fileName), [fileName]);
  const playlistTitle = useMemo(() => formatPlaylistTitle(title), [title]);
  const archiveOwnerKey = useMemo(() => (
    libraryId && folderNodeId ? `audio-archive:${libraryId}:${folderNodeId}` : null
  ), [folderNodeId, libraryId]);
  const { showNodeProperties } = useNodePropertiesOverlay({ libraryId });
  const readerCacheKey = useMemo(
    () => resolveReaderCacheKey(fileUrl, folderNodeId),
    [fileUrl, folderNodeId],
  );

  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedList, setHasLoadedList] = useState(false);
  const [cards, setCards] = useState<AudioArchiveCard[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [currentCardId, setCurrentCardId] = useState<number | null>(null);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [repeatMode, setRepeatMode] = useState<AudioRepeatMode>('list-loop');
  const [expanded, setExpanded] = useState(false);
  const [activeSubtitleSources, setActiveSubtitleSources] = useState<FileViewerSubtitleSource[] | undefined>(undefined);
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    card: AudioArchiveCard | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    card: null,
  });

  const currentCard = useMemo(
    () => cards.find(card => card.id === currentCardId) || null,
    [cards, currentCardId],
  );
  const selectedCard = useMemo(
    () => cards.find(card => card.id === selectedCardId) || null,
    [cards, selectedCardId],
  );
  const effectiveCard = currentCard || selectedCard || cards[0] || null;
  const {
    ensureSource,
    getPlayerState,
    play,
    playerState,
    seekTo,
    setMuted,
    setVolume,
    togglePlay: toggleOwnedPlay,
  } = useGlobalAudioPlayback({ ownerType: 'default', ownerKey: archiveOwnerKey, tabId, libraryId });
  const isCurrentArchiveSource = Boolean(currentAudioUrl && playerState.src === currentAudioUrl);
  const currentTime = isCurrentArchiveSource ? playerState.currentTime : 0;
  const duration = isCurrentArchiveSource ? playerState.duration : 0;

  const {
    subtitleCues,
    subtitleError,
    subtitleFileName,
  } = useTimedText({
    currentTime,
    subtitleSources: activeSubtitleSources,
    url: currentAudioUrl || '',
  });

  useEffect(() => {
    activeSubtitleSourcesRef.current = activeSubtitleSources;
  }, [activeSubtitleSources]);

  useEffect(() => {
    if (active) return;
    setMenuState(prev => (prev.visible ? { ...prev, visible: false } : prev));
  }, [active]);

  const persistSnapshot = useCallback((patch: Partial<AudioArchiveSnapshot>) => {
    if (!readerCacheKey) return;
    const prev = audioArchiveSnapshotCache.get(readerCacheKey) ?? EMPTY_AUDIO_ARCHIVE_SNAPSHOT;
    setArchiveSnapshotCache(readerCacheKey, {
      hasLoadedList: patch.hasLoadedList ?? prev.hasLoadedList,
      cards: patch.cards ?? prev.cards,
      nextOffset: patch.nextOffset ?? prev.nextOffset,
      total: patch.total ?? prev.total,
      hasMore: patch.hasMore ?? prev.hasMore,
      scrollTop: patch.scrollTop ?? prev.scrollTop,
      currentCardId: hasSnapshotPatchKey(patch, 'currentCardId') ? patch.currentCardId ?? null : prev.currentCardId,
      selectedCardId: hasSnapshotPatchKey(patch, 'selectedCardId') ? patch.selectedCardId ?? null : prev.selectedCardId,
      currentAudioUrl: hasSnapshotPatchKey(patch, 'currentAudioUrl') ? patch.currentAudioUrl ?? null : prev.currentAudioUrl,
      activeSubtitleSources: hasSnapshotPatchKey(patch, 'activeSubtitleSources')
        ? patch.activeSubtitleSources
        : prev.activeSubtitleSources,
    });
  }, [readerCacheKey]);

  const closeContextMenu = useCallback(() => {
    setMenuState(prev => ({ ...prev, visible: false }));
  }, []);

  const clearPendingCoverClick = useCallback(() => {
    if (!coverClickTimerRef.current) return;
    window.clearTimeout(coverClickTimerRef.current);
    coverClickTimerRef.current = 0;
  }, []);

  const openCardContextMenu = useCallback((e: React.MouseEvent, card: AudioArchiveCard) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuState({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      card,
    });
  }, []);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const card = menuState.card;
    if (!card || !libraryId) return [];
    return [
      {
        key: 'props',
        label: '属性',
        onClick: () => {
          closeContextMenu();
          void showNodeProperties({
            id: card.id,
            label: card.title,
          });
        },
      },
    ];
  }, [closeContextMenu, libraryId, menuState.card, showNodeProperties]);

  const resolveCardCoverUrls = useCallback(async (inputCards: AudioArchiveCard[]): Promise<AudioArchiveCard[]> => {
    if (!libraryId || inputCards.length === 0) {
      return inputCards;
    }
    const coverNodeIds = Array.from(new Set(inputCards
      .map(card => card.coverNodeId)
      .filter((nodeId): nodeId is number => Boolean(nodeId && nodeId > 0))));
    if (coverNodeIds.length === 0) {
      return inputCards;
    }

    try {
      const linkMap = await batchGetFileLinks({
        libraryId,
        nodeIds: coverNodeIds,
        expiry: LINK_EXPIRY_MINUTES,
      });
      return inputCards.map(card => (
        card.coverNodeId && linkMap.has(card.coverNodeId)
          ? { ...card, coverUrl: linkMap.get(card.coverNodeId) || null }
          : card
      ));
    } catch (coverError) {
      runtimeLogger.warn('批量加载音频归档封面失败:', coverError);
      return inputCards;
    }
  }, [libraryId]);

  const mapArchiveCards = useCallback((
    items: Array<{
      id: number;
      name: string;
      sortOrder?: number;
      coverNodeId?: number;
      mediaNodeId?: number;
      subtitleCount?: number;
      durationSeconds?: number;
    }>,
    sidecarIndex: AudioArchiveSidecarIndex,
  ): AudioArchiveCard[] => items.map((item) => {
    const cardId = Number(item.id);
    const mediaNodeId = Number.isFinite(Number(item.mediaNodeId)) && Number(item.mediaNodeId) > 0
      ? Number(item.mediaNodeId)
      : cardId;
    const matchName = normalizeAudioArchiveMatchName(item.name);
    const explicitCoverNodeId = Number.isFinite(Number(item.coverNodeId)) && Number(item.coverNodeId) > 0
      ? Number(item.coverNodeId)
      : null;
    const sidecarCoverNodeId = matchName ? sidecarIndex.coverNodeIdByName.get(matchName) ?? null : null;
    const subtitleCount = Math.max(
      Number(item.subtitleCount ?? 0),
      matchName ? sidecarIndex.subtitlesByName.get(matchName)?.length ?? 0 : 0,
    );
    return {
      id: cardId,
      mediaNodeId,
      title: String(item.name || ''),
      sortOrder: Number(item.sortOrder ?? 0),
      coverNodeId: explicitCoverNodeId || sidecarCoverNodeId,
      coverUrl: null,
      subtitleCount,
      durationSeconds: Number(item.durationSeconds ?? 0) > 0 ? Number(item.durationSeconds) : null,
    };
  }), []);

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    if (!folderNodeId || !libraryId || !Number.isFinite(folderNodeId)) return;
    const requestId = requestIdRef.current;
    if (append) {
      setLoadingMore(true);
    } else {
      setListLoading(true);
      setError(null);
    }

    try {
      const page = await fetchArchiveCardsPage({
        nodeId: folderNodeId,
        libraryId,
        builtInType: 'AUDIO',
        offset,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;
      const rawCards = mapArchiveCards(page.items, AUDIO_ARCHIVE_EMPTY_SIDECARS);
      const cardsWithCover = await resolveCardCoverUrls(rawCards);
      if (requestId !== requestIdRef.current) return;

      setCards((prev) => {
        const merged = append ? [...prev, ...cardsWithCover] : cardsWithCover;
        const byId = new Map<number, AudioArchiveCard>();
        merged.forEach((card) => {
          const existing = byId.get(card.id);
          byId.set(card.id, existing ? { ...existing, ...card, coverUrl: card.coverUrl || existing.coverUrl } : card);
        });
        return Array.from(byId.values()).sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.id - b.id;
        });
      });
      setHasLoadedList(true);
      setTotal(page.total);
      setNextOffset(page.offset + page.items.length);
      setHasMore(page.hasMore);
    } catch (loadError) {
      runtimeLogger.error('加载音频归档分页失败:', loadError);
      if (requestId !== requestIdRef.current) return;
      setError('加载归档失败');
      if (!append) {
        setCards([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setListLoading(false);
        setLoadingMore(false);
      }
    }
  }, [folderNodeId, libraryId, mapArchiveCards, resolveCardCoverUrls]);

  const loadMore = useCallback(() => {
    if (listLoading || loadingMore || !hasMore) return;
    void loadPage(nextOffset, true);
  }, [hasMore, listLoading, loadingMore, loadPage, nextOffset]);

  const loadCardSubtitleSources = useCallback(async (card: AudioArchiveCard): Promise<FileViewerSubtitleSource[] | undefined> => {
    if (!libraryId) return undefined;
    if (card.mediaNodeId && card.mediaNodeId !== card.id) {
      try {
        const children = await getChildrenByNodeId(card.id, libraryId);
        const sources = buildAudioSubtitleSources(children as AudioArchiveChildNode[], libraryId);
        return sources.length > 0 ? sources : undefined;
      } catch (error) {
        runtimeLogger.warn('加载歌曲文件夹歌词失败:', error);
        return undefined;
      }
    }
    return undefined;
  }, [libraryId]);

  const playCard = useCallback(async (card: AudioArchiveCard) => {
    if (!libraryId || !archiveOwnerKey) {
      Toast.error('当前库参数异常');
      return;
    }
    try {
      const [nextUrl, subtitleSources] = await Promise.all([
        getFileLink(card.mediaNodeId || card.id, libraryId, LINK_EXPIRY_MINUTES),
        loadCardSubtitleSources(card),
      ]);
      if (!nextUrl) {
        throw new Error('未获取到音频访问链接');
      }
      ensureSource(nextUrl, card.title, card.coverUrl ?? null);
      await play();
      setCurrentCardId(card.id);
      setSelectedCardId(card.id);
      setCurrentAudioUrl(nextUrl);
      setActiveSubtitleSources(subtitleSources);
      lastHandledEndedSerialRef.current = getPlayerState().endedSerial;
    } catch (playError: any) {
      runtimeLogger.error('播放音频归档歌曲失败:', playError);
      Toast.error(playError?.message || '播放音频失败');
    }
  }, [archiveOwnerKey, ensureSource, getPlayerState, libraryId, loadCardSubtitleSources, play]);

  const restartCard = useCallback(async (card: AudioArchiveCard) => {
    if (!libraryId || !archiveOwnerKey) {
      Toast.error('当前库参数异常');
      return;
    }
    try {
      const [nextUrl, subtitleSources] = await Promise.all([
        getFileLink(card.mediaNodeId || card.id, libraryId, LINK_EXPIRY_MINUTES),
        loadCardSubtitleSources(card),
      ]);
      if (!nextUrl) {
        throw new Error('未获取到音频访问链接');
      }
      ensureSource(nextUrl, card.title, card.coverUrl ?? null);
      seekTo(0);
      await play();
      setCurrentCardId(card.id);
      setSelectedCardId(card.id);
      setCurrentAudioUrl(nextUrl);
      setActiveSubtitleSources(subtitleSources);
      lastHandledEndedSerialRef.current = getPlayerState().endedSerial;
    } catch (playError: any) {
      runtimeLogger.error('重新播放音频归档歌曲失败:', playError);
      Toast.error(playError?.message || '重新播放音频失败');
    }
  }, [archiveOwnerKey, ensureSource, getPlayerState, libraryId, loadCardSubtitleSources, play, seekTo]);

  const currentCardIndex = useMemo(
    () => cards.findIndex(card => card.id === currentCardId),
    [cards, currentCardId],
  );

  const playNextCard = useCallback((fromEnded = false) => {
    if (cards.length === 0) return;
    if (repeatMode === 'single-loop' && currentCard && fromEnded) {
      void playCard(currentCard);
      return;
    }
    let nextIndex = currentCardIndex >= 0 ? currentCardIndex + 1 : 0;
    if (repeatMode === 'random') {
      nextIndex = cards.length === 1 ? 0 : Math.floor(Math.random() * cards.length);
      if (cards.length > 1 && nextIndex === currentCardIndex) {
        nextIndex = (nextIndex + 1) % cards.length;
      }
    }
    if (nextIndex >= cards.length) {
      if (repeatMode !== 'list-loop' && repeatMode !== 'random') return;
      nextIndex = 0;
    }
    const nextCard = cards[nextIndex];
    if (nextCard) void playCard(nextCard);
  }, [cards, currentCard, currentCardIndex, playCard, repeatMode]);

  const playPrevCard = useCallback(() => {
    if (cards.length === 0) return;
    let nextIndex = currentCardIndex >= 0 ? currentCardIndex - 1 : 0;
    if (nextIndex < 0) nextIndex = repeatMode === 'list-loop' ? cards.length - 1 : 0;
    const prevCard = cards[nextIndex];
    if (prevCard) void playCard(prevCard);
  }, [cards, currentCardIndex, playCard, repeatMode]);

  const togglePlay = useCallback(() => {
    if (isCurrentArchiveSource) {
      void toggleOwnedPlay().catch((playError) => {
        runtimeLogger.error('切换音频播放失败:', playError);
      });
      return;
    }
    if (effectiveCard) {
      void playCard(effectiveCard);
    }
  }, [effectiveCard, isCurrentArchiveSource, playCard, toggleOwnedPlay]);

  const handleCardPlayButtonClick = useCallback((card: AudioArchiveCard) => {
    clearPendingCoverClick();
    coverClickTimerRef.current = window.setTimeout(() => {
      coverClickTimerRef.current = 0;
      setSelectedCardId(card.id);
      if (card.id === currentCardId && isCurrentArchiveSource) {
        void toggleOwnedPlay().catch((playError) => {
          runtimeLogger.error('切换音频播放失败:', playError);
        });
        return;
      }
      void playCard(card);
    }, 180);
  }, [clearPendingCoverClick, currentCardId, isCurrentArchiveSource, playCard, toggleOwnedPlay]);

  const handleCardRestart = useCallback((card: AudioArchiveCard) => {
    clearPendingCoverClick();
    setSelectedCardId(card.id);
    void restartCard(card);
  }, [clearPendingCoverClick, restartCard]);

  const handleLyricJump = useCallback((cue: TimedTextCue) => {
    const targetTime = Math.max(cue.start + 0.01, 0);
    if (isCurrentArchiveSource) {
      seekTo(targetTime);
      if (!playerState.isPlaying) {
        void play().catch((playError) => {
          runtimeLogger.error('点击歌词播放失败:', playError);
        });
      }
      return;
    }
    if (!effectiveCard) return;
    void playCard(effectiveCard).then(() => {
      seekTo(targetTime);
    });
  }, [effectiveCard, isCurrentArchiveSource, play, playCard, playerState.isPlaying, seekTo]);

  const handleOpenInAudioViewer = useCallback(async () => {
    if (!currentCard || !libraryId || !currentAudioUrl) return;
    const audioPlaylist: FileViewerAudioPlaylist = {
      id: `audio-archive:${libraryId}:${folderNodeId || 0}`,
      title,
      items: cards.map(card => ({
        nodeId: card.mediaNodeId || card.id,
        libraryId,
        title: card.title,
        sortOrder: card.sortOrder,
        durationSeconds: card.durationSeconds,
        coverUrl: card.coverUrl,
        subtitleSources: card.id === currentCard.id ? activeSubtitleSourcesRef.current : undefined,
      })),
    };
    setFileUrl(
      currentAudioUrl,
      currentCard.title,
      'audio',
      currentCard.mediaNodeId || currentCard.id,
      {
        tabTypeLabel: 'AUDIO',
        returnTarget: {
          fileUrl,
          fileName: fileName || title,
          fileType: 'audio_archive',
          nodeId: folderNodeId,
          tabTypeLabel: 'AUDIO-ARCHIVE',
        },
        audioSubtitleSources: activeSubtitleSourcesRef.current,
        audioPlaylist,
        audioAutoPlay: true,
        audioCoverUrl: currentCard.coverUrl,
      },
    );
  }, [cards, currentAudioUrl, currentCard, fileName, fileUrl, folderNodeId, libraryId, setFileUrl, title]);

  useEffect(() => {
    if (!isCurrentArchiveSource) return;
    if (playerState.endedSerial <= 0 || playerState.endedSerial === lastHandledEndedSerialRef.current) return;
    lastHandledEndedSerialRef.current = playerState.endedSerial;
    playNextCard(true);
  }, [isCurrentArchiveSource, playNextCard, playerState.endedSerial]);

  useEffect(() => {
    requestIdRef.current += 1;
    if (persistScrollRafRef.current) {
      window.cancelAnimationFrame(persistScrollRafRef.current);
      persistScrollRafRef.current = 0;
    }

    if (!folderNodeId || !libraryId) {
      setHasLoadedList(false);
      setCards([]);
      setError('归档参数异常');
      setListLoading(false);
      setLoadingMore(false);
      setTotal(0);
      setNextOffset(0);
      setHasMore(false);
      setCurrentCardId(null);
      setSelectedCardId(null);
      setCurrentAudioUrl(null);
      setActiveSubtitleSources(undefined);
      return;
    }

    const cached = readerCacheKey ? audioArchiveSnapshotCache.get(readerCacheKey) : null;
    if (cached?.hasLoadedList) {
      setCards(cached.cards);
      setNextOffset(cached.nextOffset);
      setTotal(cached.total);
      setHasMore(cached.hasMore);
      setHasLoadedList(true);
      setError(null);
      setListLoading(false);
      setLoadingMore(false);
      setCurrentCardId(cached.currentCardId);
      setSelectedCardId(cached.selectedCardId);
      setCurrentAudioUrl(cached.currentAudioUrl);
      setActiveSubtitleSources(cached.activeSubtitleSources);
      restoreScrollTopRef.current = cached.scrollTop;
      return;
    }

    setHasLoadedList(false);
    setCards([]);
    setNextOffset(0);
    setTotal(0);
    setHasMore(false);
    setError(null);
    setCurrentCardId(null);
    setSelectedCardId(null);
    setCurrentAudioUrl(null);
    setActiveSubtitleSources(undefined);
    restoreScrollTopRef.current = 0;
    void loadPage(0, false);
  }, [folderNodeId, libraryId, loadPage, readerCacheKey]);

  useEffect(() => {
    if (!active) return;
    const nextScrollTop = restoreScrollTopRef.current;
    if (nextScrollTop == null) return;
    restoreScrollTopRef.current = null;
    requestAnimationFrame(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollTop = nextScrollTop;
      }
    });
  }, [active, cards.length]);

  useEffect(() => {
    persistSnapshot({
      hasLoadedList,
      cards,
      nextOffset,
      total,
      hasMore,
    });
  }, [cards, hasLoadedList, hasMore, nextOffset, persistSnapshot, total]);

  useEffect(() => {
    persistSnapshot({
      currentCardId,
      selectedCardId,
      currentAudioUrl,
      activeSubtitleSources,
    });
  }, [activeSubtitleSources, currentAudioUrl, currentCardId, persistSnapshot, selectedCardId]);

  useEffect(() => {
    if (!libraryId || cards.length === 0 || !playerState.src) return;
    if (playerState.libraryId && playerState.libraryId !== libraryId) return;
    const playingNodeId = parseAudioNodeOwnerKey(playerState.ownerKey);
    if (!playingNodeId) return;
    const matchedCard = cards.find(card => (
      card.mediaNodeId === playingNodeId || card.id === playingNodeId
    ));
    if (!matchedCard) return;
    if (currentCardId === matchedCard.id && currentAudioUrl === playerState.src) return;

    setCurrentCardId(matchedCard.id);
    setSelectedCardId(matchedCard.id);
    setCurrentAudioUrl(playerState.src);
    void loadCardSubtitleSources(matchedCard).then((sources) => {
      const latestState = getPlayerState();
      if (latestState.src !== playerState.src) return;
      setActiveSubtitleSources(sources);
    });
  }, [
    cards,
    currentAudioUrl,
    currentCardId,
    getPlayerState,
    libraryId,
    loadCardSubtitleSources,
    playerState.libraryId,
    playerState.ownerKey,
    playerState.src,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleScroll = () => {
      if (persistScrollRafRef.current) return;
      persistScrollRafRef.current = window.requestAnimationFrame(() => {
        persistScrollRafRef.current = 0;
        persistSnapshot({
          hasLoadedList,
          cards,
          nextOffset,
          total,
          hasMore,
          scrollTop: viewport.scrollTop,
        });
      });
    };
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      if (persistScrollRafRef.current) {
        window.cancelAnimationFrame(persistScrollRafRef.current);
        persistScrollRafRef.current = 0;
      }
    };
  }, [cards, hasLoadedList, hasMore, nextOffset, persistSnapshot, total]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible) {
        loadMore();
      }
    }, {
      root: viewport,
      rootMargin: '0px 0px 360px 0px',
      threshold: 0,
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const progressPercent = duration > 0 ? Math.min(Math.max((currentTime / duration) * 100, 0), 100) : 0;

  // MediaHub 注册由 globalAudioPlayer 服务层完成；详见 docs/media-hub-contract.md。
  // 关闭归档 tab 时必须由 FileViewerContext.releaseForTab 释放，不能依赖组件卸载。

  useEffect(() => {
    return () => {
      clearPendingCoverClick();
    };
  }, [clearPendingCoverClick]);

  return (
    <AudioArchiveViewerWrapper className={expanded ? 'is-expanded' : ''}>
      {expanded && (
        <section className="expanded-player" aria-label="展开播放器">
          <div className="expanded-cover-wrap">
            <AudioCover coverUrl={effectiveCard?.coverUrl} title={effectiveCard?.title || '音频'} className="large" />
          </div>
          <div className="expanded-lyrics">
            <div className="expanded-title" title={effectiveCard?.title || ''}>{effectiveCard?.title || '未选择歌曲'}</div>
            <div className="expanded-subtitle">{subtitleFileName || (subtitleCues.length > 0 ? '歌词已加载' : '暂无歌词')}</div>
            <div className="lyrics-stage">
              <ExpandedLyricsRoller
                currentAudioUrl={currentAudioUrl}
                currentTime={currentTime}
                duration={duration}
                getPlayerState={getPlayerState}
                isOwnedSource={isCurrentArchiveSource}
                isPlaying={playerState.isPlaying}
                onLyricJump={handleLyricJump}
                subtitleCues={subtitleCues}
                subtitleError={subtitleError}
              />
            </div>
          </div>
        </section>
      )}

      <div className="archive-main" ref={viewportRef} aria-hidden={expanded}>
        <header className="archive-header">
          <div className="archive-title-wrap">
            <span className="badge">音乐</span>
            <h2 title={playlistTitle}>{playlistTitle}</h2>
          </div>
          <span className="archive-count">共 {total} 首</span>
        </header>

        {listLoading ? (
          <div className="state-wrap">
            <Spin size="large" tip="归档加载中..." />
          </div>
        ) : error ? (
          <div className="state-wrap state-error">{error}</div>
        ) : cards.length === 0 ? (
          <div className="state-wrap">当前归档下暂无可播放歌曲</div>
        ) : (
          <>
            <div className="song-list-header" aria-hidden="true">
              <span />
              <span />
              <span className="song-header-title">
                歌名/歌手
                <IconSort className="song-header-sort" />
              </span>
              <span>专辑</span>
              <span />
              <span className="song-header-duration">时长</span>
            </div>
            <div className="song-list" role="list">
              {cards.map((card, index) => {
                const activeRow = card.id === currentCardId && isCurrentArchiveSource;
                const playingRow = activeRow && playerState.isPlaying;
                const selectedRow = card.id === selectedCardId;
                return (
                  <article
                    key={card.id}
                    role="listitem"
                    className={`song-row ${activeRow ? 'is-playing' : ''} ${selectedRow ? 'is-selected' : ''}`}
                    onClick={() => setSelectedCardId(card.id)}
                    onDoubleClick={() => handleCardRestart(card)}
                    onContextMenu={(event) => openCardContextMenu(event, card)}
                  >
                    <span className="song-index">{activeRow ? <IconMusic /> : index + 1}</span>
                    <button
                      type="button"
                      className="song-cover-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCardPlayButtonClick(card);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        handleCardRestart(card);
                      }}
                      title={activeRow && playingRow ? '暂停' : '播放'}
                      aria-label={`${activeRow && playingRow ? '暂停' : '播放'} ${card.title}`}
                    >
                      <AudioCover coverUrl={card.coverUrl} title={card.title} />
                      <span className="cover-play">{activeRow && playingRow ? <IconPause /> : <IconPlay />}</span>
                    </button>
                    <div className="song-primary">
                      <div className="song-title-line">
                        <span className="song-title" title={card.title}>{card.title}</span>
                        {card.subtitleCount > 0 && <span className="song-pill">歌词</span>}
                        {card.coverUrl && <span className="song-pill">封面</span>}
                      </div>
                      <span className="song-artist">未知艺术家</span>
                    </div>
                    <span className="song-album" title={title}>{title}</span>
                    <button
                      type="button"
                      className="row-icon-button"
                      title="更多"
                      aria-label="更多"
                      onClick={(event) => openCardContextMenu(event, card)}
                    >
                      <IconMore />
                    </button>
                    <span className="song-duration">{formatDuration(card.durationSeconds)}</span>
                  </article>
                );
              })}
            </div>
            {loadingMore && (
              <div className="state-wrap loading-more">
                <Spin size="large" tip="正在加载更多..." />
              </div>
            )}
            <div ref={sentinelRef} style={{ height: 1, width: '100%' }} />
          </>
        )}
      </div>

      <footer className="audio-player-bar">
        <div className="player-progress">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <button
          type="button"
          className="player-brief"
          onClick={() => setExpanded(prev => !prev)}
          title={expanded ? '收起播放器' : '展开播放器'}
          aria-label={expanded ? '收起播放器' : '展开播放器'}
        >
          <span className="player-cover-trigger">
            <AudioCover coverUrl={effectiveCard?.coverUrl} title={effectiveCard?.title || '音频'} className="mini" />
            <span className="player-cover-toggle" aria-hidden="true">
              {expanded ? <IconChevronDown /> : <IconChevronUp />}
            </span>
          </span>
          <div className="player-track">
            <span className="player-title" title={effectiveCard?.title || ''}>{effectiveCard?.title || '选择一首歌'}</span>
            <span className="player-artist">{subtitleFileName || '未知艺术家'}</span>
          </div>
        </button>

        <div className="player-controls">
          <Button
            icon={<IconBackward />}
            theme="borderless"
            onClick={playPrevCard}
            disabled={cards.length === 0}
            title="上一首"
            aria-label="上一首"
          />
          <Button
            className="play-main"
            icon={isCurrentArchiveSource && playerState.isPlaying ? <IconPause /> : <IconPlay />}
            theme="solid"
            shape="circle"
            onClick={togglePlay}
            disabled={cards.length === 0}
            title={isCurrentArchiveSource && playerState.isPlaying ? '暂停' : '播放'}
            aria-label={isCurrentArchiveSource && playerState.isPlaying ? '暂停' : '播放'}
          />
          <Button
            icon={<IconForward />}
            theme="borderless"
            onClick={() => playNextCard(false)}
            disabled={cards.length === 0}
            title="下一首"
            aria-label="下一首"
          />
        </div>

        <div className="player-extra">
          <span className="time-display">{formatDuration(currentTime)} / {formatDuration(duration)}</span>
          <Button
            icon={repeatMode === 'single-loop' ? <IconLoopTextStroked /> : repeatMode === 'random' ? <IconSync /> : <IconList />}
            theme="borderless"
            onClick={() => setRepeatMode(prev => getNextRepeatMode(prev))}
            title={getRepeatModeLabel(repeatMode)}
            aria-label={getRepeatModeLabel(repeatMode)}
          />
          <Button
            icon={<IconMusic />}
            theme="borderless"
            onClick={() => void handleOpenInAudioViewer()}
            disabled={!currentCard || !currentAudioUrl}
            title="打开普通音频播放器"
            aria-label="打开普通音频播放器"
          />
          <div className="volume-pop">
            <Button
              icon={playerState.isMuted ? <IconMute /> : playerState.volume < 0.5 ? <IconVolume1 /> : <IconVolume2 />}
              theme="borderless"
              size="small"
              onClick={() => {
                setMuted(!playerState.isMuted);
              }}
              title="静音"
              aria-label="静音"
            />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={playerState.isMuted ? 0 : playerState.volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="音量"
            />
          </div>
        </div>
      </footer>

      <Popover
        trigger="custom"
        visible={menuState.visible}
        onClickOutSide={closeContextMenu}
        position="bottomLeft"
        showArrow={false}
        spacing={4}
        getPopupContainer={() => document.body}
        content={(
          <ContextMenu
            items={contextMenuItems}
            className="directory-context-menu"
            onItemClick={closeContextMenu}
          />
        )}
      >
        <div
          style={{
            position: 'fixed',
            left: menuState.x,
            top: menuState.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        />
      </Popover>
    </AudioArchiveViewerWrapper>
  );
};

export default AudioArchiveViewer;
