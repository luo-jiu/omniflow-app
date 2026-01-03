import React from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { uploadManager } from '@/utils/uploadManager.ts';

interface UploadConfirmModalProps {
  visible: boolean;
  files: File[];
  targetNode: any;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const UploadConfirmModal: React.FC<UploadConfirmModalProps> = ({
  visible,
  files,
  targetNode,
  loading,
  onConfirm,
  onCancel
}) => {
  return (
    <Modal
      title="文件上传确认"
      visible={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
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
      {files.length > 0 && targetNode && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ marginBottom: 12 }}>
            <strong>上传位置:</strong> 📂 {targetNode.label}
          </div>

          <div style={{ 
            maxHeight: '200px', 
            overflowY: 'auto', 
            border: '1px solid var(--semi-color-border)',
            borderRadius: '4px',
            padding: '8px',
            backgroundColor: 'var(--semi-color-fill-0)'
          }}>
            {files.map((f, i) => (
              <div key={i} style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                padding: '4px 0',
                fontSize: '13px',
                borderBottom: i === files.length - 1 ? 'none' : '1px solid var(--semi-color-border-light)'
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }}>
                  {f.name}
                </span>
                <span style={{ color: 'var(--semi-color-text-2)', marginLeft: 8 }}>
                  {uploadManager.formatSize(f.size)}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, color: 'var(--semi-color-text-2)', fontSize: 15 }}>
            <p>即将上传以上 {files.length} 个文件到目标目录，是否继续？</p>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default UploadConfirmModal;

