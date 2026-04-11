import React from 'react';
import { Modal, Input } from '@douyinfe/semi-ui';

interface CreateNodeModalProps {
  visible: boolean;
  type: 'file' | 'dir' | null;
  name: string;
  loading: boolean;
  onNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const CreateNodeModal: React.FC<CreateNodeModalProps> = ({
  visible,
  type,
  name,
  loading,
  onNameChange,
  onConfirm,
  onCancel
}) => {
  return (
    <Modal
      title={type === 'dir' ? '新建文件夹' : '新建文件'}
      visible={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确定"
      cancelText="取消"
      maskClosable={false}
      centered
    >
      <div style={{ padding: '10px 0' }}>
        <Input
          placeholder={type === 'dir' ? '请输入文件夹名称' : '请输入文件名称'}
          value={name}
          onChange={onNameChange}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              onConfirm();
            }
          }}
          autoFocus
        />
      </div>
    </Modal>
  );
};

export default CreateNodeModal;
