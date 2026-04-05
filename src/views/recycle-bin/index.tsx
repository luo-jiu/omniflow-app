import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Button, Empty, Popconfirm, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { IconChevronLeft, IconDelete, IconRefresh } from '@douyinfe/semi-icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchRecycleBinItems,
  hardDeleteNodeAndChildren,
  restoreNodeAndChildren,
  type RecycleBinItem,
} from '@/features/file-explorer/services/file.api';
import { invalidateRepositoryTreeSnapshot } from '@/features/file-explorer/hooks/useRepositoryTree';

const Page = styled.div`
  width: 100%;
  height: 100%;
  padding: 34px 36px;
  overflow: auto;
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .subtitle {
    margin-bottom: 18px;
    color: var(--semi-color-text-2);
    font-size: 14px;
  }

  .list {
    border: 1px solid var(--semi-color-border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--semi-color-bg-0);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(200px, 1.3fr) 100px 180px 120px 180px;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--semi-color-border-light);
  }

  .row.header-row {
    font-size: 12px;
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
    font-size: 14px;
  }

  .name-meta {
    margin-top: 4px;
    font-size: 12px;
    color: var(--semi-color-text-2);
  }

  .size,
  .time {
    font-size: 12px;
    color: var(--semi-color-text-2);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  @media (max-width: 980px) {
    padding: 22px 16px;

    .row {
      grid-template-columns: minmax(160px, 1fr) 88px 140px 90px 150px;
      gap: 8px;
      padding: 10px 12px;
    }
  }
`;

function formatBytes(size?: number): string {
  if (!size || size <= 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
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

const RecycleBin: React.FC = () => {
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const libraryId = Number(id);
  const { Title } = Typography;
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState(false);

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
      return '当前路由缺少库 ID，无法加载回收站';
    }
    return `共 ${items.length} 条记录。默认删除会进入回收站，可恢复或彻底删除。`;
  }, [items.length, validLibraryId]);

  const handleRestore = async (item: RecycleBinItem) => {
    try {
      await restoreNodeAndChildren(item.id, libraryId);
      setItems(prev => prev.filter(x => x.id !== item.id));
      invalidateRepositoryTreeSnapshot(libraryId);
      Toast.success('已恢复');
    } catch (error: any) {
      Toast.error(error?.message || '恢复失败');
    }
  };

  const handleHardDelete = async (item: RecycleBinItem) => {
    try {
      await hardDeleteNodeAndChildren(item.id, libraryId);
      setItems(prev => prev.filter(x => x.id !== item.id));
      invalidateRepositoryTreeSnapshot(libraryId);
      Toast.success('已彻底删除');
    } catch (error: any) {
      Toast.error(error?.message || '彻底删除失败');
    }
  };

  return (
    <Page>
      <div className="header">
        <div className="header-left">
          <Button
            icon={<IconChevronLeft style={{ fontSize: 20 }} />}
            theme="borderless"
            onClick={() => navigate(-1)}
            style={{ padding: 6, borderRadius: 8 }}
          />
          <Title heading={2} style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>
            回收站
          </Title>
        </div>
        <Button
          icon={<IconRefresh />}
          theme="borderless"
          loading={loading}
          onClick={() => void loadItems()}
        >
          刷新
        </Button>
      </div>

      <div className="subtitle">{summaryText}</div>

      <div className="list">
        <div className="row header-row">
          <div>名称</div>
          <div>类型</div>
          <div>删除时间</div>
          <div>大小</div>
          <div style={{ textAlign: 'right' }}>操作</div>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: 36 }}>
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
                {item.type === 'dir' && (
                  <div className="name-meta">
                    包含 {item.deletedDescendantCount ?? 0} 项
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
                <Button size="small" theme="borderless" onClick={() => void handleRestore(item)}>
                  恢复
                </Button>
                <Popconfirm
                  title="确认彻底删除？"
                  content="彻底删除后无法恢复，并会清理对象存储文件。"
                  onConfirm={() => void handleHardDelete(item)}
                >
                  <Button
                    size="small"
                    theme="borderless"
                    type="danger"
                    icon={<IconDelete />}
                  >
                    彻底删除
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ))
        )}
      </div>
    </Page>
  );
};

export default RecycleBin;
