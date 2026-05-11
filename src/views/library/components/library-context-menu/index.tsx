import React from 'react';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import type { Library } from '@/features/file-explorer/services/file.api';

interface LibraryContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  mode: 'library' | 'blank';
  library: Library | null;
  onCreate: () => void;
  onEdit: () => void;
  onReleaseWorkspace: () => void;
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
  onReleaseWorkspace,
  onDelete,
  onClose
}) => {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    if (!visible) return;
    const menuEl = menuRef.current;
    if (!menuEl) {
      setPosition({ left: x, top: y });
      return;
    }

    const margin = 8;
    const rect = menuEl.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const nextPosition = {
      left: Math.min(Math.max(x, margin), maxLeft),
      top: Math.min(Math.max(y, margin), maxTop),
    };
    setPosition((prev) => (
      prev.left === nextPosition.left && prev.top === nextPosition.top ? prev : nextPosition
    ));
  }, [mode, visible, x, y]);

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
        key: 'release-workspace',
        label: '释放工作区',
        onClick: onReleaseWorkspace,
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

  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 9999,
      }}
    >
      <ContextMenu
        id="library-context-menu"
        items={items}
        className="directory-context-menu"
        onItemClick={onClose}
      />
    </div>
  );
};

export default LibraryContextMenu;
