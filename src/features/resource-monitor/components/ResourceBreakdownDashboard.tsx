import React from 'react';
import { Empty, Spin } from '@douyinfe/semi-ui';
import {
  IconAlertTriangle,
  IconArchive,
  IconFolder,
  IconLayers,
  IconLink,
  IconPieChartStroked,
  IconPulse,
} from '@douyinfe/semi-icons';
import styled from 'styled-components';
import type {
  ResourceMonitorBreakdown,
  ResourceMonitorBreakdownAnomaly,
  ResourceMonitorBreakdownCategory,
  ResourceMonitorBreakdownLibrary,
  ResourceMonitorBreakdownStatus,
} from '../services/resource-monitor.api';

interface ResourceBreakdownDashboardProps {
  breakdown: ResourceMonitorBreakdown | null;
  error: string;
  loading: boolean;
}

const CATEGORY_ACCENTS = ['#f59e0b', '#38bdf8', '#22c55e', '#a855f7', '#ef4444', '#14b8a6'];
const STATUS_ACCENT: Record<string, string> = {
  visible: '#22c55e',
  recycle: '#f59e0b',
  orphan: '#ef4444',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 100 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return value.toLocaleString();
}

function formatTime(value: string): string {
  if (!value) return '尚未刷新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未刷新';
  return date.toLocaleString();
}

function accentStyle(accent: string): React.CSSProperties {
  return { '--accent': accent } as React.CSSProperties;
}

