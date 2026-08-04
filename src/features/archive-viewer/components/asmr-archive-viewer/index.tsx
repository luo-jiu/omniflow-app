import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Modal, Popover, Spin, Toast } from '@douyinfe/semi-ui';
import {
  batchGetFileLinks,
  fetchArchiveCardsPage,
  fetchNodeDetailById,
  renameNode,
  updateNodeConfig,
} from '@/features/file-explorer/services/file.api';
import { softDeleteNodeSubtree } from '@/features/file-explorer/services/node-deletion';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { AsmrArchiveViewerWrapper } from './style';
import { useFileViewer } from '@/hooks/useFileViewer';
import {
  acknowledgeLatestPendingValue,
  useViewerSession,
  type ViewerSessionAdapter,
} from '@/features/file-viewer/session';
import { fetchTags, type TagItem } from '@/features/tag-management/services/tag.api';
import { useArchiveCardGrid } from '@/features/archive-viewer/hooks/useArchiveCardGrid';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import { locateNodeInDirectoryTree } from '@/features/file-explorer/services/tree-locate';
import { useNodePropertiesOverlay } from '@/features/file-explorer/hooks/useNodePropertiesOverlay';
import {
  ARCHIVE_CARD_SESSION_ESTIMATED_BYTES,
  ARCHIVE_CARD_SESSION_SCHEMA_VERSION,
  parseArchiveCardSessionSnapshot,
  resolveArchiveCardRestoreScrollTop,
  type ArchiveCardSessionSnapshot,
} from '@/features/archive-viewer/session/archive-card-session';

interface AsmrArchiveTag {
  id: number | null;
  name: string;
  color?: string | null;
  textColor?: string | null;
  fallback?: boolean;
}

interface AsmrArchiveCard {
  id: number;
  title: string;
  sortOrder: number;
  coverNodeId: number | null;
  coverUrl: string | null;
  tags: AsmrArchiveTag[];
  viewMeta: string;
}

interface AsmrArchiveViewerProps {
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

interface ArchiveReaderProgress {
  anchorCardId: number | null;
  anchorOffsetRatio: number;
  scrollTop: number;
  scrollRatio: number;
  updatedAt: string;
}

interface AsmrViewMetaPayload {
  tag?: string;
  tagIds?: number[];
  coverNodeId?: number;
  [key: string]: unknown;
}

const PAGE_SIZE = 24;
const LINK_EXPIRY_MINUTES = 120;
const VIEW_META_VIEWER_STATE_KEY = '__omniflowViewerStateV1';
const VIEW_META_VIEWER_STATE_LEGACY_KEY = '__omniflow_viewer_state_v1';
const VIEW_META_ASMR_ARCHIVE_READER_KEY = 'asmrArchiveReader';
const VIEW_META_ASMR_ARCHIVE_READER_LEGACY_KEY = 'asmr_archive_reader';
const REMOTE_PROGRESS_SYNC_INTERVAL_MS = 200;

function normalizeArchiveTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return 'ASMR 归档';
  if (raw.startsWith('ASMR 归档 ·')) {
    const stripped = raw.replace(/^ASMR 归档 ·\s*/u, '').trim();
    if (stripped) return stripped;
  }
  return raw;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseViewMetaObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseRatio(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1);
}

function parseRemoteArchiveProgress(viewMetaRaw: string | null | undefined): ArchiveReaderProgress | null {
  const meta = parseViewMetaObject(viewMetaRaw);
  const viewerState = meta[VIEW_META_VIEWER_STATE_KEY] ?? meta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  if (!isPlainObject(viewerState)) return null;
  const readerState = viewerState[VIEW_META_ASMR_ARCHIVE_READER_KEY] ?? viewerState[VIEW_META_ASMR_ARCHIVE_READER_LEGACY_KEY];
  if (!isPlainObject(readerState)) return null;

  const anchorCardId = parsePositiveNumber(readerState.anchorCardId);
  const scrollTop = Number(readerState.scrollTop ?? 0);
  const currentScrollTop = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const currentScrollRatio = parseRatio(readerState.scrollRatio);
  if (!anchorCardId && currentScrollTop <= 0 && currentScrollRatio <= 0) {
    return null;
  }

  return {
    anchorCardId,
    anchorOffsetRatio: parseRatio(readerState.anchorOffsetRatio),
    scrollTop: currentScrollTop,
    scrollRatio: currentScrollRatio,
    updatedAt: String(readerState.updatedAt || ''),
  };
}

