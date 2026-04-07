import React, { useLayoutEffect } from 'react';
import styled from 'styled-components';
import type { FileViewerTab } from '@/contexts/file-viewer.context';
import {
  resolveTabTypeTone,
  type FileTabToneConfig,
  type TabTypeTone,
} from './tab-type-tone';
import { fetchTags, type TagItem } from '@/features/tag-management/services/tag.api';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { normalizeFileTabTargetKey } from '@/features/tag-management/constants/file-tab-targets';

interface FileTabsBarProps {
  tabs: FileViewerTab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorder: (draggedTabId: string, targetTabId: string, position: 'before' | 'after') => void;
}

const DRAG_START_THRESHOLD_PX = 4;
const REORDER_MIN_STEP_PX = 14;
const REORDER_COOLDOWN_MS = 90;
const MIDPOINT_GUARD_RATIO = 0.16;
const REORDER_FLIP_DURATION_MS = 180;
const TAB_TOP_SCROLLBAR_HEIGHT = 10;
const TAB_TOP_SCROLLBAR_HIDE_DELAY_MS = 900;
const TAB_TOP_SCROLLBAR_HIDE_DELAY_ON_LEAVE_MS = 260;
const TAB_OVERFLOW_BUTTON_WIDTH = 44;
const TAB_OVERFLOW_GAP = 6;
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
  asmr_archive: 84 * 1024 * 1024,
  comic_archive: 92 * 1024 * 1024,
  other: 36 * 1024 * 1024,
};

const TabsFrame = styled.div`
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
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
  scrollbar-color: color-mix(in srgb, var(--semi-color-fill-2) 70%, transparent) transparent;

  &::-webkit-scrollbar {
    height: 10px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--semi-color-fill-2) 70%, transparent);
    border-radius: 999px;
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
  margin-top: 3px;
  border-bottom: 1px solid var(--app-border);
`;

const TabsWrapper = styled.div`
  width: auto;
  min-width: 0;
  flex: 1 1 auto;
  height: 46px;
  display: flex;
  align-items: center;
  gap: ${TAB_OVERFLOW_GAP}px;
  padding: 0 ${TAB_OVERFLOW_BUTTON_WIDTH + 8}px 0 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const TabButton = styled.button<{
  $active: boolean;
  $dropBefore?: boolean;
  $dropAfter?: boolean;
  $dragging?: boolean;
}>`
  height: 42px;
  min-width: 195px;
  max-width: 360px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  border: 1px solid ${({ $active }) => ($active ? 'var(--semi-color-primary)' : 'var(--app-border)')};
  background: ${({ $active }) => ($active ? 'var(--semi-color-primary-light-default)' : 'var(--app-bg-elevated)')};
  color: var(--app-text);
  border-radius: 12px;
  padding: 0 14px 0 15px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
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
`;

const FileTypeBadge = styled.span<{ $tone: TabTypeTone }>`
  flex-shrink: 0;
  min-width: 42px;
  height: 27px;
  border-radius: 999px;
  background: ${({ $tone }) => $tone.background};
  color: ${({ $tone }) => $tone.text};
  border: 1px solid ${({ $tone }) => $tone.border};
  font-size: 14px;
  line-height: 24px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  padding: 0 9px;
`;

const DragGhost = styled.div`
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  height: 42px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--semi-color-primary);
  background: var(--semi-color-primary-light-default);
  color: var(--app-text);
  border-radius: 12px;
  padding: 0 14px 0 15px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
`;

const Name = styled.span`
  min-width: 0;
  flex: 1;
  font-size: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
`;

const CloseButton = styled.button`
  flex-shrink: 0;
  width: 27px;
  height: 27px;
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

const OverflowSlot = styled.div`
  position: absolute;
  right: 0;
  top: 0;
  z-index: 5;
  height: 47px;
  width: ${TAB_OVERFLOW_BUTTON_WIDTH}px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--app-bg-1) 0%, transparent),
    var(--app-bg-1) 24%
  );
`;

