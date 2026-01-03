import React from 'react';
import { Popconfirm } from '@douyinfe/semi-ui';
import MenuContent from '@/components/ui/menu-content';

interface DirectoryContextMenuProps {
  node: any;
  isFolder: boolean;
  onAction: (action: string, node: any) => void;
}

const DirectoryContextMenu: React.FC<DirectoryContextMenuProps> = ({
  node,
  isFolder,
  onAction
}) => {
  if (node === null) {
    return (
      <MenuContent>
        <div className="menu-title">根目录操作</div>
        <div className="menu-item" onClick={() => onAction('新建文件', null)}>新建文件</div>
        <div className="menu-item" onClick={() => onAction('新建文件夹', null)}>新建文件夹</div>
      </MenuContent>
    );
  }

  return (
    <MenuContent>
      <div className="menu-title">{isFolder ? '文件夹操作' : '文件操作'}</div>
      <div className="menu-item" onClick={() => onAction('重命名', node)}>重命名</div>
      
      {isFolder ? (
        <>
          <div className="menu-item" onClick={() => onAction('新建文件', node)}>新建文件</div>
          <div className="menu-item" onClick={() => onAction('新建文件夹', node)}>新建文件夹</div>
        </>
      ) : (
        <div className="menu-item" onClick={() => onAction('属性', node)}>属性</div>
      )}

      <Popconfirm
        title={<div style={{ fontSize: '16px', fontWeight: 600 }}>确认删除？</div>}
        content={
          <div style={{ fontSize: '14px', marginTop: '8px', width: '240px' }}>
            将删除「{node.data?.rawName ?? node.label ?? node.key}」及其所有子内容，此操作不可恢复。
          </div>
        }
        okType="danger"
        onConfirm={() => {
          onAction('delete', node);
        }}
        position="rightBottom"
        style={{ width: 320 }}
      >
        <div className="menu-item danger">删除</div>
      </Popconfirm>
    </MenuContent>
  );
};

export default DirectoryContextMenu;

