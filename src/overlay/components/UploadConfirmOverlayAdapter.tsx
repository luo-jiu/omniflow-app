import React from 'react';
import UploadConfirmModal from '@/features/file-explorer/components/directory-tree/modals/UploadConfirmModal';
import type {
  UploadConfirmOverlayProps,
  UploadConfirmResult,
} from '@/service/overlay/types';
import type { OverlayComponentProps } from '../registry';

export const UploadConfirmOverlayAdapter: React.FC<
  OverlayComponentProps<UploadConfirmOverlayProps, UploadConfirmResult>
> = ({ props, onResolve, onCancel }) => {
  return (
    <UploadConfirmModal
      visible
      defaultProvider={props.defaultProvider}
      fileSummaries={props.fileSummaries}
      providers={props.providers}
      targetNode={props.targetNode}
      onConfirm={(storageProvider) => onResolve({ type: 'confirm', storageProvider })}
      onCancel={onCancel}
    />
  );
};
