import React from 'react';
import { Input } from '@douyinfe/semi-ui';
import { CompactModal } from '@/components/ui/compact-modal';

interface LibraryEditModalProps {
  visible: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const LibraryEditModal: React.FC<LibraryEditModalProps> = ({
  visible,
  name,
  onNameChange,
  onConfirm,
  onCancel,
}) => {
  return (
    <CompactModal
      title="重命名仓库"
      visible={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
    >
      <Input
        placeholder="请输入仓库名称"
        value={name}
        onChange={onNameChange}
        autoFocus
        onEnterPress={onConfirm}
      />
    </CompactModal>
  );
};

export default LibraryEditModal;
