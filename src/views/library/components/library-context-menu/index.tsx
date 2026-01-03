import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { IconEdit, IconDelete } from '@douyinfe/semi-icons';
import {
  ContextMenu,
  ContextMenuTitle,
  ContextMenuActions
} from '../../style';
import type { Library } from "@/features/file-explorer/services/file.api";

interface LibraryContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  library: Library | null;
  onRename: () => void;
  onDelete: () => void;
}

const LibraryContextMenu: React.FC<LibraryContextMenuProps> = ({
  visible,
  x,
  y,
  library,
  onRename,
  onDelete
}) => {
  if (!visible || !library) return null;

  return (
    <ContextMenu id="library-context-menu" style={{ left: x, top: y }}>
      <ContextMenuTitle>{library.name}</ContextMenuTitle>
      <ContextMenuActions>
        <Button icon={<IconEdit />} onClick={onRename}>重命名</Button>
        <Button icon={<IconDelete />} type="danger" onClick={onDelete}>删除</Button>
      </ContextMenuActions>
    </ContextMenu>
  );
};

export default LibraryContextMenu;

