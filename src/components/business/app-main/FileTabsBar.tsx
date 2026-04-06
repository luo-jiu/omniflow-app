import React from 'react';
import styled from 'styled-components';
import type { FileViewerTab } from '@/contexts/file-viewer.context';

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

const FileTypeBadge = styled.span`
  flex-shrink: 0;
  min-width: 28px;
  height: 18px;
  border-radius: 999px;
  background: var(--semi-color-fill-1);
  color: var(--semi-color-text-2);
  font-size: 10px;
  line-height: 18px;
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
  if (tabs.length === 0) return null;

  return (
    <TabsWrapper>
      {tabs.map(tab => (
        <TabButton
          key={tab.id}
          type="button"
          $active={tab.id === activeTabId}
          onClick={() => onActivate(tab.id)}
          title={getDisplayName(tab)}
        >
          <FileTypeBadge>{getTabTypeLabel(tab)}</FileTypeBadge>
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
      ))}
    </TabsWrapper>
  );
};

export default FileTabsBar;
