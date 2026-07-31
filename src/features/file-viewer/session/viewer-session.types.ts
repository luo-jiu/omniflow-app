import type { FileViewerFileType } from '@/shared/file-viewer-types';

export interface ViewerLiveInstanceKey {
  runtimeSessionId: string;
  libraryId: number;
  tabId: string;
  mountGeneration: number;
}

export interface ViewerResourceKey {
  accountScope: string;
  libraryId: number;
  resourceIdentity: string;
  viewerKind: FileViewerFileType;
}

export interface ViewerDraftKey extends ViewerResourceKey {
  contentRevision: string;
}

export interface ViewerSessionSnapshot<TPayload = unknown> {
  schemaVersion: number;
  identity: ViewerResourceKey;
  contentRevision: string | null;
  savedAt: number;
  payload: TPayload;
}

export interface ViewerSessionAdapter<TPayload = unknown> {
  capture: () => TPayload | null;
  restore: (snapshot: TPayload) => void;
  suspend: () => void;
  resume: () => void;
  estimateCost: () => number;
  getPinReasons: () => Array<'active' | 'dirty' | 'playing' | 'pip'>;
}

export interface ViewerLiveRegistration<TPayload = unknown> {
  key: ViewerLiveInstanceKey;
  identity: ViewerResourceKey;
  schemaVersion: number;
  contentRevision: string | null;
  adapter: ViewerSessionAdapter<TPayload>;
}

export type ViewerSessionDiagnosticEventType =
  | 'registered'
  | 'captured'
  | 'restored'
  | 'invalidated'
  | 'evicted'
  | 'disposed'
  | 'restore-skipped';

export interface ViewerSessionDiagnosticEvent {
  type: ViewerSessionDiagnosticEventType;
  occurredAt: number;
  key: string;
  libraryId: number;
  viewerKind: FileViewerFileType;
  schemaVersion?: number;
  estimatedBytes?: number;
  reason?: string;
}
