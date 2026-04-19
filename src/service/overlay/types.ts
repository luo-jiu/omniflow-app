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

export type OverlayResultMap = {
  'upload-confirm': UploadConfirmResult;
};

export type OverlayPropsMap = {
  'upload-confirm': UploadConfirmOverlayProps;
};

export type OverlayType = keyof OverlayResultMap;
