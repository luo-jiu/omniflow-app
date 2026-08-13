import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, Progress, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import {
  cancelMigrationTask,
  listMigrationTasks,
  type MigrationTask,
} from '@/modules/transfer-center/services/migration.api';
import { runtimeLogger } from '@/utils/runtimeLogger';

const { Text } = Typography;

const POLL_INTERVAL_MS = 5000;

function statusTag(status: string) {
  const map: Record<string, { color: 'amber' | 'blue' | 'green' | 'red' | 'grey'; label: string }> = {
    pending: { color: 'amber', label: '等待中' },
    running: { color: 'blue', label: '运行中' },
    completed: { color: 'green', label: '已完成' },
    failed: { color: 'red', label: '失败' },
    canceled: { color: 'grey', label: '已取消' },
  };
  const entry = map[status] ?? { color: 'grey' as const, label: status };
  return <Tag color={entry.color} size="small">{entry.label}</Tag>;
}

function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const MigrationTab: React.FC = () => {
  const [tasks, setTasks] = useState<MigrationTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await listMigrationTasks({});
      if (!mountedRef.current) return;
      setTasks(list);
      setLoaded(true);
    } catch (err) {
      runtimeLogger.warn('list migration tasks failed', err);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  const handleCancel = async (taskId: string) => {
    try {
      await cancelMigrationTask(taskId);
      Toast.success('已取消');
      refresh();
    } catch (err: any) {
      runtimeLogger.error('cancel migration failed', err);
      Toast.error(err?.message || '取消失败');
    }
  };

  if (!loaded) {
    return null;
  }

  if (tasks.length === 0) {
    return (
      <div style={{ padding: '32px 16px' }}>
        <Empty
          description={
            <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, lineHeight: 1.6 }}>
              暂无存储迁移任务<br />
              从文件树右键菜单 “迁移到其他存储...” 创建任务
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 4px' }}>
      {tasks.map((task) => {
        const total = Math.max(1, task.totalObjects);
        const percent = Math.min(100, Math.round((task.completedObjects / total) * 100));
        const cancellable = task.status === 'pending' || task.status === 'running';
        return (
          <div
            key={task.id}
            style={{
              border: '1px solid var(--semi-color-border)',
              borderRadius: 8,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text strong style={{ flex: 1 }}>
                {`Library ${task.libraryId} · Node ${task.rootNodeId} → ${task.targetProvider}`}
              </Text>
              {statusTag(task.status)}
              {cancellable && (
                <Button size="small" theme="borderless" onClick={() => handleCancel(task.id)}>
                  取消
                </Button>
              )}
            </div>
            <Progress percent={percent} stroke="var(--semi-color-primary)" size="small" />
            <Text size="small" type="tertiary">
              对象: {task.completedObjects}/{task.totalObjects}
              {task.failedObjects > 0 ? ` · 失败 ${task.failedObjects}` : ''}
              {task.skippedObjects > 0 ? ` · 跳过 ${task.skippedObjects}` : ''}
              {' · '}字节: {humanBytes(task.transferredBytes)} / {humanBytes(task.totalBytes)}
            </Text>
            {task.currentObjectKey && (
              <Text size="small" type="quaternary" ellipsis={{ showTooltip: true }}>
                当前: {task.currentObjectKey}
              </Text>
            )}
            {task.errorMessage && (
              <Text size="small" type="danger">
                错误: {task.errorMessage}
              </Text>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MigrationTab;
