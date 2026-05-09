import React from 'react';
import styled from 'styled-components';
import { IconMusic, IconVideoStroked, IconPlay, IconPause, IconExternalOpenStroked, IconClose } from '@douyinfe/semi-icons';
import type { MediaEntry } from '@/contexts/media-registry.context';

const PopoverWrapper = styled.div`
  width: 368px;
  max-width: 388px;
  padding: 8px;
`;

const PopoverHeader = styled.div`
  padding: 2px 4px 8px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;

  .heading {
    font-size: 12px;
    color: var(--app-text);
    font-weight: 650;
  }

  .count {
    font-size: 10px;
    color: var(--app-text-muted);
    font-variant-numeric: tabular-nums;
  }
`;

const EntryRow = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 28px 28px;
  grid-template-rows: auto auto auto;
  column-gap: 10px;
  row-gap: 5px;
  padding: 11px 12px 9px 10px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--app-bg-elevated) 82%, transparent);
  transition: border-color 0.12s ease, background 0.12s ease;

  & + & {
    margin-top: 6px;
  }

  &:hover {
    border-color: color-mix(in srgb, #22d3ee 36%, var(--app-border));
    background: color-mix(in srgb, #22d3ee 6%, var(--app-bg-elevated));
  }

  .kind-icon {
    grid-column: 1;
    grid-row: 1 / span 3;
    align-self: center;
    flex-shrink: 0;
    width: 42px;
    height: 32px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-muted);
    font-size: 15px;
    overflow: hidden;
  }

  .thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &.is-playing .kind-icon {
    color: #22d3ee;
    background: color-mix(in srgb, #22d3ee 15%, transparent);
  }

  .title {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    padding-right: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--app-text);
  }

  .meta {
    grid-column: 2;
    grid-row: 2;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    line-height: 1;
    color: var(--app-text-muted);
  }

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-text-muted) 65%, transparent);
  }

  &.is-playing .status-dot {
    background: #22d3ee;
    box-shadow: 0 0 8px color-mix(in srgb, #22d3ee 55%, transparent);
  }

  .progress-row {
    grid-column: 2 / span 3;
    grid-row: 3;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .progress-track {
    flex: 1;
    min-width: 0;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
  }

  .progress-bar {
    display: block;
    width: 100%;
    height: 3px;
    border-radius: inherit;
    background: color-mix(in srgb, var(--app-text) 12%, transparent);
    overflow: hidden;
  }

  .progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #22d3ee;
    transition: width 0.18s ease;
  }

  .time-text {
    flex-shrink: 0;
    min-width: 68px;
    text-align: right;
    font-size: 10px;
    line-height: 1;
    color: var(--app-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .toggle-btn {
    grid-column: 3;
    grid-row: 1 / span 2;
    align-self: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: none;
    background: color-mix(in srgb, var(--app-text) 7%, transparent);
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
  }

  .toggle-btn:hover {
    background: color-mix(in srgb, var(--app-text) 12%, transparent);
    color: var(--app-text);
  }

  .toggle-btn.is-playing {
    background: color-mix(in srgb, #22d3ee 16%, transparent);
    color: #22d3ee;
  }

  .toggle-btn.is-playing:hover {
    background: color-mix(in srgb, #22d3ee 22%, transparent);
    color: #67e8f9;
  }

  .jump-btn {
    grid-column: 4;
    grid-row: 1 / span 2;
    align-self: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: none;
    background: color-mix(in srgb, var(--app-text) 7%, transparent);
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
    transform: translateX(-2px);
  }

  .jump-btn:hover {
    background: color-mix(in srgb, var(--app-text) 12%, transparent);
    color: var(--app-text);
  }

  .dismiss-btn {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;

    svg {
      width: 11px;
      height: 11px;
    }
  }

  &:hover .dismiss-btn,
  .dismiss-btn:focus-visible {
    opacity: 1;
  }

  .dismiss-btn:hover {
    background: color-mix(in srgb, var(--app-text) 10%, transparent);
    color: var(--app-text);
  }
`;

const GroupBlock = styled.div`
  & + & {
    margin-top: 8px;
  }

  .group-title {
    padding: 4px 3px 5px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    line-height: 1;
    color: var(--app-text-muted);
  }

  .group-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: color-mix(in srgb, var(--app-border) 78%, transparent);
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
  onSeek: (entry: MediaEntry, time: number) => void;
  onDismiss: (entry: MediaEntry) => void;
}

function formatMediaTime(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '--:--';
  const normalized = Math.floor(value);
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function resolveProgressPercent(entry: MediaEntry) {
  const currentTime = Number(entry.currentTime ?? 0);
  const duration = Number(entry.duration ?? 0);
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (currentTime / duration) * 100));
}

function resolveSeekTime(entry: MediaEntry, event: React.MouseEvent<HTMLButtonElement>) {
  const duration = Number(entry.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
  return (offsetX / rect.width) * duration;
}

function getMediaKindLabel(kind: MediaEntry['kind']) {
  return kind === 'audio' ? '音频' : '视频';
}

function groupMediaEntries(entries: MediaEntry[]) {
  if (entries.length <= 4) {
    return [{ key: 'all', label: '', entries }];
  }
  const audioEntries = entries.filter(entry => entry.kind === 'audio');
  const videoEntries = entries.filter(entry => entry.kind === 'video');
  return [
    audioEntries.length > 0 ? { key: 'audio', label: `音频 ${audioEntries.length}`, entries: audioEntries } : null,
    videoEntries.length > 0 ? { key: 'video', label: `视频 ${videoEntries.length}`, entries: videoEntries } : null,
  ].filter((group): group is { key: string; label: string; entries: MediaEntry[] } => Boolean(group));
}

function seekVideoPreviewFrame(video: HTMLVideoElement) {
  if (!Number.isFinite(video.duration) || video.duration <= 0.6 || video.currentTime >= 0.05) return;
  try {
    video.currentTime = 0.5;
  } catch {
    // Preview-only video elements can keep their fallback frame if seeking is unsupported.
  }
}

function renderKindIcon(entry: MediaEntry) {
  if (entry.thumbnailUrl) {
    return <img src={entry.thumbnailUrl} alt="" className="thumbnail" />;
  }
  if (entry.kind === 'video' && entry.previewUrl) {
    return (
      <video
        src={entry.previewUrl}
        preload="metadata"
        muted
        playsInline
        aria-hidden
        className="thumbnail"
        onLoadedMetadata={(event) => seekVideoPreviewFrame(event.currentTarget)}
      />
    );
  }
  return entry.kind === 'audio' ? <IconMusic /> : <IconVideoStroked />;
}

const MediaHubPopover: React.FC<MediaHubPopoverProps> = ({ entries, onActivate, onToggle, onSeek, onDismiss }) => {
  if (entries.length === 0) {
    return (
      <PopoverWrapper>
        <EmptyHint>当前没有正在播放的媒体</EmptyHint>
      </PopoverWrapper>
    );
  }

  return (
    <PopoverWrapper>
      <PopoverHeader>
        <span className="heading">媒体控制中心</span>
        <span className="count">{entries.length} 项</span>
      </PopoverHeader>
      {groupMediaEntries(entries).map(group => (
        <GroupBlock key={group.key}>
          {group.label ? <div className="group-title">{group.label}</div> : null}
          {group.entries.map((entry) => {
            const progressPercent = resolveProgressPercent(entry);
            return (
              <EntryRow
                key={entry.entryId}
                className={entry.isPlaying ? 'is-playing' : ''}
                title={entry.title}
              >
                <span className="kind-icon">
                  {renderKindIcon(entry)}
                </span>
                <span className="title">{entry.title}</span>
                <span className="meta">
                  <span className="status-dot" />
                  <span>{getMediaKindLabel(entry.kind)}</span>
                  <span>{entry.isPlaying ? '播放中' : '已暂停'}</span>
                </span>
                <button
                  type="button"
                  className={`toggle-btn ${entry.isPlaying ? 'is-playing' : ''}`}
                  onClick={() => onToggle(entry)}
                  title={entry.isPlaying ? '暂停' : '播放'}
                >
                  {entry.isPlaying ? <IconPause /> : <IconPlay />}
                </button>
                <button
                  type="button"
                  className="jump-btn"
                  onClick={() => onActivate(entry.tabId)}
                  title={entry.kind === 'video' ? '回到视频 tab' : '回到音频 tab'}
                  aria-label={entry.kind === 'video' ? '回到视频 tab' : '回到音频 tab'}
                >
                  <IconExternalOpenStroked />
                </button>
                <button
                  type="button"
                  className="dismiss-btn"
                  onClick={() => onDismiss(entry)}
                  title="从媒体控制中心移除"
                  aria-label="从媒体控制中心移除"
                >
                  <IconClose />
                </button>
                <div className="progress-row">
                  <button
                    type="button"
                    className="progress-track"
                    onClick={(event) => {
                      const seekTime = resolveSeekTime(entry, event);
                      if (seekTime !== null) {
                        onSeek(entry, seekTime);
                      }
                    }}
                    title="跳转播放进度"
                  >
                    <span className="progress-bar">
                      <span className="progress-fill" style={{ width: `${progressPercent}%` }} />
                    </span>
                  </button>
                  <span className="time-text">
                    {formatMediaTime(entry.currentTime)} / {formatMediaTime(entry.duration)}
                  </span>
                </div>
              </EntryRow>
            );
          })}
        </GroupBlock>
      ))}
    </PopoverWrapper>
  );
};

export default MediaHubPopover;
