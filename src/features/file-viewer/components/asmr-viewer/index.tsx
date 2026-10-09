import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconEdit,
  IconBackward,
  IconFastForward,
  IconPlay,
  IconPause,
  IconMusic,
} from '@douyinfe/semi-icons';
import { Button, Input, Modal, Spin, Toast } from '@douyinfe/semi-ui';
import {
  fetchNodeDetailById,
  getChildrenByNodeId,
  getFileLink,
} from '@/features/file-explorer/services/file.api';
import { queryLibraryTags, readNodeTags, type TagItem } from '@/features/tag-management/services/tag.api';
import { getFileNodeIcon, isImageExtension } from '@/features/file-explorer/utils/file-node-icon';
import { resolveNodeFileIdentity } from '@/features/file-identity';
import { AsmrCoverPickerList, AsmrViewerWrapper } from './style';
import { useFileViewer } from '@/hooks/useFileViewer';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { parseAsmrRouteInfo, resolveAsmrOwnerKey } from '@/features/file-viewer/utils/asmr-owner-key';
import type { PreviewFileType } from '@/utils/preview-file-type';
import { useGlobalAudioPlayback } from '@/features/file-viewer/hooks/useGlobalAudioPlayback';
import { isOwnedGlobalAudioPlaying } from '@/features/file-viewer/services/global-audio-retention';
import {
  ASMR_VIEWER_SESSION_ESTIMATED_BYTES,
  ASMR_VIEWER_SESSION_SCHEMA_VERSION,
  parseAsmrViewerSessionSnapshot,
  type AsmrNodeItem,
  type AsmrPathItem,
  type AsmrViewMetaPayload,
  type AsmrViewerSessionSnapshot,
} from './asmr-viewer-session';
import { useViewerSession, type ViewerSessionAdapter } from '@/features/file-viewer/session';
import { MediaVolumeControl } from '@/features/file-viewer/components/media-volume-control';
import { useAudioSpectrumColors } from '@/features/file-viewer/components/audio-spectrum-visualizer/use-audio-spectrum-colors';
import { AudioDockMeteor, type AudioDockMeteorEvent } from '@/features/audio-viewer/components/unified-audio-viewer/AudioDockMeteor';
import { AudioDockProgress } from '@/features/audio-viewer/components/unified-audio-viewer/audio-dock-progress';
import OutlineIcon from '@/components/ui/outline-icon';
import { API_CONFIG } from '@/config/api';
import { matchesLibraryMutationScope, notifyLibraryNodesMutated, subscribeLibraryNodesMutated } from '@/features/file-explorer/services/node-mutation-events';
import { LibraryTagPicker } from '@/features/tag-management/components/LibraryTagPicker';
import { saveAsmrMetadata, type AsmrMetadataDraft } from './asmr-metadata-editor';

interface AsmrViewerProps {
  accountScope: string | null;
  contentRevision: string | null;
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  libraryId: number | null;
  active?: boolean;
  reloadToken?: number;
  tabId: string;
}

const NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});

function normalizeExt(ext?: string): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

function isDirectoryNode(item: AsmrNodeItem): boolean {
  return String(item.type) === 'dir' || Number(item.type) === 0;
}

function sortNodes(items: AsmrNodeItem[]): AsmrNodeItem[] {
  return [...items].sort((a, b) => {
    const aDir = isDirectoryNode(a);
    const bDir = isDirectoryNode(b);
    if (aDir !== bDir) {
      return aDir ? -1 : 1;
    }
    return NAME_COLLATOR.compare(String(a.name || ''), String(b.name || ''));
  });
}

function resolveDisplayName(item: AsmrNodeItem): string {
  if (isDirectoryNode(item)) {
    return item.name;
  }
  const ext = normalizeExt(item.ext);
  if (!ext) {
    return item.name;
  }
  return `${item.name}.${ext}`;
}

function formatFileSize(size?: number): string {
  const bytes = Number(size || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function resolveRowType(item: AsmrNodeItem): string {
  if (isDirectoryNode(item)) return '文件夹';
  const ext = normalizeExt(item.ext);
  if (ext) return ext.toUpperCase();
  return item.mimeType || '文件';
}

function resolveFileType(item: AsmrNodeItem): PreviewFileType {
  return resolveNodeFileIdentity({
    mimeType: item.mimeType,
    ext: item.ext,
    name: item.name,
    parentBuiltInType: 'AUDIO',
    parentArchiveMode: 1,
  }).previewKind;
}

function isImageFile(item: AsmrNodeItem): boolean {
  if (isDirectoryNode(item)) return false;
  if (item.mimeType?.startsWith('image/')) return true;
  return isImageExtension(item.ext);
}

function normalizeViewerTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return 'ASMR 集合';
  if (raw.toUpperCase().startsWith('ASMR ·')) {
    const parts = raw.split('·');
    if (parts.length >= 2) {
      const right = parts.slice(1).join('·').trim();
      if (right) return right;
    }
  }
  return raw;
}

function parseViewMeta(raw?: string | null): AsmrViewMetaPayload {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AsmrViewMetaPayload;
    }
  } catch {
    return {};
  }
  return {};
}

function sanitizeMetaText(input: string): string {
  return String(input || '').trim();
}

function resolveMetaNumber(input: unknown): number | null {
  const next = Number(input);
  return Number.isFinite(next) && next > 0 ? next : null;
}

function resolveMetaNumberList(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const result: number[] = [];
  input.forEach((item) => {
    const next = resolveMetaNumber(item);
    if (next !== null && !result.includes(next)) {
      result.push(next);
    }
  });
  return result;
}

