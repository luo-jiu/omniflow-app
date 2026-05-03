import React from 'react';
import { DeleteConfirmOverlayAdapter } from './components/DeleteConfirmOverlayAdapter';
import { DirectoryContextMenuOverlayAdapter } from './components/DirectoryContextMenuOverlayAdapter';
import { NodePropertiesOverlayAdapter } from './components/NodePropertiesOverlayAdapter';
import { UploadConfirmOverlayAdapter } from './components/UploadConfirmOverlayAdapter';

export type OverlayComponentProps<TProps = unknown, TResult = unknown> = {
  props: TProps;
  onResolve: (result: TResult) => void;
  onCancel: () => void;
};

export type OverlayRegistryEntry = {
  component: React.FC<OverlayComponentProps<any, any>>;
};

export const overlayRegistry: Record<string, OverlayRegistryEntry> = {
  'delete-confirm': { component: DeleteConfirmOverlayAdapter },
  'directory-context-menu': { component: DirectoryContextMenuOverlayAdapter },
  'node-properties': { component: NodePropertiesOverlayAdapter },
  'upload-confirm': { component: UploadConfirmOverlayAdapter },
};
