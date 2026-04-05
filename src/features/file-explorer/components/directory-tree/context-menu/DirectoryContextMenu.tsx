import React from 'react';
import { Popconfirm } from '@douyinfe/semi-ui';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';

interface DirectoryContextMenuProps {
  node: any;
  isFolder: boolean;
  onAction: (action: string, node: any) => void;
  onClose?: () => void;
}

/**
 * 目录树右键菜单
 * 使用通用的 ContextMenu 组件构建
 */
const DirectoryContextMenu: React.FC<DirectoryContextMenuProps> = ({
  node,
  isFolder,
  onAction,
  onClose
}) => {
  // 根目录菜单
  if (node === null) {
    const rootItems: ContextMenuItem[] = [
      { 
        key: 'new-file', 
        label: '新建文件', 
        onClick: () => onAction('新建文件', null) 
      },
      { 
        key: 'new-folder', 
        label: '新建文件夹', 
        onClick: () => onAction('新建文件夹', null) 
      }
    ];
    return (
      <ContextMenu
        items={rootItems}
        className="directory-context-menu"
        onItemClick={onClose}
      />
    );
  }

  // 文件/文件夹菜单
  const items: ContextMenuItem[] = [
    { 
      key: 'rename', 
      label: '重命名', 
      onClick: () => onAction('重命名', node) 
    }
  ];

  if (isFolder) {
    items.push(
      { 
        key: 'new-file', 
        label: '新建文件', 
        onClick: () => onAction('新建文件', node) 
      },
      { 
        key: 'new-folder', 
        label: '新建文件夹', 
        onClick: () => onAction('新建文件夹', node) 
      }
    );
  } else {
    items.push({ 
      key: 'props', 
      label: '属性', 
      onClick: () => onAction('属性', node) 
    });
  }

  // 分割线
  items.push({ type: 'divider', key: 'divider-1' });

  // 删除操作（带二次确认）
  items.push({
    key: 'delete',
    label: '删除',
    danger: true,
    render: (content) => (
      <Popconfirm
        title={<div style={{ fontSize: '16px', fontWeight: 600 }}>确认删除？</div>}
        content={
          <div style={{ fontSize: '14px', marginTop: '8px', width: '240px' }}>
            将把「{node.data?.rawName ?? node.label ?? node.key}」及其子内容移入回收站，你可在回收站恢复或彻底删除。
          </div>
        }
        okType="danger"
        onConfirm={() => {
          onAction('delete', node);
          onClose?.();
        }}
        position="rightBottom"
        style={{ width: 320 }}
      >
        {content}
      </Popconfirm>
    )
  });

  return (
    <ContextMenu 
      items={items} 
      className="directory-context-menu"
      onItemClick={onClose}
    />
  );
};

export default DirectoryContextMenu;
