import React from 'react';
import { Button, Empty, Spin } from '@douyinfe/semi-ui';
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
  ResourceMonitorDashboard,
  ResourceMonitorDashboardDimension,
  ResourceMonitorDashboardMatrixItem,
  ResourceMonitorStorageItem,
} from '../services/resource-monitor.api';
import {
  ResourceCompositionChart,
} from './ResourceMonitorCharts';

interface ResourceBreakdownDashboardProps {
  breakdown?: ResourceMonitorBreakdown | null;
  dashboard?: ResourceMonitorDashboard | null;
  error: string;
  loading: boolean;
  onRetry?: () => void;
  storageError?: string;
  storageLoading?: boolean;
  storage?: ResourceMonitorStorageItem[];
}

const CATEGORY_ACCENTS = ['#f59e0b', '#38bdf8', '#22c55e', '#a855f7', '#ef4444', '#14b8a6'];
const STATUS_ACCENT: Record<string, string> = {
  visible: '#22c55e',
  recycle: '#f59e0b',
  orphan: '#ef4444',
};

type DashboardSource = ResourceMonitorBreakdown | ResourceMonitorDashboard;
type CompositionMode = 'collection' | 'fileType' | 'matrix' | 'library' | 'storage' | 'status';

interface CompositionItem {
  key: string;
  label: string;
  meta: string;
  value: number;
  percent: number;
  accent: string;
}

const COMPOSITION_MODES: Array<{ key: CompositionMode; label: string }> = [
  { key: 'collection', label: '业务集合' },
  { key: 'fileType', label: '基础类型' },
  { key: 'matrix', label: '集合构成' },
  { key: 'library', label: '资料库' },
  { key: 'storage', label: '物理存储' },
  { key: 'status', label: '资源状态' },
];

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

function metricItems(snapshot: DashboardSource) {
  return [
    {
      accent: '#f59e0b',
      icon: <IconPieChartStroked />,
      label: '物理占用',
      meta: '对象存储真实容量',
      value: formatBytes(snapshot.summary.physicalBytes),
    },
    {
      accent: '#38bdf8',
      icon: <IconLayers />,
      label: '对象数',
      meta: 'distinct storage object',
      value: formatNumber(snapshot.summary.objectCount),
    },
    {
      accent: '#3b82f6',
      icon: <IconLink />,
      label: '文件引用',
      meta: `引用展开 ${formatBytes(snapshot.summary.referencedBytes)}`,
      value: formatNumber(snapshot.summary.fileRefCount),
    },
    {
      accent: '#14b8a6',
      icon: <IconFolder />,
      label: '资料库',
      meta: '当前范围有资源',
      value: formatNumber(snapshot.summary.libraryCount),
    },
    {
      accent: '#a855f7',
      icon: <IconArchive />,
      label: '归档目录',
      meta: 'archiveMode = 1',
      value: formatNumber(snapshot.summary.archiveDirectoryCount),
    },
    {
      accent: '#ef4444',
      icon: <IconAlertTriangle />,
      label: '维护风险',
      meta: `多引用 ${formatNumber(snapshot.summary.multiRefObjectCount)} 对象`,
      value: formatBytes(snapshot.summary.recycleBytes + snapshot.summary.orphanBytes),
    },
  ];
}

function snapshotRuntimeError(snapshot: DashboardSource): string | undefined {
  if ('dashboardError' in snapshot) return snapshot.dashboardError;
  if ('breakdownError' in snapshot) return snapshot.breakdownError;
  return undefined;
}

function storageTotal(items: ResourceMonitorStorageItem[]): number {
  return items.reduce((total, item) => total + (Number.isFinite(item.physicalBytes) ? item.physicalBytes : 0), 0);
}

function storageLabel(item: ResourceMonitorStorageItem): string {
  if (item.providerLabel && item.provider) return `${item.providerLabel}（${item.provider}）`;
  return item.providerLabel || item.provider || '未命名存储';
}