function percentWidth(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.min(100, Math.max(0, value))}%`;
}

function metricItems(breakdown: ResourceMonitorBreakdown) {
  return [
    {
      accent: '#f59e0b',
      icon: <IconPieChartStroked />,
      label: '物理占用',
      meta: '对象存储真实容量',
      value: formatBytes(breakdown.summary.physicalBytes),
    },
    {
      accent: '#38bdf8',
      icon: <IconLayers />,
      label: '对象数',
      meta: 'distinct storage object',
      value: formatNumber(breakdown.summary.objectCount),
    },
    {
      accent: '#3b82f6',
      icon: <IconLink />,
      label: '文件引用',
      meta: `引用展开 ${formatBytes(breakdown.summary.referencedBytes)}`,
      value: formatNumber(breakdown.summary.fileRefCount),
    },
    {
      accent: '#14b8a6',
      icon: <IconFolder />,
      label: '资料库',
      meta: '当前范围有资源',
      value: formatNumber(breakdown.summary.libraryCount),
    },
    {
      accent: '#a855f7',
      icon: <IconArchive />,
      label: '归档目录',
      meta: 'archiveMode = 1',
      value: formatNumber(breakdown.summary.archiveDirectoryCount),
    },
    {
      accent: '#ef4444',
      icon: <IconAlertTriangle />,
      label: '维护风险',
      meta: `多引用 ${formatNumber(breakdown.summary.multiRefObjectCount)} 对象`,
      value: formatBytes(breakdown.summary.recycleBytes + breakdown.summary.orphanBytes),
    },
  ];
}

const ResourceBreakdownDashboard: React.FC<ResourceBreakdownDashboardProps> = ({
  breakdown,
  error,
  loading,
}) => {
  if (loading && !breakdown) {
    return (
      <DashboardRoot>
        <div className="dashboard-state">
          <Spin />
        </div>
      </DashboardRoot>
    );
  }

  if (error && !breakdown) {
    return (
      <DashboardRoot>
        <div className="dashboard-state error">{error}</div>
      </DashboardRoot>
    );
  }

  if (!breakdown) {
    return (
      <DashboardRoot>
        <div className="dashboard-state">
          <Empty description="暂无细分统计" />
        </div>
      </DashboardRoot>
    );
  }

  const hasData = breakdown.summary.physicalBytes > 0 || breakdown.summary.objectCount > 0;
  const categories = breakdown.categories.slice(0, 6);
  const libraries = breakdown.libraries.slice(0, 5);

  return (
    <DashboardRoot>
      <div className="dashboard-header">
        <div>
          <div className="dashboard-title">
            <IconPulse />
            <span>资源细分仪表盘</span>
          </div>
          <div className="dashboard-meta">
            细分：{formatTime(breakdown.generatedAt)} · 物理去重 / 引用展开分离统计
          </div>
        </div>
        <div className="dashboard-badge">
          {breakdown.summary.multiRefObjectCount > 0 ? '存在多引用' : '对象去重'}
        </div>
      </div>

      {error || breakdown.breakdownError ? (
        <div className="dashboard-inline-error">{error || breakdown.breakdownError}</div>
      ) : null}

      <div className="metric-grid">
        {metricItems(breakdown).map((item) => (
          <div className="metric-tile" key={item.label} style={accentStyle(item.accent)}>
            <div className="metric-icon">{item.icon}</div>
            <div className="metric-copy">
              <span className="metric-label">{item.label}</span>
              <span className="metric-value">{item.value}</span>
              <span className="metric-meta">{item.meta}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-main">
        <div className="composition-panel">
          <div className="panel-header">
            <span>资源组成</span>
            <span>{hasData ? '当前快照' : '暂无容量'}</span>
          </div>
          <div className="composition-visual">
            <div className="chart-field" aria-hidden="true">
              <svg viewBox="0 0 420 126" role="presentation">
                <path className="grid-line" d="M12 102H408M12 70H408M12 38H408" />
                <path className="signal-line main" d="M12 92C56 84 76 88 112 68C154 45 184 56 216 48C264 36 294 62 326 50C358 38 378 45 408 28" />
                <path className="signal-line aux" d="M12 104C60 99 92 101 134 92C180 80 214 86 254 76C304 64 350 75 408 62" />
              </svg>
            </div>
            <div className="status-stack">
              {breakdown.statuses.map((status) => (
                <StatusSegment key={status.key} status={status} />
              ))}
            </div>
          </div>
          <div className="category-strip">
            {categories.length === 0 ? (
              <div className="strip-empty">暂无分类数据</div>
            ) : categories.map((item, index) => (
              <CategoryChip
                accent={CATEGORY_ACCENTS[index % CATEGORY_ACCENTS.length]}
                item={item}
                key={item.key}
              />
            ))}
          </div>
        </div>

        <div className="rank-panel">
          <div className="panel-header">
            <span>资料库排行</span>
            <span>{breakdown.libraries.length} 个</span>
          </div>
          {libraries.length === 0 ? (
            <div className="dashboard-mini-state">暂无资料库资源</div>
          ) : libraries.map((item, index) => (
            <LibraryRankItem index={index} item={item} key={item.libraryId} />
          ))}
        </div>
      </div>

      <div className="anomaly-panel">
        <div className="panel-header">
          <span>诊断摘要</span>
          <span>{breakdown.anomalies.length} 条</span>
        </div>
        {breakdown.anomalies.length === 0 ? (
          <div className="dashboard-mini-state">暂无明显风险项</div>
        ) : (
          <div className="anomaly-list">
            {breakdown.anomalies.map((item) => (
              <AnomalyItem item={item} key={item.key} />
            ))}
          </div>
        )}
      </div>
    </DashboardRoot>
  );
};

const StatusSegment: React.FC<{ status: ResourceMonitorBreakdownStatus }> = ({ status }) => (
  <div className="status-row" style={accentStyle(STATUS_ACCENT[status.key] || '#64748b')}>
    <div className="status-label">
      <span>{status.label}</span>
      <strong>{formatBytes(status.physicalBytes)}</strong>
    </div>
    <div className="status-track">
      <div className="status-fill" style={{ width: percentWidth(status.percent) }} />
    </div>
    <div className="status-meta">
      {formatNumber(status.objectCount)} 对象 · {status.percent.toFixed(1)}%
    </div>
  </div>
);

const CategoryChip: React.FC<{
  accent: string;
  item: ResourceMonitorBreakdownCategory;
}> = ({ accent, item }) => (
  <div className="category-chip" style={accentStyle(accent)}>
    <div className="category-head">
      <span>{item.label}</span>
      <strong>{item.percent.toFixed(1)}%</strong>
    </div>
    <div className="category-track">
      <div className="category-fill" style={{ width: percentWidth(item.percent) }} />
    </div>
    <div className="category-meta">
      {formatBytes(item.physicalBytes)} · {formatNumber(item.fileRefCount)} 引用
    </div>
  </div>
);

const LibraryRankItem: React.FC<{
  index: number;
  item: ResourceMonitorBreakdownLibrary;
}> = ({ index, item }) => (
  <div className="library-rank-row" style={accentStyle(CATEGORY_ACCENTS[index % CATEGORY_ACCENTS.length])}>
    <div className="rank-index">{index + 1}</div>
    <div className="rank-main">
      <div className="rank-title">
        <span>{item.libraryName || `资料库 ${item.libraryId}`}</span>
        <strong>{formatBytes(item.physicalBytes)}</strong>
      </div>
      <div className="rank-track">
        <div className="rank-fill" style={{ width: percentWidth(item.percent) }} />
      </div>
      <div className="rank-meta">
        {formatNumber(item.objectCount)} 对象 · {formatNumber(item.fileRefCount)} 引用
        {item.topProvider ? ` · ${item.topProvider}${item.topBucket ? ` / ${item.topBucket}` : ''}` : ''}
      </div>
    </div>
  </div>
);

const AnomalyItem: React.FC<{ item: ResourceMonitorBreakdownAnomaly }> = ({ item }) => (
  <div className={`anomaly-item ${item.severity}`}>
    <IconAlertTriangle />
    <div className="anomaly-copy">
      <div className="anomaly-title">
        <span>{item.title}</span>
        {item.physicalBytes ? <strong>{formatBytes(item.physicalBytes)}</strong> : null}
      </div>
      <div className="anomaly-meta">
        {item.message || '未命名资料库'}{item.objectCount ? ` · ${formatNumber(item.objectCount)} 对象` : ''}
      </div>
    </div>
  </div>
);

const DashboardRoot = styled.div`
  border: 1px solid color-mix(in srgb, var(--semi-color-primary) 18%, var(--app-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--app-bg-elevated) 94%, var(--semi-color-primary) 6%), var(--app-bg-elevated));
  overflow: hidden;

  .dashboard-header {
    min-height: 44px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--app-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .dashboard-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text);
    font-size: 13px;
    line-height: 1.35;
    font-weight: 700;
  }

  .dashboard-title .semi-icon {
    color: var(--semi-color-warning);
  }

  .dashboard-meta {
    margin-top: 3px;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.4;
  }

  .dashboard-badge {
    flex: 0 0 auto;
    border: 1px solid color-mix(in srgb, var(--semi-color-warning) 35%, var(--app-border));
    border-radius: 999px;
    padding: 3px 8px;
    color: var(--semi-color-warning);
    background: color-mix(in srgb, var(--semi-color-warning-light-default) 45%, transparent);
    font-size: 10px;
    line-height: 1.4;
  }

  .dashboard-inline-error {
    padding: 8px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
    color: var(--semi-color-danger);
    font-size: 11px;
    line-height: 1.4;
  }

  .dashboard-state,
  .dashboard-mini-state {
    min-height: 150px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .dashboard-mini-state {
    min-height: 84px;
  }

  .dashboard-state.error {
    color: var(--semi-color-danger);
  }

  .metric-grid {
    padding: 10px 12px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .metric-tile {
    min-width: 0;
    min-height: 70px;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--app-border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 10%, var(--app-bg-elevated));
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 12%, transparent);
    padding: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .metric-icon {
    width: 31px;
    height: 31px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 17%, transparent);
  }

  .metric-copy {
    min-width: 0;
  }

  .metric-label,
  .metric-meta {
    display: block;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    line-height: 1.35;
  }

  .metric-value {
    display: block;
    margin-top: 2px;
    color: var(--app-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 16px;
    line-height: 1.25;
    font-weight: 800;
  }

  .metric-meta {
    margin-top: 3px;
    font-size: 10px;
  }

  .dashboard-main {
    padding: 0 12px 10px;
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.95fr);
    gap: 10px;
  }

  .composition-panel,
  .rank-panel,
  .anomaly-panel {
    min-width: 0;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg-elevated) 92%, var(--app-panel-muted));
    overflow: hidden;
  }

  .panel-header {
    height: 34px;
    padding: 0 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 75%, transparent);
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--app-text-secondary);
    font-size: 11px;
    line-height: 1.35;
    font-weight: 650;
  }

  .composition-visual {
    padding: 10px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px;
    gap: 10px;
  }

  .chart-field {
    min-width: 0;
    height: 126px;
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 18%, var(--app-border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-primary) 7%, transparent);
    overflow: hidden;
  }

  .chart-field svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .grid-line {
    fill: none;
    stroke: color-mix(in srgb, var(--app-text-muted) 20%, transparent);
    stroke-width: 1;
  }

  .signal-line {
    fill: none;
    stroke-linecap: round;
    stroke-width: 3;
  }

  .signal-line.main {
    stroke: var(--semi-color-warning);
    filter: drop-shadow(0 0 5px color-mix(in srgb, var(--semi-color-warning) 45%, transparent));
  }

  .signal-line.aux {
    stroke: var(--semi-color-info);
    opacity: 0.78;
  }

  .status-stack {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .status-row {
    min-width: 0;
  }

  .status-label,
  .category-head,
  .rank-title,
  .anomaly-title {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--app-text);
    font-size: 11px;
    line-height: 1.35;
  }

  .status-label span,
  .category-head span,
  .rank-title span,
  .anomaly-title span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-label strong,
  .category-head strong,
  .rank-title strong,
  .anomaly-title strong {
    flex: 0 0 auto;
  }

  .status-track,
  .category-track,
  .rank-track {
    margin-top: 5px;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-text-muted) 16%, transparent);
    overflow: hidden;
  }

  .status-fill,
  .category-fill,
  .rank-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  .status-meta,
  .category-meta,
  .rank-meta,
  .anomaly-meta {
    margin-top: 4px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    line-height: 1.35;
  }

  .category-strip {
    padding: 0 10px 10px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .category-chip {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--app-border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    padding: 8px;
  }

  .strip-empty {
    min-height: 54px;
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .library-rank-row {
    padding: 9px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
    display: flex;
    align-items: flex-start;
    gap: 9px;
  }

  .library-rank-row:last-child {
    border-bottom: none;
  }

  .rank-index {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    font-size: 10px;
    line-height: 1;
    font-weight: 800;
  }

  .rank-main {
    min-width: 0;
    flex: 1 1 auto;
  }

  .anomaly-panel {
    margin: 0 12px 12px;
  }

  .anomaly-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    padding: 10px;
  }

  .anomaly-item {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--semi-color-info) 20%, var(--app-border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-info-light-default) 34%, transparent);
    padding: 9px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--app-text);
  }

  .anomaly-item.warning {
    border-color: color-mix(in srgb, var(--semi-color-warning) 28%, var(--app-border));
    background: color-mix(in srgb, var(--semi-color-warning-light-default) 38%, transparent);
  }

  .anomaly-item.danger {
    border-color: color-mix(in srgb, var(--semi-color-danger) 28%, var(--app-border));
    background: color-mix(in srgb, var(--semi-color-danger-light-default) 34%, transparent);
  }

  .anomaly-item > .semi-icon {
    flex: 0 0 auto;
    margin-top: 1px;
  }

  .anomaly-copy {
    min-width: 0;
    flex: 1 1 auto;
  }

  @container (max-width: 900px) {
    .metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .dashboard-main,
    .composition-visual,
    .anomaly-list {
      grid-template-columns: 1fr;
    }

    .category-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`;

export default ResourceBreakdownDashboard;
