import React from 'react';
import DeleteConfirmModal from '@/features/file-explorer/components/directory-tree/modals/DeleteConfirmModal';
import type {
  DeleteConfirmOverlayProps,
  DeleteConfirmResult,
} from '@/service/overlay/types';
import type { OverlayComponentProps } from '../registry';

export const DeleteConfirmOverlayAdapter: React.FC<
  OverlayComponentProps<DeleteConfirmOverlayProps, DeleteConfirmResult>
> = ({ props, onResolve, onCancel }) => {
  return (
    <DeleteConfirmModal
      visible
      deleteCount={props.deleteCount}
      isFolder={props.isFolder}
      nodeName={props.nodeName}
      onConfirm={() => onResolve({ type: 'confirm' })}
      onCancel={onCancel}
    />
  );
};
