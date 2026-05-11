import React, { useLayoutEffect } from 'react';
import styled from 'styled-components';
import type { FileViewerTab } from '@/contexts/file-viewer.context';
import {
  getDirectoryBuiltInIcon,
  getFileNodeIcon,
} from '@/features/file-explorer/utils/file-node-icon';

interface FileTabsBarProps {
  tabs: FileViewerTab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorder: (draggedTabId: string, targetTabId: string, position: 'before' | 'after') => void;
  onItemReorder?: (draggedItemId: string, targetItemId: string, position: 'before' | 'after') => void;
  itemOrder?: string[];
  extraTabs?: FileTabsBarExtraTab[];
}

export type FileTabsBarExtraTab = {
  id: string;
  title: string;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
};

type FileTabsBarItem =
  | { id: string; kind: 'file'; tab: FileViewerTab }
  | { id: string; kind: 'extra'; tab: FileTabsBarExtraTab };

type ClosingTabSnapshot = {
  item: FileTabsBarItem;
  index: number;
};

type TabLayoutSnapshot = {
  left: number;
};

const DRAG_START_THRESHOLD_PX = 4;
const REORDER_MIN_STEP_PX = 14;
const REORDER_COOLDOWN_MS = 90;
const MIDPOINT_GUARD_RATIO = 0.16;
const TAB_LAYOUT_FLIP_DURATION_MS = 180;
const TAB_CLOSE_COLLAPSE_MS = 160;
const TAB_CLOSE_REMOVE_DELAY_MS = TAB_CLOSE_COLLAPSE_MS + 70;
const TAB_TOP_SCROLLBAR_HEIGHT = 7;
const TAB_TOP_SCROLLBAR_HIDE_DELAY_MS = 900;
const TAB_TOP_SCROLLBAR_HIDE_DELAY_ON_LEAVE_MS = 260;
const TAB_DEFAULT_WIDTH = 168;
const TAB_MIN_WIDTH = 96;
const TAB_OVERFLOW_BUTTON_WIDTH = 32;
const TAB_OVERFLOW_GAP = 4;
const TAB_MEMORY_SAMPLE_DELAY_MS = 900;
const TAB_MEMORY_MAX_STALE_MS = 120_000;
const TAB_MEMORY_GLOBAL_COOLDOWN_MS = 8_000;

const TAB_MEMORY_FALLBACK_BY_TYPE: Record<string, number> = {
  image: 64 * 1024 * 1024,
  video: 180 * 1024 * 1024,
  audio: 24 * 1024 * 1024,
  pdf: 72 * 1024 * 1024,
  comic: 120 * 1024 * 1024,
  asmr: 96 * 1024 * 1024,
  video_archive: 118 * 1024 * 1024,
  asmr_archive: 84 * 1024 * 1024,
  comic_archive: 92 * 1024 * 1024,
  audio_archive: 72 * 1024 * 1024,
  other: 36 * 1024 * 1024,
};

const TabsFrame = styled.div<{ $scrollVisible: boolean }>`
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;

  ${({ $scrollVisible }) => $scrollVisible ? `
    .tabs-top-scroll {
      scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
    }

    .tabs-top-scroll::-webkit-scrollbar-thumb {
      background: var(--app-scrollbar-thumb);
    }
  ` : ''}
`;

const TabsTopScroll = styled.div<{ $visible: boolean }>`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  z-index: 6;
  width: 100%;
  min-width: 0;
  height: ${TAB_TOP_SCROLLBAR_HEIGHT}px;
  margin-bottom: 0;
  padding: 0;
  box-sizing: border-box;
  overflow-x: scroll;
  overflow-y: hidden;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity 0.16s ease;
  pointer-events: ${({ $visible }) => ($visible ? 'auto' : 'none')};
  scrollbar-gutter: stable both-edges;
  scrollbar-width: auto;
  scrollbar-color: transparent transparent;

  &::-webkit-scrollbar {
    height: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--app-scrollbar-track);
  }

  &::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  &:hover,
  &:focus-within,
  &:active {
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  &:hover::-webkit-scrollbar-thumb,
  &:focus-within::-webkit-scrollbar-thumb,
  &:active::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
  }

  &:hover::-webkit-scrollbar-thumb:hover,
  &:focus-within::-webkit-scrollbar-thumb:hover,
  &:active::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
  }
`;

const TabsTopScrollInner = styled.div`
  height: 1px;
  min-height: 1px;
`;

const TabsContainer = styled.div`
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  position: relative;
  margin-top: 2px;
  padding-top: 1px;
  padding-bottom: 4px;

  &::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--app-border);
    pointer-events: none;
    z-index: 1;
  }
`;

