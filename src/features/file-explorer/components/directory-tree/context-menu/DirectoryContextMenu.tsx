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
  const currentBuiltInType = String(node?.builtInType || 'DEF').toUpperCase();
  const currentArchiveMode = Number(node?.archiveMode ?? 0) === 1 ? 1 : 0;

  const items: ContextMenuItem[] = [
    { 
      key: 'rename', 
      label: '重命名', 
      onClick: () => onAction('重命名', node) 
    },
    {
      key: 'built-in-type',
      label: '内置类型',
      children: [
        {
          key: 'built-in-type-def',
          label: currentBuiltInType === 'DEF' ? '默认（当前）' : '默认',
          onClick: () => onAction('设置内置类型:DEF', node),
        },
        {
          key: 'built-in-type-comic',
          label: currentBuiltInType === 'COMIC' ? '漫画（当前）' : '漫画',
          onClick: () => onAction('设置内置类型:COMIC', node),
        },
      ],
    },
    {
      key: 'archive-mode',
      label: '归档模式',
      children: [
        {
          key: 'archive-mode-off',
          label: currentArchiveMode === 0 ? '关闭（当前）' : '关闭',
          onClick: () => onAction('设置归档模式:0', node),
        },
        {
          key: 'archive-mode-on',
          label: currentArchiveMode === 1 ? '开启（当前）' : '开启',
          onClick: () => onAction('设置归档模式:1', node),
        },
      ],
    },
  ];

  const isBuiltInFolder = isFolder && currentBuiltInType !== 'DEF';
  if (isBuiltInFolder) {
    items.push({
      key: 'open-raw-folder',
      label: '打开原始目录',
      onClick: () => onAction('打开原始目录', node),
    });
    if (currentBuiltInType === 'COMIC') {
      items.push({
        key: 'comic-sort-by-name',
        label: '漫画按名称排序',
        onClick: () => onAction('漫画按名称排序', node),
      });
    }
  }

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
