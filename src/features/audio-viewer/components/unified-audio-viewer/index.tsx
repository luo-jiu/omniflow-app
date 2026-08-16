import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Popover, Spin } from '@douyinfe/semi-ui';
import {
  IconBackward,
  IconChevronDown,
  IconChevronUp,
  IconFastForward,
  IconList,
  IconLoopTextStroked,
  IconMore,
  IconMusic,
  IconPause,
  IconPlay,
  IconSort,
  IconSync,
} from '@douyinfe/semi-icons';
import {
  batchGetFileLinks,
  fetchArchiveCardsPage,
  getChildrenByNodeId,
} from '@/features/file-explorer/services/file.api';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { useGlobalAudioPlayback } from '@/features/file-viewer/hooks/useGlobalAudioPlayback';
import { isOwnedGlobalAudioPlaying } from '@/features/file-viewer/services/global-audio-retention';
import { useTimedText } from '@/features/file-viewer/timed-text/useTimedText';
import type { TimedTextCue } from '@/features/file-viewer/timed-text/subtitle';
import type {
  FileViewerSubtitleSource,
} from '@/contexts/file-viewer.context';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/context-menu';
import { useNodePropertiesOverlay } from '@/features/file-explorer/hooks/useNodePropertiesOverlay';
import {
  AUDIO_ARCHIVE_EMPTY_SIDECARS,
  buildBareAudioCard,
  buildSingleAudioFolderContent,
  buildAudioSubtitleSources,
  normalizeAudioArchiveMatchName,
  resolveAudioViewerMode,
  type AudioArchiveCard,
  type AudioArchiveChildNode,
  type AudioArchiveSidecarIndex,
} from './audio-viewer-content';
import { UnifiedAudioViewerWrapper } from './style';
import {
  ARCHIVE_CARD_SESSION_ESTIMATED_BYTES,
  ARCHIVE_CARD_SESSION_SCHEMA_VERSION,
  parseArchiveCardSessionSnapshot,
  resolveArchiveCardRestoreScrollTop,
  type ArchiveCardSessionSnapshot,
} from '@/features/archive-viewer/session/archive-card-session';
import { useViewerSession, type ViewerSessionAdapter } from '@/features/file-viewer/session';
import { MediaVolumeControl } from '@/features/file-viewer/components/media-volume-control';
import { AudioSpectrumVisualizer } from '@/features/file-viewer/components/audio-spectrum-visualizer';
import { useAudioSpectrumColors } from '@/features/file-viewer/components/audio-spectrum-visualizer/use-audio-spectrum-colors';
import {
  isTextEditingKeyboardTarget,
  isViewerInteractiveKeyboardTarget,
  releaseExternalKeyboardFocus,
} from '@/features/file-viewer/utils/media-keyboard-target';
import { useAudioCardPlayback } from './use-audio-card-playback';
import {
  AudioCover,
  ExpandedLyricsRoller,
} from './audio-viewer-presenters';

interface UnifiedAudioViewerProps {
  accountScope: string | null;
  contentRevision: string | null;
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  libraryId: number | null;
  active?: boolean;
  tabId: string;
  reloadToken?: number;
}

type AudioProgressStyle = React.CSSProperties & {
  '--player-progress-end': string;
  '--player-progress-start': string;
};

type AudioRepeatMode = 'order' | 'list-loop' | 'single-loop' | 'random';

const PAGE_SIZE = 60;
const LINK_EXPIRY_MINUTES = 120;
const BARE_AUDIO_SEEK_SECONDS = 10;
const BARE_AUDIO_FAST_SEEK_SECONDS = 30;
const AUDIO_VOLUME_STEP = 0.05;

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