const TabsWrapper = styled.div`
  width: auto;
  min-width: 0;
  flex: 1 1 auto;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 ${TAB_OVERFLOW_BUTTON_WIDTH + 5}px 0 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const TabButton = styled.div<{
  $active: boolean;
  $dropBefore?: boolean;
  $dropAfter?: boolean;
  $dragging?: boolean;
  $closing?: boolean;
}>`
  height: 30px;
  width: ${TAB_DEFAULT_WIDTH}px;
  min-width: ${TAB_MIN_WIDTH}px;
  flex: 0 1 ${TAB_DEFAULT_WIDTH}px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid ${({ $active }) => ($active ? 'var(--semi-color-primary)' : 'var(--app-border)')};
  background: ${({ $active }) => ($active ? 'var(--semi-color-primary-light-default)' : 'var(--app-bg-elevated)')};
  color: var(--app-text);
  border-radius: 8px;
  padding: 0 7px;
  margin-right: ${TAB_OVERFLOW_GAP}px;
  cursor: pointer;
  overflow: hidden;
  transition:
    width ${TAB_CLOSE_COLLAPSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    min-width ${TAB_CLOSE_COLLAPSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    flex-basis ${TAB_CLOSE_COLLAPSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    padding ${TAB_CLOSE_COLLAPSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    margin-right ${TAB_CLOSE_COLLAPSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    border-left-width ${TAB_CLOSE_COLLAPSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    border-right-width ${TAB_CLOSE_COLLAPSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease,
    opacity 0.15s ease;
  user-select: none;
  position: relative;

  &:hover {
    border-color: var(--semi-color-primary);
  }

  ${({ $dropBefore }) => $dropBefore ? `
    box-shadow: inset 2px 0 0 var(--semi-color-primary);
  ` : ''}

  ${({ $dropAfter }) => $dropAfter ? `
    box-shadow: inset -2px 0 0 var(--semi-color-primary);
  ` : ''}

  ${({ $dragging }) => $dragging ? `
    opacity: 0.45;
    transform: scale(0.985);
    z-index: 2;
  ` : ''}

  ${({ $closing }) => $closing ? `
    width: 0;
    min-width: 0;
    flex-basis: 0;
    padding-left: 0;
    padding-right: 0;
    border-color: transparent;
    border-left-width: 0;
    border-right-width: 0;
    opacity: 0;
    margin-right: 0;
    pointer-events: none;
  ` : ''}

  &:last-child {
    margin-right: 0;
  }
`;

const TabIconSlot = styled.span`
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  .tree-file-type-icon {
    width: 15px;
    height: 15px;
  }
`;

const DragGhost = styled.div`
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--semi-color-primary);
  background: var(--semi-color-primary-light-default);
  color: var(--app-text);
  border-radius: 8px;
  padding: 0 7px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
`;

const Name = styled.span`
  min-width: 0;
  flex: 1;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
`;

const CloseButton = styled.button`
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--semi-color-text-2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;

  &:hover {
    color: var(--semi-color-danger);
    background: color-mix(in srgb, var(--semi-color-danger) 12%, transparent);
  }
`;

function normalizeTabTypeForIcon(tabTypeLabel: string): string {
  return String(tabTypeLabel || '')
    .trim()
    .toUpperCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-');
}

function getFileExtFromTab(tab: FileViewerTab): string {
  const fileName = String(tab.fileName || '').trim();
  const match = /\.([^.\\/]+)$/.exec(fileName);
  return match?.[1] ?? '';
}

function getBuiltInTypeFromTab(tab: FileViewerTab): 'ASMR' | 'COMIC' | 'VIDEO' | 'AUDIO' | null {
  const label = normalizeTabTypeForIcon(getTabTypeLabel(tab));
  if (label.startsWith('ASMR')) return 'ASMR';
  if (label.startsWith('COMIC')) return 'COMIC';
  if (label.startsWith('VIDEO')) return 'VIDEO';
  if (label.startsWith('AUDIO')) return 'AUDIO';
  if (tab.fileType === 'asmr' || tab.fileType === 'asmr_archive') return 'ASMR';
  if (tab.fileType === 'comic' || tab.fileType === 'comic_archive') return 'COMIC';
  if (tab.fileType === 'video_archive') return 'VIDEO';
  if (tab.fileType === 'audio_archive') return 'AUDIO';
  return null;
}

function isDirectoryLikeTab(tab: FileViewerTab): boolean {
  return (
    tab.fileType === 'asmr'
    || tab.fileType === 'comic'
    || tab.fileType === 'asmr_archive'
    || tab.fileType === 'comic_archive'
    || tab.fileType === 'video_archive'
    || tab.fileType === 'audio_archive'
    || (tab.fileType === 'video' && normalizeTabTypeForIcon(getTabTypeLabel(tab)) === 'VIDEO')
  );
}

function getFileTabIcon(tab: FileViewerTab): React.ReactNode {
  if (isDirectoryLikeTab(tab)) {
    const builtInType = getBuiltInTypeFromTab(tab);
    const archiveMode = tab.fileType?.endsWith('_archive') ? 1 : 0;
    return getDirectoryBuiltInIcon(builtInType ?? 'DEF', archiveMode, false) ?? getFileNodeIcon();
  }
  return getFileNodeIcon(getFileExtFromTab(tab), tab.fileName ?? undefined, {
    previewKind: (
      tab.fileType === 'image'
      || tab.fileType === 'video'
      || tab.fileType === 'audio'
      || tab.fileType === 'pdf'
      || tab.fileType === 'text'
      || tab.fileType === 'other'
    ) ? tab.fileType : null,
  });
}

function FileTabIcon({ tab }: { tab: FileViewerTab }) {
  return (
    <TabIconSlot title={getTabTypeLabel(tab)}>
      {getFileTabIcon(tab)}
    </TabIconSlot>
  );
}

function SystemTabIcon() {
  return (
    <TabIconSlot title="系统">
      {getFileNodeIcon('env', '.env')}
    </TabIconSlot>
  );
}

const OverflowSlot = styled.div`
  position: absolute;
  right: 0;
  top: 0;
  z-index: 5;
  height: 33px;
  width: ${TAB_OVERFLOW_BUTTON_WIDTH}px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--app-bg-1) 0%, transparent),
    var(--app-bg-1) 24%
  );
  pointer-events: none;
`;

const OverflowTrigger = styled.button<{ $open: boolean; $disabled: boolean }>`
  width: 24px;
  height: 24px;
  border: 1px solid ${({ $open }) => ($open ? 'var(--semi-color-primary)' : 'var(--app-border)')};
  border-radius: 7px;
  background: ${({ $open }) => ($open ? 'var(--semi-color-primary-light-default)' : 'var(--app-bg-elevated)')};
  color: ${({ $disabled }) => ($disabled ? 'var(--app-text-faint)' : 'var(--app-text-muted)')};
  cursor: ${({ $disabled }) => ($disabled ? 'default' : 'pointer')};
  opacity: ${({ $disabled }) => ($disabled ? 0.72 : 1)};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;

  &:hover {
    border-color: ${({ $disabled }) => ($disabled ? 'var(--app-border)' : 'var(--semi-color-primary)')};
    color: ${({ $disabled }) => ($disabled ? 'var(--app-text-faint)' : 'var(--app-text)')};
  }

  .dot-stack {
    display: inline-block;
    line-height: 1;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0;
  }
`;

const OverflowMenu = styled.div`
  position: absolute;
  top: calc(100% - 2px);
  right: 0;
  width: 260px;
  max-height: 280px;
  overflow: auto;
  z-index: 40;
  padding: 5px;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  background: var(--app-bg-elevated);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  pointer-events: auto;
`;

const OverflowMenuItem = styled.button<{ $active: boolean }>`
  width: 100%;
  border: 1px solid ${({ $active }) => ($active ? 'var(--semi-color-primary)' : 'transparent')};
  background: ${({ $active }) => ($active ? 'var(--semi-color-primary-light-default)' : 'transparent')};
  border-radius: 6px;
  padding: 5px 7px;
  margin: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--app-text);

  &:hover {
    border-color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 8%, transparent);
  }
`;

function getTabTypeLabel(tab: FileViewerTab) {
  if (tab.tabTypeLabel && tab.tabTypeLabel.trim()) {
    const normalized = tab.tabTypeLabel.trim().toUpperCase();
    if (
      normalized === 'VIDEO-ARCHIVE'
      || normalized === 'VIDEO ARC'
      || normalized === 'VIDEO-ARC'
      || normalized === 'VIDEO_ARCHIVE'
    ) {
      return 'VIDEO-A';
    }
    if (
      normalized === 'ASMR-ARCHIVE'
      || normalized === 'ASMR ARC'
      || normalized === 'ASMR-ARC'
      || normalized === 'ASMR_ARCHIVE'
    ) {
      return 'ASMR-A';
    }
    if (
      normalized === 'COMIC-ARCHIVE'
      || normalized === 'COMIC ARC'
      || normalized === 'COMIC-ARC'
      || normalized === 'COMIC_ARCHIVE'
    ) {
      return 'COMIC-A';
    }
    if (
      normalized === 'AUDIO-ARCHIVE'
      || normalized === 'AUDIO ARC'
      || normalized === 'AUDIO-ARC'
      || normalized === 'AUDIO_ARCHIVE'
    ) {
      return 'AUDIO-A';
    }
    return normalized;
  }
  const fileType = tab.fileType;
  if (fileType === 'image') return 'IMG';
  if (fileType === 'audio') return 'MP3';
  if (fileType === 'video') return 'MP4';
  if (fileType === 'pdf') return 'PDF';
  if (fileType === 'comic') return 'COMIC';
  if (fileType === 'asmr') return 'ASMR';
  if (fileType === 'video_archive') return 'VIDEO-A';
  if (fileType === 'asmr_archive') return 'ASMR-A';
  if (fileType === 'comic_archive') return 'COMIC-A';
  if (fileType === 'audio_archive') return 'AUDIO-A';
  return 'FILE';
}

function getDisplayName(tab: FileViewerTab) {
  const raw = tab.fileName?.trim() || '';
  if (!raw) return '未命名文件';
  const trimmed = raw
    .replace(/^VIDEO\s*归档\s*·\s*/iu, '')
    .replace(/^ASMR\s*归档\s*·\s*/iu, '')
    .replace(/^COMIC\s*归档\s*·\s*/iu, '')
    .replace(/^AUDIO\s*归档\s*·\s*/iu, '')
    .replace(/^VIDEO\s*·\s*/iu, '')
    .replace(/^ASMR\s*·\s*/iu, '')
    .replace(/^COMIC\s*·\s*/iu, '')
    .replace(/^AUDIO\s*·\s*/iu, '')
    .replace(/\s*[【[]\s*VIDEO\s*·\s*归档\s*[】\]]\s*$/iu, '')
    .replace(/\s*[【[]\s*ASMR\s*·\s*归档\s*[】\]]\s*$/iu, '')
    .replace(/\s*[【[]\s*COMIC\s*·\s*归档\s*[】\]]\s*$/iu, '')
    .replace(/\s*[【[]\s*AUDIO\s*·\s*归档\s*[】\]]\s*$/iu, '')
    .trim();
  return trimmed || '未命名文件';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知';
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / kb))} KB`;
}

function areSameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

let uaMemoryProbeAvailable: boolean | null = null;

async function estimateRendererMemoryBytes(): Promise<number | null> {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
    measureUserAgentSpecificMemory?: () => Promise<{ bytes?: number }>;
  };
  const uaMemoryProbe = perf.measureUserAgentSpecificMemory;
  const canUseUaMemoryProbe = (
    uaMemoryProbeAvailable !== false
    && typeof uaMemoryProbe === 'function'
  );
  if (canUseUaMemoryProbe) {
    try {
      const result = await uaMemoryProbe();
      if (typeof result?.bytes === 'number' && Number.isFinite(result.bytes) && result.bytes > 0) {
        uaMemoryProbeAvailable = true;
        return result.bytes;
      }
    } catch {
      // 忽略不支持或权限受限的浏览器实现，回退到 JS Heap 估算
      uaMemoryProbeAvailable = false;
    }
  }
  const usedHeap = perf.memory?.usedJSHeapSize;
  if (typeof usedHeap === 'number' && Number.isFinite(usedHeap) && usedHeap > 0) {
    return usedHeap;
  }
  return null;
}

function resolveFallbackTabMemoryBytes(tab: FileViewerTab): number {
  const key = String(tab.fileType ?? 'other');
  return TAB_MEMORY_FALLBACK_BY_TYPE[key] ?? TAB_MEMORY_FALLBACK_BY_TYPE.other;
}

