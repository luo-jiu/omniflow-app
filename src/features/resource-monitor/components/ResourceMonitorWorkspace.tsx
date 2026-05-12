import React from 'react';
import { Button, Empty, Spin, Toast } from '@douyinfe/semi-ui';
import {
  IconArrowRight,
  IconDelete,
  IconRefresh,
  IconSave,
  IconSetting,
} from '@douyinfe/semi-icons';
import styled from 'styled-components';
import type { SystemWorkspaceViewProps } from '@/features/system-workspace/types';
import {
  captureResourceMonitorSample,
  fetchResourceMonitorSnapshot,
  type ResourceMonitorProbeTarget,
  type ResourceMonitorSnapshot,
  type ResourceMonitorStorageItem,
} from '../services/resource-monitor.api';

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

function formatTime(value: string): string {
  if (!value) return '尚未刷新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未刷新';
  return date.toLocaleString();
}

function storageTitle(item: ResourceMonitorStorageItem): string {
  if (item.providerLabel && item.provider) {
    return `${item.providerLabel}（${item.provider}）`;
  }
  return item.providerLabel || item.provider || '未命名 provider';
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

function storageBreakdown(item: ResourceMonitorStorageItem): string {
  return [
    `可见 ${formatBytes(item.visibleBytes)} / ${item.visibleObjectCount} 对象`,
    `回收站 ${formatBytes(item.recycleBytes)} / ${item.recycleObjectCount} 对象`,
    `孤儿 ${formatBytes(item.orphanBytes)} / ${item.orphanObjectCount} 对象`,
  ].join(' · ');
}

const ResourceMonitorWorkspace: React.FC<SystemWorkspaceViewProps> = ({
  libraryId,
  onOpenLegacyRoute,
  onOpenView,
  onSettingsSectionChange,
}) => {
  const [snapshot, setSnapshot] = React.useState<ResourceMonitorSnapshot | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sampling, setSampling] = React.useState(false);
  const [error, setError] = React.useState<string>('');
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSnapshot = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextSnapshot = await fetchResourceMonitorSnapshot({ libraryId });
      if (!mountedRef.current) return;
      setSnapshot(nextSnapshot);
    } catch (err: any) {
      if (!mountedRef.current) return;
      const message = err?.message || '加载资源快照失败';
      setError(message);
      Toast.error(message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [libraryId]);

  React.useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const summary = snapshot?.summary;
  const probeSummary = snapshot?.probeSummary;
  const probes = snapshot?.probes || [];
  const distributionError = snapshot?.distributionError || '';
  const storage = snapshot?.storage || [];
  const canOpenRecycleBin = libraryId > 0;
  const openStorageSettings = React.useCallback(() => {
    onSettingsSectionChange?.('storage');
    onOpenView('settings');
  }, [onOpenView, onSettingsSectionChange]);
  const openMigrationCenter = React.useCallback(() => {
    onOpenLegacyRoute('/transfer-center?tab=migration');
  }, [onOpenLegacyRoute]);
  const openRecycleBin = React.useCallback(() => {
    if (!canOpenRecycleBin) {
      Toast.info('进入具体资料库后可以查看回收站');
      return;
    }
    onOpenView('recycle-bin');
  }, [canOpenRecycleBin, onOpenView]);
  const captureSample = React.useCallback(async () => {
    setSampling(true);
    try {
      const sample = await captureResourceMonitorSample({ libraryId });
      if (!mountedRef.current) return;
      Toast.success(`已记录资源样本 #${sample.id}`);
      void loadSnapshot();
    } catch (err: any) {
      if (!mountedRef.current) return;
      Toast.error(err?.message || '记录资源样本失败');
    } finally {
      if (mountedRef.current) {
        setSampling(false);
      }
    }
  }, [libraryId, loadSnapshot]);

  return (
    <ResourceMonitorRoot>
      <div className="monitor-toolbar">
        <div>
          <div className="monitor-toolbar-title">资源分布快照</div>
          <div className="monitor-toolbar-meta">最后刷新：{formatTime(snapshot?.generatedAt || '')}</div>
        </div>
        <div className="monitor-toolbar-actions">
          <Button
            icon={<IconSetting />}
            onClick={openStorageSettings}
            size="small"
            theme="borderless"
          >
            存储设置
          </Button>
          <Button
            icon={<IconArrowRight />}
            onClick={openMigrationCenter}
            size="small"
            theme="borderless"
          >
            迁移任务
          </Button>
          <Button
            icon={<IconSave />}
            loading={sampling}
            onClick={() => void captureSample()}
            size="small"
            theme="borderless"
          >
            记录样本
          </Button>
          <Button
            icon={<IconRefresh />}
            loading={loading}
            onClick={() => void loadSnapshot()}
            size="small"
            theme="borderless"
          >
            刷新
          </Button>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-item">
          <span className="summary-label">物理占用</span>
          <span className="summary-value">{formatBytes(summary?.physicalBytes || 0)}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">对象数</span>
          <span className="summary-value">{summary?.objectCount || 0}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">文件引用</span>
          <span className="summary-value">{summary?.fileRefCount || 0}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Provider / Bucket</span>
          <span className="summary-value">{summary?.providerCount || 0} / {summary?.bucketCount || 0}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">探针</span>
          <span className="summary-value">{probeSummary?.ok || 0} / {probeSummary?.total || 0}</span>
        </div>
      </div>

      {summary && summary.unmatchedCount > 0 ? (
        <div className="monitor-warning">
          <span>
            有 {summary.unmatchedCount} 个存储位置没有匹配到当前 provider 配置，可能来自历史数据或已移除的 provider。
          </span>
          <Button
            icon={<IconSetting />}
            onClick={openStorageSettings}
            size="small"
            theme="borderless"
          >
            存储设置
          </Button>
        </div>
      ) : null}

      {summary && summary.legacyProviderCount > 0 ? (
        <div className="monitor-warning">
          <span>
            有 {summary.legacyProviderCount} 个存储位置仍使用历史 provider 类型值，当前已按唯一匹配的 provider alias 兼容展示。
          </span>
          <Button
            icon={<IconSetting />}
            onClick={openStorageSettings}
            size="small"
            theme="borderless"
          >
            存储设置
          </Button>
        </div>
      ) : null}

      <div className="diagnostics-grid">
        <div className="diagnostic-item">
          <span className="diagnostic-label">可见资源</span>
          <span className="diagnostic-value">{formatBytes(summary?.visibleBytes || 0)}</span>
          <span className="diagnostic-meta">
            {summary?.visibleObjectCount || 0} 对象 / {summary?.visibleFileRefCount || 0} 引用
          </span>
        </div>
        <div className="diagnostic-item">
          <span className="diagnostic-label">回收站关联</span>
          <span className="diagnostic-value">{formatBytes(summary?.recycleBytes || 0)}</span>
          <span className="diagnostic-meta">
            {summary?.recycleObjectCount || 0} 对象 / {summary?.recycleFileRefCount || 0} 引用
          </span>
          <Button
            className="diagnostic-action"
            icon={<IconDelete />}
            onClick={openRecycleBin}
            size="small"
            theme="borderless"
            title={canOpenRecycleBin ? '打开当前资料库回收站' : '进入具体资料库后可以查看回收站'}
          >
            回收站
          </Button>
        </div>
        <div className="diagnostic-item">
          <span className="diagnostic-label">孤儿对象</span>
          <span className="diagnostic-value">{formatBytes(summary?.orphanBytes || 0)}</span>
          <span className="diagnostic-meta">{summary?.orphanObjectCount || 0} 对象无文件引用</span>
        </div>
      </div>

      <div className="probe-panel">
        <div className="distribution-header">
          <span>资源探针</span>
          <span>{probeSummary?.error || 0} 个异常</span>
        </div>
        {loading && !snapshot ? (
          <div className="state-block">
            <Spin />
          </div>
        ) : probes.length === 0 ? (
          <div className="state-block">
            <Empty description="暂无探针结果" />
          </div>
        ) : (
          <div className="probe-list">
            {probes.map((item) => (
              <div className="probe-row" key={item.key}>
                <div className="probe-main">
                  <div className="probe-title">
                    <span className={`probe-dot ${item.status}`} />
                    <span>{item.label}</span>
                    {item.isDefault ? <span className="default-badge">默认</span> : null}
                  </div>
                  <div className="location-meta">{probeMeta(item)}</div>
                  {item.error ? <div className="probe-error">{item.error}</div> : null}
                </div>
                <div className="probe-status">
                  <span className={`probe-status-text ${item.status}`}>{probeStatusText(item.status)}</span>
                  <span>{item.latencyMs} ms</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="distribution-panel">
        <div className="distribution-header">
          <span>物理存储分布</span>
          <span>{storage.length} 个位置</span>
        </div>

        {loading && !snapshot ? (
          <div className="state-block">
            <Spin />
          </div>
        ) : error && !snapshot ? (
          <div className="state-block error">{error}</div>
        ) : distributionError ? (
          <div className="state-block error">{distributionError}</div>
        ) : storage.length === 0 ? (
          <div className="state-block">
            <Empty description="暂无物理存储对象" />
          </div>
        ) : (
          <div className="distribution-table">
            <div className="distribution-row distribution-row-head">
              <span>位置</span>
              <span>对象</span>
              <span>引用</span>
              <span>容量</span>
              <span>占比</span>
            </div>
            {storage.map((item) => (
              <div className="distribution-row" key={`${item.provider}:${item.bucket}`}>
                <div className="location-cell">
                  <div className="location-title">
                    {storageTitle(item)}
                    {item.isDefault ? <span className="default-badge">默认</span> : null}
                    {item.isLegacyProvider ? <span className="legacy-badge">历史</span> : null}
                  </div>
                  <div className="location-meta">
                    {[item.providerType, item.bucket ? `桶 ${item.bucket}` : '', item.endpoint]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {item.isLegacyProvider && item.sourceProvider ? (
                    <div className="location-legacy">历史 provider {item.sourceProvider} 已映射为 {item.provider}</div>
                  ) : null}
                  <div className="location-breakdown">{storageBreakdown(item)}</div>
                </div>
                <span>{item.objectCount}</span>
                <span>{item.fileRefCount}</span>
                <span>{formatBytes(item.physicalBytes)}</span>
                <div className="percent-cell">
                  <div className="percent-track">
                    <div className="percent-fill" style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }} />
                  </div>
                  <span>{item.percent.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ResourceMonitorRoot>
  );
};

const ResourceMonitorRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--app-text);

  .monitor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .monitor-toolbar-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }

  .monitor-toolbar-title {
    font-size: 13px;
    line-height: 1.35;
    font-weight: 650;
  }

  .monitor-toolbar-meta {
    margin-top: 3px;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.4;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }

  .summary-item {
    min-width: 0;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    padding: 11px 12px;
  }

  .summary-label {
    display: block;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.35;
  }

  .summary-value {
    display: block;
    margin-top: 5px;
    font-size: 16px;
    line-height: 1.25;
    font-weight: 700;
    color: var(--app-text);
  }

  .monitor-warning {
    border: 1px solid color-mix(in srgb, var(--semi-color-warning) 35%, var(--app-border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-warning-light-default) 45%, var(--app-bg-elevated));
    color: var(--app-text);
    padding: 9px 11px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    line-height: 1.5;
  }

  .monitor-warning > span {
    min-width: 0;
  }

  .diagnostics-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .diagnostic-item {
    min-width: 0;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    padding: 10px 12px;
  }

  .diagnostic-label,
  .diagnostic-meta {
    display: block;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.35;
  }

  .diagnostic-value {
    display: block;
    margin-top: 5px;
    color: var(--app-text);
    font-size: 15px;
    line-height: 1.25;
    font-weight: 700;
  }

  .diagnostic-meta {
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diagnostic-action {
    margin-top: 7px;
    padding-left: 0;
  }

  .probe-panel,
  .distribution-panel {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    overflow: hidden;
  }

  .distribution-header {
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

  .state-block {
    min-height: 150px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .state-block.error {
    color: var(--semi-color-danger);
  }

  .distribution-table {
    width: 100%;
  }

  .probe-list {
    display: flex;
    flex-direction: column;
  }

  .probe-row {
    min-height: 48px;
    padding: 9px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .probe-row:last-child {
    border-bottom: none;
  }

  .probe-main {
    min-width: 0;
  }

  .probe-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.35;
    font-weight: 650;
  }

  .probe-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    flex: 0 0 auto;
    background: var(--semi-color-text-2);
  }

  .probe-dot.ok {
    background: var(--semi-color-success);
  }

  .probe-dot.error {
    background: var(--semi-color-danger);
  }

  .probe-error {
    margin-top: 4px;
    color: var(--semi-color-danger);
    font-size: 11px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .probe-status {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.35;
  }

  .probe-status-text {
    color: var(--app-text-secondary);
    font-weight: 650;
  }

  .probe-status-text.ok {
    color: var(--semi-color-success);
  }

  .probe-status-text.error {
    color: var(--semi-color-danger);
  }

  .distribution-row {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 72px 72px 92px 120px;
    gap: 10px;
    align-items: center;
    min-height: 44px;
    padding: 8px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
    font-size: 11px;
    line-height: 1.35;
  }

  .distribution-row:last-child {
    border-bottom: none;
  }

  .distribution-row-head {
    min-height: 32px;
    color: var(--app-text-muted);
    background: color-mix(in srgb, var(--app-panel-muted) 70%, transparent);
    font-weight: 600;
  }

  .location-cell {
    min-width: 0;
  }

  .location-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--app-text);
    font-weight: 600;
  }

  .location-meta {
    margin-top: 3px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .location-breakdown {
    margin-top: 3px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    line-height: 1.35;
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

  .legacy-badge {
    flex-shrink: 0;
    border-radius: 999px;
    padding: 1px 6px;
    background: var(--semi-color-warning-light-default);
    color: var(--semi-color-warning);
    font-size: 10px;
    line-height: 1.4;
  }

  .location-legacy {
    margin-top: 3px;
    color: var(--semi-color-warning);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    line-height: 1.35;
  }

  .percent-cell {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .percent-track {
    flex: 1;
    min-width: 36px;
    height: 5px;
    border-radius: 999px;
    background: var(--semi-color-fill-1);
    overflow: hidden;
  }

  .percent-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--semi-color-primary);
  }

  @container (max-width: 760px) {
    .monitor-toolbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .monitor-toolbar-actions {
      width: 100%;
      justify-content: flex-start;
      flex-wrap: wrap;
    }

    .monitor-warning {
      align-items: flex-start;
      flex-direction: column;
    }

    .summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .diagnostics-grid {
      grid-template-columns: 1fr;
    }

    .distribution-row {
      grid-template-columns: minmax(180px, 1fr) 56px 56px 80px 96px;
    }

    .probe-row {
      align-items: flex-start;
    }
  }
`;

export default ResourceMonitorWorkspace;
