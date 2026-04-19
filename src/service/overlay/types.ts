export type OverlayFileSummary = {
  name: string;
  size: number;
  relativePath: string;
};

export type OverlayTargetNode = {
  id: number;
  key: string;
  label: string;
  libraryId: number;
};

export type UploadConfirmOverlayProps = {
  fileSummaries: OverlayFileSummary[];
  targetNode: OverlayTargetNode;
};

export type UploadConfirmResult =
  | { type: 'confirm' }
  | { type: 'cancel' };

export type OverlayContextMenuPosition =
  | 'leftTop'
  | 'leftBottom'
  | 'rightTop'
  | 'rightBottom'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

export type OverlayBoundaryRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type DirectoryContextMenuNodeSnapshot = {
  archiveMode: number;
  builtInType: string;
  data?: {
    rawExt?: string;
    rawName?: string;
  };
  ext?: string;
  id?: number;
  isLeaf?: boolean;
  key: string;
  label: string;
  parentId?: number | null;
  type: string;
};

export type DirectoryContextMenuOverlayProps = {
  boundaryRect: OverlayBoundaryRect | null;
  deleteCount: number;
  isFolder: boolean;
  node: DirectoryContextMenuNodeSnapshot | null;
  position: OverlayContextMenuPosition;
  submenuPreferredHorizontal: 'left' | 'right';
  x: number;
  y: number;
};

export type DirectoryContextMenuResult =
  | { type: 'action'; action: string }
  | { type: 'cancel' };

export type OverlayResultMap = {
  'directory-context-menu': DirectoryContextMenuResult;
  'upload-confirm': UploadConfirmResult;
};

export type OverlayPropsMap = {
  'directory-context-menu': DirectoryContextMenuOverlayProps;
  'upload-confirm': UploadConfirmOverlayProps;
};

export type OverlayType = keyof OverlayResultMap;
