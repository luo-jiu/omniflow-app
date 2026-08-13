import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Select, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import {
  enqueueMigration,
  getStorageDistribution,
  type StorageDistributionEntry,
} from '@/modules/transfer-center/services/migration.api';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface MigrationDialogProps {
  visible: boolean;
  libraryId: number;
  rootNodeId: number;
  nodeName: string;
  availableProviders: string[];
  onCancel: () => void;
  onSuccess: (taskId: string | null) => void;
}

const { Text } = Typography;

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

const MigrationDialog: React.FC<MigrationDialogProps> = ({
  visible,
  libraryId,
  rootNodeId,
  nodeName,
  availableProviders,
  onCancel,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [distribution, setDistribution] = useState<StorageDistributionEntry[]>([]);
  const [target, setTarget] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) {
      setDistribution([]);
      setTarget('');
      return;
    }
    let canceled = false;
    setLoading(true);
    getStorageDistribution(libraryId, rootNodeId)
      .then((entries) => {
        if (canceled) return;
        setDistribution(entries);
      })
      .catch((err) => {
        if (canceled) return;
        runtimeLogger.error('storage distribution failed', err);
        Toast.error(err?.message || '加载存储分布失败');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [visible, libraryId, rootNodeId]);

  const totalFiles = useMemo(
    () => distribution.reduce((sum, e) => sum + e.fileCount, 0),
    [distribution],
  );
  const totalBytes = useMemo(
    () => distribution.reduce((sum, e) => sum + e.totalBytes, 0),
    [distribution],
  );

  // 100% 已经在某个 provider 上 → 该项禁用
  const fullProvider = useMemo(() => {
    if (distribution.length !== 1) return null;
    const only = distribution[0];
    return only.fileCount === totalFiles ? only.provider : null;
  }, [distribution, totalFiles]);

  const handleConfirm = async () => {
    if (!target) {
      Toast.warning('请选择目标存储');
      return;
    }
    if (target === fullProvider) {
      Toast.warning('已经在该存储上，无需迁移');
      return;
    }
    setSubmitting(true);
    try {
      const result = await enqueueMigration({
        libraryId,
        rootNodeId,
        targetProvider: target,
      });
      Toast.success(`已入队迁移 ${result.plannedObjects} 个对象`);
      onSuccess(result.task?.id ?? null);
    } catch (err: any) {
      runtimeLogger.error('enqueue migration failed', err);
      Toast.error(err?.message || '入队迁移任务失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="迁移到其他存储"
      visible={visible}
      onCancel={onCancel}
      onOk={handleConfirm}
      okText={submitting ? '提交中...' : '开始迁移'}
      cancelText="取消"
      confirmLoading={submitting}
      maskClosable={!submitting}
      width={460}
    >
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Text strong>{nodeName}</Text>
          <Text type="secondary" size="small">
            共 {totalFiles} 个文件 · {humanBytes(totalBytes)}
          </Text>

          <div>
            <Text size="small" type="tertiary">
              当前分布：
            </Text>
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {distribution.length === 0 && (
                <Text size="small" type="quaternary">
                  无存储对象
                </Text>
              )}
              {distribution.map((e) => (
                <Text key={e.provider} size="small">
                  {e.provider} · {e.fileCount} 文件 · {humanBytes(e.totalBytes)}
                </Text>
              ))}
            </div>
          </div>

          <div>
            <Text size="small" type="tertiary" style={{ marginBottom: 4, display: 'block' }}>
              目标存储：
            </Text>
            <Select
              value={target}
              onChange={(v) => setTarget(String(v ?? ''))}
              placeholder="选择目标 provider"
              style={{ width: '100%' }}
              optionList={availableProviders.map((p) => ({
                label: p === fullProvider ? `${p}（已全部在此）` : p,
                value: p,
                disabled: p === fullProvider,
              }))}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};

export default MigrationDialog;
