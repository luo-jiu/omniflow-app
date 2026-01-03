import React from 'react';
import { Modal, Input } from '@douyinfe/semi-ui';

interface LibraryCreateModalProps {
  visible: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const LibraryCreateModal: React.FC<LibraryCreateModalProps> = ({
  visible,
  name,
  onNameChange,
  onConfirm,
  onCancel
}) => {
  return (
    <Modal
      title="新建库"
      visible={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      okText="创建"
    >
      <Input
        placeholder="请输入库名称"
        value={name}
        onChange={onNameChange}
        autoFocus
        onEnterPress={onConfirm}
      />
    </Modal>
  );
};

export default LibraryCreateModal;

