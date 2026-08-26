import React from 'react';
import { Input } from '@douyinfe/semi-ui';
import { CompactModal } from '@/components/ui/compact-modal';

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
    <CompactModal
      title="新建库"
      visible={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      okText="创建"
      cancelText="取消"
    >
      <Input
        placeholder="请输入库名称"
        value={name}
        onChange={onNameChange}
        autoFocus
        onEnterPress={onConfirm}
      />
    </CompactModal>
  );
};

export default LibraryCreateModal;