const FileTabsBar: React.FC<FileTabsBarProps> = ({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onReorder,
  onItemReorder,
  itemOrder,
  extraTabs = [],
}) => {
  const [draggingTabId, setDraggingTabId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{ tabId: string; position: 'before' | 'after' } | null>(null);
  const [dragGhost, setDragGhost] = React.useState<{ left: number; top: number; width: number } | null>(null);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = React.useState(false);
  const [topScrollVisible, setTopScrollVisible] = React.useState(false);
  const [tabsScrollWidth, setTabsScrollWidth] = React.useState(0);
  const [overflowMenuTabIds, setOverflowMenuTabIds] = React.useState<string[]>([]);
  const [overflowMenuOpen, setOverflowMenuOpen] = React.useState(false);
  const [reorderTick, setReorderTick] = React.useState(0);
  const [closingItemSnapshots, setClosingItemSnapshots] = React.useState<Map<string, ClosingTabSnapshot>>(
    () => new Map(),
  );
  const blockClickUntilRef = React.useRef(0);
  const lastReorderSignatureRef = React.useRef('');
  const lastReorderAtRef = React.useRef(0);
  const tabLayoutSnapshotRef = React.useRef<Map<string, TabLayoutSnapshot>>(new Map());
  const pendingTabLayoutSnapshotRef = React.useRef<Map<string, TabLayoutSnapshot> | null>(null);
  const mouseMoveListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const mouseUpListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const topScrollRef = React.useRef<HTMLDivElement | null>(null);
  const tabsWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const overflowMenuRef = React.useRef<HTMLDivElement | null>(null);
  const overflowTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const topScrollHideTimerRef = React.useRef<number | null>(null);
  const closeTimerRef = React.useRef<Map<string, number>>(new Map());
  const tabsHoveringRef = React.useRef(false);
  const tabButtonRefMap = React.useRef(new Map<string, HTMLDivElement>());
  const tabSampleTimerRef = React.useRef<number | null>(null);
  const hoverTabIdRef = React.useRef<string | null>(null);
  const samplingTabIdRef = React.useRef<string | null>(null);
  const activeTabIdRef = React.useRef<string | null>(activeTabId);
  const tabMemorySamplesRef = React.useRef<Record<string, { bytes: number; sampledAt: number }>>({});
  const lastMemoryAttemptAtRef = React.useRef(0);
  const [tabMemorySamples, setTabMemorySamples] = React.useState<Record<string, { bytes: number; sampledAt: number }>>(
    {},
  );
  const pendingDragRef = React.useRef<{
    tabId: string;
    startX: number;
    started: boolean;
    grabOffsetX: number;
    ghostTop: number;
    ghostWidth: number;
    lastReorderClientX: number | null;
    lastDropTarget: { tabId: string; position: 'before' | 'after' } | null;
  } | null>(null);

  const baseTabItems = React.useMemo<FileTabsBarItem[]>(() => [
    ...tabs.map(tab => ({ id: tab.id, kind: 'file' as const, tab })),
    ...extraTabs.map(tab => ({ id: tab.id, kind: 'extra' as const, tab })),
  ], [extraTabs, tabs]);
  const tabItems = React.useMemo<FileTabsBarItem[]>(() => {
    if (!itemOrder?.length) {
      return baseTabItems;
    }
    const itemMap = new Map(baseTabItems.map(item => [item.id, item]));
    const usedIds = new Set<string>();
    const orderedItems = itemOrder
      .map((itemId) => {
        const item = itemMap.get(itemId);
        if (!item) return null;
        usedIds.add(itemId);
        return item;
      })
      .filter((item): item is FileTabsBarItem => Boolean(item));
    return [
      ...orderedItems,
      ...baseTabItems.filter(item => !usedIds.has(item.id)),
    ];
  }, [baseTabItems, itemOrder]);
  const activeExtraTabId = React.useMemo(() => (
    extraTabs.find(tab => tab.active)?.id ?? null
  ), [extraTabs]);
  const activeScrollTargetId = activeTabId ?? activeExtraTabId;
  const liveTabItemIds = React.useMemo(() => new Set(tabItems.map(item => item.id)), [tabItems]);
  const exitingItemIds = React.useMemo(() => {
    const ids = new Set<string>();
    closingItemSnapshots.forEach((_, itemId) => {
      if (!liveTabItemIds.has(itemId)) {
        ids.add(itemId);
      }
    });
    return ids;
  }, [closingItemSnapshots, liveTabItemIds]);
  const renderedTabItems = React.useMemo(() => {
    const exitingSnapshots = Array.from(closingItemSnapshots.values())
      .filter(snapshot => !liveTabItemIds.has(snapshot.item.id))
      .sort((left, right) => left.index - right.index);
    if (exitingSnapshots.length === 0) {
      return tabItems;
    }

    const nextItems = [...tabItems];
    exitingSnapshots.forEach((snapshot) => {
      const insertAt = Math.min(Math.max(snapshot.index, 0), nextItems.length);
      nextItems.splice(insertAt, 0, snapshot.item);
    });
    return nextItems;
  }, [closingItemSnapshots, liveTabItemIds, tabItems]);

  const checkHorizontalOverflow = React.useCallback(() => {
    const wrapper = tabsWrapperRef.current;
    if (!wrapper) {
      setHasHorizontalOverflow(false);
      setTabsScrollWidth(0);
      return;
    }
    const nextHasOverflow = wrapper.scrollWidth - wrapper.clientWidth > 1;
    setHasHorizontalOverflow(nextHasOverflow);
    setTabsScrollWidth((prev) => (
      Math.abs(prev - wrapper.scrollWidth) > 0.5 ? wrapper.scrollWidth : prev
    ));
    const topScroll = topScrollRef.current;
    if (topScroll && Math.abs(topScroll.scrollLeft - wrapper.scrollLeft) > 1) {
      topScroll.scrollLeft = wrapper.scrollLeft;
    }
  }, []);

  const collectHiddenTabIds = React.useCallback(() => {
    const wrapper = tabsWrapperRef.current;
    if (!wrapper || tabItems.length === 0) {
      return [] as string[];
    }
    if (wrapper.scrollWidth - wrapper.clientWidth <= 1) {
      return [] as string[];
    }
    const leftBound = wrapper.scrollLeft + 1;
    const rightBound = wrapper.scrollLeft + wrapper.clientWidth - 1;
    return tabItems
      .map((tabItem) => {
        const el = tabButtonRefMap.current.get(tabItem.id);
        if (!el) return tabItem.id;
        const tabLeft = el.offsetLeft;
        const tabRight = tabLeft + el.offsetWidth;
        return tabLeft < leftBound || tabRight > rightBound ? tabItem.id : null;
      })
      .filter((value): value is string => Boolean(value));
  }, [tabItems]);

  const collectVisibleDropTargetTabIds = React.useCallback((draggedId: string) => {
    const wrapper = tabsWrapperRef.current;
    if (!wrapper || tabItems.length === 0) {
      return [] as string[];
    }
    const leftBound = wrapper.scrollLeft + 1;
    const rightBound = wrapper.scrollLeft + wrapper.clientWidth - 1;
    return tabItems
      .map((tabItem) => {
        if (tabItem.id === draggedId) return null;
        const el = tabButtonRefMap.current.get(tabItem.id);
        if (!el) return null;
        const tabLeft = el.offsetLeft;
        const tabRight = tabLeft + el.offsetWidth;
        const visible = tabRight >= leftBound && tabLeft <= rightBound;
        return visible ? tabItem.id : null;
      })
      .filter((value): value is string => Boolean(value));
  }, [tabItems]);

  const refreshOverflowMenuTabIds = React.useCallback(() => {
    const nextTabIds = collectHiddenTabIds();
    setOverflowMenuTabIds((prev) => (areSameStringArray(prev, nextTabIds) ? prev : nextTabIds));
  }, [collectHiddenTabIds]);

  const clearTopScrollHideTimer = React.useCallback(() => {
    if (topScrollHideTimerRef.current !== null) {
      window.clearTimeout(topScrollHideTimerRef.current);
      topScrollHideTimerRef.current = null;
    }
  }, []);

  const revealTopScrollTemporarily = React.useCallback(() => {
    if (!hasHorizontalOverflow) {
      clearTopScrollHideTimer();
      setTopScrollVisible(false);
      return;
    }
    setTopScrollVisible(true);
    clearTopScrollHideTimer();
    if (tabsHoveringRef.current) {
      return;
    }
    topScrollHideTimerRef.current = window.setTimeout(() => {
      setTopScrollVisible(false);
      topScrollHideTimerRef.current = null;
    }, TAB_TOP_SCROLLBAR_HIDE_DELAY_MS);
  }, [clearTopScrollHideTimer, hasHorizontalOverflow]);

  const hideTopScrollSoon = React.useCallback(() => {
    clearTopScrollHideTimer();
    if (tabsHoveringRef.current) {
      return;
    }
    topScrollHideTimerRef.current = window.setTimeout(() => {
      setTopScrollVisible(false);
      topScrollHideTimerRef.current = null;
    }, TAB_TOP_SCROLLBAR_HIDE_DELAY_ON_LEAVE_MS);
  }, [clearTopScrollHideTimer]);

  const hideTopScrollAfterAction = React.useCallback(() => {
    tabsHoveringRef.current = false;
    clearTopScrollHideTimer();
    window.requestAnimationFrame(() => {
      clearTopScrollHideTimer();
      topScrollHideTimerRef.current = window.setTimeout(() => {
        setTopScrollVisible(false);
        topScrollHideTimerRef.current = null;
      }, TAB_TOP_SCROLLBAR_HIDE_DELAY_ON_LEAVE_MS);
    });
  }, [clearTopScrollHideTimer]);

  React.useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  React.useLayoutEffect(() => {
    checkHorizontalOverflow();
  }, [checkHorizontalOverflow, tabItems]);

  React.useEffect(() => {
    const wrapper = tabsWrapperRef.current;
    if (!wrapper) return undefined;
    const observer = new ResizeObserver(() => {
      checkHorizontalOverflow();
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [checkHorizontalOverflow]);

  React.useEffect(() => {
    const onWindowResize = () => {
      checkHorizontalOverflow();
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [checkHorizontalOverflow]);

  React.useEffect(() => {
    const wrapper = tabsWrapperRef.current;
    if (!wrapper) return undefined;
    const onScroll = () => {
      const topScroll = topScrollRef.current;
      if (topScroll && Math.abs(topScroll.scrollLeft - wrapper.scrollLeft) > 1) {
        topScroll.scrollLeft = wrapper.scrollLeft;
      }
      revealTopScrollTemporarily();
      if (overflowMenuOpen) {
        refreshOverflowMenuTabIds();
      }
    };
    wrapper.addEventListener('scroll', onScroll, { passive: true });
    return () => wrapper.removeEventListener('scroll', onScroll);
  }, [overflowMenuOpen, refreshOverflowMenuTabIds, revealTopScrollTemporarily]);

  React.useEffect(() => {
    const wrapper = tabsWrapperRef.current;
    if (!wrapper) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.shiftKey) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.1) return;
      event.preventDefault();
      wrapper.scrollLeft += delta;
      const topScroll = topScrollRef.current;
      if (topScroll && Math.abs(topScroll.scrollLeft - wrapper.scrollLeft) > 1) {
        topScroll.scrollLeft = wrapper.scrollLeft;
      }
      revealTopScrollTemporarily();
    };
    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, [revealTopScrollTemporarily]);

  React.useEffect(() => {
    if (!activeScrollTargetId) return;
    const wrapper = tabsWrapperRef.current;
    if (!wrapper) return;
    const rafId = window.requestAnimationFrame(() => {
      const activeEl = tabButtonRefMap.current.get(activeScrollTargetId);
      if (!activeEl) return;
      const targetLeft = activeEl.offsetLeft;
      const targetRight = targetLeft + activeEl.offsetWidth;
      const viewLeft = wrapper.scrollLeft;
      const viewRight = viewLeft + wrapper.clientWidth;
      if (targetRight > viewRight) {
        wrapper.scrollTo({
          left: targetRight - wrapper.clientWidth,
          behavior: 'smooth',
        });
      } else if (targetLeft < viewLeft) {
        wrapper.scrollTo({
          left: targetLeft,
          behavior: 'smooth',
        });
      }
      checkHorizontalOverflow();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeScrollTargetId, checkHorizontalOverflow, tabItems.length]);

  const overflowItems = React.useMemo(() => {
    if (overflowMenuTabIds.length === 0) return [] as FileTabsBarItem[];
    const tabMap = new Map(tabs.map(tab => [tab.id, tab]));
    const extraTabMap = new Map(extraTabs.map(tab => [tab.id, tab]));
    return overflowMenuTabIds
      .map((tabId) => {
        const fileTab = tabMap.get(tabId);
        if (fileTab) {
          return { id: tabId, kind: 'file' as const, tab: fileTab };
        }
        const extraTab = extraTabMap.get(tabId);
        if (extraTab) {
          return { id: tabId, kind: 'extra' as const, tab: extraTab };
        }
        return null;
      })
      .filter((tab): tab is FileTabsBarItem => Boolean(tab));
  }, [extraTabs, overflowMenuTabIds, tabs]);

  React.useEffect(() => {
    if (!hasHorizontalOverflow && overflowMenuOpen) {
      setOverflowMenuOpen(false);
      setOverflowMenuTabIds([]);
    }
  }, [hasHorizontalOverflow, overflowMenuOpen]);

  React.useEffect(() => {
    if (hasHorizontalOverflow) {
      revealTopScrollTemporarily();
      return;
    }
    clearTopScrollHideTimer();
    setTopScrollVisible(false);
  }, [clearTopScrollHideTimer, hasHorizontalOverflow, revealTopScrollTemporarily]);

  React.useEffect(() => () => {
    clearTopScrollHideTimer();
  }, [clearTopScrollHideTimer]);

  React.useEffect(() => {
    if (!overflowMenuOpen) return;
    refreshOverflowMenuTabIds();
  }, [activeScrollTargetId, overflowMenuOpen, refreshOverflowMenuTabIds, tabItems.length]);

  React.useEffect(() => {
    if (!overflowMenuOpen) {
      return undefined;
    }
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (overflowMenuRef.current?.contains(target)) return;
      if (overflowTriggerRef.current?.contains(target)) return;
      setOverflowMenuOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [overflowMenuOpen]);

  const clearDragState = () => {
    setDraggingTabId(null);
    setDropTarget(null);
    setDragGhost(null);
    lastReorderSignatureRef.current = '';
    lastReorderAtRef.current = 0;
  };

  const requestCloseItem = React.useCallback((itemId: string, closeItem: () => void) => {
    if (closeTimerRef.current.has(itemId)) {
      return;
    }
    const closingIndex = tabItems.findIndex(item => item.id === itemId);
    const closingItem = closingIndex >= 0 ? tabItems[closingIndex] : null;
    if (!closingItem) {
      closeItem();
      return;
    }
    pendingTabLayoutSnapshotRef.current = null;
    setClosingItemSnapshots((prev) => {
      if (prev.has(itemId)) {
        return prev;
      }
      const next = new Map(prev);
      next.set(itemId, {
        item: closingItem,
        index: closingIndex,
      });
      return next;
    });
    closeItem();
    const timer = window.setTimeout(() => {
      closeTimerRef.current.delete(itemId);
      setClosingItemSnapshots((prev) => {
        if (!prev.has(itemId)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
    }, TAB_CLOSE_REMOVE_DELAY_MS);
    closeTimerRef.current.set(itemId, timer);
  }, [tabItems]);

  React.useEffect(() => {
    const liveItemIds = new Set(tabItems.map(item => item.id));
    closeTimerRef.current.forEach((timer, itemId) => {
      if (!liveItemIds.has(itemId)) {
        return;
      }
      window.clearTimeout(timer);
      closeTimerRef.current.delete(itemId);
    });
    setClosingItemSnapshots((prev) => {
      let changed = false;
      const next = new Map(prev);
      prev.forEach((_, itemId) => {
        if (liveItemIds.has(itemId)) {
          changed = true;
          next.delete(itemId);
        }
      });
      return changed ? next : prev;
    });
  }, [tabItems]);

  React.useEffect(() => () => {
    closeTimerRef.current.forEach(timer => window.clearTimeout(timer));
    closeTimerRef.current.clear();
  }, []);

  const clearTabSampleTimer = React.useCallback(() => {
    if (tabSampleTimerRef.current !== null) {
      window.clearTimeout(tabSampleTimerRef.current);
      tabSampleTimerRef.current = null;
    }
  }, []);

  const sampleTabMemory = React.useCallback(async (tabId: string) => {
    if (!tabId || activeTabIdRef.current !== tabId) {
      return;
    }
    if (samplingTabIdRef.current === tabId) {
      return;
    }
    const existing = tabMemorySamplesRef.current[tabId];
    if (
      existing
      && Date.now() - existing.sampledAt < TAB_MEMORY_MAX_STALE_MS
    ) {
      return;
    }
    const now = Date.now();
    if (now - lastMemoryAttemptAtRef.current < TAB_MEMORY_GLOBAL_COOLDOWN_MS) {
      return;
    }
    lastMemoryAttemptAtRef.current = now;
    samplingTabIdRef.current = tabId;
    try {
      const bytes = await estimateRendererMemoryBytes();
      if (!bytes) {
        return;
      }
      const sampledAt = Date.now();
      setTabMemorySamples((prev) => {
        const next = {
          ...prev,
          [tabId]: { bytes, sampledAt },
        };
        tabMemorySamplesRef.current = next;
        return next;
      });
    } finally {
      if (samplingTabIdRef.current === tabId) {
        samplingTabIdRef.current = null;
      }
    }
  }, []);

  React.useEffect(() => {
    const validTabIds = new Set(tabs.map(tab => tab.id));
    setTabMemorySamples((prev) => {
      let changed = false;
      const next: Record<string, { bytes: number; sampledAt: number }> = {};
      Object.entries(prev).forEach(([tabId, value]) => {
        if (validTabIds.has(tabId)) {
          next[tabId] = value;
        } else {
          changed = true;
        }
      });
      tabMemorySamplesRef.current = changed ? next : prev;
      return changed ? next : prev;
    });
  }, [tabs]);

  React.useEffect(() => () => {
    clearTabSampleTimer();
  }, [clearTabSampleTimer]);

  const scheduleTabMemorySample = React.useCallback((tabId: string) => {
    if (!tabId || tabId !== activeTabIdRef.current) {
      return;
    }
    clearTabSampleTimer();
    tabSampleTimerRef.current = window.setTimeout(() => {
      tabSampleTimerRef.current = null;
      if (hoverTabIdRef.current !== tabId) {
        return;
      }
      void sampleTabMemory(tabId);
    }, TAB_MEMORY_SAMPLE_DELAY_MS);
  }, [clearTabSampleTimer, sampleTabMemory]);

  const handleTopScroll = React.useCallback(() => {
    const wrapper = tabsWrapperRef.current;
    const topScroll = topScrollRef.current;
    if (!wrapper || !topScroll) return;
    if (Math.abs(wrapper.scrollLeft - topScroll.scrollLeft) <= 1) return;
    wrapper.scrollLeft = topScroll.scrollLeft;
    revealTopScrollTemporarily();
  }, [revealTopScrollTemporarily]);

  const captureTabLayouts = React.useCallback(() => {
    const layouts = new Map<string, TabLayoutSnapshot>();
    tabItems.forEach((tabItem) => {
      const el = tabButtonRefMap.current.get(tabItem.id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      layouts.set(tabItem.id, {
        left: rect.left,
      });
    });
    return layouts;
  }, [tabItems]);

  const dispatchReorder = React.useCallback((
    draggedId: string,
    targetId: string,
    position: 'before' | 'after',
  ) => {
    const draggedItem = tabItems.find(item => item.id === draggedId);
    const targetItem = tabItems.find(item => item.id === targetId);
    if (!draggedItem || !targetItem) {
      return false;
    }
    onItemReorder?.(draggedId, targetId, position);
    if (draggedItem.kind === 'file' && targetItem.kind === 'file') {
      onReorder(draggedId, targetId, position);
    }
    return true;
  }, [onItemReorder, onReorder, tabItems]);

  const resolveClosestDropTarget = React.useCallback((
    clientX: number,
    draggedId: string,
    previousTarget: { tabId: string; position: 'before' | 'after' } | null,
  ): { tabId: string; position: 'before' | 'after' } | null => {
    const candidateTabIds = collectVisibleDropTargetTabIds(draggedId);
    if (candidateTabIds.length === 0) {
      return null;
    }

    let hovered: { tabId: string; rect: DOMRect } | null = null;
    for (const tabId of candidateTabIds) {
      const el = tabButtonRefMap.current.get(tabId);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        hovered = { tabId, rect };
        break;
      }
    }

    if (hovered) {
      const midpoint = hovered.rect.left + hovered.rect.width / 2;
      const guardHalfWidth = hovered.rect.width * MIDPOINT_GUARD_RATIO;
      if (Math.abs(clientX - midpoint) <= guardHalfWidth) {
        if (previousTarget?.tabId === hovered.tabId) {
          return previousTarget;
        }
        return null;
      }
      return {
        tabId: hovered.tabId,
        position: clientX < midpoint ? 'before' : 'after',
      };
    }

    let nearest: { tabId: string; position: 'before' | 'after'; distance: number } | null = null;
    for (const tabId of candidateTabIds) {
      const el = tabButtonRefMap.current.get(tabId);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const position: 'before' | 'after' = clientX < midpoint ? 'before' : 'after';
      const distance = Math.abs(clientX - midpoint);
      if (!nearest || distance < nearest.distance) {
        nearest = { tabId, position, distance };
      }
    }
    if (!nearest) return null;
    return { tabId: nearest.tabId, position: nearest.position };
  }, [collectVisibleDropTargetTabIds]);

  const detachWindowDragListeners = React.useCallback(() => {
    if (mouseMoveListenerRef.current) {
      window.removeEventListener('mousemove', mouseMoveListenerRef.current);
      mouseMoveListenerRef.current = null;
    }
    if (mouseUpListenerRef.current) {
      window.removeEventListener('mouseup', mouseUpListenerRef.current);
      mouseUpListenerRef.current = null;
    }
  }, []);

  const handleTabMouseDown = React.useCallback((
    event: React.MouseEvent<HTMLDivElement>,
    tabId: string,
  ) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pendingDragRef.current = {
      tabId,
      startX: event.clientX,
      started: false,
      grabOffsetX: event.clientX - rect.left,
      ghostTop: rect.top,
      ghostWidth: rect.width,
      lastReorderClientX: null,
      lastDropTarget: null,
    };
    setDropTarget(null);
    setDragGhost(null);
    detachWindowDragListeners();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const pending = pendingDragRef.current;
      if (!pending || pending.tabId !== tabId) {
        return;
      }

      const offsetX = moveEvent.clientX - pending.startX;
      if (!pending.started) {
        if (Math.abs(offsetX) < DRAG_START_THRESHOLD_PX) {
          return;
        }
        pending.started = true;
        setDraggingTabId(tabId);
        blockClickUntilRef.current = Date.now() + 180;
      }

      setDragGhost({
        left: moveEvent.clientX - pending.grabOffsetX,
        top: pending.ghostTop,
        width: pending.ghostWidth,
      });
      if (
        pending.lastReorderClientX !== null
        && Math.abs(moveEvent.clientX - pending.lastReorderClientX) < REORDER_MIN_STEP_PX
      ) {
        return;
      }

      const nextDropTarget = resolveClosestDropTarget(
        moveEvent.clientX,
        tabId,
        pending.lastDropTarget,
      );
      if (!nextDropTarget) {
        setDropTarget(null);
        pending.lastDropTarget = null;
        return;
      }
      setDropTarget(nextDropTarget);
      const signature = `${tabId}->${nextDropTarget.tabId}:${nextDropTarget.position}`;
      const now = Date.now();
      if (
        signature !== lastReorderSignatureRef.current
        && now - lastReorderAtRef.current >= REORDER_COOLDOWN_MS
      ) {
        pendingTabLayoutSnapshotRef.current = captureTabLayouts();
        if (!dispatchReorder(tabId, nextDropTarget.tabId, nextDropTarget.position)) {
          return;
        }
        setReorderTick((prev) => prev + 1);
        lastReorderSignatureRef.current = signature;
        lastReorderAtRef.current = now;
        pending.lastReorderClientX = moveEvent.clientX;
        pending.lastDropTarget = nextDropTarget;
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const pending = pendingDragRef.current;
      pendingDragRef.current = null;
      detachWindowDragListeners();
      if (pending?.started) {
        const finalDropTarget = resolveClosestDropTarget(
          upEvent.clientX,
          tabId,
          pending.lastDropTarget,
        ) ?? pending.lastDropTarget;
        if (finalDropTarget) {
          const signature = `${tabId}->${finalDropTarget.tabId}:${finalDropTarget.position}`;
          if (signature !== lastReorderSignatureRef.current) {
            pendingTabLayoutSnapshotRef.current = captureTabLayouts();
            if (dispatchReorder(tabId, finalDropTarget.tabId, finalDropTarget.position)) {
              setReorderTick((prev) => prev + 1);
            }
          }
        }
        clearDragState();
        return;
      }
      clearDragState();
    };

    mouseMoveListenerRef.current = handleMouseMove;
    mouseUpListenerRef.current = handleMouseUp;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [
    captureTabLayouts,
    detachWindowDragListeners,
    dispatchReorder,
    resolveClosestDropTarget,
  ]);

  React.useEffect(() => {
    return () => {
      detachWindowDragListeners();
    };
  }, [detachWindowDragListeners]);

  useLayoutEffect(() => {
    const previousLayouts = pendingTabLayoutSnapshotRef.current;
    pendingTabLayoutSnapshotRef.current = null;
    const nextLayouts = captureTabLayouts();
    tabLayoutSnapshotRef.current = nextLayouts;
    if (!previousLayouts || previousLayouts.size === 0 || nextLayouts.size === 0) {
      return;
    }

    tabItems.forEach((tabItem) => {
      if (tabItem.id === draggingTabId) return;
      const el = tabButtonRefMap.current.get(tabItem.id);
      if (!el) return;
      const prevLayout = previousLayouts.get(tabItem.id);
      const nextLayout = nextLayouts.get(tabItem.id);
      if (!prevLayout || !nextLayout) return;
      const deltaX = prevLayout.left - nextLayout.left;
      if (Math.abs(deltaX) < 0.5) return;

      el.style.transition = 'none';
      el.style.transform = `translateX(${deltaX}px)`;
      void el.offsetWidth;
      el.style.transition = `transform ${TAB_LAYOUT_FLIP_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      el.style.transform = 'translateX(0px)';
      const cleanup = () => {
        window.clearTimeout(cleanupTimer);
        el.style.transition = '';
        el.style.transform = '';
        el.removeEventListener('transitionend', handleTransitionEnd);
      };
      const handleTransitionEnd = (event: TransitionEvent) => {
        if (event.propertyName !== 'transform') return;
        cleanup();
      };
      const cleanupTimer = window.setTimeout(cleanup, TAB_LAYOUT_FLIP_DURATION_MS + 80);
      el.addEventListener('transitionend', handleTransitionEnd);
    });
  }, [captureTabLayouts, draggingTabId, reorderTick, tabItems]);

  if (tabItems.length === 0 && renderedTabItems.length === 0) return null;
  const draggingItem = draggingTabId ? (renderedTabItems.find(item => item.id === draggingTabId) ?? null) : null;

  return (
    <>
      <TabsFrame
        className="file-tabs-bar"
        $scrollVisible={hasHorizontalOverflow && topScrollVisible}
        onMouseEnter={() => {
          tabsHoveringRef.current = true;
          revealTopScrollTemporarily();
        }}
        onMouseLeave={() => {
          tabsHoveringRef.current = false;
          hideTopScrollSoon();
        }}
      >
        <TabsTopScroll
          ref={topScrollRef}
          className="tabs-top-scroll"
          $visible={hasHorizontalOverflow && topScrollVisible}
          onScroll={handleTopScroll}
        >
          <TabsTopScrollInner style={{ width: `${Math.max(tabsScrollWidth, 0)}px` }} />
        </TabsTopScroll>
        <TabsContainer
        >
        <TabsWrapper
          ref={tabsWrapperRef}
        >
          {renderedTabItems.map((tabItem) => {
        if (tabItem.kind === 'extra') {
          const tab = tabItem.tab;
          const isClosing = exitingItemIds.has(tab.id);
          return (
            <TabButton
              key={tab.id}
              role="button"
              tabIndex={0}
              $active={tab.active}
              $dropBefore={Boolean(
                draggingTabId
                && draggingTabId !== tab.id
                && dropTarget?.tabId === tab.id
                && dropTarget.position === 'before',
              )}
              $dropAfter={Boolean(
                draggingTabId
                && draggingTabId !== tab.id
                && dropTarget?.tabId === tab.id
                && dropTarget.position === 'after',
              )}
              $dragging={draggingTabId === tab.id}
              $closing={isClosing}
              ref={(el) => {
                if (el) {
                  tabButtonRefMap.current.set(tab.id, el);
                } else {
                  tabButtonRefMap.current.delete(tab.id);
                }
              }}
              onMouseDown={(event) => {
                if (isClosing) return;
                handleTabMouseDown(event, tab.id);
              }}
              onClick={() => {
                if (isClosing) {
                  return;
                }
                if (Date.now() < blockClickUntilRef.current) {
                  return;
                }
                tab.onActivate();
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) {
                  return;
                }
                if (event.key !== 'Enter' && event.key !== ' ') {
                  return;
                }
                event.preventDefault();
                if (isClosing) {
                  return;
                }
                tab.onActivate();
              }}
              title={tab.title}
            >
              <SystemTabIcon />
              <Name>{tab.title}</Name>
              <CloseButton
                type="button"
                aria-label="关闭标签"
                onClick={(event) => {
                  event.stopPropagation();
                  requestCloseItem(tab.id, tab.onClose);
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
              >
                ×
              </CloseButton>
            </TabButton>
          );
        }
        const tab = tabItem.tab;
        const isClosing = exitingItemIds.has(tab.id);
        const isDropBefore = Boolean(
          draggingTabId
          && draggingTabId !== tab.id
          && dropTarget?.tabId === tab.id
          && dropTarget.position === 'before',
        );
        const isDropAfter = Boolean(
          draggingTabId
          && draggingTabId !== tab.id
          && dropTarget?.tabId === tab.id
          && dropTarget.position === 'after',
        );
        const memorySnapshot = tabMemorySamples[tab.id];
        const memoryBytes = memorySnapshot?.bytes ?? resolveFallbackTabMemoryBytes(tab);
        const memoryLine = `内存占用: ${formatBytes(memoryBytes)}`;
        const tabTitle = `${getDisplayName(tab)}\n${memoryLine}`;
        return (
          <TabButton
            key={tab.id}
            role="button"
            tabIndex={0}
            $active={tab.id === activeTabId}
            $dropBefore={isDropBefore}
            $dropAfter={isDropAfter}
            $dragging={draggingTabId === tab.id}
            $closing={isClosing}
            ref={(el) => {
              if (el) {
                tabButtonRefMap.current.set(tab.id, el);
              } else {
                tabButtonRefMap.current.delete(tab.id);
              }
            }}
            onMouseDown={(event) => {
              if (isClosing) return;
              handleTabMouseDown(event, tab.id);
            }}
            onClick={() => {
              if (isClosing) {
                return;
              }
              if (Date.now() < blockClickUntilRef.current) {
                return;
              }
              onActivate(tab.id);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) {
                return;
              }
              if (event.key !== 'Enter' && event.key !== ' ') {
                return;
              }
              event.preventDefault();
              if (isClosing) {
                return;
              }
              if (Date.now() < blockClickUntilRef.current) {
                return;
              }
              onActivate(tab.id);
            }}
            onMouseEnter={() => {
              hoverTabIdRef.current = tab.id;
              scheduleTabMemorySample(tab.id);
            }}
            onMouseLeave={() => {
              if (hoverTabIdRef.current === tab.id) {
                hoverTabIdRef.current = null;
              }
              clearTabSampleTimer();
            }}
            title={tabTitle}
          >
            <FileTabIcon tab={tab} />
            <Name>{getDisplayName(tab)}</Name>
            <CloseButton
              type="button"
              aria-label="关闭标签"
              onClick={(event) => {
                event.stopPropagation();
                requestCloseItem(tab.id, () => onClose(tab.id));
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
            >
              ×
            </CloseButton>
          </TabButton>
        );
      })}
        </TabsWrapper>
        {tabItems.length > 1 ? (
          <OverflowSlot>
            <OverflowTrigger
              ref={overflowTriggerRef}
              type="button"
              $open={overflowMenuOpen}
              $disabled={!hasHorizontalOverflow}
              aria-label="更多标签"
              onClick={() => {
                if (!hasHorizontalOverflow) {
                  setOverflowMenuOpen(false);
                  setOverflowMenuTabIds([]);
                  return;
                }
                const nextOpen = !overflowMenuOpen;
                if (nextOpen) {
                  refreshOverflowMenuTabIds();
                }
                setOverflowMenuOpen(nextOpen);
              }}
            >
              <span className="dot-stack">⋮</span>
            </OverflowTrigger>
            {overflowMenuOpen ? (
              <OverflowMenu ref={overflowMenuRef}>
                {overflowItems.map((item) => {
                  if (item.kind === 'extra') {
                    return (
                      <OverflowMenuItem
                        key={`overflow-${item.id}`}
                        type="button"
                        $active={item.tab.active}
                        onClick={() => {
                          item.tab.onActivate();
                          setOverflowMenuOpen(false);
                          hideTopScrollAfterAction();
                        }}
                      >
                        <SystemTabIcon />
                        <Name title={item.tab.title}>{item.tab.title}</Name>
                      </OverflowMenuItem>
                    );
                  }
                  return (
                    <OverflowMenuItem
                      key={`overflow-${item.id}`}
                      type="button"
                      $active={item.tab.id === activeTabId}
                      onClick={() => {
                        onActivate(item.tab.id);
                        setOverflowMenuOpen(false);
                        hideTopScrollAfterAction();
                      }}
                    >
                      <FileTabIcon tab={item.tab} />
                      <Name title={getDisplayName(item.tab)}>{getDisplayName(item.tab)}</Name>
                    </OverflowMenuItem>
                  );
                })}
              </OverflowMenu>
            ) : null}
          </OverflowSlot>
        ) : null}
      </TabsContainer>
      </TabsFrame>
      {draggingItem && dragGhost ? (
        <DragGhost style={{ left: `${dragGhost.left}px`, top: `${dragGhost.top}px`, width: `${dragGhost.width}px` }}>
          {draggingItem.kind === 'file' ? (
            <>
              <FileTabIcon tab={draggingItem.tab} />
              <Name>{getDisplayName(draggingItem.tab)}</Name>
            </>
          ) : (
            <>
              <SystemTabIcon />
              <Name>{draggingItem.tab.title}</Name>
            </>
          )}
        </DragGhost>
      ) : null}
    </>
  );
};

export default FileTabsBar;
