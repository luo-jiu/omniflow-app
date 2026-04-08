import React from 'react';
import { Checkbox, Input, Modal, Typography } from '@douyinfe/semi-ui';

interface LibraryEditModalProps {
  visible: boolean;
  name: string;
  starred: boolean;
  onNameChange: (value: string) => void;
  onStarredChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const LibraryEditModal: React.FC<LibraryEditModalProps> = ({
  visible,
  name,
  starred,
  onNameChange,
  onStarredChange,
  onConfirm,
  onCancel,
}) => {
  return (
    <Modal
      title="编辑仓库"
      visible={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      okText="保存"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input
          placeholder="请输入仓库名称"
          value={name}
          onChange={onNameChange}
          autoFocus
          onEnterPress={onConfirm}
        />
        <Checkbox checked={starred} onChange={event => onStarredChange(Boolean(event.target.checked))}>
          收藏此仓库
        </Checkbox>
        <Typography.Text type="tertiary" size="small">
          当前为前端本地预览模式，暂不提交后端。
        </Typography.Text>
      </div>
    </Modal>
  );
};

export default LibraryEditModal;
