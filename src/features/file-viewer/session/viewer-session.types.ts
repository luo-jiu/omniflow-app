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
  viewerId?: string;
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

export type ViewerSessionPinReason = 'active' | 'dirty' | 'playing' | 'pip';

export interface ViewerSessionAdapter<TPayload = unknown> {
  capture: () => TPayload | null;
  restore: (snapshot: TPayload) => void;
  suspend: () => void;
  resume: () => void;
  estimateSnapshotBytes: () => number;
  estimateHotCostUnits?: () => number | null;
  getPinReasons: () => ViewerSessionPinReason[];
}

export interface ViewerLiveRegistration<TPayload = unknown> {
  key: ViewerLiveInstanceKey;
  identity: ViewerResourceKey;
  schemaVersion: number;
  contentRevision: string | null;
  adapter: ViewerSessionAdapter<TPayload>;
}

export interface ViewerLiveRetentionProjection {
  libraryId: number;
  tabId: string;
  viewerKind: FileViewerFileType;
  viewerId?: string;
  hotCostUnits: number | null;
  pinReasons: ViewerSessionPinReason[];
  pinProjectionReliable: boolean;
}

export interface ViewerHotEvictionPreparationTarget {
  libraryId: number;
  tabId: string;
  viewerKind: FileViewerFileType;
  viewerId?: string;
}

export type ViewerHotEvictionBlockReason =
  | 'live-instance-not-found'
  | 'viewer-kind-mismatch'
  | 'viewer-id-mismatch'
  | 'pin-projection-unreliable'
  | 'pinned'
  | 'capture-empty'
  | 'capture-failed'
  | 'snapshot-not-retained';

export type ViewerHotEvictionPreparationResult =
  | { status: 'captured' }
  | {
    status: 'blocked';
    reason: ViewerHotEvictionBlockReason;
    pinReasons: ViewerSessionPinReason[];
  };

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
  viewerId?: string;
  schemaVersion?: number;
  estimatedBytes?: number;
  reason?: string;
}
