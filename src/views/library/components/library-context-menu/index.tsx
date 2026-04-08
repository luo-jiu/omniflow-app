import React from 'react';
import { Popover } from '@douyinfe/semi-ui';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import type { Library } from "@/features/file-explorer/services/file.api";

interface LibraryContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  mode: 'library' | 'blank';
  library: Library | null;
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose?: () => void;
}

const LibraryContextMenu: React.FC<LibraryContextMenuProps> = ({
  visible,
  x,
  y,
  mode,
  library,
  onCreate,
  onEdit,
  onDelete,
  onClose
}) => {
  if (mode === 'library' && !library) return null;

  const items: ContextMenuItem[] = mode === 'blank'
    ? [
      {
        key: 'create',
        label: '新建库',
        onClick: onCreate,
      },
    ]
    : [
      {
        key: 'edit',
        label: '编辑',
        onClick: onEdit,
      },
      {
        type: 'divider',
        key: 'divider-delete',
      },
      {
        key: 'delete',
        label: '删除',
        danger: true,
        onClick: onDelete,
      },
    ];

  return (
    <Popover
      trigger="custom"
      visible={visible}
      onClickOutSide={onClose}
      position="bottomLeft" // 改为 bottomLeft
      showArrow={false}
      spacing={4}
      getPopupContainer={() => document.body}
      content={
        <ContextMenu
          id="library-context-menu"
          items={items}
          className="directory-context-menu"
          onItemClick={onClose}
        />
      }
    >
      <div
        style={{
          position: 'fixed',
          left: x,
          top: y,
          width: 1,
          height: 1,
          pointerEvents: 'none',
          zIndex: 9999
        }}
      />
    </Popover>
  );
};

export default LibraryContextMenu;
