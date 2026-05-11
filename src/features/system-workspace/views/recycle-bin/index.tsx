import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { Button, Empty, Modal, Tag, Toast } from '@douyinfe/semi-ui';
import { IconDelete, IconRefresh } from '@douyinfe/semi-icons';
import {
  clearRecycleBin,
  fetchRecycleBinItems,
  hardDeleteNodeAndChildren,
  restoreNodeAndChildren,
  type RecycleBinItem,
  type RecycleStorageLocation,
} from '@/features/file-explorer/services/file.api';
import { markRepositoryTreeSnapshotDirty } from '@/features/file-explorer/hooks/useRepositoryTree';
import { requestDesktopWindowActivation } from '@/utils/windowActivation';
import type { SystemWorkspaceViewProps } from '../../types';

const RecycleBinWorkspaceWrapper = styled.div`
  width: 100%;

  .recycle-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .recycle-summary {
    min-width: 0;
    color: var(--semi-color-text-2);
    font-size: 11px;
    line-height: 1.55;
  }

  .recycle-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    flex-shrink: 0;
  }

  .toolbar-button {
    height: 27px;
    min-height: 27px;
    padding: 0 9px;
    border-radius: 7px;
    font-size: 10px;
    font-weight: 600;
  }

  .toolbar-button .semi-icon,
  .row-action-button .semi-icon {
    font-size: 12px;
  }

  .list {
    border: 1px solid var(--semi-color-border);
    border-radius: 9px;
    overflow: hidden;
    background: var(--semi-color-bg-0);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(134px, 1.3fr) 67px 121px 80px 121px;
    align-items: center;
    gap: 9px;
    padding: 11px 12px;
    border-bottom: 1px solid var(--semi-color-border-light);
  }

  .row.header-row {
    font-size: 10px;
    color: var(--semi-color-text-2);
    background: var(--semi-color-fill-0);
    font-weight: 600;
  }

  .row:last-child {
    border-bottom: none;
  }

  .name {
    min-width: 0;
  }

  .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 500;
  }

  .name-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 4px;
    font-size: 10px;
    color: var(--semi-color-text-2);
  }

  .storage-location-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .storage-more {
    flex-shrink: 0;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--semi-color-primary);
    cursor: pointer;
    font-size: 10px;
    line-height: 1.3;
  }

  .size,
  .time {
    font-size: 10px;
    color: var(--semi-color-text-2);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 5px;
  }

  .row-action-button {
    height: 25px;
    min-height: 25px;
    padding: 0 7px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
  }

  .semi-tag {
    font-size: 10px;
    line-height: 16px;
  }

  .empty-state {
    padding: 38px 16px;
  }

  .empty-state .semi-empty-description {
    font-size: 11px;
  }

  @media (max-width: 760px) {
    .recycle-toolbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .row {
      grid-template-columns: minmax(120px, 1fr) 59px 94px 60px 101px;
      gap: 5px;
      padding: 8px 9px;
    }
  }
`;

const RecycleBinConfirmModalStyle = createGlobalStyle`
  .recycle-bin-compact-confirm {
    width: 320px !important;
  }

  .recycle-bin-compact-confirm .semi-modal-content {
    overflow: hidden;
    border: 1px solid var(--app-border-strong);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  }

  .recycle-bin-compact-confirm .semi-modal-header {
    margin: 0;
    padding: 13px 16px 8px !important;
  }

  .recycle-bin-compact-confirm .semi-modal-title {
    font-size: 14px;
    line-height: 1.35;
    font-weight: 700;
  }

  .recycle-bin-compact-confirm .semi-modal-body {
    padding: 0 16px 13px !important;
    font-size: 12px;
    line-height: 1.55;
    color: var(--semi-color-text-1);
  }

  .recycle-bin-compact-confirm .semi-modal-confirm-content {
    font-size: 12px;
    line-height: 1.55;
  }

  .recycle-bin-compact-confirm .semi-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 0;
    padding: 0 16px 16px !important;
  }

  .recycle-bin-compact-confirm .semi-button {
    height: 28px;
    min-width: 56px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }
`;

