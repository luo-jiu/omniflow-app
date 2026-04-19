import React from 'react';
import DirectoryContextMenu from '@/features/file-explorer/components/directory-tree/context-menu/DirectoryContextMenu';
import type {
  DirectoryContextMenuOverlayProps,
  DirectoryContextMenuResult,
  OverlayContextMenuPosition,
} from '@/service/overlay/types';
import type { OverlayComponentProps } from '../registry';

function getMenuTransform(position: OverlayContextMenuPosition): string {
  const translateX = position.endsWith('Right') || position.startsWith('right') ? '-100%' : '0';
  const translateY = position.startsWith('top') || position.endsWith('Top') ? '-100%' : '0';
  return `translate(${translateX}, ${translateY})`;
}

export const DirectoryContextMenuOverlayAdapter: React.FC<
  OverlayComponentProps<DirectoryContextMenuOverlayProps, DirectoryContextMenuResult>
> = ({ props, onResolve, onCancel }) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    rootRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="presentation"
      onContextMenu={(event) => {
        event.preventDefault();
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'transparent',
        outline: 'none',
      }}
    >
      <div
        role="presentation"
        onContextMenu={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          position: 'fixed',
          left: props.x,
          top: props.y,
          transform: getMenuTransform(props.position),
        }}
      >
        <DirectoryContextMenu
          node={props.node}
          isFolder={props.isFolder}
          onAction={(action) => onResolve({ type: 'action', action })}
          boundaryRect={props.boundaryRect}
          deleteCount={props.deleteCount}
          submenuPreferredHorizontal={props.submenuPreferredHorizontal}
          getPopupContainer={() => document.body}
        />
      </div>
    </div>
  );
};