function formatDuration(time: number): string {
  if (!Number.isFinite(time)) return '00:00';
  const minutes = Math.floor(Math.max(time, 0) / 60);
  const seconds = Math.floor(Math.max(time, 0) % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const AsmrViewer: React.FC<AsmrViewerProps> = ({
  accountScope,
  contentRevision,
  folderNodeId,
  fileUrl,
  fileName,
  libraryId: libraryIdProp,
  active = true,
  reloadToken = 0,
  tabId,
}) => {
  const { setFileUrl } = useFileViewer();
  const routeInfo = useMemo(() => parseAsmrRouteInfo(fileUrl), [fileUrl]);
  const libraryId = useMemo(() => {
    if (libraryIdProp && Number.isFinite(libraryIdProp)) return libraryIdProp;
    return routeInfo?.libraryId ?? null;
  }, [libraryIdProp, routeInfo?.libraryId]);
  const rootNodeId = useMemo(() => {
    const fromProp = Number(folderNodeId);
    if (Number.isFinite(fromProp) && fromProp > 0) {
      return fromProp;
    }
    const fromRoute = Number(routeInfo?.nodeId);
    if (Number.isFinite(fromRoute) && fromRoute > 0) {
      return fromRoute;
    }
    return null;
  }, [folderNodeId, routeInfo?.nodeId]);
  const fallbackTitle = useMemo(() => normalizeViewerTitle(fileName), [fileName]);
  const asmrOwnerKey = useMemo(() => resolveAsmrOwnerKey(fileUrl, rootNodeId), [fileUrl, rootNodeId]);

  const [pathStack, setPathStack] = useState<AsmrPathItem[]>([]);
  const [items, setItems] = useState<AsmrNodeItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [collectionName, setCollectionName] = useState<string>(fallbackTitle);
  const [legacyTagText, setLegacyTagText] = useState('');
  const [collectionTagIds, setCollectionTagIds] = useState<number[]>([]);
  const [collectionSn, setCollectionSn] = useState<string>('');
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [audioQueue, setAudioQueue] = useState<AsmrNodeItem[]>([]);
  const [currentAudioId, setCurrentAudioId] = useState<number | null>(null);
  const [currentAudioSrc, setCurrentAudioSrc] = useState<string | null>(null);
  const [seekingTime, setSeekingTime] = useState<number | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorName, setEditorName] = useState('');
  const [editorTagIds, setEditorTagIds] = useState<number[]>([]);
  const [editorSn, setEditorSn] = useState('');
  const [editorCoverNodeId, setEditorCoverNodeId] = useState<number | null>(null);
  const [asmrTagOptions, setAsmrTagOptions] = useState<TagItem[]>([]);
  const editorBaselineRef = useRef<AsmrMetadataDraft | null>(null);
  const editorRequestIdRef = useRef(0);
  const editorSavingRef = useRef(false);
  useEffect(() => {
    editorRequestIdRef.current += 1;
    editorBaselineRef.current = null;
    editorSavingRef.current = false;
    setEditorVisible(false);
    setEditorSaving(false);
    return () => { editorRequestIdRef.current += 1; };
  }, [accountScope, libraryId, rootNodeId]);
  const [coverPickerPathStack, setCoverPickerPathStack] = useState<AsmrPathItem[]>([]);
  const [coverPickerItems, setCoverPickerItems] = useState<AsmrNodeItem[]>([]);
  const [coverPickerLoading, setCoverPickerLoading] = useState(false);
  const {
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
  } = useGlobalAudioPlayback({ ownerType: 'asmr', ownerKey: asmrOwnerKey, tabId, libraryId });
  const retentionPlaying = isOwnedGlobalAudioPlaying(playerState, tabId, libraryId);
  const spectrumColors = useAudioSpectrumColors(coverUrl);
  const [meteor, setMeteor] = useState<AudioDockMeteorEvent | null>(null);
  const meteorSerialRef = useRef(0);
  const progressVisualRef = useRef({ fromColor: spectrumColors.primary, ratio: 0 });
  const lastHandledEndedSerialRef = useRef(playerState.endedSerial);
  const pendingMeteorRef = useRef<Omit<AudioDockMeteorEvent, 'id' | 'src'> | null>(null);

  useEffect(() => {
    if (active) return;
    setEditorVisible(false);
    setMeteor(null);
  }, [active]);

  const listRequestIdRef = useRef(0);
  const coverRequestIdRef = useRef(0);
  const coverPickerRequestIdRef = useRef(0);
  const audioUrlCacheRef = useRef<Map<number, string>>(new Map());
  const activePlaybackRequestIdRef = useRef<number | null>(null);
  const listViewportRef = useRef<HTMLDivElement | null>(null);
  const rowElementMapRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const pathStackRef = useRef(pathStack);
  const itemsRef = useRef(items);
  const selectedIdRef = useRef(selectedId);
  const currentAudioIdRef = useRef(currentAudioId);
  const currentAudioParentNodeIdRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const isOwnedSourceRef = useRef(isOwnedSource);
  const playerSrcRef = useRef(playerState.src);
  const retentionPlayingRef = useRef(retentionPlaying);
  const hasLoadedListRef = useRef(false);
  const pendingSessionRestoreRef = useRef<AsmrViewerSessionSnapshot | null>(null);
  const listScrollCaptureRafRef = useRef(0);
  pathStackRef.current = pathStack;
  itemsRef.current = items;
  selectedIdRef.current = selectedId;
  currentAudioIdRef.current = currentAudioId;
  activeRef.current = active;
  isOwnedSourceRef.current = isOwnedSource;
  playerSrcRef.current = playerState.src;

  const captureSessionSnapshot = useCallback((): AsmrViewerSessionSnapshot | null => {
    if (pendingSessionRestoreRef.current) return pendingSessionRestoreRef.current;
    if (!hasLoadedListRef.current || pathStackRef.current.length === 0) return null;
    const viewport = listViewportRef.current;
    const scrollTop = Math.max(viewport?.scrollTop ?? 0, 0);
    const maxScrollable = viewport
      ? Math.max(viewport.scrollHeight - viewport.clientHeight, 0)
      : 0;
    let anchorItemId: number | null = null;
    let anchorOffsetRatio = 0;
    for (const item of itemsRef.current) {
      const element = rowElementMapRef.current.get(item.id);
      if (!element || element.offsetTop > scrollTop + 1) continue;
      anchorItemId = item.id;
      anchorOffsetRatio = Math.min(
        Math.max((scrollTop - element.offsetTop) / Math.max(element.offsetHeight, 1), 0),
        1,
      );
    }
    if (anchorItemId == null && itemsRef.current.length > 0) {
      anchorItemId = itemsRef.current[0].id;
    }
    return {
      currentAudioId: currentAudioIdRef.current,
      currentAudioParentNodeId: currentAudioIdRef.current == null
        ? null
        : currentAudioParentNodeIdRef.current,
      listAnchorItemId: anchorItemId,
      listAnchorOffsetRatio: anchorOffsetRatio,
      listScrollRatio: maxScrollable > 0 ? scrollTop / maxScrollable : null,
      listScrollTop: scrollTop,
      pathStack: pathStackRef.current,
      selectedId: selectedIdRef.current,
    };
  }, []);

  const restoreSessionSnapshot = useCallback((payload: AsmrViewerSessionSnapshot) => {
    const snapshot = parseAsmrViewerSessionSnapshot(payload);
    if (!snapshot || snapshot.pathStack[0]?.id !== rootNodeId) return;
    pendingSessionRestoreRef.current = snapshot;
  }, [rootNodeId]);

  const sessionAdapter = useMemo<ViewerSessionAdapter<AsmrViewerSessionSnapshot>>(() => ({
    capture: captureSessionSnapshot,
    restore: restoreSessionSnapshot,
    suspend: () => undefined,
    resume: () => undefined,
    estimateSnapshotBytes: () => ASMR_VIEWER_SESSION_ESTIMATED_BYTES,
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
    waitForInitialRestore,
  } = useViewerSession({
    accountScope,
    active,
    adapter: sessionAdapter,
    contentRevision,
    libraryId,
    nodeId: rootNodeId,
    reloadToken,
    schemaVersion: ASMR_VIEWER_SESSION_SCHEMA_VERSION,
    tabId,
    viewerKind: 'asmr',
  });

  useEffect(() => {
    if (retentionPlayingRef.current === retentionPlaying) return;
    retentionPlayingRef.current = retentionPlaying;
    notifyRetentionChanged();
  }, [notifyRetentionChanged, retentionPlaying]);

  const relativePath = useMemo(() => {
    const segments = pathStack.slice(1).map(item => item.name);
    if (segments.length === 0) return 'ROOT/';
    return `ROOT/${segments.join('/')}/`;
  }, [pathStack]);

  const currentAudioQueueIndex = useMemo(
    () => audioQueue.findIndex(item => item.id === currentAudioId),
    [audioQueue, currentAudioId],
  );
  const asmrTagOptionMap = useMemo(() => {
    const map = new Map<number, TagItem>();
    asmrTagOptions.forEach((option) => {
      map.set(option.id, option);
    });
    return map;
  }, [asmrTagOptions]);
  const selectedTagItems = useMemo(() => collectionTagIds.map(id => {
    const tag = asmrTagOptionMap.get(id);
    return { id, name: tag ? `${tag.name}${tag.deleted ? '（已删除）' : tag.enabled === 0 ? '（已停用）' : ''}` : `#${id}`,
      color: tag?.color, textColor: tag?.textColor };
  }), [asmrTagOptionMap, collectionTagIds]);
  const title = sanitizeMetaText(collectionName) || fallbackTitle;
  const hasPrevAudio = currentAudioQueueIndex > 0;
  const hasNextAudio = currentAudioQueueIndex >= 0 && currentAudioQueueIndex < audioQueue.length - 1;
  const visibleCurrentTime = seekingTime ?? playerState.currentTime;
  const isCurrentAudioSource = Boolean(
    isOwnedSource
    && currentAudioSrc
    && playerState.src === currentAudioSrc
  );
  const showPlayerProgress = Boolean(
    currentAudioId !== null
    && isCurrentAudioSource
    && Number.isFinite(playerState.duration)
    && playerState.duration > 0
  );
  const showMeteor = Boolean(
    meteor
    && active
    && currentAudioId !== null
    && currentAudioSrc
    && meteor.src === currentAudioSrc
  );
  progressVisualRef.current = {
    fromColor: spectrumColors.primary,
    ratio: playerState.duration > 0 ? Math.min(Math.max(playerState.currentTime / playerState.duration, 0), 1) : 0,
  };
  const currentTrackName = useMemo(() => {
    if (currentAudioQueueIndex >= 0) {
      const active = audioQueue[currentAudioQueueIndex];
      return resolveDisplayName(active);
    }
    return playerState.trackName || '未选择音频';
  }, [audioQueue, currentAudioQueueIndex, playerState.trackName]);

  const loadDirectory = useCallback(async (targetNodeId: number, nextPathStack: AsmrPathItem[]) => {
    if (!libraryId) {
      setListError('ASMR 目录参数异常');
      setItems([]);
      return { items: [] as AsmrNodeItem[], success: false };
    }

    const requestId = ++listRequestIdRef.current;
    setListLoading(true);
    setListError(null);

    try {
      const children = (await getChildrenByNodeId(targetNodeId, libraryId)) as AsmrNodeItem[];
      if (requestId !== listRequestIdRef.current) {
        return { items: [] as AsmrNodeItem[], success: false };
      }
      const sorted = sortNodes(children || []);
      setPathStack(nextPathStack);
      setItems(sorted);
      setSelectedId(null);
      return { items: sorted, success: true };
    } catch (error) {
      runtimeLogger.error('加载 ASMR 目录失败:', error);
      if (requestId === listRequestIdRef.current) {
        setListError('加载目录失败');
      }
      return { items: [] as AsmrNodeItem[], success: false };
    } finally {
      if (requestId === listRequestIdRef.current) {
        setListLoading(false);
      }
    }
  }, [libraryId]);

  const resolveAudioUrl = useCallback(async (item: AsmrNodeItem): Promise<string> => {
    const cached = audioUrlCacheRef.current.get(item.id);
    if (cached) {
      return cached;
    }
    if (!libraryId) {
      throw new Error('ASMR 目录参数异常');
    }
    const url = await getFileLink(item.id, libraryId, 60);
    if (!url) {
      throw new Error('无法获取音频访问地址');
    }
    audioUrlCacheRef.current.set(item.id, url);
    return url;
  }, [libraryId]);

  const cancelPendingAudioPlayback = useCallback(() => {
    const requestId = activePlaybackRequestIdRef.current;
    activePlaybackRequestIdRef.current = null;
    if (requestId !== null) cancelPlaybackRequest(requestId);
  }, [cancelPlaybackRequest]);

  useEffect(() => cancelPendingAudioPlayback, [
    asmrOwnerKey,
    cancelPendingAudioPlayback,
    libraryId,
  ]);

  const playAudioInAsmr = useCallback(async (
    targetAudio: AsmrNodeItem,
    queue: AsmrNodeItem[],
    parentNodeId?: number | null,
    options?: { animateTransition?: boolean },
  ) => {
    const requestId = beginPlaybackRequest();
    activePlaybackRequestIdRef.current = requestId;
    try {
      const url = await resolveAudioUrl(targetAudio);
      if (!isPlaybackRequestCurrent(requestId)) return;
      const previousState = getPlayerState();
      const shouldAnimate = Boolean(
        options?.animateTransition
        && previousState.src
        && previousState.duration > 0
      );
      pendingMeteorRef.current = shouldAnimate
        ? { ...progressVisualRef.current }
        : null;
      const claimed = ensureSource(
        url,
        resolveDisplayName(targetAudio),
        null,
        targetAudio.id,
        requestId,
      );
      if (!claimed) return;
      const started = await play(requestId);
      if (!started || !isPlaybackRequestCurrent(requestId)) return;
      setAudioQueue(queue);
      setCurrentAudioId(targetAudio.id);
      currentAudioParentNodeIdRef.current = parentNodeId
        ?? currentAudioParentNodeIdRef.current
        ?? pathStackRef.current[pathStackRef.current.length - 1]?.id
        ?? null;
      setCurrentAudioSrc(url);
      setSelectedId(targetAudio.id);
      setSeekingTime(null);
      const previous = pendingMeteorRef.current;
      pendingMeteorRef.current = null;
      setMeteor(previous
        ? { ...previous, id: ++meteorSerialRef.current, src: url }
        : null);
    } catch (error: any) {
      if (!isPlaybackRequestCurrent(requestId)) return;
      runtimeLogger.error('ASMR 音频播放失败:', error);
      Toast.error(error?.message || '播放音频失败');
    } finally {
      if (activePlaybackRequestIdRef.current === requestId) {
        activePlaybackRequestIdRef.current = null;
      }
    }
  }, [
    beginPlaybackRequest,
    ensureSource,
    getPlayerState,
    isPlaybackRequestCurrent,
    play,
    resolveAudioUrl,
  ]);

  const resolveCover = useCallback(async (
    rootChildren: AsmrNodeItem[],
    preferredCoverNodeId?: number | null,
  ) => {
    if (!libraryId) {
      setCoverUrl(null);
      setCoverLoading(false);
      return;
    }

    const preferredId = resolveMetaNumber(preferredCoverNodeId);
    const fallbackCover = rootChildren.find(isImageFile);
    const fallbackId = fallbackCover ? fallbackCover.id : null;
    const candidateIds = [preferredId, fallbackId]
      .filter((id): id is number => Number.isFinite(id) && Number(id) > 0)
      .filter((id, index, arr) => arr.indexOf(id) === index);

    if (candidateIds.length === 0) {

      setCoverUrl(null);
      setCoverLoading(false);
      return;
    }

    const requestId = ++coverRequestIdRef.current;
    setCoverLoading(true);
    for (const candidateId of candidateIds) {
      try {
        const url = await getFileLink(candidateId, libraryId, 60);
        if (requestId !== coverRequestIdRef.current) return;
        if (url) {

          setCoverUrl(url);
          setCoverLoading(false);
          return;
        }
      } catch (error) {
        runtimeLogger.warn('加载 ASMR 封面失败，将尝试回退候选:', error);
      }
    }

    if (requestId === coverRequestIdRef.current) {

      setCoverUrl(null);
    }
    if (requestId === coverRequestIdRef.current) {
      setCoverLoading(false);
    }
  }, [libraryId]);

  const loadCoverPickerDirectory = useCallback(async (
    targetNodeId: number,
    nextPathStack: AsmrPathItem[],
  ) => {
    if (!libraryId) {
      setCoverPickerItems([]);
      return [] as AsmrNodeItem[];
    }
    const requestId = ++coverPickerRequestIdRef.current;
    setCoverPickerLoading(true);
    try {
      const children = (await getChildrenByNodeId(targetNodeId, libraryId)) as AsmrNodeItem[];
      if (requestId !== coverPickerRequestIdRef.current) {
        return [] as AsmrNodeItem[];
      }
      const sorted = sortNodes(children || []);
      setCoverPickerPathStack(nextPathStack);
      setCoverPickerItems(sorted);
      return sorted;
    } catch (error) {
      runtimeLogger.error('加载封面选择目录失败:', error);
      if (requestId === coverPickerRequestIdRef.current) {
        setCoverPickerPathStack(nextPathStack);
        setCoverPickerItems([]);
      }
      return [] as AsmrNodeItem[];
    } finally {
      if (requestId === coverPickerRequestIdRef.current) {
        setCoverPickerLoading(false);
      }
    }
  }, [libraryId]);

  const loadCollectionMeta = useCallback(async (targetNodeId: number) => {
    if (!libraryId) throw new Error('资料库参数异常');
    const [detail, tags] = await Promise.all([
      fetchNodeDetailById(targetNodeId), readNodeTags(targetNodeId, libraryId),
    ]);
    if (detail.id !== targetNodeId || detail.libraryId !== libraryId) throw new Error('集合所属资料库已变化');
    const viewMeta = parseViewMeta(detail.viewMeta);
    return {
      name: sanitizeMetaText(detail.name) || fallbackTitle,
      tagIds: tags.tagIds,
      sn: sanitizeMetaText(String(viewMeta.sn || '')),
      preferredCoverNodeId: resolveMetaNumber(viewMeta.coverNodeId),
    };
  }, [fallbackTitle, libraryId]);

  useEffect(() => {
    let disposed = false;
    let requestId = 0;
    setCollectionTagIds([]);
    setLegacyTagText('');
    if (!libraryId || !rootNodeId) return;
    const refresh = async () => {
      const current = ++requestId;
      try {
        const state = await readNodeTags(rootNodeId, libraryId);
        if (disposed || current !== requestId) return;
        const detail = state.tagIds.length === 0 ? await fetchNodeDetailById(rootNodeId) : null;
        if (disposed || current !== requestId) return;
        if (detail && (detail.id !== rootNodeId || detail.libraryId !== libraryId)) throw new Error('集合所属资料库已变化');
        setCollectionTagIds(state.tagIds);
        setLegacyTagText(detail ? sanitizeMetaText(String(parseViewMeta(detail.viewMeta).tag || '')) : '');
      } catch (error) { if (!disposed) runtimeLogger.warn('加载集合标签关系失败:', error); }
    };
    const unsubscribe = subscribeLibraryNodesMutated(event => {
      if (event.nodeId !== rootNodeId || !matchesLibraryMutationScope(event, accountScope, API_CONFIG.BASE_URL, libraryId)) return;
      void refresh();
    });
    void refresh();
    return () => { disposed = true; unsubscribe(); };
  }, [accountScope, libraryId, rootNodeId, reloadToken]);

  useEffect(() => {
    let canceled = false;
    setAsmrTagOptions([]);
    if (!libraryId || collectionTagIds.length === 0) return;
    void (async () => {
      const tags: TagItem[] = [];
      for (let offset = 0; offset < collectionTagIds.length; offset += 100) {
        const page = await queryLibraryTags({ libraryId, ids: collectionTagIds.slice(offset, offset + 100), limit: 100 });
        if (canceled) return;
        tags.push(...page.entries);
      }
      setAsmrTagOptions(tags);
    })().catch(error => { if (!canceled) runtimeLogger.warn('加载集合标签名称失败:', error); });
    return () => { canceled = true; };
  }, [accountScope, libraryId, collectionTagIds]);

  // MediaHub 注册由 globalAudioPlayer 服务层完成；详见 docs/media-hub-contract.md。
  // 卸载时不主动 clear，tab 关闭由 FileViewerContext.releaseForTab 兜底。

  useEffect(() => {
    let canceled = false;
    if (!rootNodeId || !Number.isFinite(rootNodeId) || !libraryId) {
      hasLoadedListRef.current = false;
      setPathStack([]);
      setItems([]);
      setListError('ASMR 目录参数异常');
      setListLoading(false);
      setCollectionName(fallbackTitle);
      setCollectionTagIds([]);
      setCollectionSn('');

      setCoverUrl(null);
      setCoverLoading(false);
      return;
    }

    const rootPath: AsmrPathItem[] = [{ id: rootNodeId, name: 'ROOT' }];
    hasLoadedListRef.current = false;
    audioUrlCacheRef.current.clear();
    setCoverUrl(null);

    setCoverLoading(true);

    void (async () => {
      const metadataPromise = loadCollectionMeta(rootNodeId)
        .then((meta) => {
          if (canceled) return null;
          setCollectionName(meta.name);
          setCollectionSn(meta.sn);
          return meta.preferredCoverNodeId;
        })
        .catch((error) => {
          if (canceled) return null;
          runtimeLogger.warn('加载 ASMR 元信息失败，已回退默认展示:', error);
          setCollectionName(fallbackTitle);
          setCollectionSn('');
          return null;
        });
      const [initialRestoreSource, rootResult] = await Promise.all([
        waitForInitialRestore(),
        loadDirectory(rootNodeId, rootPath),
      ]);
      if (canceled || !rootResult.success) return;
      const pendingRestore = pendingSessionRestoreRef.current;
      const restorePath = pendingRestore?.pathStack[0]?.id === rootNodeId
        ? pendingRestore.pathStack
        : rootPath;
      const rootChildren = rootResult.items;
      if (initialRestoreSource === 'blocked') {
        hasLoadedListRef.current = true;
        const preferredCoverNodeId = await metadataPromise;
        if (canceled) return;
        await resolveCover(rootChildren, preferredCoverNodeId);
        return;
      }
      let restoredItems = rootChildren;
      let restoredPath = rootPath;
      for (const desiredSegment of restorePath.slice(1)) {
        const validSegment = restoredItems.find(item => (
          item.id === desiredSegment.id && isDirectoryNode(item)
        ));
        if (!validSegment) break;
        const nextPath = [...restoredPath, { id: validSegment.id, name: validSegment.name }];
        const nextResult = await loadDirectory(validSegment.id, nextPath);
        if (canceled) return;
        if (!nextResult.success) break;
        restoredItems = nextResult.items;
        restoredPath = nextPath;
      }
      hasLoadedListRef.current = true;
      const restoredSelectedId = pendingRestore?.selectedId ?? null;
      setSelectedId(restoredItems.some(item => item.id === restoredSelectedId) ? restoredSelectedId : null);
      if (pendingRestore?.currentAudioId && isOwnedSourceRef.current && playerSrcRef.current) {
        const audioParentNodeId = pendingRestore.currentAudioParentNodeId
          ?? restoredPath[restoredPath.length - 1]?.id
          ?? null;
        let audioParentItems = restoredItems;
        if (audioParentNodeId && audioParentNodeId !== restoredPath[restoredPath.length - 1]?.id) {
          try {
            const children = (await getChildrenByNodeId(audioParentNodeId, libraryId)) as AsmrNodeItem[];
            if (canceled) return;
            audioParentItems = sortNodes(children || []);
          } catch (error) {
            runtimeLogger.warn('恢复 ASMR 播放队列失败:', error);
            audioParentItems = [];
          }
        }
        const restoredQueue = audioParentItems.filter(item => (
          !isDirectoryNode(item) && resolveFileType(item) === 'audio'
        ));
        const restoredAudio = restoredQueue.find(item => item.id === pendingRestore.currentAudioId);
        if (restoredAudio) {
          setAudioQueue(restoredQueue);
          setCurrentAudioId(restoredAudio.id);
          currentAudioParentNodeIdRef.current = audioParentNodeId;
          setCurrentAudioSrc(playerSrcRef.current);
        }
      }
      const preferredCoverNodeId = await metadataPromise;
      if (canceled) return;
      await resolveCover(rootChildren, preferredCoverNodeId);
    })();
    return () => {
      canceled = true;
    };
  }, [
    fallbackTitle,
    libraryId,
    loadCollectionMeta,
    loadDirectory,
    resolveCover,
    rootNodeId,
    waitForInitialRestore,
  ]);

  useEffect(() => {
    if (currentAudioId === null) {
      return;
    }
    if (!playerState.src || !currentAudioSrc || playerState.src !== currentAudioSrc) {
      setCurrentAudioId(null);
      currentAudioParentNodeIdRef.current = null;
      setCurrentAudioSrc(null);
      setAudioQueue([]);
      setSeekingTime(null);
    }
  }, [currentAudioId, currentAudioSrc, playerState.src]);

  useEffect(() => {
    if (!active || !hasLoadedListRef.current) return;
    const pending = pendingSessionRestoreRef.current;
    const viewport = listViewportRef.current;
    if (!pending || !viewport) return;
    const frame = window.requestAnimationFrame(() => {
      const anchorElement = pending.listAnchorItemId == null
        ? null
        : rowElementMapRef.current.get(pending.listAnchorItemId) ?? null;
      const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
      const targetTop = anchorElement
        ? anchorElement.offsetTop + pending.listAnchorOffsetRatio * Math.max(anchorElement.offsetHeight, 1)
        : pending.listScrollRatio != null && maxScrollable > 0
          ? pending.listScrollRatio * maxScrollable
          : pending.listScrollTop;
      viewport.scrollTop = Math.min(Math.max(targetTop, 0), maxScrollable);
      pendingSessionRestoreRef.current = null;
      flushSessionSnapshot();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, flushSessionSnapshot, items]);

  useEffect(() => {
    if (!hasLoadedListRef.current) return;
    flushSessionSnapshot();
  }, [currentAudioId, flushSessionSnapshot, pathStack, selectedId]);

  useEffect(() => {
    const viewport = listViewportRef.current;
    if (!viewport) return;
    const onScroll = () => {
      if (pendingSessionRestoreRef.current || listScrollCaptureRafRef.current) return;
      listScrollCaptureRafRef.current = window.requestAnimationFrame(() => {
        listScrollCaptureRafRef.current = 0;
        flushSessionSnapshot();
      });
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (listScrollCaptureRafRef.current) {
        window.cancelAnimationFrame(listScrollCaptureRafRef.current);
        listScrollCaptureRafRef.current = 0;
      }
    };
  }, [flushSessionSnapshot]);

  const handleOpenNode = useCallback(async (item: AsmrNodeItem) => {
    if (!libraryId) return;
    if (isDirectoryNode(item)) {
      const nextStack = [...pathStack, { id: item.id, name: item.name }];
      await loadDirectory(item.id, nextStack);
      return;
    }

    try {
      const fileType = resolveFileType(item);
      if (fileType === 'audio') {
        const queue = items.filter(candidate => (
          !isDirectoryNode(candidate) && resolveFileType(candidate) === 'audio'
        ));
        await playAudioInAsmr(
          item,
          queue,
          pathStack[pathStack.length - 1]?.id ?? null,
        );
        return;
      }

      const url = await getFileLink(item.id, libraryId, 60);
      if (!url) {
        Toast.error('无法获取文件访问地址');
        return;
      }
      setFileUrl(url, resolveDisplayName(item), fileType, item.id);
    } catch (error: any) {
      runtimeLogger.error('打开 ASMR 内文件失败:', error);
      Toast.error(error?.message || '打开文件失败');
    }
  }, [items, libraryId, loadDirectory, pathStack, playAudioInAsmr, setFileUrl]);

  const handleJumpToCrumb = useCallback(async (index: number) => {
    if (index < 0 || index >= pathStack.length) return;
    const nextStack = pathStack.slice(0, index + 1);
    const target = nextStack[nextStack.length - 1];
    await loadDirectory(target.id, nextStack);
  }, [loadDirectory, pathStack]);

  const handlePlayPrevAudio = useCallback(async () => {
    if (!hasPrevAudio || currentAudioQueueIndex <= 0) return;
    const prevTrack = audioQueue[currentAudioQueueIndex - 1];
    await playAudioInAsmr(prevTrack, audioQueue);
  }, [audioQueue, currentAudioQueueIndex, hasPrevAudio, playAudioInAsmr]);

  const handlePlayNextAudio = useCallback(async () => {
    if (!hasNextAudio || currentAudioQueueIndex < 0) return;
    const nextTrack = audioQueue[currentAudioQueueIndex + 1];
    await playAudioInAsmr(nextTrack, audioQueue, currentAudioParentNodeIdRef.current, { animateTransition: true });
  }, [audioQueue, currentAudioQueueIndex, hasNextAudio, playAudioInAsmr]);

  useEffect(() => {
    if (!active || !isCurrentAudioSource) return;
    if (playerState.endedSerial <= 0 || playerState.endedSerial === lastHandledEndedSerialRef.current) return;
    lastHandledEndedSerialRef.current = playerState.endedSerial;
    if (!hasNextAudio || currentAudioQueueIndex < 0) return;
    const nextTrack = audioQueue[currentAudioQueueIndex + 1];
    if (nextTrack) {
      void playAudioInAsmr(nextTrack, audioQueue, currentAudioParentNodeIdRef.current, { animateTransition: true });
    }
  }, [
    active,
    audioQueue,
    currentAudioQueueIndex,
    hasNextAudio,
    isCurrentAudioSource,
    playAudioInAsmr,
    playerState.endedSerial,
  ]);

  const openEditor = useCallback(() => {
    if (!rootNodeId || !libraryId || editorSavingRef.current) return;
    const requestId = ++editorRequestIdRef.current;
    editorBaselineRef.current = null;
    setEditorVisible(true);
    setEditorLoading(true);
    const rootPath: AsmrPathItem[] = [{ id: rootNodeId, name: 'ROOT' }];
    void loadCoverPickerDirectory(rootNodeId, rootPath);
    void (async () => {
      try {
        const meta = await loadCollectionMeta(rootNodeId);
        if (requestId !== editorRequestIdRef.current) return;
        editorBaselineRef.current = { name: meta.name, tagIds: meta.tagIds, sn: meta.sn, coverNodeId: meta.preferredCoverNodeId };
        setEditorName(meta.name);
        setEditorTagIds(meta.tagIds);
        setEditorSn(meta.sn);
        setEditorCoverNodeId(meta.preferredCoverNodeId);
      } catch (error) {
        if (requestId !== editorRequestIdRef.current) return;
        runtimeLogger.error('加载 ASMR 编辑信息失败:', error);
        Toast.error(error instanceof Error ? error.message : '加载编辑信息失败');
        setEditorVisible(false);
      } finally {
        if (requestId === editorRequestIdRef.current) setEditorLoading(false);
      }
    })();
  }, [libraryId, loadCollectionMeta, loadCoverPickerDirectory, rootNodeId]);

  const handleCoverPickerJumpToCrumb = useCallback(async (index: number) => {
    if (index < 0 || index >= coverPickerPathStack.length) return;
    const nextStack = coverPickerPathStack.slice(0, index + 1);
    const target = nextStack[nextStack.length - 1];
    await loadCoverPickerDirectory(target.id, nextStack);
  }, [coverPickerPathStack, loadCoverPickerDirectory]);

  const handleCoverPickerOpenNode = useCallback(async (item: AsmrNodeItem) => {
    if (!isDirectoryNode(item)) return;
    const nextStack = [...coverPickerPathStack, { id: item.id, name: item.name }];
    await loadCoverPickerDirectory(item.id, nextStack);
  }, [coverPickerPathStack, loadCoverPickerDirectory]);

  const handleSaveEditor = useCallback(async () => {
    const baseline = editorBaselineRef.current;
    if (!rootNodeId || !libraryId || !baseline || editorSavingRef.current || editorLoading) return;
    const nextName = sanitizeMetaText(editorName);
    if (!nextName) { Toast.error('名称不能为空'); return; }
    const requestId = editorRequestIdRef.current;
    const assertCurrent = () => {
      if (requestId !== editorRequestIdRef.current) throw new Error('编辑目标已变化');
    };
    editorSavingRef.current = true;
    setEditorSaving(true);
    const result = await saveAsmrMetadata(libraryId, rootNodeId, baseline, {
      name: nextName, tagIds: resolveMetaNumberList(editorTagIds), sn: sanitizeMetaText(editorSn), coverNodeId: editorCoverNodeId,
    }, { assertCurrent });
    if (requestId !== editorRequestIdRef.current) return;
    editorBaselineRef.current = result.baseline;
    if (result.savedParts.includes('名称')) setCollectionName(result.baseline.name);
    if (result.savedParts.includes('元信息')) setCollectionSn(result.baseline.sn);
    if (result.savedParts.includes('标签')) {
      setCollectionTagIds(result.baseline.tagIds);
      setLegacyTagText('');
    }
    if (accountScope && result.savedParts.length > 0) {
      notifyLibraryNodesMutated({ accountScope, backendScope: API_CONFIG.BASE_URL, libraryId, nodeId: rootNodeId,
        affectedParentIds: result.affectedParentIds, ...(result.savedParts.includes('名称') ? { name: result.baseline.name, type: 'dir' } : {}) });
    }
    if (result.status === 'saved') {
      setEditorVisible(false);
      Toast.success('ASMR 信息已更新');
      // 展示刷新失败不能把已提交的保存变成失败，更不能再次提交。
      try {
        const [children, meta] = await Promise.all([getChildrenByNodeId(rootNodeId, libraryId), loadCollectionMeta(rootNodeId)]);
        assertCurrent();
        setCollectionName(meta.name);
        setCollectionSn(meta.sn);
        await resolveCover(sortNodes(children as AsmrNodeItem[]), meta.preferredCoverNodeId);
      } catch (error) { runtimeLogger.warn('ASMR 信息已保存，但封面刷新未完成:', error); }
    } else {
      Toast.error(result.message || '保存失败');
      if (result.status === 'unknown') {
        setEditorVisible(false);
        editorBaselineRef.current = null;
        try {
          const meta = await loadCollectionMeta(rootNodeId);
          assertCurrent();
          setCollectionName(meta.name);
          setCollectionTagIds(meta.tagIds);
          setCollectionSn(meta.sn);
        } catch (error) { runtimeLogger.warn('ASMR 保存结果核对未完成:', error); }
      }
    }
    if (requestId === editorRequestIdRef.current) {
      editorSavingRef.current = false;
      setEditorSaving(false);
    }
  }, [accountScope, editorCoverNodeId, editorLoading, editorName, editorSn, editorTagIds, libraryId, loadCollectionMeta, resolveCover, rootNodeId]);

  return (
    <AsmrViewerWrapper data-player-active={currentAudioId !== null}>
      <section className="top-section">
        <div className="cover-panel">
          {coverLoading ? (
            <div className="cover-placeholder">
              <Spin size="middle" />
              <span>封面加载中</span>
            </div>
          ) : coverUrl ? (
            <img src={coverUrl} alt={title} className="cover-image" draggable={false} />
          ) : (
            <div className="cover-placeholder">
              <span>暂无封面</span>
              <span>将自动使用目录中的首张图片</span>
            </div>
          )}
        </div>

        <div className="meta-panel">
          <div className="meta-tools">
            <Button
              type="tertiary"
              theme="borderless"
              icon={<IconEdit />}
              aria-label="编辑 ASMR"
              title="编辑 ASMR"
              onClick={openEditor}
            />
          </div>
          <div className="title-row">
            <h2 className="title" title={title}>{title}</h2>
          </div>
          <p className="subtitle" title={collectionSn || ''}>
            {collectionSn || '-'}
          </p>
          <div className="meta-divider" />
          <div className="tag-list">
            {selectedTagItems.length > 0 ? (
              selectedTagItems.map(tag => (
                <span
                  key={`asmr-tag-${tag.id}`}
                  className="tag-pill"
                  style={{
                    background: tag.color || 'var(--semi-color-fill-0)',
                    color: tag.textColor || (tag.color ? '#fff' : 'var(--semi-color-text-1)'),
                    borderColor: tag.color || 'var(--semi-color-border)',
                  }}
                >
                  {tag.name}
                </span>
              ))
            ) : legacyTagText ? (
              <span className="tag-pill fallback">{legacyTagText}</span>
            ) : (
              <span className="tag-empty">暂无标签</span>
            )}
          </div>
        </div>
      </section>

      <section className="bottom-section">
        <div className="path-strip">
          <div className="path-breadcrumb" title={relativePath}>
            {pathStack.map((item, index) => {
              const isCurrent = index === pathStack.length - 1;
              return (
                <React.Fragment key={`${item.id}-${index}`}>
                  <button
                    type="button"
                    className="crumb-btn"
                    onClick={() => {
                      if (!isCurrent && !listLoading) {
                        void handleJumpToCrumb(index);
                      }
                    }}
                    disabled={isCurrent || listLoading}
                  >
                    {item.name}
                  </button>
                  {!isCurrent ? <span className="crumb-sep">/</span> : null}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="list-shell" ref={listViewportRef}>
          {listLoading ? (
            <div className="state-loading">
              <Spin size="large" tip="目录加载中..." />
            </div>
          ) : listError ? (
            <div className="state-error">{listError}</div>
          ) : items.length === 0 ? (
            <div className="state-empty">当前目录为空</div>
          ) : (
            <div className="rows">
              {items.map((item) => {
                const isDir = isDirectoryNode(item);
                const displayName = resolveDisplayName(item);
                const isPlayingRow = !isDir && item.id === currentAudioId;
                return (
                  <div
                    key={item.id}
                    ref={(element) => {
                      if (element) {
                        rowElementMapRef.current.set(item.id, element);
                      } else {
                        rowElementMapRef.current.delete(item.id);
                      }
                    }}
                    className={`row ${selectedId === item.id ? 'selected' : ''} ${isPlayingRow ? 'playing' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => {
                      void handleOpenNode(item);
                    }}
                    title={displayName}
                  >
                    <div className="row-main">
                      <span className="row-icon">
                        {isDir ? <OutlineIcon name="folder" /> : getFileNodeIcon(item.ext, item.name, {
                          mimeType: item.mimeType,
                          parentBuiltInType: 'AUDIO',
                          parentArchiveMode: 1,
                        })}
                      </span>
                      <span className="row-name">{displayName}</span>
                      {isPlayingRow ? (
                        <span className={`row-playing-badge ${playerState.isPlaying ? 'active' : 'paused'}`}>
                          {playerState.isPlaying ? '播放中' : '已暂停'}
                        </span>
                      ) : null}
                    </div>
                    <span className="row-type">{resolveRowType(item)}</span>
                    <span className="row-size">{isDir ? '-' : formatFileSize(item.fileSize)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {currentAudioId !== null ? (
          <div className="audio-player-bar" data-progress-visible={showPlayerProgress} data-meteor-active={showMeteor}>
            {showMeteor && meteor ? (
              <AudioDockMeteor
                key={meteor.id}
                event={meteor}
                color={spectrumColors.primary}
                onFinish={() => setMeteor(current => current?.id === meteor.id ? null : current)}
              />
            ) : null}
            <AudioDockProgress
              visible={showPlayerProgress}
              disabled={!isCurrentAudioSource}
              duration={playerState.duration}
              value={visibleCurrentTime}
              startColor={spectrumColors.mirrored}
              endColor={spectrumColors.primary}
              smooth={active && playerState.isPlaying && seekingTime === null && !showMeteor}
              readTime={() => {
                const state = getPlayerState();
                return isCurrentAudioSource ? state.currentTime : null;
              }}
              onPreview={(time) => {
                setSeekingTime(time);
                seekTo(time);
              }}
              onCommit={() => setSeekingTime(null)}
              onCancel={() => setSeekingTime(null)}
            />

            <div className="player-brief">
              <span className="audio-cover mini">
                {coverUrl ? <img src={coverUrl} alt="" draggable={false} /> : <IconMusic />}
              </span>
              <span className="player-track">
                <span className="player-title" title={currentTrackName}>{currentTrackName}</span>
                <span className="player-artist">ASMR</span>
              </span>
            </div>

            <div className="player-controls">
              <Button
                theme="borderless"
                size="default"
                icon={<IconBackward />}
                disabled={!hasPrevAudio}
                onClick={() => {
                  void handlePlayPrevAudio();
                }}
              />
              <Button
                theme="borderless"
                size="large"
                className="play-main"
                shape="circle"
                icon={playerState.isPlaying ? <IconPause /> : <IconPlay />}
                onClick={() => {
                  void toggleOwnedPlay().catch((error) => {
                    runtimeLogger.error('ASMR 音频切换播放失败:', error);
                  });
                }}
              />
              <Button
                theme="borderless"
                size="default"
                icon={<IconFastForward />}
                disabled={!hasNextAudio}
                onClick={() => {
                  void handlePlayNextAudio();
                }}
              />
            </div>

            <div className="player-extra">
              <span className="time-display">{formatDuration(visibleCurrentTime)} / {formatDuration(playerState.duration)}</span>

              <MediaVolumeControl
                muted={playerState.isMuted}
                volume={playerState.volume}
                onMutedChange={setMuted}
                onVolumeChange={setVolume}
              />
            </div>
          </div>
        ) : null}
      </section>

      <Modal
        title="编辑 ASMR 集合"
        visible={editorVisible}
        centered
        width={660}
        onCancel={() => {
          if (!editorSaving) {
            editorRequestIdRef.current += 1;
            editorBaselineRef.current = null;
            setEditorVisible(false);
          }
        }}
        onOk={() => {
          void handleSaveEditor();
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={editorSaving}
        okButtonProps={{ disabled: editorLoading }}
      >
        {editorLoading ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="middle" tip="加载编辑信息..." />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 12, minHeight: 300 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ marginBottom: 4, color: 'var(--semi-color-text-1)', fontSize: 11 }}>名称</div>
                <Input
                  disabled={editorSaving}
                  value={editorName}
                  maxLength={255}
                  onChange={(value) => setEditorName(value)}
                  placeholder="请输入 ASMR 集合名称"
                  size="small"
                />
              </div>
              <div>
                <div style={{ marginBottom: 4, color: 'var(--semi-color-text-1)', fontSize: 11 }}>标签</div>
                {libraryId && <LibraryTagPicker
                  libraryId={libraryId}
                  valueIds={editorTagIds}
                  onChange={setEditorTagIds}
                  disabled={editorSaving}
                  placeholder="搜索资料库标签"
                />}
              </div>
              <div>
                <div style={{ marginBottom: 4, color: 'var(--semi-color-text-1)', fontSize: 11 }}>SN</div>
                <Input
                  disabled={editorSaving}
                  value={editorSn}
                  maxLength={128}
                  onChange={(value) => setEditorSn(value)}
                  placeholder="例如：ASMR-2026-0001"
                  size="small"
                />
              </div>
              <div>
                <div style={{ marginBottom: 4, color: 'var(--semi-color-text-1)', fontSize: 11 }}>封面节点</div>
                <Input
                  value={editorCoverNodeId ? String(editorCoverNodeId) : ''}
                  readOnly
                  placeholder="未选择（默认自动取首张图片）"
                  size="small"
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  theme="light"
                  size="small"
                  disabled={editorSaving}
                  onClick={() => setEditorCoverNodeId(null)}
                >
                  清除自定义封面
                </Button>
              </div>
            </div>

            <div
              style={{
                border: '1px solid var(--semi-color-border)',
                borderRadius: 8,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <div
                style={{
                  height: 32,
                  borderBottom: '1px solid var(--semi-color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  gap: 4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  fontSize: 11,
                }}
              >
                {coverPickerPathStack.map((item, index) => {
                  const isCurrent = index === coverPickerPathStack.length - 1;
                  return (
                    <React.Fragment key={`${item.id}-${index}`}>
                      <button
                        type="button"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: isCurrent ? 'var(--semi-color-text-0)' : 'var(--semi-color-text-1)',
                          cursor: isCurrent ? 'default' : 'pointer',
                          fontWeight: isCurrent ? 600 : 500,
                          padding: 0,
                        }}
                        disabled={isCurrent || coverPickerLoading}
                        onClick={() => {
                          void handleCoverPickerJumpToCrumb(index);
                        }}
                      >
                        {item.name}
                      </button>
                      {!isCurrent ? <span style={{ color: 'var(--semi-color-text-2)' }}>/</span> : null}
                    </React.Fragment>
                  );
                })}
              </div>

              <AsmrCoverPickerList>
                {coverPickerLoading ? (
                  <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spin size="middle" />
                  </div>
                ) : coverPickerItems.length === 0 ? (
                  <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--semi-color-text-2)', fontSize: 11 }}>
                    当前目录为空
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {coverPickerItems.map((item) => {
                      const isDir = isDirectoryNode(item);
                      const isImage = !isDir && isImageFile(item);
                      const selected = !isDir && editorCoverNodeId === item.id;
                      return (
                        <div
                          key={`cover-picker-${item.id}`}
                          style={{
                            height: 32,
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) auto',
                            alignItems: 'center',
                            gap: 6,
                            border: selected
                              ? '1px solid var(--semi-color-primary)'
                              : '1px solid transparent',
                            borderRadius: 6,
                            padding: '0 8px',
                            background: selected
                              ? 'var(--semi-color-primary-light-default)'
                              : 'transparent',
                            cursor: isDir || isImage ? 'pointer' : 'default',
                          }}
                          onDoubleClick={() => {
                            if (isDir) {
                              void handleCoverPickerOpenNode(item);
                            }
                          }}
                          onClick={() => {
                            if (isDir) {
                              return;
                            }
                            if (isImage && !editorSaving) {
                              setEditorCoverNodeId(item.id);
                            }
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, fontSize: 11 }}>
                            <span style={{ width: 20, display: 'inline-flex', justifyContent: 'center' }}>
                              {isDir ? <OutlineIcon name="folder" /> : getFileNodeIcon(item.ext, item.name, {
                                mimeType: item.mimeType,
                                parentBuiltInType: 'AUDIO',
                                parentArchiveMode: 1,
                              })}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {resolveDisplayName(item)}
                            </span>
                          </div>
                          <span style={{ color: 'var(--semi-color-text-2)', fontSize: 10 }}>
                            {isDir ? '目录（双击进入）' : isImage ? '图片（可选封面）' : '不可作为封面'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </AsmrCoverPickerList>
            </div>
          </div>
        )}
      </Modal>
    </AsmrViewerWrapper>
  );
};

export default AsmrViewer;
