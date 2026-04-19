import React from 'react';
import { DirectoryContextMenuOverlayAdapter } from './components/DirectoryContextMenuOverlayAdapter';
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
  'directory-context-menu': { component: DirectoryContextMenuOverlayAdapter },
  'upload-confirm': { component: UploadConfirmOverlayAdapter },
};
