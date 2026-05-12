import React from 'react';
import { Empty, Spin } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import type { ResourceMonitorProbeTarget } from '../services/resource-monitor.api';

export interface ResourceProbeHistoryEntry {
  checkedAt: string;
  error?: string;
  latencyMs: number;
  status: ResourceMonitorProbeTarget['status'];
}

export interface ResourceProbeHistoryRecord {
  entries: ResourceProbeHistoryEntry[];
  target: ResourceMonitorProbeTarget;
}

export type ResourceProbeHistoryMap = Record<string, ResourceProbeHistoryRecord>;

interface ResourceProbeHistoryPanelProps {
  error: string;
  history: ResourceProbeHistoryMap;
  loading: boolean;
  probes: ResourceMonitorProbeTarget[];
}

const CAPSULE_COUNT = 60;
const EMPTY_CAPSULES = Array.from({ length: CAPSULE_COUNT }, (_, index) => index);

function formatTime(value: string): string {
  if (!value) return '尚未探测';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未探测';
  return date.toLocaleString();
}

function probeStatusText(status: ResourceMonitorProbeTarget['status']): string {
  if (status === 'ok') return '可用';
  if (status === 'error') return '异常';
  return '未知';
}

function probeMeta(item: ResourceMonitorProbeTarget): string {
  const parts = [
    item.providerType,
    item.provider ? `provider ${item.provider}` : '',
    item.bucket ? `桶 ${item.bucket}` : '',
    item.endpoint,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  if (item.kind === 'postgres') return 'PostgreSQL 主连接';
  if (item.kind === 'redis') return 'Redis 主连接';
  return item.kind;
}

function latestStatusMeta(latest: ResourceProbeHistoryEntry | undefined): string {
  if (!latest) return '尚未探测';
  return `${probeStatusText(latest.status)} · ${latest.latencyMs} ms · ${formatTime(latest.checkedAt)}`;
}

function latestMessage(latest: ResourceProbeHistoryEntry | undefined): string {
  return latest?.error || '';
}

function probeOrder(item: ResourceMonitorProbeTarget): number {
  if (item.kind === 'postgres') return 0;
  if (item.kind === 'redis') return 1;
  if (item.kind === 'object_storage') return 2;
  return 3;
}

const ResourceProbeHistoryPanel: React.FC<ResourceProbeHistoryPanelProps> = ({
  error,
  history,
  loading,
  probes,
}) => {
  const records = React.useMemo<ResourceProbeHistoryRecord[]>(() => {
    const merged = new Map<string, ResourceProbeHistoryRecord>();
    probes.forEach((target) => {
      merged.set(target.key, history[target.key] || { entries: [], target });
    });
    Object.values(history).forEach((record) => {
      if (!merged.has(record.target.key)) {
        merged.set(record.target.key, record);
      }
    });
    return Array.from(merged.values()).sort((left, right) => {
      const leftOrder = probeOrder(left.target);
      const rightOrder = probeOrder(right.target);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftName = left.target.label || left.target.key;
      const rightName = right.target.label || right.target.key;
      return leftName.localeCompare(rightName);
    });
  }, [history, probes]);

  const panelContent = records.length === 0 ? (
    <div className="probe-history-state">
      {loading ? <Spin /> : <Empty description="暂无探针历史" />}
    </div>
  ) : (
    <div className="probe-history-list">
      {records.map((record) => {
        const latest = record.entries[record.entries.length - 1];
        const placeholderCount = Math.max(0, CAPSULE_COUNT - record.entries.length);
        return (
          <div className="probe-history-row" key={record.target.key}>
            <div className="probe-history-title-line">
              <div className="probe-history-title">
                <span className={`probe-history-dot ${latest?.status || 'unknown'}`} />
                <span className="probe-history-label">{record.target.label}</span>
                {record.target.isDefault ? <span className="default-badge">默认</span> : null}
              </div>
              <div className={`probe-history-latest ${latest?.status || 'unknown'}`}>
                {latestStatusMeta(latest)}
              </div>
            </div>
            <div className="probe-history-meta">{probeMeta(record.target)}</div>
            <div className="probe-history-capsules" aria-label={`${record.target.label} 最近 60 次探测结果`}>
              {EMPTY_CAPSULES.slice(0, placeholderCount).map((index) => (
                <span
                  className="probe-history-capsule placeholder"
                  key={`placeholder:${index}`}
                  title="尚未探测"
                />
              ))}
              {record.entries.map((entry, index) => (
                <span
                  className={`probe-history-capsule ${entry.status}`}
                  key={`${entry.checkedAt}:${index}`}
                  title={`${formatTime(entry.checkedAt)} · ${probeStatusText(entry.status)} · ${entry.error || `${entry.latencyMs} ms`}`}
                />
              ))}
            </div>
            {latestMessage(latest) ? (
              <div className="probe-history-error">{latestMessage(latest)}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <ProbeHistoryRoot>
      <div className="probe-history-header">
        <span>探针可用性图谱</span>
        <span>最近 60 次 · 每 5 分钟</span>
      </div>
      {error && records.length === 0 ? (
        <div className="probe-history-state error">{error}</div>
      ) : (
        <>
          {error && records.length > 0 ? <div className="probe-history-inline-error">{error}</div> : null}
          {panelContent}
        </>
      )}
    </ProbeHistoryRoot>
  );
};

const ProbeHistoryRoot = styled.div`
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-bg-elevated);
  overflow: hidden;

  .probe-history-header {
    height: 36px;
    padding: 0 12px;
    border-bottom: 1px solid var(--app-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--app-text-secondary);
    font-size: 11px;
    line-height: 1.35;
  }

  .probe-history-state {
    min-height: 150px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .probe-history-state.error,
  .probe-history-inline-error {
    color: var(--semi-color-danger);
  }

  .probe-history-inline-error {
    padding: 8px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
    font-size: 11px;
    line-height: 1.4;
  }

  .probe-history-list {
    display: flex;
    flex-direction: column;
  }

  .probe-history-row {
    min-height: 92px;
    padding: 10px 12px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
  }

  .probe-history-row:last-child {
    border-bottom: none;
  }

  .probe-history-title-line {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .probe-history-title {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.35;
    font-weight: 650;
  }

  .probe-history-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .probe-history-latest {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.35;
    white-space: nowrap;
  }

  .probe-history-latest.ok {
    color: var(--semi-color-success);
  }

  .probe-history-latest.error {
    color: var(--semi-color-danger);
  }

  .probe-history-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex: 0 0 auto;
    background: var(--semi-color-text-2);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--semi-color-text-2) 15%, transparent);
  }

  .probe-history-dot.ok {
    background: var(--semi-color-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--semi-color-success) 16%, transparent);
  }

  .probe-history-dot.error {
    background: var(--semi-color-danger);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--semi-color-danger) 16%, transparent);
  }

  .probe-history-meta,
  .probe-history-message {
    margin-top: 4px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    line-height: 1.4;
  }

  .probe-history-capsules {
    margin-top: 10px;
    display: grid;
    grid-template-columns: repeat(60, 7px);
    grid-auto-rows: 24px;
    gap: 3px;
    overflow: hidden;
  }

  .probe-history-capsule {
    width: 7px;
    height: 24px;
    border-radius: 999px;
    background: var(--semi-color-text-2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
    opacity: 0.76;
  }

  .probe-history-capsule.placeholder {
    background: color-mix(in srgb, var(--app-text-muted) 34%, var(--app-bg-elevated));
    border: 1px solid color-mix(in srgb, var(--app-text-muted) 22%, transparent);
    opacity: 0.9;
  }

  .probe-history-capsule.ok {
    background: var(--semi-color-success);
  }

  .probe-history-capsule.error {
    background: var(--semi-color-danger);
  }

  .probe-history-error {
    margin-top: 7px;
    color: var(--semi-color-danger);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    line-height: 1.4;
  }

  .default-badge {
    flex-shrink: 0;
    border-radius: 999px;
    padding: 1px 6px;
    background: var(--semi-color-primary-light-default);
    color: var(--semi-color-primary);
    font-size: 10px;
    line-height: 1.4;
  }

  @container (max-width: 760px) {
    .probe-history-header,
    .probe-history-title-line {
      height: auto;
      align-items: flex-start;
      flex-direction: column;
      justify-content: center;
      gap: 4px;
    }

    .probe-history-header {
      min-height: 36px;
      padding-block: 7px;
    }

    .probe-history-latest {
      white-space: normal;
    }
  }
`;

export default ResourceProbeHistoryPanel;
