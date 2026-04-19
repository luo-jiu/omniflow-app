import React from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { formatSize } from '@/utils/formatSize';
import type {
  OverlayFileSummary,
  OverlayTargetNode,
} from '@/service/overlay/types';

interface UploadConfirmModalProps {
  visible: boolean;
  fileSummaries: OverlayFileSummary[];
  targetNode: OverlayTargetNode | null;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const UploadConfirmModal: React.FC<UploadConfirmModalProps> = ({
  visible,
  fileSummaries,
  targetNode,
  loading,
  onConfirm,
  onCancel,
}) => {
  const containsFolderStructure = fileSummaries.some(item => (item.relativePath || '').includes('/'));

  const summaryItems = React.useMemo(() => {
    const folderMap = new Map<string, { name: string; fileCount: number; totalBytes: number }>();
    const fileItems: Array<{ key: string; name: string; totalBytes: number }> = [];

    fileSummaries.forEach((item, index) => {
      const normalizedPath = String(item.relativePath || item.name || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean);
      const firstSegment = normalizedPath[0] || item.name || `file-${index + 1}`;
      const isFolderFile = normalizedPath.length > 1;
      if (isFolderFile) {
        const current = folderMap.get(firstSegment) || {
          name: firstSegment,
          fileCount: 0,
          totalBytes: 0,
        };
        current.fileCount += 1;
        current.totalBytes += Number(item.size || 0);
        folderMap.set(firstSegment, current);
        return;
      }
      fileItems.push({
        key: `${firstSegment}-${index}`,
        name: firstSegment,
        totalBytes: Number(item.size || 0),
      });
    });

    const folders = Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    const filesList = fileItems.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return {
      folders,
      files: filesList,
    };
  }, [fileSummaries]);

  const totalBytes = React.useMemo(
    () => fileSummaries.reduce((sum, item) => sum + Number(item.size || 0), 0),
    [fileSummaries],
  );

  return (
    <Modal
      title={containsFolderStructure ? '文件夹上传确认' : '文件上传确认'}
      visible={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={Boolean(loading)}
      okText="确定上传"
      cancelText="取消"
      maskClosable={false}
      centered
      width={600}
      bodyStyle={{
        fontSize: 15,
        lineHeight: '22px',
        padding: '20px 28px',
      }}
    >
      {fileSummaries.length > 0 && targetNode && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ marginBottom: 12 }}>
            <strong>上传位置:</strong> 📂 {targetNode.label}
          </div>

          <div style={{
            maxHeight: '240px',
            overflowY: 'auto',
            border: '1px solid var(--semi-color-border)',
            borderRadius: '4px',
            padding: '10px 12px',
            backgroundColor: 'var(--semi-color-fill-0)'
          }}>
            {summaryItems.folders.map((folder) => (
              <div key={`folder-${folder.name}`} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                fontSize: 13,
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }}>
                  📁 {folder.name}
                </span>
                <span style={{ color: 'var(--semi-color-text-2)', marginLeft: 8 }}>
                  {folder.fileCount} 个文件 · {formatSize(folder.totalBytes)}
                </span>
              </div>
            ))}
            {summaryItems.files.map((file) => (
              <div key={file.key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                fontSize: 13,
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }}>
                  📄 {file.name}
                </span>
                <span style={{ color: 'var(--semi-color-text-2)', marginLeft: 8 }}>
                  {formatSize(file.totalBytes)}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, color: 'var(--semi-color-text-2)', fontSize: 15 }}>
            <p>
              共 {summaryItems.folders.length} 个文件夹、{summaryItems.files.length} 个文件、{fileSummaries.length} 个上传任务，
              总大小 {formatSize(totalBytes)}。是否继续？
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default UploadConfirmModal;
