import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Button, Empty, Progress, Tag, Typography, Toast } from '@douyinfe/semi-ui';
import { IconChevronLeft } from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router-dom';
import { uploadManager } from '@/utils/uploadManager';
import type { UploadTask } from '@/modules/upload-center/model/upload-task.types';
import type { UploadTaskSummary } from '@/modules/upload-center/model/upload-task.store';

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
    gap: 12px;
    margin-bottom: 18px;
  }

  .subtitle {
    margin-bottom: 18px;
    color: var(--semi-color-text-2);
    font-size: 14px;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 18px;
  }

  .summary-card {
    border: 1px solid var(--semi-color-border);
    border-radius: 10px;
    padding: 10px 12px;
    background: var(--semi-color-bg-0);
  }

  .summary-label {
    font-size: 12px;
    color: var(--semi-color-text-2);
  }

  .summary-value {
    margin-top: 4px;
    font-size: 20px;
    font-weight: 600;
  }

  .list {
    border: 1px solid var(--semi-color-border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--semi-color-bg-0);
  }

  .row {
    padding: 14px 16px;
    border-bottom: 1px solid var(--semi-color-border-light);
  }

  .row:last-child {
    border-bottom: none;
  }

  .row-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .file-name {
    font-size: 14px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 56%;
  }

  .row-meta {
    margin-top: 8px;
    display: flex;
    justify-content: space-between;
    gap: 10px;
    color: var(--semi-color-text-2);
    font-size: 12px;
  }

  .row-actions {
    display: flex;
    gap: 8px;
  }

  @media (max-width: 900px) {
    padding: 22px 18px;

    .summary {
      grid-template-columns: repeat(2, minmax(100px, 1fr));
    }
  }
`;

const STATUS_LABEL: Record<UploadTask['status'], string> = {
  queued: '排队中',
  uploading: '上传中',
  success: '已完成',
  failed: '失败',
  canceled: '已取消',
  paused: '已暂停',
};

const STATUS_COLOR: Record<UploadTask['status'], 'grey' | 'green' | 'red' | 'blue' | 'orange'> = {
  queued: 'grey',
  uploading: 'blue',
  success: 'green',
  failed: 'red',
  canceled: 'grey',
  paused: 'orange',
};

function formatSpeed(speedBps: number): string {
  if (speedBps <= 0) return '--';
  return `${uploadManager.formatSize(speedBps)}/s`;
}

function formatProgress(task: UploadTask): string {
  return `${uploadManager.formatSize(task.progress.uploadedBytes)} / ${uploadManager.formatSize(task.progress.totalBytes)}`;
}

const UploadCenter: React.FC = () => {
  const navigate = useNavigate();
  const { Title } = Typography;
  const [tasks, setTasks] = useState<UploadTask[]>(() => uploadManager.getTasks());
  const [summary, setSummary] = useState<UploadTaskSummary>(() => uploadManager.getSummary());

  useEffect(() => {
    const sync = () => {
      setTasks(uploadManager.getTasks());
      setSummary(uploadManager.getSummary());
    };
    sync();
    const unsubscribe = uploadManager.subscribe(() => {
      sync();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => b.createdAt - a.createdAt),
    [tasks],
  );

  const handleCancel = (taskId: string) => {
    const canceled = uploadManager.cancelTask(taskId);
    if (!canceled) {
      Toast.warning('当前任务不可中断');
      return;
    }
    Toast.info('已中断任务');
  };

  const handleRetry = (taskId: string) => {
    const retried = uploadManager.retryTask(taskId);
    if (!retried) {
      Toast.warning('仅失败任务支持重试');
      return;
    }
    Toast.info('任务已重新加入队列');
  };

  return (
    <Page>
      <div className="header">
        <Button
          icon={<IconChevronLeft style={{ fontSize: 20 }} />}
          theme="borderless"
          onClick={() => navigate(-1)}
          style={{ padding: 6, borderRadius: 8 }}
        />
        <Title heading={2} style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>
          上传中心
        </Title>
      </div>

      <div className="subtitle">
        统一查看上传队列、实时进度与中断状态
      </div>

      <div className="summary">
        <div className="summary-card">
          <div className="summary-label">总任务</div>
          <div className="summary-value">{summary.total}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">进行中</div>
          <div className="summary-value">{summary.uploading}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">排队</div>
          <div className="summary-value">{summary.queued}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">失败</div>
          <div className="summary-value">{summary.failed}</div>
        </div>
      </div>

      <div className="list">
        {sortedTasks.length === 0 ? (
          <div style={{ padding: 36 }}>
            <Empty description="暂无上传任务" />
          </div>
        ) : (
          sortedTasks.map((task) => (
            <div key={task.id} className="row">
              <div className="row-head">
                <div className="file-name" title={task.meta.fileName}>{task.meta.fileName}</div>
                <Tag color={STATUS_COLOR[task.status]}>{STATUS_LABEL[task.status]}</Tag>
              </div>

              <div style={{ marginTop: 10 }}>
                <Progress
                  percent={Number(task.progress.percentage.toFixed(1))}
                  showInfo={false}
                  stroke={task.status === 'failed' ? 'var(--semi-color-danger)' : undefined}
                />
              </div>

              <div className="row-meta">
                <span>{task.progress.percentage.toFixed(1)}%</span>
                <span>{formatProgress(task)}</span>
                <span>{formatSpeed(task.progress.speedBps)}</span>
                <div className="row-actions">
                  {(task.status === 'uploading' || task.status === 'queued' || task.status === 'paused') && (
                    <Button size="small" type="danger" theme="borderless" onClick={() => handleCancel(task.id)}>
                      中断
                    </Button>
                  )}
                  {task.status === 'failed' && (
                    <Button size="small" theme="borderless" onClick={() => handleRetry(task.id)}>
                      重试
                    </Button>
                  )}
                </div>
              </div>
              {task.status === 'failed' && task.error?.message && (
                <div style={{ marginTop: 8, color: 'var(--semi-color-danger)', fontSize: 12 }}>
                  失败原因: {task.error.message}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Page>
  );
};

export default UploadCenter;
