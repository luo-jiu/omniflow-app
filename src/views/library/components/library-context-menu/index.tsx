import React from 'react';
import { Popover } from '@douyinfe/semi-ui';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import type { Library } from "@/features/file-explorer/services/file.api";

interface LibraryContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  library: Library | null;
  onRename: () => void;
  onDelete: () => void;
  onClose?: () => void;
}

const LibraryContextMenu: React.FC<LibraryContextMenuProps> = ({
  visible,
  x,
  y,
  library,
  onRename,
  onDelete,
  onClose
}) => {
  if (!library) return null;

  const items: ContextMenuItem[] = [
    {
      key: 'rename',
      label: '重命名',
      icon: '✏️',
      onClick: onRename
    },
    {
      key: 'delete',
      label: '删除',
      icon: '🗑️',
      danger: true,
      onClick: onDelete
    }
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
          title={library.name}
          items={items}
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
