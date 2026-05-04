import React from 'react';
import styled from 'styled-components';
import { IconMusic, IconVideoStroked, IconPlay, IconPause } from '@douyinfe/semi-icons';
import type { MediaEntry } from '@/contexts/media-registry.context';

const PopoverWrapper = styled.div`
  width: 280px;
  max-width: 320px;
  padding: 6px 0;
`;

const PopoverHeader = styled.div`
  padding: 4px 14px 8px;
  font-size: 11px;
  color: var(--app-text-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--app-border);
  margin-bottom: 4px;
`;

const EntryRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.12s ease;

  &:hover {
    background: color-mix(in srgb, var(--app-text) 6%, transparent);
  }

  .kind-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-muted);
    font-size: 14px;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--app-text);
  }

  .toggle-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
  }

  .toggle-btn:hover {
    background: color-mix(in srgb, var(--app-text) 10%, transparent);
    color: var(--app-text);
  }
`;

const EmptyHint = styled.div`
  padding: 12px 14px;
  text-align: center;
  font-size: 12px;
  color: var(--app-text-muted);
`;

interface MediaHubPopoverProps {
  entries: MediaEntry[];
  onActivate: (tabId: string) => void;
  onToggle: (entry: MediaEntry) => void;
}

const MediaHubPopover: React.FC<MediaHubPopoverProps> = ({ entries, onActivate, onToggle }) => {
  if (entries.length === 0) {
    return (
      <PopoverWrapper>
        <EmptyHint>当前没有正在播放的媒体</EmptyHint>
      </PopoverWrapper>
    );
  }

  return (
    <PopoverWrapper>
      <PopoverHeader>正在播放（共 {entries.length} 项）</PopoverHeader>
      {entries.map((entry) => (
        <EntryRow
          key={entry.entryId}
          onClick={() => onActivate(entry.tabId)}
          title={entry.title}
        >
          <span className="kind-icon">
            {entry.kind === 'audio' ? <IconMusic /> : <IconVideoStroked />}
          </span>
          <span className="title">{entry.title}</span>
          <button
            type="button"
            className="toggle-btn"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(entry);
            }}
            title={entry.isPlaying ? '暂停' : '播放'}
          >
            {entry.isPlaying ? <IconPause /> : <IconPlay />}
          </button>
        </EntryRow>
      ))}
    </PopoverWrapper>
  );
};

export default MediaHubPopover;
