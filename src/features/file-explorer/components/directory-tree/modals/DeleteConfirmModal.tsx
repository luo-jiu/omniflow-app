import React from 'react';
import { Modal } from '@douyinfe/semi-ui';
import styled from 'styled-components';

interface DeleteConfirmModalProps {
  deleteCount: number;
  isFolder: boolean;
  nodeName: string;
  onCancel: () => void;
  onConfirm: () => void;
  visible: boolean;
}

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 2px;

  .delete-title {
    font-size: 18px;
    line-height: 1.45;
    font-weight: 600;
    color: var(--semi-color-text-0);
  }

  .delete-desc {
    font-size: 16px;
    line-height: 1.65;
    color: var(--semi-color-text-1);
  }

  .delete-target {
    border: 1px solid var(--semi-color-danger-light-default);
    border-radius: 8px;
    padding: 12px 14px;
    background: var(--semi-color-danger-light-default);
    color: var(--semi-color-text-0);
    font-size: 16px;
    line-height: 1.55;
    word-break: break-word;
  }
`;

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  deleteCount,
  isFolder,
  nodeName,
  onCancel,
  onConfirm,
  visible,
}) => {
  const isBatch = deleteCount > 1;
  const targetText = isBatch
    ? `选中的 ${deleteCount} 项`
    : `「${nodeName || (isFolder ? '文件夹' : '文件')}」`;

  return (
    <Modal
      title="确认删除"
      visible={visible}
      centered
      width={520}
      okText="移入回收站"
      cancelText="取消"
      okType="danger"
      maskClosable={false}
      onOk={onConfirm}
      onCancel={onCancel}
      bodyStyle={{ padding: '22px 28px 26px' }}
      okButtonProps={{ size: 'large', style: { minWidth: 116, height: 40, fontSize: 16, borderRadius: 8 } }}
      cancelButtonProps={{ size: 'large', style: { minWidth: 88, height: 40, fontSize: 16, borderRadius: 8 } }}
    >
      <Content>
        <div className="delete-title">将内容移入回收站？</div>
        <div className="delete-desc">
          删除后内容会进入回收站，可以在回收站中恢复或彻底删除。
        </div>
        <div className="delete-target">{targetText}</div>
      </Content>
    </Modal>
  );
};

export default DeleteConfirmModal;