const OverflowTrigger = styled.button<{ $open: boolean; $disabled: boolean }>`
  width: 34px;
  height: 34px;
  border: 1px solid ${({ $open }) => ($open ? 'var(--semi-color-primary)' : 'var(--app-border)')};
  border-radius: 10px;
  background: ${({ $open }) => ($open ? 'var(--semi-color-primary-light-default)' : 'var(--app-bg-elevated)')};
  color: ${({ $disabled }) => ($disabled ? 'var(--app-text-faint)' : 'var(--app-text-muted)')};
  cursor: ${({ $disabled }) => ($disabled ? 'default' : 'pointer')};
  opacity: ${({ $disabled }) => ($disabled ? 0.72 : 1)};
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover {
    border-color: ${({ $disabled }) => ($disabled ? 'var(--app-border)' : 'var(--semi-color-primary)')};
    color: ${({ $disabled }) => ($disabled ? 'var(--app-text-faint)' : 'var(--app-text)')};
  }

  .dot-stack {
    display: inline-block;
    line-height: 1;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0;
  }
`;

const OverflowMenu = styled.div`
  position: absolute;
  top: calc(100% - 2px);
  right: 0;
  width: 360px;
  max-height: 380px;
  overflow: auto;
  z-index: 40;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
`;

const OverflowMenuItem = styled.button<{ $active: boolean }>`
  width: 100%;
  border: 1px solid ${({ $active }) => ($active ? 'var(--semi-color-primary)' : 'transparent')};
  background: ${({ $active }) => ($active ? 'var(--semi-color-primary-light-default)' : 'transparent')};
  border-radius: 8px;
  padding: 8px 10px;
  margin: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 10px;
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
    return normalized;
  }
  const fileType = tab.fileType;
  if (fileType === 'image') return 'IMG';
  if (fileType === 'audio') return 'MP3';
  if (fileType === 'video') return 'MP4';
  if (fileType === 'pdf') return 'PDF';
  if (fileType === 'comic') return 'COMIC';
  if (fileType === 'asmr') return 'ASMR';
  if (fileType === 'asmr_archive') return 'ASMR-A';
  if (fileType === 'comic_archive') return 'COMIC-A';
  return 'FILE';
}

function getDisplayName(tab: FileViewerTab) {
  const raw = tab.fileName?.trim() || '';
  if (!raw) return '未命名文件';
  const trimmed = raw
    .replace(/^ASMR\s*归档\s*·\s*/iu, '')
    .replace(/^COMIC\s*归档\s*·\s*/iu, '')
    .replace(/^ASMR\s*·\s*/iu, '')
    .replace(/^COMIC\s*·\s*/iu, '')
    .replace(/\s*[【[]\s*ASMR\s*·\s*归档\s*[】\]]\s*$/iu, '')
    .replace(/\s*[【[]\s*COMIC\s*·\s*归档\s*[】\]]\s*$/iu, '')
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
}) => {
  const [remoteToneByTargetKey, setRemoteToneByTargetKey] = React.useState<Record<string, FileTabToneConfig>>({});
  const [draggingTabId, setDraggingTabId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{ tabId: string; position: 'before' | 'after' } | null>(null);
  const [dragGhost, setDragGhost] = React.useState<{ left: number; top: number; width: number } | null>(null);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = React.useState(false);
  const [topScrollVisible, setTopScrollVisible] = React.useState(false);
  const [tabsScrollWidth, setTabsScrollWidth] = React.useState(0);
  const [overflowMenuTabIds, setOverflowMenuTabIds] = React.useState<string[]>([]);
  const [overflowMenuOpen, setOverflowMenuOpen] = React.useState(false);
  const [reorderTick, setReorderTick] = React.useState(0);
  const blockClickUntilRef = React.useRef(0);
  const lastReorderSignatureRef = React.useRef('');
  const lastReorderAtRef = React.useRef(0);
  const flipFromLeftRef = React.useRef<Map<string, number> | null>(null);
  const mouseMoveListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const mouseUpListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const topScrollRef = React.useRef<HTMLDivElement | null>(null);
  const tabsWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const overflowMenuRef = React.useRef<HTMLDivElement | null>(null);
  const overflowTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const topScrollHideTimerRef = React.useRef<number | null>(null);
  const tabsHoveringRef = React.useRef(false);
  const tabButtonRefMap = React.useRef(new Map<string, HTMLButtonElement>());
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

  const loadFileTabTones = React.useCallback(async () => {
    try {
      const tags = await fetchTags('FILE_TAB');
      const nextMap: Record<string, FileTabToneConfig> = {};
      const chosenByTarget: Record<string, TagItem> = {};
      tags
        .filter((tag: TagItem) => String(tag.type || '').toUpperCase() === 'FILE_TAB')
        .forEach((tag) => {
          const targetKey = normalizeFileTabTargetKey(String(tag.targetKey || ''));
          if (!targetKey) return;
          const previous = chosenByTarget[targetKey];
          if (previous) {
            const previousIsSystem = previous.ownerUserId === null || previous.ownerUserId === undefined;
            const currentIsSystem = tag.ownerUserId === null || tag.ownerUserId === undefined;
            if (previousIsSystem && !currentIsSystem) {
              // 用户标签覆盖系统标签
            } else if (previousIsSystem === currentIsSystem) {
              const previousSort = Number(previous.sortOrder ?? 0);
              const currentSort = Number(tag.sortOrder ?? 0);
              if (currentSort >= previousSort) {
                return;
              }
            } else {
              return;
            }
          }
          chosenByTarget[targetKey] = tag;
          nextMap[targetKey] = {
            targetKey,
            color: tag.color,
            textColor: tag.textColor,
            enabled: tag.enabled,
          };
        });
      setRemoteToneByTargetKey(nextMap);
    } catch (error) {
      runtimeLogger.warn('加载顶部标签配色配置失败，回退默认色盘:', error);
      setRemoteToneByTargetKey({});
    }
  }, []);

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
    if (!wrapper || tabs.length === 0) {
      return [] as string[];
    }
    if (wrapper.scrollWidth - wrapper.clientWidth <= 1) {
      return [] as string[];
    }
    const leftBound = wrapper.scrollLeft + 1;
    const rightBound = wrapper.scrollLeft + wrapper.clientWidth - 1;
    return tabs
      .map((tab) => {
        const el = tabButtonRefMap.current.get(tab.id);
        if (!el) return tab.id;
        const tabLeft = el.offsetLeft;
        const tabRight = tabLeft + el.offsetWidth;
        return tabLeft < leftBound || tabRight > rightBound ? tab.id : null;
      })
      .filter((value): value is string => Boolean(value));
  }, [tabs]);

  const collectVisibleDropTargetTabIds = React.useCallback((draggedId: string) => {
    const wrapper = tabsWrapperRef.current;
    if (!wrapper || tabs.length === 0) {
      return [] as string[];
    }
    const leftBound = wrapper.scrollLeft + 1;
    const rightBound = wrapper.scrollLeft + wrapper.clientWidth - 1;
    return tabs
      .map((tab) => {
        if (tab.id === draggedId) return null;
        const el = tabButtonRefMap.current.get(tab.id);
        if (!el) return null;
        const tabLeft = el.offsetLeft;
        const tabRight = tabLeft + el.offsetWidth;
        const visible = tabRight >= leftBound && tabLeft <= rightBound;
        return visible ? tab.id : null;
      })
      .filter((value): value is string => Boolean(value));
  }, [tabs]);

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

  React.useEffect(() => {
    void loadFileTabTones();
  }, [loadFileTabTones]);

  React.useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  React.useLayoutEffect(() => {
    checkHorizontalOverflow();
  }, [checkHorizontalOverflow, tabs, remoteToneByTargetKey]);

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
    const handler = () => {
      void loadFileTabTones();
    };
    window.addEventListener('omniflow:file-tab-tags-updated', handler as EventListener);
    return () => {
      window.removeEventListener('omniflow:file-tab-tags-updated', handler as EventListener);
    };
  }, [loadFileTabTones]);

  React.useEffect(() => {
    if (!activeTabId) return;
    const wrapper = tabsWrapperRef.current;
    if (!wrapper) return;
    const rafId = window.requestAnimationFrame(() => {
      const activeEl = tabButtonRefMap.current.get(activeTabId);
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
  }, [activeTabId, checkHorizontalOverflow, tabs.length]);

  const overflowTabs = React.useMemo(() => {
    if (overflowMenuTabIds.length === 0) return [] as FileViewerTab[];
    const tabMap = new Map(tabs.map(tab => [tab.id, tab]));
    return overflowMenuTabIds
      .map(tabId => tabMap.get(tabId))
      .filter((tab): tab is FileViewerTab => Boolean(tab));
  }, [overflowMenuTabIds, tabs]);

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
  }, [activeTabId, overflowMenuOpen, refreshOverflowMenuTabIds, tabs.length]);

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

  const handleTabsWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return;
    const wrapper = tabsWrapperRef.current;
    if (!wrapper) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.1) return;
    event.preventDefault();
    wrapper.scrollLeft += delta;
    const topScroll = topScrollRef.current;
    if (topScroll && Math.abs(topScroll.scrollLeft - wrapper.scrollLeft) > 1) {
      topScroll.scrollLeft = wrapper.scrollLeft;
    }
    revealTopScrollTemporarily();
  }, [revealTopScrollTemporarily]);

  const captureTabLefts = React.useCallback(() => {
    const positions = new Map<string, number>();
    tabs.forEach((tab) => {
      const el = tabButtonRefMap.current.get(tab.id);
      if (!el) return;
      positions.set(tab.id, el.getBoundingClientRect().left);
    });
    return positions;
  }, [tabs]);

  const resolveClosestDropTarget = (
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
  };

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

  React.useEffect(() => {
    return () => {
      detachWindowDragListeners();
    };
  }, [detachWindowDragListeners]);

  useLayoutEffect(() => {
    const fromLeft = flipFromLeftRef.current;
    if (!fromLeft) {
      return;
    }
    flipFromLeftRef.current = null;

    tabs.forEach((tab) => {
      if (tab.id === draggingTabId) return;
      const el = tabButtonRefMap.current.get(tab.id);
      if (!el) return;
      const prevLeft = fromLeft.get(tab.id);
      if (prevLeft === undefined) return;
      const nextLeft = el.getBoundingClientRect().left;
      const deltaX = prevLeft - nextLeft;
      if (Math.abs(deltaX) < 0.5) return;

      el.style.transition = 'none';
      el.style.transform = `translateX(${deltaX}px)`;
      void el.offsetWidth;
      el.style.transition = `transform ${REORDER_FLIP_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      el.style.transform = 'translateX(0px)';
      const cleanup = () => {
        el.style.transition = '';
        el.style.transform = '';
        el.removeEventListener('transitionend', cleanup);
      };
      el.addEventListener('transitionend', cleanup);
    });
  }, [tabs, reorderTick, draggingTabId]);

  if (tabs.length === 0) return null;
  const draggingTab = draggingTabId ? (tabs.find(tab => tab.id === draggingTabId) ?? null) : null;

  return (
    <>
      <TabsFrame
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
          $visible={hasHorizontalOverflow && topScrollVisible}
          onScroll={handleTopScroll}
        >
          <TabsTopScrollInner style={{ width: `${Math.max(tabsScrollWidth, 0)}px` }} />
        </TabsTopScroll>
        <TabsContainer
        >
        <TabsWrapper
          ref={tabsWrapperRef}
          onWheel={handleTabsWheel}
        >
          {tabs.map(tab => {
        const tabTypeLabel = getTabTypeLabel(tab);
        const badgeTone = resolveTabTypeTone(tab, tabTypeLabel, remoteToneByTargetKey);
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
            type="button"
            $active={tab.id === activeTabId}
            $dropBefore={isDropBefore}
            $dropAfter={isDropAfter}
            $dragging={draggingTabId === tab.id}
            ref={(el) => {
              if (el) {
                tabButtonRefMap.current.set(tab.id, el);
              } else {
                tabButtonRefMap.current.delete(tab.id);
              }
            }}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              const rect = event.currentTarget.getBoundingClientRect();
              pendingDragRef.current = {
                tabId: tab.id,
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
                if (!pending || pending.tabId !== tab.id) {
                  return;
                }

                const offsetX = moveEvent.clientX - pending.startX;
                if (!pending.started) {
                  if (Math.abs(offsetX) < DRAG_START_THRESHOLD_PX) {
                    return;
                  }
                  pending.started = true;
                  setDraggingTabId(tab.id);
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
                  tab.id,
                  pending.lastDropTarget,
                );
                if (!nextDropTarget) {
                  setDropTarget(null);
                  pending.lastDropTarget = null;
                  return;
                }
                setDropTarget(nextDropTarget);
                const signature = `${tab.id}->${nextDropTarget.tabId}:${nextDropTarget.position}`;
                const now = Date.now();
                if (
                  signature !== lastReorderSignatureRef.current
                  && now - lastReorderAtRef.current >= REORDER_COOLDOWN_MS
                ) {
                  flipFromLeftRef.current = captureTabLefts();
                  onReorder(tab.id, nextDropTarget.tabId, nextDropTarget.position);
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
                    tab.id,
                    pending.lastDropTarget,
                  ) ?? pending.lastDropTarget;
                  if (finalDropTarget) {
                    const signature = `${tab.id}->${finalDropTarget.tabId}:${finalDropTarget.position}`;
                    if (signature !== lastReorderSignatureRef.current) {
                      flipFromLeftRef.current = captureTabLefts();
                      onReorder(tab.id, finalDropTarget.tabId, finalDropTarget.position);
                      setReorderTick((prev) => prev + 1);
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
            }}
            onClick={() => {
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
            <FileTypeBadge $tone={badgeTone}>{tabTypeLabel}</FileTypeBadge>
            <Name>{getDisplayName(tab)}</Name>
            <CloseButton
              type="button"
              aria-label="关闭标签"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
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
        {tabs.length > 1 ? (
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
                {overflowTabs.map((tab) => {
                  const tabTypeLabel = getTabTypeLabel(tab);
                  const badgeTone = resolveTabTypeTone(tab, tabTypeLabel, remoteToneByTargetKey);
                  return (
                    <OverflowMenuItem
                      key={`overflow-${tab.id}`}
                      type="button"
                      $active={tab.id === activeTabId}
                      onClick={() => {
                        onActivate(tab.id);
                        setOverflowMenuOpen(false);
                      }}
                    >
                      <FileTypeBadge $tone={badgeTone}>{tabTypeLabel}</FileTypeBadge>
                      <Name title={getDisplayName(tab)}>{getDisplayName(tab)}</Name>
                    </OverflowMenuItem>
                  );
                })}
              </OverflowMenu>
            ) : null}
          </OverflowSlot>
        ) : null}
      </TabsContainer>
      </TabsFrame>
      {draggingTab && dragGhost ? (
        <DragGhost style={{ left: `${dragGhost.left}px`, top: `${dragGhost.top}px`, width: `${dragGhost.width}px` }}>
          <FileTypeBadge $tone={resolveTabTypeTone(draggingTab, getTabTypeLabel(draggingTab), remoteToneByTargetKey)}>
            {getTabTypeLabel(draggingTab)}
          </FileTypeBadge>
          <Name>{getDisplayName(draggingTab)}</Name>
        </DragGhost>
      ) : null}
    </>
  );
};

export default FileTabsBar;