function formatAudioDuration(durationSeconds?: number | null): string {
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

const UnifiedAudioViewer: React.FC<UnifiedAudioViewerProps> = ({
  accountScope,
  contentRevision,
  folderNodeId,
  fileUrl,
  fileName,
  libraryId,
  active = true,
  tabId,
  reloadToken = 0,
}) => {
  const viewerRootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const persistScrollRafRef = useRef<number>(0);
  const lastHandledEndedSerialRef = useRef(0);
  const coverClickTimerRef = useRef<number>(0);
  const pendingSeekTimeRef = useRef<number | null>(null);

  const title = useMemo(() => normalizeArchiveTitle(fileName), [fileName]);
  const playlistTitle = useMemo(() => formatPlaylistTitle(title), [title]);
  const viewerMode = resolveAudioViewerMode(fileUrl);
  const singleFolderMode = viewerMode === 'folder';
  const bareAudioMode = viewerMode === 'bare';
  const audioOwnerKey = useMemo(() => {
    if (!folderNodeId) return null;
    if (bareAudioMode) return `audio:node:${folderNodeId}`;
    return libraryId ? `audio-archive:${libraryId}:${folderNodeId}` : null;
  }, [bareAudioMode, folderNodeId, libraryId]);
  const { showNodeProperties } = useNodePropertiesOverlay({ libraryId });

  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedList, setHasLoadedList] = useState(false);
  const [cards, setCards] = useState<AudioArchiveCard[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [sessionRestoreRevision, setSessionRestoreRevision] = useState(0);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [currentCardId, setCurrentCardId] = useState<number | null>(null);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [repeatMode, setRepeatMode] = useState<AudioRepeatMode>('list-loop');
  const [expanded, setExpanded] = useState(singleFolderMode || bareAudioMode);
  const [seekingTime, setSeekingTime] = useState<number | null>(null);
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
  const spectrumColors = useAudioSpectrumColors(effectiveCard?.coverUrl);
  const {
    adjustVolumeBy,
    beginPlaybackRequest,
    cancelPlaybackRequest,
    ensureSource,
    getPlayerState,
    isOwnedSource,
    isPlaybackRequestCurrent,
    play,
    playerState,
    seekTo,
    setMuted,
    setVolume,
    togglePlay: toggleOwnedPlay,
  } = useGlobalAudioPlayback({ ownerType: 'default', ownerKey: audioOwnerKey, tabId, libraryId });
  const retentionPlaying = isOwnedGlobalAudioPlaying(playerState, tabId, libraryId);
  const isCurrentAudioSource = Boolean(
    isOwnedSource
    && currentAudioUrl
    && playerState.src === currentAudioUrl,
  );
  const currentTime = isCurrentAudioSource ? playerState.currentTime : 0;
  const duration = isCurrentAudioSource ? playerState.duration : 0;
  const visibleCurrentTime = seekingTime ?? currentTime;

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
    if (active) return;
    setMenuState(prev => (prev.visible ? { ...prev, visible: false } : prev));
  }, [active]);

  const cardElementMapRef = useRef<Map<number, HTMLElement>>(new Map());
  const cardsRef = useRef(cards);
  const selectedCardIdRef = useRef(selectedCardId);
  const activeRef = useRef(active);
  const hasLoadedListRef = useRef(hasLoadedList);
  const pendingSessionRestoreRef = useRef<ArchiveCardSessionSnapshot | null>(null);
  const pendingSessionResourceNodeIdRef = useRef<number | null>(null);
  const retentionPlayingRef = useRef(retentionPlaying);
  const restoreTriggeredLoadMoreRef = useRef(false);
  cardsRef.current = cards;
  selectedCardIdRef.current = selectedCardId;
  activeRef.current = active;
  hasLoadedListRef.current = hasLoadedList;

  const captureSessionSnapshot = useCallback((): ArchiveCardSessionSnapshot | null => {
    if (pendingSessionRestoreRef.current) return pendingSessionRestoreRef.current;
    if (!hasLoadedListRef.current) return null;
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const scrollTop = Math.max(viewport.scrollTop, 0);
    const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
    let anchorCardId: number | null = null;
    let anchorOffsetRatio = 0;
    for (const card of cardsRef.current) {
      const element = cardElementMapRef.current.get(card.id);
      if (!element || element.offsetTop > scrollTop + 1) continue;
      anchorCardId = card.id;
      anchorOffsetRatio = Math.min(
        Math.max((scrollTop - element.offsetTop) / Math.max(element.offsetHeight, 1), 0),
        1,
      );
    }
    if (anchorCardId == null && cardsRef.current.length > 0) anchorCardId = cardsRef.current[0].id;
    return {
      anchorCardId,
      anchorOffsetRatio,
      scrollRatio: maxScrollable > 0 ? scrollTop / maxScrollable : null,
      scrollTop,
      selectedCardId: selectedCardIdRef.current,
    };
  }, []);

  const restoreSessionSnapshot = useCallback((payload: ArchiveCardSessionSnapshot) => {
    const snapshot = parseArchiveCardSessionSnapshot(payload);
    if (!snapshot) return;
    pendingSessionRestoreRef.current = snapshot;
    pendingSessionResourceNodeIdRef.current = folderNodeId;
    setSelectedCardId(snapshot.selectedCardId);
    setSessionRestoreRevision(revision => revision + 1);
  }, [folderNodeId]);

  const sessionAdapter = useMemo<ViewerSessionAdapter<ArchiveCardSessionSnapshot>>(() => ({
    capture: captureSessionSnapshot,
    restore: restoreSessionSnapshot,
    suspend: () => undefined,
    resume: () => undefined,
    estimateSnapshotBytes: () => ARCHIVE_CARD_SESSION_ESTIMATED_BYTES,
    getPinReasons: () => {
      const reasons: Array<'active' | 'playing'> = [];
      if (activeRef.current) reasons.push('active');
      const audioState = getPlayerState();
      if (isOwnedGlobalAudioPlaying(audioState, tabId, libraryId)) {
        reasons.push('playing');
      }
      return reasons;
    },
  }), [captureSessionSnapshot, getPlayerState, libraryId, restoreSessionSnapshot, tabId]);

  const {
    capture: flushSessionSnapshot,
    notifyRetentionChanged,
  } = useViewerSession({
    accountScope: bareAudioMode ? null : accountScope,
    active,
    adapter: sessionAdapter,
    contentRevision,
    libraryId,
    nodeId: folderNodeId,
    reloadToken,
    schemaVersion: ARCHIVE_CARD_SESSION_SCHEMA_VERSION,
    tabId,
    viewerKind: bareAudioMode ? 'audio' : 'audio_archive',
  });

  useEffect(() => {
    if (retentionPlayingRef.current === retentionPlaying) return;
    retentionPlayingRef.current = retentionPlaying;
    notifyRetentionChanged();
  }, [notifyRetentionChanged, retentionPlaying]);

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

  const loadSingleFolder = useCallback(async () => {
    if (!folderNodeId || !libraryId || !Number.isFinite(folderNodeId)) return;
    const requestId = requestIdRef.current;
    setListLoading(true);
    setError(null);

    try {
      const children = await getChildrenByNodeId(folderNodeId, libraryId) as AudioArchiveChildNode[];
      if (requestId !== requestIdRef.current) return;
      const content = buildSingleAudioFolderContent({
        children,
        folderNodeId,
        libraryId,
        title,
      });
      if (!content) {
        setCards([]);
        setTotal(0);
        setError('当前音乐文件夹中没有可播放的音频');
        setActiveSubtitleSources(undefined);
        return;
      }

      const [card] = await resolveCardCoverUrls([content.card]);
      if (requestId !== requestIdRef.current) return;
      setCards(card ? [card] : []);
      setTotal(card ? 1 : 0);
      setSelectedCardId(card?.id ?? null);
      setActiveSubtitleSources(content.subtitleSources.length > 0 ? content.subtitleSources : undefined);
    } catch (loadError) {
      runtimeLogger.error('加载音乐文件夹失败:', loadError);
      if (requestId !== requestIdRef.current) return;
      setCards([]);
      setTotal(0);
      setError('加载音乐文件夹失败');
      setActiveSubtitleSources(undefined);
    } finally {
      if (requestId === requestIdRef.current) {
        setHasLoadedList(true);
        setListLoading(false);
        setLoadingMore(false);
        setNextOffset(0);
        setHasMore(false);
      }
    }
  }, [folderNodeId, libraryId, resolveCardCoverUrls, title]);

  const loadBareAudio = useCallback(() => {
    const card = buildBareAudioCard(Number(folderNodeId), title);
    if (!card) return;
    setCards([card]);
    setTotal(1);
    setSelectedCardId(card.id);
    setActiveSubtitleSources(undefined);
    setHasLoadedList(true);
    setListLoading(false);
    setLoadingMore(false);
    setNextOffset(0);
    setHasMore(false);
  }, [folderNodeId, title]);

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

  const handlePlaybackStarted = useCallback(({
    card,
    endedSerial,
    subtitleSources,
    url,
  }: {
    card: AudioArchiveCard;
    endedSerial: number;
    subtitleSources: FileViewerSubtitleSource[] | undefined;
    url: string;
  }) => {
    setCurrentCardId(card.id);
    setSelectedCardId(card.id);
    setCurrentAudioUrl(url);
    setActiveSubtitleSources(subtitleSources);
    lastHandledEndedSerialRef.current = endedSerial;
  }, []);
  const getEndedSerial = useCallback(
    () => getPlayerState().endedSerial,
    [getPlayerState],
  );

  const {
    cancelPendingPlayback,
    playCard,
    restartCard,
  } = useAudioCardPlayback({
    audioOwnerKey,
    bareAudioMode,
    beginPlaybackRequest,
    cancelPlaybackRequest,
    ensureSource,
    fileUrl,
    getEndedSerial,
    libraryId,
    isPlaybackRequestCurrent,
    loadSubtitleSources: loadCardSubtitleSources,
    onStarted: handlePlaybackStarted,
    play,
    seekTo,
  });

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

  const seekBareAudioBy = useCallback((deltaSeconds: number) => {
    if (!isCurrentAudioSource || duration <= 0) return;
    seekTo(Math.min(Math.max(currentTime + deltaSeconds, 0), duration));
  }, [currentTime, duration, isCurrentAudioSource, seekTo]);

  const togglePlay = useCallback(() => {
    if (isCurrentAudioSource) {
      void toggleOwnedPlay().catch((playError) => {
        runtimeLogger.error('切换音频播放失败:', playError);
      });
      return;
    }
    if (effectiveCard) {
      void playCard(effectiveCard);
    }
  }, [effectiveCard, isCurrentAudioSource, playCard, toggleOwnedPlay]);

  useEffect(() => {
    if (!active || !bareAudioMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEditingKeyboardTarget(event.target)) return;
      if (isViewerInteractiveKeyboardTarget(event.target, viewerRootRef.current)) return;
      let handled = true;
      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          if (!event.repeat) togglePlay();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seekBareAudioBy(event.shiftKey ? -BARE_AUDIO_FAST_SEEK_SECONDS : -BARE_AUDIO_SEEK_SECONDS);
          break;
        case 'ArrowRight':
          event.preventDefault();
          seekBareAudioBy(event.shiftKey ? BARE_AUDIO_FAST_SEEK_SECONDS : BARE_AUDIO_SEEK_SECONDS);
          break;
        case 'ArrowUp':
          event.preventDefault();
          adjustVolumeBy(AUDIO_VOLUME_STEP);
          break;
        case 'ArrowDown':
          event.preventDefault();
          adjustVolumeBy(-AUDIO_VOLUME_STEP);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          if (!event.repeat) setMuted(!playerState.isMuted);
          break;
        default:
          handled = false;
      }
      if (!handled) return;
      event.stopPropagation();
      releaseExternalKeyboardFocus(event.target, viewerRootRef.current);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    active,
    adjustVolumeBy,
    bareAudioMode,
    playerState.isMuted,
    seekBareAudioBy,
    setMuted,
    togglePlay,
  ]);

  const handleCardPlayButtonClick = useCallback((card: AudioArchiveCard) => {
    cancelPendingPlayback();
    clearPendingCoverClick();
    coverClickTimerRef.current = window.setTimeout(() => {
      coverClickTimerRef.current = 0;
      setSelectedCardId(card.id);
      if (card.id === currentCardId && isCurrentAudioSource) {
        void toggleOwnedPlay().catch((playError) => {
          runtimeLogger.error('切换音频播放失败:', playError);
        });
        return;
      }
      void playCard(card);
    }, 180);
  }, [cancelPendingPlayback, clearPendingCoverClick, currentCardId, isCurrentAudioSource, playCard, toggleOwnedPlay]);

  const handleCardRestart = useCallback((card: AudioArchiveCard) => {
    clearPendingCoverClick();
    setSelectedCardId(card.id);
    void restartCard(card);
  }, [clearPendingCoverClick, restartCard]);

  const handleLyricJump = useCallback((cue: TimedTextCue) => {
    const targetTime = Math.max(cue.start + 0.01, 0);
    if (isCurrentAudioSource) {
      seekTo(targetTime);
      if (!playerState.isPlaying) {
        void play().catch((playError) => {
          runtimeLogger.error('点击歌词播放失败:', playError);
        });
      }
      return;
    }
    if (!effectiveCard) return;
    void playCard(effectiveCard).then((started) => {
      if (started) seekTo(targetTime);
    });
  }, [effectiveCard, isCurrentAudioSource, play, playCard, playerState.isPlaying, seekTo]);

  const updatePendingSeek = useCallback((nextTime: number) => {
    const normalizedTime = Math.min(Math.max(nextTime, 0), Math.max(duration, 0));
    pendingSeekTimeRef.current = normalizedTime;
    setSeekingTime(normalizedTime);
  }, [duration]);

  const commitPendingSeek = useCallback(() => {
    const targetTime = pendingSeekTimeRef.current;
    pendingSeekTimeRef.current = null;
    setSeekingTime(null);
    if (targetTime === null || !isCurrentAudioSource || duration <= 0) return;
    seekTo(targetTime);
  }, [duration, isCurrentAudioSource, seekTo]);

  const cancelPendingSeek = useCallback(() => {
    pendingSeekTimeRef.current = null;
    setSeekingTime(null);
  }, []);

  useEffect(() => {
    cancelPendingSeek();
  }, [cancelPendingSeek, currentAudioUrl]);

  useEffect(() => {
    if (bareAudioMode) return;
    if (!isCurrentAudioSource) return;
    if (playerState.endedSerial <= 0 || playerState.endedSerial === lastHandledEndedSerialRef.current) return;
    lastHandledEndedSerialRef.current = playerState.endedSerial;
    playNextCard(true);
  }, [bareAudioMode, isCurrentAudioSource, playNextCard, playerState.endedSerial]);

  useEffect(() => {
    requestIdRef.current += 1;
    cancelPendingPlayback();
    cardElementMapRef.current.clear();
    restoreTriggeredLoadMoreRef.current = false;
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
    if (pendingSessionResourceNodeIdRef.current !== folderNodeId) {
      pendingSessionRestoreRef.current = null;
    }

    setHasLoadedList(false);
    setCards([]);
    setNextOffset(0);
    setTotal(0);
    setHasMore(false);
    setError(null);
    setCurrentCardId(null);
    setSelectedCardId(pendingSessionRestoreRef.current?.selectedCardId ?? null);
    setCurrentAudioUrl(null);
    setActiveSubtitleSources(undefined);
    setExpanded(singleFolderMode || bareAudioMode);
    if (bareAudioMode) {
      loadBareAudio();
    } else if (singleFolderMode) {
      void loadSingleFolder();
    } else {
      void loadPage(0, false);
    }
  }, [
    bareAudioMode,
    cancelPendingPlayback,
    folderNodeId,
    libraryId,
    loadBareAudio,
    loadPage,
    loadSingleFolder,
    singleFolderMode,
  ]);

  useEffect(() => {
    if (!active) return;
    const viewport = viewportRef.current;
    const pending = pendingSessionRestoreRef.current;
    if (!viewport || !pending || !hasLoadedList) return;
    const anchorElement = pending.anchorCardId == null
      ? null
      : cardElementMapRef.current.get(pending.anchorCardId) ?? null;
    if (!anchorElement && pending.anchorCardId && hasMore && !listLoading && !loadingMore) {
      if (!restoreTriggeredLoadMoreRef.current) {
        restoreTriggeredLoadMoreRef.current = true;
        void loadPage(nextOffset, true).finally(() => {
          restoreTriggeredLoadMoreRef.current = false;
        });
      }
      return;
    }
    if (!anchorElement && pending.anchorCardId && (listLoading || loadingMore)) return;
    const frame = window.requestAnimationFrame(() => {
      const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
      viewport.scrollTop = resolveArchiveCardRestoreScrollTop({
        anchorHeight: anchorElement?.offsetHeight ?? null,
        anchorOffsetTop: anchorElement?.offsetTop ?? null,
        maxScrollable,
        snapshot: pending,
      });
      pendingSessionRestoreRef.current = null;
      flushSessionSnapshot();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    active,
    cards.length,
    flushSessionSnapshot,
    hasLoadedList,
    hasMore,
    listLoading,
    loadPage,
    loadingMore,
    nextOffset,
    sessionRestoreRevision,
  ]);

  useEffect(() => {
    if (!hasLoadedList) return;
    flushSessionSnapshot();
  }, [flushSessionSnapshot, hasLoadedList, selectedCardId]);

  useEffect(() => {
    if (!isOwnedSource || !libraryId || cards.length === 0 || !playerState.src) return;
    const playingNodeId = playerState.sourceNodeId;
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
      if (
        latestState.src !== playerState.src
        || latestState.sourceNodeId !== playingNodeId
        || latestState.ownerKey !== audioOwnerKey
        || latestState.tabId !== tabId
      ) return;
      setActiveSubtitleSources(sources);
    });
  }, [
    cards,
    currentAudioUrl,
    currentCardId,
    getPlayerState,
    isOwnedSource,
    libraryId,
    loadCardSubtitleSources,
    audioOwnerKey,
    playerState.sourceNodeId,
    playerState.src,
    tabId,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleScroll = () => {
      if (persistScrollRafRef.current) return;
      persistScrollRafRef.current = window.requestAnimationFrame(() => {
        persistScrollRafRef.current = 0;
        if (pendingSessionRestoreRef.current) pendingSessionRestoreRef.current = null;
        flushSessionSnapshot();
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
  }, [flushSessionSnapshot]);

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

  const progressPercent = duration > 0
    ? Math.min(Math.max((visibleCurrentTime / duration) * 100, 0), 100)
    : 0;

  // MediaHub 注册由 globalAudioPlayer 服务层完成；详见 docs/media-hub-contract.md。
  // 关闭归档 tab 时必须由 FileViewerContext.releaseForTab 释放，不能依赖组件卸载。

  useEffect(() => {
    return () => {
      clearPendingCoverClick();
    };
  }, [clearPendingCoverClick]);

  return (
    <UnifiedAudioViewerWrapper ref={viewerRootRef} className={expanded ? 'is-expanded' : ''}>
      {expanded && (
        <section className="expanded-player" aria-label="展开播放器">
          {listLoading ? (
            <div className="expanded-state">
              <Spin size="large" tip="音乐加载中..." />
            </div>
          ) : error ? (
            <div className="expanded-state state-error">{error}</div>
          ) : (
            <>
              <div className="expanded-cover-wrap">
                <AudioCover
                  coverUrl={effectiveCard?.coverUrl}
                  title={effectiveCard?.title || '音频'}
                  className="large"
                  showPlaceholder={!bareAudioMode}
                />
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
                    isOwnedSource={isCurrentAudioSource}
                    isPlaying={playerState.isPlaying}
                    onLyricJump={handleLyricJump}
                    subtitleCues={subtitleCues}
                    subtitleError={subtitleError}
                    emptyText={bareAudioMode ? '暂无歌词' : undefined}
                  />
                </div>
              </div>
              <div className="expanded-spectrum">
                <AudioSpectrumVisualizer
                  colors={spectrumColors}
                  enabled={Boolean(active && isCurrentAudioSource)}
                  isPlaying={playerState.isPlaying}
                  url={currentAudioUrl || ''}
                />
              </div>
            </>
          )}
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
                const activeRow = card.id === currentCardId && isCurrentAudioSource;
                const playingRow = activeRow && playerState.isPlaying;
                const selectedRow = card.id === selectedCardId;
                return (
                  <article
                    key={card.id}
                    ref={(element) => {
                      if (element) {
                        cardElementMapRef.current.set(card.id, element);
                      } else {
                        cardElementMapRef.current.delete(card.id);
                      }
                    }}
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
                    <span className="song-duration">{formatAudioDuration(card.durationSeconds)}</span>
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
        <div
          className="player-progress"
          style={{
            '--player-progress-end': spectrumColors.primary,
            '--player-progress-start': spectrumColors.mirrored,
          } as AudioProgressStyle}
        >
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0)}
            step={0.1}
            value={Math.min(visibleCurrentTime, Math.max(duration, 0))}
            disabled={!isCurrentAudioSource || duration <= 0}
            onChange={(event) => updatePendingSeek(Number(event.currentTarget.value))}
            onPointerUp={commitPendingSeek}
            onPointerCancel={cancelPendingSeek}
            onKeyUp={commitPendingSeek}
            onBlur={commitPendingSeek}
            aria-label="播放进度"
          />
          <span className="player-progress-track" aria-hidden="true">
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        </div>
        <button
          type="button"
          className="player-brief"
          disabled={bareAudioMode}
          onClick={bareAudioMode ? undefined : () => setExpanded(prev => !prev)}
          title={bareAudioMode ? effectiveCard?.title : expanded ? '收起播放器' : '展开播放器'}
          aria-label={bareAudioMode ? effectiveCard?.title || '当前音频' : expanded ? '收起播放器' : '展开播放器'}
        >
          <span className="player-cover-trigger">
            <AudioCover
              coverUrl={effectiveCard?.coverUrl}
              title={effectiveCard?.title || '音频'}
              className="mini"
              showPlaceholder={!bareAudioMode}
            />
            {!bareAudioMode && (
              <span className="player-cover-toggle" aria-hidden="true">
                {expanded ? <IconChevronDown /> : <IconChevronUp />}
              </span>
            )}
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
            onClick={bareAudioMode ? () => seekBareAudioBy(-10) : playPrevCard}
            disabled={bareAudioMode ? !isCurrentAudioSource : cards.length === 0}
            title={bareAudioMode ? '后退 10 秒' : '上一首'}
            aria-label={bareAudioMode ? '后退 10 秒' : '上一首'}
          />
          <Button
            className="play-main"
            icon={isCurrentAudioSource && playerState.isPlaying ? <IconPause /> : <IconPlay />}
            theme="solid"
            shape="circle"
            onClick={togglePlay}
            disabled={cards.length === 0}
            title={isCurrentAudioSource && playerState.isPlaying ? '暂停' : '播放'}
            aria-label={isCurrentAudioSource && playerState.isPlaying ? '暂停' : '播放'}
          />
          <Button
            icon={<IconFastForward />}
            theme="borderless"
            onClick={bareAudioMode ? () => seekBareAudioBy(10) : () => playNextCard(false)}
            disabled={bareAudioMode ? !isCurrentAudioSource : cards.length === 0}
            title={bareAudioMode ? '前进 10 秒' : '下一首'}
            aria-label={bareAudioMode ? '前进 10 秒' : '下一首'}
          />
        </div>

        <div className="player-extra">
          <span className="time-display">{formatAudioDuration(visibleCurrentTime)} / {formatAudioDuration(duration)}</span>
          {!bareAudioMode && (
            <Button
              icon={repeatMode === 'single-loop' ? <IconLoopTextStroked /> : repeatMode === 'random' ? <IconSync /> : <IconList />}
              theme="borderless"
              onClick={() => setRepeatMode(prev => getNextRepeatMode(prev))}
              title={getRepeatModeLabel(repeatMode)}
              aria-label={getRepeatModeLabel(repeatMode)}
            />
          )}
          <MediaVolumeControl
            muted={playerState.isMuted}
            volume={playerState.volume}
            onMutedChange={setMuted}
            onVolumeChange={setVolume}
          />
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
    </UnifiedAudioViewerWrapper>
  );
};

export default UnifiedAudioViewer;