function withOtherCompositionItem<T>(
  rows: T[],
  total: number,
  limit: number,
  mapItem: (item: T, index: number) => Omit<CompositionItem, 'percent'>,
): CompositionItem[] {
  const visibleRows = rows.slice(0, limit).map((item, index) => {
    const mapped = mapItem(item, index);
    return { ...mapped, percent: percentOfNumber(mapped.value, total) };
  });
  const hiddenRows = rows.slice(limit);
  if (hiddenRows.length === 0) return visibleRows;

  const otherBytes = hiddenRows.reduce((sum, item) => sum + Math.max(0, mapItem(item, limit).value), 0);
  if (otherBytes <= 0) return visibleRows;
  return [
    ...visibleRows,
    {
      key: '__other__',
      label: `其他 ${hiddenRows.length} 项`,
      meta: '未展开的剩余容量',
      value: otherBytes,
      percent: percentOfNumber(otherBytes, total),
      accent: '#64748b',
    },
  ];
}

function dimensionMeta(item: Pick<ResourceMonitorDashboardDimension, 'objectCount' | 'fileRefCount'>): string {
  return `${formatNumber(item.objectCount)} 对象 · ${formatNumber(item.fileRefCount)} 引用`;
}

function buildDimensionCompositionItems(
  rows: Array<ResourceMonitorBreakdownCategory | ResourceMonitorDashboardDimension>,
  total: number,
): CompositionItem[] {
  return withOtherCompositionItem(rows, total, 7, (item, index) => ({
    key: item.key,
    label: item.label,
    meta: dimensionMeta(item),
    value: item.physicalBytes,
    accent: CATEGORY_ACCENTS[index % CATEGORY_ACCENTS.length],
  }));
}

function buildMatrixCompositionItems(
  rows: ResourceMonitorDashboardMatrixItem[],
  total: number,
): CompositionItem[] {
  return withOtherCompositionItem(rows, total, 8, (item, index) => ({
    key: `${item.collectionKey}:${item.fileTypeKey}`,
    label: `${item.collectionLabel} / ${item.fileTypeLabel}`,
    meta: `${dimensionMeta(item)} · 集合内 ${item.percentOfCollection.toFixed(1)}%`,
    value: item.physicalBytes,
    accent: CATEGORY_ACCENTS[index % CATEGORY_ACCENTS.length],
  }));
}

function buildCompositionItems(
  mode: CompositionMode,
  snapshot: DashboardSource,
  storage: ResourceMonitorStorageItem[],
  dashboard?: ResourceMonitorDashboard | null,
): CompositionItem[] {
  if (mode === 'collection') {
    const collections = dashboard?.collections || ('categories' in snapshot ? snapshot.categories : []);
    return buildDimensionCompositionItems(collections, snapshot.summary.physicalBytes);
  }

  if (mode === 'fileType') {
    return buildDimensionCompositionItems(dashboard?.fileTypes || [], snapshot.summary.physicalBytes);
  }

  if (mode === 'matrix') {
    return buildMatrixCompositionItems(dashboard?.collectionFileTypeMatrix || [], snapshot.summary.physicalBytes);
  }

  if (mode === 'storage') {
    const total = storageTotal(storage);
    return withOtherCompositionItem(storage, total, 7, (item, index) => ({
      key: `${item.provider}:${item.bucket}`,
      label: storageLabel(item),
      meta: [item.providerType, item.bucket ? `桶 ${item.bucket}` : '', item.endpoint].filter(Boolean).join(' · '),
      value: item.physicalBytes,
      accent: CATEGORY_ACCENTS[index % CATEGORY_ACCENTS.length],
    }));
  }

  if (mode === 'status') {
    return snapshot.statuses.map((item) => ({
      key: item.key,
      label: item.label,
      meta: `${formatNumber(item.objectCount)} 对象 · ${formatNumber(item.fileRefCount)} 引用`,
      value: item.physicalBytes,
      percent: item.percent,
      accent: STATUS_ACCENT[item.key] || '#64748b',
    }));
  }

  const total = snapshot.summary.physicalBytes;
  return withOtherCompositionItem(snapshot.libraries, total, 7, (item, index) => ({
    key: String(item.libraryId),
    label: item.libraryName || `资料库 ${item.libraryId}`,
    meta: `${formatNumber(item.objectCount)} 对象 · ${formatNumber(item.fileRefCount)} 引用`,
    value: item.physicalBytes,
    accent: CATEGORY_ACCENTS[index % CATEGORY_ACCENTS.length],
  }));
}