function buildViewMetaWithArchiveProgress(
  baseMeta: Record<string, unknown>,
  progress: ArchiveReaderProgress,
): Record<string, unknown> {
  const nextMeta: Record<string, unknown> = { ...baseMeta };
  const viewerStateCandidate = nextMeta[VIEW_META_VIEWER_STATE_KEY] ?? nextMeta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  const currentViewerState = isPlainObject(viewerStateCandidate)
    ? { ...(viewerStateCandidate as Record<string, unknown>) }
    : {};
  delete currentViewerState[VIEW_META_ASMR_ARCHIVE_READER_LEGACY_KEY];
  delete nextMeta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  nextMeta[VIEW_META_VIEWER_STATE_KEY] = {
    ...currentViewerState,
    [VIEW_META_ASMR_ARCHIVE_READER_KEY]: {
      anchorCardId: progress.anchorCardId,
      anchorOffsetRatio: progress.anchorOffsetRatio,
      scrollTop: progress.scrollTop,
      scrollRatio: progress.scrollRatio,
      updatedAt: progress.updatedAt,
    },
  };
  return nextMeta;
}

function parseAsmrViewMeta(raw?: string | null): AsmrViewMetaPayload {
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

function sanitizeMetaText(input: unknown): string {
  return String(input || '').trim();
}

function resolveMetaNumber(input: unknown): number | null {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function resolveMetaNumberList(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const result: number[] = [];
  input.forEach((item) => {
    const value = resolveMetaNumber(item);
    if (value !== null && !result.includes(value)) {
      result.push(value);
    }
  });
  return result;
}

function resolveTagIdsFromLegacyTagText(legacyTagText: string, normalizedNameMap: Map<string, number>): number[] {
  const normalized = sanitizeMetaText(legacyTagText);
  if (!normalized) return [];
  const tokens = normalized
    .split(/[/,，、|]/g)
    .map(token => sanitizeMetaText(token).toLowerCase())
    .filter(Boolean);
  const ids: number[] = [];
  tokens.forEach((token) => {
    const tagId = normalizedNameMap.get(token);
    if (tagId && !ids.includes(tagId)) {
      ids.push(tagId);
    }
  });
  return ids;
}

function resolveFallbackTagTexts(tagText: string): string[] {
  return sanitizeMetaText(tagText)
    .split(/[/,，、|]/g)
    .map(token => sanitizeMetaText(token))
    .filter(Boolean);
}

function resolveAsmrCardTags(
  viewMetaRaw: string,
  tagOptionMap: Map<number, TagItem>,
  normalizedTagNameMap: Map<string, number>,
): AsmrArchiveTag[] {
  const parsedMeta = parseAsmrViewMeta(viewMetaRaw);
  const nextTags: AsmrArchiveTag[] = [];
  const metaTagText = sanitizeMetaText(parsedMeta.tag);
  const metaTagIds = resolveMetaNumberList(parsedMeta.tagIds);
  const resolvedTagIds = metaTagIds.length > 0
    ? metaTagIds
    : resolveTagIdsFromLegacyTagText(metaTagText, normalizedTagNameMap);

  resolvedTagIds.forEach((tagId) => {
    const option = tagOptionMap.get(tagId);
    if (!option) return;
    nextTags.push({
      id: option.id,
      name: option.name,
      color: option.color,
      textColor: option.textColor,
    });
  });

  if (nextTags.length === 0 && metaTagText) {
    resolveFallbackTagTexts(metaTagText).forEach((tagName) => {
      if (nextTags.some(item => item.name === tagName)) return;
      nextTags.push({
        id: null,
        name: tagName,
        fallback: true,
      });
    });
  }
  return nextTags;
}

const AsmrArchiveViewer: React.FC<AsmrArchiveViewerProps> = ({
  accountScope,
  contentRevision,
  folderNodeId,
  fileUrl,
  fileName,
  libraryId,
  active = true,
  reloadToken = 0,
  tabId,
}) => {
  const { closeTabByNodeId, setFileUrl } = useFileViewer();
  const { viewportRef, wrapperStyle } = useArchiveCardGrid({ baseCardWidth: 275, gridGap: 15 });
  const title = useMemo(() => normalizeArchiveTitle(fileName), [fileName]);
  const { showNodeProperties } = useNodePropertiesOverlay({ libraryId });

  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<AsmrArchiveCard[]>([]);
  const [, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [restoreTick, setRestoreTick] = useState(0);
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    card: AsmrArchiveCard | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    card: null,
  });
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameTargetCard, setRenameTargetCard] = useState<AsmrArchiveCard | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const [tagOptionMap, setTagOptionMap] = useState<Map<number, TagItem>>(new Map());
  const [normalizedTagNameMap, setNormalizedTagNameMap] = useState<Map<string, number>>(new Map());
  const tagOptionMapRef = useRef<Map<number, TagItem>>(new Map());
  const normalizedTagNameMapRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (active) return;
    setMenuState(prev => (prev.visible ? { ...prev, visible: false } : prev));
    setRenameDialogVisible(false);
    setRenameTargetCard(null);
  }, [active]);

  const cardRefs = useRef<Map<number, HTMLElement>>(new Map());
  const cardsRef = useRef(cards);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const pendingRestoreRef = useRef<ArchiveReaderProgress | null>(null);
  const pendingSessionResourceNodeIdRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const restoreTriggeredLoadMoreRef = useRef(false);
  const scrollPersistRafRef = useRef<number>(0);
  const remoteSyncTimerRef = useRef<number>(0);
  const remoteSyncInflightRef = useRef(false);
  const pendingRemoteProgressRef = useRef<ArchiveReaderProgress | null>(null);
  const suppressNextScrollPersistRef = useRef(false);
  const viewMetaBaseRef = useRef<Record<string, unknown>>({});
  const viewMetaBaseReadyRef = useRef(false);
  const lastRemoteSyncSignatureRef = useRef('');
  activeRef.current = active;
  cardsRef.current = cards;

  const closeContextMenu = useCallback(() => {
    setMenuState(prev => ({ ...prev, visible: false }));
  }, []);

  const openCardContextMenu = useCallback((e: React.MouseEvent, card: AsmrArchiveCard) => {
    e.preventDefault();
    e.stopPropagation();

    const x = e.clientX;
    const y = e.clientY;
    if (menuState.visible) {
      setMenuState(prev => ({ ...prev, visible: false }));
      setTimeout(() => {
        setMenuState({
          visible: true,
          x,
          y,
          card,
        });
      }, 0);
      return;
    }
    setMenuState({
      visible: true,
      x,
      y,
      card,
    });
  }, [menuState.visible]);

  const openRenameDialog = useCallback((card: AsmrArchiveCard) => {
    setRenameTargetCard(card);
    setRenameInput(card.title);
    setRenameDialogVisible(true);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTargetCard) {
      setRenameDialogVisible(false);
      return;
    }
    const nextName = renameInput.trim();
    if (!nextName) {
      Toast.warning('名称不能为空');
      return;
    }
    if (nextName === renameTargetCard.title) {
      setRenameDialogVisible(false);
      setRenameTargetCard(null);
      return;
    }

    setRenameSubmitting(true);
    try {
      await renameNode({
        id: renameTargetCard.id,
        name: nextName,
      });
      setCards(prev => prev.map(card => (
        card.id === renameTargetCard.id
          ? { ...card, title: nextName }
          : card
      )));
      Toast.success('重命名成功');
      setRenameDialogVisible(false);
      setRenameTargetCard(null);
    } catch (error: any) {
      runtimeLogger.error('ASMR 归档卡片重命名失败:', error);
      Toast.error(error?.message || '重命名失败');
    } finally {
      setRenameSubmitting(false);
    }
  }, [renameInput, renameTargetCard]);

  const handleDeleteCard = useCallback((card: AsmrArchiveCard) => {
    if (!libraryId) {
      Toast.error('当前库参数异常');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确认将「${card.title || '未命名目录'}」移入回收站吗？`,
      okButtonProps: { theme: 'solid', type: 'danger' },
      okText: '删除',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          const result = await softDeleteNodeSubtree({
            accountScope,
            ancestorId: card.id,
            libraryId,
          });
          result.deletedNodeIds.forEach(closeTabByNodeId);
          setCards(prev => prev.filter(item => item.id !== card.id));
          setTotal(prev => Math.max(prev - 1, 0));
          if (result.draftCleanupFailed || result.subtreeCollectionFailed) {
            Toast.warning('已移入回收站，但本地文本草稿可能未完整清理');
          } else {
            Toast.success('已移入回收站');
          }
        } catch (error: any) {
          runtimeLogger.error('删除 ASMR 归档卡片失败:', error);
          Toast.error(error?.message || '删除失败');
        }
      },
    });
  }, [accountScope, closeTabByNodeId, libraryId]);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const card = menuState.card;
    if (!card || !libraryId) return [];
    return [
      {
        key: 'rename',
        label: '重命名',
        onClick: () => {
          closeContextMenu();
          openRenameDialog(card);
        },
      },
      {
        key: 'locate-in-tree',
        label: '在目录树中定位',
        onClick: () => {
          closeContextMenu();
          locateNodeInDirectoryTree({
            libraryId,
            nodeId: card.id,
          });
        },
      },
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
      {
        key: 'delete',
        label: '删除',
        danger: true,
        onClick: () => {
          closeContextMenu();
          handleDeleteCard(card);
        },
      },
    ];
  }, [closeContextMenu, handleDeleteCard, libraryId, menuState.card, openRenameDialog, showNodeProperties]);

  const captureAnchorFromViewport = useCallback((): {
    anchorCardId: number | null;
    anchorOffsetRatio: number;
  } => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return { anchorCardId: null, anchorOffsetRatio: 0 };
    }

    const viewportTop = viewport.getBoundingClientRect().top;
    for (const card of cardsRef.current) {
      const el = cardRefs.current.get(card.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= viewportTop + 1) continue;
      const ratio = rect.height > 0 ? clamp((viewportTop - rect.top) / rect.height, 0, 1) : 0;
      return {
        anchorCardId: card.id,
        anchorOffsetRatio: ratio,
      };
    }

    if (cardsRef.current.length > 0) {
      return {
        anchorCardId: cardsRef.current[0].id,
        anchorOffsetRatio: 0,
      };
    }
    return { anchorCardId: null, anchorOffsetRatio: 0 };
  }, [viewportRef]);

  const captureSessionSnapshot = useCallback((): ArchiveCardSessionSnapshot | null => {
    const pending = pendingRestoreRef.current;
    if (pending) {
      return {
        anchorCardId: pending.anchorCardId,
        anchorOffsetRatio: pending.anchorOffsetRatio,
        scrollRatio: pending.scrollRatio,
        scrollTop: pending.scrollTop,
        selectedCardId: null,
      };
    }
    const viewport = viewportRef.current;
    if (!viewport || cardsRef.current.length === 0) return null;
    const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
    const scrollTop = Math.max(viewport.scrollTop, 0);
    const anchor = captureAnchorFromViewport();
    return {
      anchorCardId: anchor.anchorCardId,
      anchorOffsetRatio: anchor.anchorOffsetRatio,
      scrollRatio: maxScrollable > 0 ? clamp(scrollTop / maxScrollable, 0, 1) : null,
      scrollTop,
      selectedCardId: null,
    };
  }, [captureAnchorFromViewport, viewportRef]);

  const restoreSessionSnapshot = useCallback((payload: ArchiveCardSessionSnapshot) => {
    const snapshot = parseArchiveCardSessionSnapshot(payload);
    if (!snapshot) return;
    pendingRestoreRef.current = {
      anchorCardId: snapshot.anchorCardId,
      anchorOffsetRatio: snapshot.anchorOffsetRatio,
      scrollRatio: snapshot.scrollRatio ?? 0,
      scrollTop: snapshot.scrollTop,
      updatedAt: '',
    };
    pendingSessionResourceNodeIdRef.current = folderNodeId;
    setRestoreTick(prev => prev + 1);
  }, [folderNodeId]);

  const sessionAdapter = useMemo<ViewerSessionAdapter<ArchiveCardSessionSnapshot>>(() => ({
    capture: captureSessionSnapshot,
    restore: restoreSessionSnapshot,
    suspend: () => undefined,
    resume: () => undefined,
    estimateCost: () => ARCHIVE_CARD_SESSION_ESTIMATED_BYTES,
    getPinReasons: () => (activeRef.current ? ['active'] : []),
  }), [captureSessionSnapshot, restoreSessionSnapshot]);

  const { capture: flushSessionSnapshot } = useViewerSession({
    accountScope,
    active,
    adapter: sessionAdapter,
    contentRevision,
    libraryId,
    nodeId: folderNodeId,
    reloadToken,
    schemaVersion: ARCHIVE_CARD_SESSION_SCHEMA_VERSION,
    tabId,
    viewerKind: 'asmr_archive',
  });

  const flushRemoteProgress = useCallback(async (force = false) => {
    if (!folderNodeId || !libraryId) {
      pendingRemoteProgressRef.current = null;
      return;
    }
    if (!active && !force) return;
    if (remoteSyncInflightRef.current) return;

    const pending = pendingRemoteProgressRef.current;
    if (!pending) return;
    const requestId = requestIdRef.current;
    const signature = JSON.stringify(pending);
    if (signature === lastRemoteSyncSignatureRef.current) {
      acknowledgeLatestPendingValue(pendingRemoteProgressRef, pending);
      return;
    }

    let shouldFlushLatest = false;
    remoteSyncInflightRef.current = true;
    try {
      if (!viewMetaBaseReadyRef.current) {
        try {
          const detail = await fetchNodeDetailById(folderNodeId);
          if (requestId !== requestIdRef.current) return;
          viewMetaBaseRef.current = parseViewMetaObject(detail.viewMeta);
          viewMetaBaseReadyRef.current = true;
        } catch (detailError) {
          runtimeLogger.warn('同步前读取 ASMR 归档基础元信息失败:', detailError);
          return;
        }
      }
      const nextMeta = buildViewMetaWithArchiveProgress(viewMetaBaseRef.current, pending);
      await updateNodeConfig({
        id: folderNodeId,
        viewMeta: JSON.stringify(nextMeta),
      });
      if (requestId !== requestIdRef.current) return;
      viewMetaBaseRef.current = nextMeta;
      lastRemoteSyncSignatureRef.current = signature;
      shouldFlushLatest = acknowledgeLatestPendingValue(pendingRemoteProgressRef, pending);
    } catch (syncError) {
      runtimeLogger.warn('同步 ASMR 归档阅读位置失败:', syncError);
    } finally {
      if (requestId === requestIdRef.current) {
        remoteSyncInflightRef.current = false;
        if (shouldFlushLatest && pendingRemoteProgressRef.current && (active || force)) {
          if (remoteSyncTimerRef.current) {
            window.clearTimeout(remoteSyncTimerRef.current);
          }
          remoteSyncTimerRef.current = window.setTimeout(() => {
            remoteSyncTimerRef.current = 0;
            void flushRemoteProgress(force);
          }, force ? 0 : REMOTE_PROGRESS_SYNC_INTERVAL_MS);
        }
      }
    }
  }, [active, folderNodeId, libraryId]);

  const queueRemoteProgress = useCallback((progress: ArchiveReaderProgress, force = false) => {
    pendingRemoteProgressRef.current = progress;
    if (!active && !force) return;
    if (remoteSyncTimerRef.current) {
      window.clearTimeout(remoteSyncTimerRef.current);
    }
    remoteSyncTimerRef.current = window.setTimeout(() => {
      remoteSyncTimerRef.current = 0;
      void flushRemoteProgress(force);
    }, force ? 0 : REMOTE_PROGRESS_SYNC_INTERVAL_MS);
  }, [active, flushRemoteProgress]);

  const loadTagOptions = useCallback(async () => {
    try {
      const options = await fetchTags('ASMR')
        .then(list => list.filter(tag => (
          Number(tag.enabled ?? 1) === 1
          && Number(tag.ownerUserId ?? 0) > 0
        )));
      const nextTagMap = new Map<number, TagItem>();
      const nextNameMap = new Map<string, number>();
      options.forEach((option) => {
        nextTagMap.set(option.id, option);
        const normalizedName = sanitizeMetaText(option.name).toLowerCase();
        if (normalizedName && !nextNameMap.has(normalizedName)) {
          nextNameMap.set(normalizedName, option.id);
        }
      });
      tagOptionMapRef.current = nextTagMap;
      normalizedTagNameMapRef.current = nextNameMap;
      setTagOptionMap(nextTagMap);
      setNormalizedTagNameMap(nextNameMap);
    } catch (tagError) {
      runtimeLogger.warn('加载 ASMR 标签失败，归档卡片将仅显示文本标签:', tagError);
      tagOptionMapRef.current = new Map();
      normalizedTagNameMapRef.current = new Map();
      setTagOptionMap(new Map());
      setNormalizedTagNameMap(new Map());
    }
  }, []);

  const resolveCardCoverUrls = useCallback(async (inputCards: AsmrArchiveCard[]): Promise<AsmrArchiveCard[]> => {
    if (!libraryId || inputCards.length === 0) {
      return inputCards;
    }

    const unresolvedNodeIds = inputCards
      .filter(card => !card.coverUrl && card.coverNodeId && card.coverNodeId > 0)
      .map(card => card.coverNodeId as number);
    if (unresolvedNodeIds.length === 0) {
      return inputCards;
    }

    try {
      const linkMap = await batchGetFileLinks({
        libraryId,
        nodeIds: unresolvedNodeIds,
        expiry: LINK_EXPIRY_MINUTES,
      });
      if (linkMap.size === 0) {
        return inputCards;
      }
      return inputCards.map((card) => {
        if (!card.coverNodeId || card.coverUrl) return card;
        const nextUrl = linkMap.get(card.coverNodeId);
        if (!nextUrl) return card;
        return {
          ...card,
          coverUrl: nextUrl,
        };
      });
    } catch (coverError) {
      runtimeLogger.warn('批量加载 ASMR 归档封面失败:', coverError);
      return inputCards;
    }
  }, [libraryId]);

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
        builtInType: 'ASMR',
        offset,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;

      const nextCards: AsmrArchiveCard[] = page.items.map(item => {
        const viewMeta = String(item.viewMeta || '');
        const tags = resolveAsmrCardTags(
          viewMeta,
          tagOptionMapRef.current,
          normalizedTagNameMapRef.current,
        );
        return {
          id: Number(item.id),
          title: String(item.name || ''),
          sortOrder: Number(item.sortOrder ?? 0),
          coverNodeId: Number.isFinite(Number(item.coverNodeId)) && Number(item.coverNodeId) > 0
            ? Number(item.coverNodeId)
            : null,
          coverUrl: null,
          tags,
          viewMeta,
        };
      });
      const cardsWithUrl = await resolveCardCoverUrls(nextCards);
      if (requestId !== requestIdRef.current) return;

      setCards((prev) => {
        const merged = append ? [...prev, ...cardsWithUrl] : cardsWithUrl;
        const byId = new Map<number, AsmrArchiveCard>();
        merged.forEach((card) => {
          const existing = byId.get(card.id);
          if (!existing) {
            byId.set(card.id, card);
            return;
          }
          byId.set(card.id, {
            ...existing,
            ...card,
            coverUrl: card.coverUrl || existing.coverUrl,
          });
        });
        return Array.from(byId.values()).sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.id - b.id;
        });
      });
      setTotal(page.total);
      setNextOffset(page.offset + page.items.length);
      setHasMore(page.hasMore);
    } catch (loadError) {
      runtimeLogger.error('加载 ASMR 归档分页失败:', loadError);
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
  }, [folderNodeId, libraryId, resolveCardCoverUrls]);

  useEffect(() => {
    setCards(prev => {
      if (prev.length === 0) return prev;
      return prev.map(card => ({
        ...card,
        tags: resolveAsmrCardTags(
          card.viewMeta,
          tagOptionMap,
          normalizedTagNameMap,
        ),
      }));
    });
  }, [normalizedTagNameMap, tagOptionMap]);

  const loadMore = useCallback(() => {
    if (listLoading || loadingMore || !hasMore) return;
    void loadPage(nextOffset, true);
  }, [hasMore, listLoading, loadingMore, loadPage, nextOffset]);

  useEffect(() => {
    void loadTagOptions();
  }, [loadTagOptions]);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    restoreTriggeredLoadMoreRef.current = false;
    const hasWarmSessionRestore = pendingSessionResourceNodeIdRef.current === folderNodeId;
    if (!hasWarmSessionRestore) {
      pendingRestoreRef.current = null;
      pendingSessionResourceNodeIdRef.current = null;
    }
    cardRefs.current.clear();
    pendingRemoteProgressRef.current = null;
    remoteSyncInflightRef.current = false;
    lastRemoteSyncSignatureRef.current = '';
    viewMetaBaseRef.current = {};
    viewMetaBaseReadyRef.current = false;
    if (remoteSyncTimerRef.current) {
      window.clearTimeout(remoteSyncTimerRef.current);
      remoteSyncTimerRef.current = 0;
    }

    if (!folderNodeId || !libraryId) {
      setCards([]);
      setError('归档参数异常');
      setListLoading(false);
      setLoadingMore(false);
      setTotal(0);
      setNextOffset(0);
      setHasMore(false);
      return;
    }

    setCards([]);
    setTotal(0);
    setNextOffset(0);
    setHasMore(false);
    setError(null);
    void loadPage(0, false);

    void (async () => {
      try {
        const detail = await fetchNodeDetailById(folderNodeId);
        if (requestId !== requestIdRef.current) return;
        viewMetaBaseRef.current = parseViewMetaObject(detail.viewMeta);
        viewMetaBaseReadyRef.current = true;
        const remoteProgress = parseRemoteArchiveProgress(detail.viewMeta);
        if (!remoteProgress) return;
        if (!hasWarmSessionRestore && !pendingRestoreRef.current) {
          pendingRestoreRef.current = remoteProgress;
          setRestoreTick((prev) => prev + 1);
        }
      } catch (detailError) {
        runtimeLogger.warn('读取 ASMR 归档阅读位置失败:', detailError);
      }
    })();
  }, [folderNodeId, libraryId, loadPage]);

  useEffect(() => {
    if (!active) return;
    const viewport = viewportRef.current;
    const pending = pendingRestoreRef.current;
    if (!viewport || !pending) return;

    if (pending.anchorCardId) {
      const targetCard = cardRefs.current.get(pending.anchorCardId);
      if (!targetCard) {
        if (hasMore && !listLoading && !loadingMore && !restoreTriggeredLoadMoreRef.current) {
          restoreTriggeredLoadMoreRef.current = true;
          void loadPage(nextOffset, true).finally(() => {
            restoreTriggeredLoadMoreRef.current = false;
          });
        }
        if ((listLoading || loadingMore) && cards.length === 0) {
          return;
        }
        if (!hasMore && !listLoading && !loadingMore) {
          const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
          suppressNextScrollPersistRef.current = true;
          viewport.scrollTop = resolveArchiveCardRestoreScrollTop({
            anchorHeight: null,
            anchorOffsetTop: null,
            maxScrollable,
            snapshot: {
              anchorCardId: pending.anchorCardId,
              anchorOffsetRatio: pending.anchorOffsetRatio,
              scrollRatio: pending.scrollRatio,
              scrollTop: pending.scrollTop,
              selectedCardId: null,
            },
          });
          pendingRestoreRef.current = null;
        }
        return;
      }
      const cardTop = targetCard.offsetTop;
      const cardHeight = targetCard.offsetHeight || 0;
      const expectedTop = cardTop + cardHeight * clamp(pending.anchorOffsetRatio, 0, 1);
      suppressNextScrollPersistRef.current = true;
      viewport.scrollTop = Math.max(Math.floor(expectedTop), 0);
      pendingRestoreRef.current = null;
      return;
    }

    const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
    suppressNextScrollPersistRef.current = true;
    viewport.scrollTop = resolveArchiveCardRestoreScrollTop({
      anchorHeight: null,
      anchorOffsetTop: null,
      maxScrollable,
      snapshot: {
        anchorCardId: null,
        anchorOffsetRatio: pending.anchorOffsetRatio,
        scrollRatio: pending.scrollRatio,
        scrollTop: pending.scrollTop,
        selectedCardId: null,
      },
    });
    pendingRestoreRef.current = null;
  }, [active, cards, hasMore, listLoading, loadPage, loadingMore, nextOffset, restoreTick, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const sentinel = sentinelRef.current;
    if (!viewport || !sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting) return;
      loadMore();
    }, {
      root: viewport,
      threshold: 0.05,
      rootMargin: '240px',
    });
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [loadMore, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onScroll = () => {
      if (suppressNextScrollPersistRef.current) {
        suppressNextScrollPersistRef.current = false;
        return;
      }
      if (pendingRestoreRef.current) {
        pendingRestoreRef.current = null;
      }
      if (scrollPersistRafRef.current) {
        window.cancelAnimationFrame(scrollPersistRafRef.current);
      }
      scrollPersistRafRef.current = window.requestAnimationFrame(() => {
        scrollPersistRafRef.current = 0;
        const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
        const scrollTop = Math.max(viewport.scrollTop, 0);
        const scrollRatio = maxScrollable > 0 ? clamp(scrollTop / maxScrollable, 0, 1) : 0;
        const anchor = captureAnchorFromViewport();
        flushSessionSnapshot();
        queueRemoteProgress({
          anchorCardId: anchor.anchorCardId,
          anchorOffsetRatio: anchor.anchorOffsetRatio,
          scrollTop,
          scrollRatio,
          updatedAt: new Date().toISOString(),
        });
      });
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (scrollPersistRafRef.current) {
        window.cancelAnimationFrame(scrollPersistRafRef.current);
        scrollPersistRafRef.current = 0;
      }
    };
  }, [captureAnchorFromViewport, flushSessionSnapshot, queueRemoteProgress, viewportRef]);

  useEffect(() => {
    if (!active || cards.length === 0) return;
    flushSessionSnapshot();
  }, [active, cards.length, flushSessionSnapshot]);

  useEffect(() => () => {
    if (remoteSyncTimerRef.current) {
      window.clearTimeout(remoteSyncTimerRef.current);
      remoteSyncTimerRef.current = 0;
    }
    void flushRemoteProgress(true);
  }, [flushRemoteProgress]);

  return (
    <AsmrArchiveViewerWrapper style={wrapperStyle}>
      <section className="table-surface" ref={viewportRef}>
        {listLoading ? (
          <div className="state-wrap">
            <Spin size="large" tip="归档加载中..." />
          </div>
        ) : error ? (
          <div className="state-wrap state-error">{error}</div>
        ) : cards.length === 0 ? (
          <div className="state-wrap">当前归档下暂无可展示的 ASMR 集合</div>
        ) : (
          <>
            <div className="cards-grid">
              {cards.map(card => (
                <article
                  key={card.id}
                  className="archive-card"
                  ref={(el) => {
                    if (el) {
                      cardRefs.current.set(card.id, el);
                    } else {
                      cardRefs.current.delete(card.id);
                    }
                  }}
                  onContextMenu={(e) => openCardContextMenu(e, card)}
                  onDoubleClick={() => {
                    if (!libraryId || !folderNodeId || !Number.isFinite(folderNodeId)) return;
                    setFileUrl(
                      `asmr://library/${libraryId}/node/${card.id}`,
                      card.title,
                      'asmr',
                      card.id,
                      {
                        tabTypeLabel: 'ASMR',
                        returnTarget: {
                          fileUrl,
                          fileName: fileName || title,
                          fileType: 'asmr_archive',
                          nodeId: folderNodeId,
                          tabTypeLabel: 'ASMR-ARCHIVE',
                        },
                      },
                    );
                  }}
                >
                  <div className="card-cover">
                    {card.coverUrl ? (
                      <img src={card.coverUrl} alt={card.title} draggable={false} />
                    ) : (
                      <div className="cover-empty" />
                    )}
                  </div>
                  <div className="card-title" title={card.title}>
                    {card.title}
                  </div>
                  <div className="card-tag-slot">
                    {card.tags.length > 0 ? (
                      card.tags.map((tag, index) => (
                        <span
                          key={`tag-${card.id}-${tag.id ?? tag.name}-${index}`}
                          className={`card-tag-pill${tag.fallback ? ' fallback' : ''}`}
                          style={tag.fallback ? undefined : {
                            background: tag.color || 'var(--semi-color-fill-0)',
                            color: tag.textColor || '#fff',
                            borderColor: tag.color || 'var(--semi-color-border)',
                          }}
                          title={tag.name}
                        >
                          {tag.name}
                        </span>
                      ))
                    ) : (
                      <span className="card-tag-empty">暂无标签</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {loadingMore && (
              <div className="state-wrap">
                <Spin size="middle" tip="加载更多中..." />
              </div>
            )}
            <div ref={sentinelRef} style={{ height: 1, width: '100%' }} />
          </>
        )}
      </section>

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

      <Modal
        title="重命名"
        visible={renameDialogVisible}
        onCancel={() => {
          if (renameSubmitting) return;
          setRenameDialogVisible(false);
          setRenameTargetCard(null);
        }}
        onOk={() => {
          void handleRenameSubmit();
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameSubmitting}
        centered
      >
        <Input
          value={renameInput}
          onChange={setRenameInput}
          placeholder="请输入新名称"
          maxLength={255}
          autoFocus
          onEnterPress={() => {
            if (!renameSubmitting) {
              void handleRenameSubmit();
            }
          }}
        />
      </Modal>

      <footer className="archive-footer">
        <div className="footer-title-group">
          <span className="badge">ASMR ARCHIVE</span>
          <span className="title" title={title}>{title}</span>
        </div>
      </footer>
    </AsmrArchiveViewerWrapper>
  );
};

export default AsmrArchiveViewer;
