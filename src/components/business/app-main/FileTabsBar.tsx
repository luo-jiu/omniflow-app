import React from 'react';
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
}

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

const TabButton = styled.button<{ $active: boolean }>`
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
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--semi-color-primary);
  }
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
}) => {
  const [remoteToneByTargetKey, setRemoteToneByTargetKey] = React.useState<Record<string, FileTabToneConfig>>({});

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

  if (tabs.length === 0) return null;

  return (
    <TabsWrapper>
      {tabs.map(tab => {
        const tabTypeLabel = getTabTypeLabel(tab);
        const badgeTone = resolveTabTypeTone(tab, tabTypeLabel, remoteToneByTargetKey);
        return (
          <TabButton
            key={tab.id}
            type="button"
            $active={tab.id === activeTabId}
            onClick={() => onActivate(tab.id)}
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
            >
              ×
            </CloseButton>
          </TabButton>
        );
      })}
    </TabsWrapper>
  );
};

export default FileTabsBar;