function formatBytes(size?: number): string {
  if (!size || size <= 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function getRecycleStorageLocations(item: RecycleBinItem): RecycleStorageLocation[] {
  if (item.storageLocations && item.storageLocations.length > 0) {
    return item.storageLocations;
  }
  if (!item.storageProvider && !item.storageBucket) {
    return [];
  }
  return [{
    storageProvider: item.storageProvider,
    storageProviderType: item.storageProviderType,
    storageProviderLabel: item.storageProviderLabel,
    storageEndpoint: item.storageEndpoint,
    storageBucket: item.storageBucket,
    fileCount: item.type === 'file' ? 1 : undefined,
  }];
}

function formatStorageLocation(location: RecycleStorageLocation): string {
  const provider = location.storageProviderLabel && location.storageProvider
    ? `${location.storageProviderLabel}（${location.storageProvider}）`
    : location.storageProviderLabel || location.storageProvider || '';
  const parts = [
    provider,
    location.storageBucket ? `桶 ${location.storageBucket}` : '',
  ].filter(Boolean);
  const text = parts.length > 0 ? parts.join(' · ') : '物理存储未知';
  return location.fileCount && location.fileCount > 1 ? `${text} · ${location.fileCount} 个文件` : text;
}

function formatStorageLocationTitle(item: RecycleBinItem): string {
  const locations = getRecycleStorageLocations(item);
  if (locations.length === 0) {
    return '物理存储未知';
  }
  const lines = locations.map((location) => [
    formatStorageLocation(location),
    location.storageEndpoint ? `Endpoint: ${location.storageEndpoint}` : '',
  ].filter(Boolean).join(' · '));
  if (item.storageKey) {
    lines.push(`Key: ${item.storageKey}`);
  }
  return lines.join('\n');
}

function formatDeletedAt(value: string): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mi = `${date.getMinutes()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

const RecycleBinWorkspace: React.FC<SystemWorkspaceViewProps> = ({ libraryId }) => {
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedStorageIds, setExpandedStorageIds] = useState<Set<number>>(() => new Set());

  const validLibraryId = Number.isFinite(libraryId) && libraryId > 0;

  const loadItems = useCallback(async () => {
    if (!validLibraryId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchRecycleBinItems(libraryId);
      setItems(list);
    } catch (error: any) {
      Toast.error(error?.message || '加载回收站失败');
    } finally {
      setLoading(false);
    }
  }, [libraryId, validLibraryId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const summaryText = useMemo(() => {
    if (!validLibraryId) {
      return '当前资料库 ID 无效，无法加载回收站';
    }
    return `共 ${items.length} 条记录。默认删除会进入回收站，可恢复或彻底删除。`;
  }, [items.length, validLibraryId]);

  const toggleStorageExpanded = useCallback((itemId: number) => {
    setExpandedStorageIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleRestore = async (item: RecycleBinItem) => {
    try {
      await restoreNodeAndChildren(item.id, libraryId);
      setItems(prev => prev.filter(x => x.id !== item.id));
      markRepositoryTreeSnapshotDirty(libraryId);
      Toast.success('已恢复');
    } catch (error: any) {
      Toast.error(error?.message || '恢复失败');
    }
  };

  const handleHardDelete = async (item: RecycleBinItem) => {
    try {
      await hardDeleteNodeAndChildren(item.id, libraryId);
      setItems(prev => prev.filter(x => x.id !== item.id));
      markRepositoryTreeSnapshotDirty(libraryId);
      Toast.success('已彻底删除');
    } catch (error: any) {
      Toast.error(error?.message || '彻底删除失败');
    }
  };

  const openHardDeleteConfirm = (item: RecycleBinItem) => {
    requestDesktopWindowActivation(true);
    Modal.confirm({
      className: 'recycle-bin-compact-confirm',
      title: '确认彻底删除？',
      content: '彻底删除后无法恢复，并会清理对象存储文件。',
      okText: '彻底删除',
      cancelText: '取消',
      okType: 'danger',
      async onOk() {
        await handleHardDelete(item);
      },
    });
  };

  const handleClearRecycleBin = async () => {
    if (!validLibraryId || items.length === 0) {
      return;
    }
    requestDesktopWindowActivation(true);
    Modal.confirm({
      className: 'recycle-bin-compact-confirm',
      title: '确认清空回收站？',
      content: `将彻底删除当前库回收站中的 ${items.length} 项内容，删除后无法恢复。`,
      okText: '清空回收站',
      cancelText: '取消',
      okType: 'danger',
      async onOk() {
        try {
          const clearedCount = await clearRecycleBin(libraryId);
          setItems([]);
          markRepositoryTreeSnapshotDirty(libraryId);
          Toast.success(clearedCount > 0 ? `已清空回收站（${clearedCount} 项）` : '回收站已清空');
        } catch (error: any) {
          Toast.error(error?.message || '清空回收站失败');
        }
      },
    });
  };

  return (
    <RecycleBinWorkspaceWrapper>
      <RecycleBinConfirmModalStyle />
      <div className="recycle-toolbar">
        <div className="recycle-summary">{summaryText}</div>
        <div className="recycle-actions">
          <Button
            icon={<IconDelete />}
            theme="borderless"
            type="danger"
            disabled={items.length === 0 || loading}
            onClick={() => void handleClearRecycleBin()}
            className="toolbar-button"
          >
            清空回收站
          </Button>
          <Button
            icon={<IconRefresh />}
            theme="borderless"
            loading={loading}
            onClick={() => void loadItems()}
            className="toolbar-button"
          >
            刷新
          </Button>
        </div>
      </div>

      <div className="list">
        <div className="row header-row">
          <div>名称</div>
          <div>类型</div>
          <div>删除时间</div>
          <div>大小</div>
          <div style={{ textAlign: 'right' }}>操作</div>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <Empty description="回收站为空" />
          </div>
        ) : (
          items.map(item => (
            <div className="row" key={item.id}>
              <div className="name">
                <div className="name-text" title={item.name}>
                  {item.name}
                  {item.type === 'file' && item.ext ? `.${item.ext}` : ''}
                </div>
                {item.type === 'dir' && getRecycleStorageLocations(item).length === 0 && (
                  <div className="name-meta">
                    包含 {item.deletedDescendantCount ?? 0} 项
                  </div>
                )}
                {getRecycleStorageLocations(item).length > 0 && (
                  <div className="name-meta" title={formatStorageLocationTitle(item)}>
                    {(expandedStorageIds.has(item.id)
                      ? getRecycleStorageLocations(item)
                      : getRecycleStorageLocations(item).slice(0, 2)
                    ).map((location) => (
                      <span
                        className="storage-location-text"
                        key={`${location.storageProvider || 'unknown'}:${location.storageBucket || ''}`}
                      >
                        {formatStorageLocation(location)}
                      </span>
                    ))}
                    {getRecycleStorageLocations(item).length > 2 && (
                      <button
                        className="storage-more"
                        type="button"
                        onClick={() => toggleStorageExpanded(item.id)}
                      >
                        {expandedStorageIds.has(item.id)
                          ? '收起'
                          : `更多 ${getRecycleStorageLocations(item).length - 2}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div>
                <Tag color={item.type === 'dir' ? 'blue' : 'grey'}>
                  {item.type === 'dir' ? '文件夹' : '文件'}
                </Tag>
              </div>
              <div className="time">{formatDeletedAt(item.deletedAt)}</div>
              <div className="size">{item.type === 'file' ? formatBytes(item.fileSize) : '--'}</div>
              <div className="actions">
                <Button
                  size="default"
                  theme="borderless"
                  className="row-action-button"
                  onClick={() => void handleRestore(item)}
                >
                  恢复
                </Button>
                <Button
                  size="default"
                  theme="borderless"
                  type="danger"
                  icon={<IconDelete />}
                  className="row-action-button"
                  onClick={() => openHardDeleteConfirm(item)}
                >
                  彻底删除
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </RecycleBinWorkspaceWrapper>
  );
};

export default RecycleBinWorkspace;
