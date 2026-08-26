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
  path: string;
};

export type OverlayStorageProvider = {
  alias: string;
  type: string;
  endpoint: string;
  bucket: string;
  label: string;
  useSSL: boolean;
  healthStatus?: 'ok' | 'error' | 'unknown';
};

export type UploadConfirmOverlayProps = {
  defaultProvider: string;
  fileSummaries: OverlayFileSummary[];
  okText?: string;
  providers: OverlayStorageProvider[];
  taskLabel?: string;
  targetLabel?: string;
  targetNode: OverlayTargetNode;
  title?: string;
};

export type UploadConfirmResult =
  | { type: 'confirm'; storageProvider: string }
  | { type: 'cancel' };

export type DeleteConfirmOverlayProps = {
  deleteCount: number;
  isFolder: boolean;
  nodeName: string;
};

export type DeleteConfirmResult =
  | { type: 'confirm' }
  | { type: 'cancel' };

export type NodePropertiesOverlayField = {
  label: string;
  value: string;
};

export type NodePropertiesOverlaySection = {
  title: string;
  items: NodePropertiesOverlayField[];
};

export type NodePropertiesOverlayIcon = {
  archiveMode: number;
  builtInType: string;
  ext: string;
  fileName: string;
  mimeType: string;
  nodeType: 'dir' | 'file';
  parentArchiveMode: number;
  parentBuiltInType: string;
};

export type NodePropertiesOverlayProps = {
  fullName: string;
  icon: NodePropertiesOverlayIcon;
  sections: NodePropertiesOverlaySection[];
  title: string;
};

export type NodePropertiesOverlayResult =
  | { type: 'close' }
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
    audioArchiveAudio?: boolean;
    audioArchiveSubtitlesVisible?: boolean;
    parentArchiveMode?: number;
    parentBuiltInType?: string;
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
  'delete-confirm': DeleteConfirmResult;
  'directory-context-menu': DirectoryContextMenuResult;
  'node-properties': NodePropertiesOverlayResult;
  'upload-confirm': UploadConfirmResult;
};

export type OverlayPropsMap = {
  'delete-confirm': DeleteConfirmOverlayProps;
  'directory-context-menu': DirectoryContextMenuOverlayProps;
  'node-properties': NodePropertiesOverlayProps;
  'upload-confirm': UploadConfirmOverlayProps;
};

export type OverlayType = keyof OverlayResultMap;