function percentOfNumber(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || part <= 0 || total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

const ResourceBreakdownDashboard: React.FC<ResourceBreakdownDashboardProps> = ({
  breakdown,
  dashboard,
  error,
  loading,
  onRetry,
  storageError = '',
  storageLoading = false,
  storage = [],
}) => {
  const [compositionMode, setCompositionMode] = React.useState<CompositionMode>('collection');
  const snapshot = dashboard || breakdown || null;

  if (loading && !snapshot) {
    return (
      <DashboardRoot>
        <div className="dashboard-state">
          <Spin />
        </div>
      </DashboardRoot>
    );
  }

  if (error && !snapshot) {
    return (
      <DashboardRoot>
        <div className="dashboard-state error">
          <span>{error}</span>
          {onRetry ? (
            <Button onClick={onRetry} size="small" theme="borderless">
              重试
            </Button>
          ) : null}
        </div>
      </DashboardRoot>
    );
  }

  if (!snapshot) {
    return (
      <DashboardRoot>
        <div className="dashboard-state">
          <Empty description="暂无细分统计" />
        </div>
      </DashboardRoot>
    );
  }

  const hasData = snapshot.summary.physicalBytes > 0 || snapshot.summary.objectCount > 0;
  const collections = (dashboard?.collections || ('categories' in snapshot ? snapshot.categories : [])).slice(0, 6);
  const libraries = snapshot.libraries.slice(0, 5);
  const compositionItems = buildCompositionItems(compositionMode, snapshot, storage, dashboard);
  const compositionTotalBytes = compositionMode === 'storage'
    ? storageTotal(storage)
    : snapshot.summary.physicalBytes;
  const storageWaiting = compositionMode === 'storage' && storageLoading && storage.length === 0;
  const storageFailed = compositionMode === 'storage' && Boolean(storageError) && storage.length === 0;
  const runtimeError = snapshotRuntimeError(snapshot);

  return (
    <DashboardRoot>
      <div className="dashboard-header">
        <div>
          <div className="dashboard-title">
            <IconPulse />
            <span>资源统计仪表盘</span>
          </div>
          <div className="dashboard-meta">
            {dashboard ? 'V2：' : '细分：'}{formatTime(snapshot.generatedAt)} · 业务集合 / 基础类型分离统计
          </div>
        </div>
        <div className="dashboard-badge">
          {snapshot.summary.multiRefObjectCount > 0 ? '存在多引用' : '对象去重'}
        </div>
      </div>

      {error || runtimeError ? (
        <div className="dashboard-inline-error">
          <span>{error || runtimeError}</span>
          {onRetry ? (
            <Button onClick={onRetry} size="small" theme="borderless">
              重试
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="metric-grid">
        {metricItems(snapshot).map((item) => (
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
          <div className="panel-header composition-header">
            <span>资源组成</span>
            <div className="mode-switch" role="tablist" aria-label="资源组成维度">
              {COMPOSITION_MODES.map((item) => (
                <button
                  aria-selected={compositionMode === item.key}
                  className={compositionMode === item.key ? 'active' : ''}
                  key={item.key}
                  onClick={() => setCompositionMode(item.key)}
                  role="tab"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="composition-visual">
            <div className="chart-field">
              <div className="chart-grid" aria-hidden="true" />
              <div className="chart-header">
                <span>{hasData ? '当前快照' : '暂无容量'}</span>
                <strong>{formatBytes(compositionTotalBytes)}</strong>
              </div>
              {storageWaiting ? (
                <div className="chart-empty">物理存储分布加载中</div>
              ) : storageFailed ? (
                <div className="chart-empty error">
                  <span>{storageError}</span>
                  {onRetry ? (
                    <Button onClick={onRetry} size="small" theme="borderless">
                      重试
                    </Button>
                  ) : null}
                </div>
              ) : compositionItems.length === 0 ? (
                <div className="chart-empty">暂无该维度数据</div>
              ) : (
                <div className="composition-chart-layout">
                  <div className="composition-chart-area">
                    <ResourceCompositionChart items={compositionItems} />
                  </div>
                  <div className="composition-legend">
                    {compositionItems.map((item) => (
                      <CompositionLegendItem item={item} key={item.key} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="category-strip">
            {collections.length === 0 ? (
              <div className="strip-empty">暂无业务集合数据</div>
            ) : collections.map((item, index) => (
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
            <span>{snapshot.libraries.length} 个</span>
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
          <span>{snapshot.anomalies.length} 条</span>
        </div>
        {snapshot.anomalies.length === 0 ? (
          <div className="dashboard-mini-state">暂无明显风险项</div>
        ) : (
          <div className="anomaly-list">
            {snapshot.anomalies.map((item) => (
              <AnomalyItem item={item} key={item.key} />
            ))}
          </div>
        )}
      </div>
    </DashboardRoot>
  );
};

const CompositionLegendItem: React.FC<{ item: CompositionItem }> = ({ item }) => (
  <div
    className="composition-legend-item"
    style={accentStyle(item.accent)}
    title={`${item.label}：${formatBytes(item.value)}，占 ${item.percent.toFixed(1)}%。${item.meta}。物理容量按当前维度去重统计。`}
  >
    <span className="composition-legend-dot" />
    <div className="composition-legend-copy">
      <span>{item.label}</span>
      <strong>{formatBytes(item.value)} · {item.percent.toFixed(1)}%</strong>
    </div>
  </div>
);

const CategoryChip: React.FC<{
  accent: string;
  item: ResourceMonitorBreakdownCategory | ResourceMonitorDashboardDimension;
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
  container-type: inline-size;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--semi-color-danger);
    font-size: 11px;
    line-height: 1.4;
  }

  .dashboard-inline-error span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dashboard-state,
  .dashboard-mini-state {
    min-height: 150px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .dashboard-state {
    flex-direction: column;
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

  .composition-header {
    min-height: 38px;
    height: auto;
    gap: 10px;
    flex-wrap: wrap;
    padding-top: 5px;
    padding-bottom: 5px;
  }

  .mode-switch {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg-base) 78%, transparent);
    padding: 2px;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .mode-switch button {
    min-width: 48px;
    height: 22px;
    border: 0;
    border-radius: 6px;
    padding: 0 7px;
    color: var(--app-text-muted);
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: 10px;
    line-height: 1;
  }

  .mode-switch button:hover {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text-muted) 12%, transparent);
  }

  .mode-switch button.active {
    color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 16%, var(--app-bg-elevated));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--semi-color-primary) 20%, transparent);
  }

  .composition-visual {
    padding: 10px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .chart-field {
    position: relative;
    min-width: 0;
    min-height: 248px;
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 22%, var(--app-border));
    border-radius: 8px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--semi-color-primary) 5%, transparent), transparent 72%),
      color-mix(in srgb, var(--app-bg-elevated) 98%, var(--app-bg-base));
    padding: 10px;
    overflow: hidden;
  }

  .chart-grid {
    position: absolute;
    inset: 0;
    opacity: 0.28;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--app-text-muted) 11%, transparent) 1px, transparent 1px),
      linear-gradient(180deg, color-mix(in srgb, var(--app-text-muted) 10%, transparent) 1px, transparent 1px);
    background-size: 20% 100%, 100% 34px;
    pointer-events: none;
  }

  .chart-header,
  .composition-chart-layout {
    position: relative;
    z-index: 1;
  }

  .chart-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
    color: var(--app-text-secondary);
    font-size: 10px;
    line-height: 1.35;
  }

  .chart-header strong {
    color: var(--app-text);
    font-size: 12px;
  }

  .chart-empty {
    position: relative;
    z-index: 1;
    min-height: 146px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .chart-empty.error {
    color: var(--semi-color-danger);
    text-align: center;
  }

  .composition-chart-layout {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(184px, 240px);
    gap: 12px;
    align-items: stretch;
  }

  .composition-chart-area {
    min-width: 0;
  }

  .composition-legend {
    min-width: 0;
    align-self: stretch;
    border-left: 1px solid color-mix(in srgb, var(--app-border) 72%, transparent);
    padding-left: 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .composition-legend-item {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.35;
  }

  .composition-legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    margin-top: 3px;
    flex: 0 0 auto;
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .composition-legend-copy {
    min-width: 0;
  }

  .composition-legend-copy span,
  .composition-legend-copy strong {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .composition-legend-copy span {
    color: var(--app-text);
  }

  .composition-legend-copy strong {
    margin-top: 2px;
    color: var(--app-text-muted);
    font-weight: 600;
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
    .composition-chart-layout,
    .anomaly-list {
      grid-template-columns: 1fr;
    }

    .composition-legend {
      border-left: 0;
      border-top: 1px solid color-mix(in srgb, var(--app-border) 72%, transparent);
      padding-left: 0;
      padding-top: 10px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .category-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`;

export default ResourceBreakdownDashboard;
