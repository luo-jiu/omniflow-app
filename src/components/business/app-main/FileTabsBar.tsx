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

const TabsWrapper = styled.div`
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 0;
  border-bottom: 1px solid var(--app-border);
  overflow-x: auto;
  overflow-y: hidden;

  &::-webkit-scrollbar {
    height: 4px;
  }
`;

const TabButton = styled.button<{
  $active: boolean;
  $dropBefore?: boolean;
  $dropAfter?: boolean;
  $dragging?: boolean;
}>`
  height: 28px;
  min-width: 130px;
  max-width: 240px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid ${({ $active }) => ($active ? 'var(--semi-color-primary)' : 'var(--app-border)')};
  background: ${({ $active }) => ($active ? 'var(--semi-color-primary-light-default)' : 'var(--app-bg-elevated)')};
  color: var(--app-text);
  border-radius: 8px;
  padding: 0 9px 0 10px;
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
  min-width: 28px;
  height: 18px;
  border-radius: 999px;
  background: ${({ $tone }) => $tone.background};
  color: ${({ $tone }) => $tone.text};
  border: 1px solid ${({ $tone }) => $tone.border};
  font-size: 10px;
  line-height: 16px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  padding: 0 6px;
`;

const DragGhost = styled.div`
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--semi-color-primary);
  background: var(--semi-color-primary-light-default);
  color: var(--app-text);
  border-radius: 8px;
  padding: 0 9px 0 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
`;

const Name = styled.span`
  min-width: 0;
  flex: 1;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
`;

const CloseButton = styled.button`
  flex-shrink: 0;
  width: 18px;
  height: 18px;
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

function getTabTypeLabel(tab: FileViewerTab) {
  if (tab.tabTypeLabel && tab.tabTypeLabel.trim()) {
    return tab.tabTypeLabel.trim().toUpperCase();
  }
  const fileType = tab.fileType;
  if (fileType === 'image') return 'IMG';
  if (fileType === 'audio') return 'MP3';
  if (fileType === 'video') return 'MP4';
  if (fileType === 'pdf') return 'PDF';
  if (fileType === 'comic') return 'COMIC';
  if (fileType === 'asmr') return 'ASMR';
  if (fileType === 'asmr_archive') return 'ASMR-ARC';
  return 'FILE';
}

function getDisplayName(tab: FileViewerTab) {
  return tab.fileName?.trim() || '未命名文件';
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
  const [reorderTick, setReorderTick] = React.useState(0);
  const blockClickUntilRef = React.useRef(0);
  const lastReorderSignatureRef = React.useRef('');
  const lastReorderAtRef = React.useRef(0);
  const flipFromLeftRef = React.useRef<Map<string, number> | null>(null);
  const mouseMoveListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const mouseUpListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const tabButtonRefMap = React.useRef(new Map<string, HTMLButtonElement>());
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

  React.useEffect(() => {
    void loadFileTabTones();
  }, [loadFileTabTones]);

  React.useEffect(() => {
    const handler = () => {
      void loadFileTabTones();
    };
    window.addEventListener('omniflow:file-tab-tags-updated', handler as EventListener);
    return () => {
      window.removeEventListener('omniflow:file-tab-tags-updated', handler as EventListener);
    };
  }, [loadFileTabTones]);

  const clearDragState = () => {
    setDraggingTabId(null);
    setDropTarget(null);
    setDragGhost(null);
    lastReorderSignatureRef.current = '';
    lastReorderAtRef.current = 0;
  };

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
    let hovered: { tabId: string; rect: DOMRect } | null = null;
    for (const tab of tabs) {
      if (tab.id === draggedId) continue;
      const el = tabButtonRefMap.current.get(tab.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        hovered = { tabId: tab.id, rect };
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
    for (const tab of tabs) {
      if (tab.id === draggedId) continue;
      const el = tabButtonRefMap.current.get(tab.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const position: 'before' | 'after' = clientX < midpoint ? 'before' : 'after';
      const distance = Math.abs(clientX - midpoint);
      if (!nearest || distance < nearest.distance) {
        nearest = { tabId: tab.id, position, distance };
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
      <TabsWrapper>
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
            title={getDisplayName(tab)}
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
