import type { FileViewerFileType } from '@/shared/file-viewer-types';
import type {
  ViewerDraftKey,
  ViewerLiveInstanceKey,
  ViewerResourceKey,
} from './viewer-session.types';

const ACCOUNT_SCOPE_PATTERN = /^(?:user:\d+|device:[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STABLE_RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function normalizePositiveInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeNonNegativeInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeRequiredText(value: string, maxLength: number): string | null {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

export function createUserViewerAccountScope(userId: number): string | null {
  const normalizedUserId = normalizePositiveInteger(userId);
  return normalizedUserId == null ? null : `user:${normalizedUserId}`;
}

export function createDeviceViewerAccountScope(deviceId: string): string | null {
  const normalizedDeviceId = normalizeRequiredText(deviceId, 128);
  if (!normalizedDeviceId || !DEVICE_ID_PATTERN.test(normalizedDeviceId)) {
    return null;
  }
  return `device:${normalizedDeviceId}`;
}

export function isViewerAccountScope(value: string): boolean {
  return ACCOUNT_SCOPE_PATTERN.test(String(value || '').trim());
}

export function resolveViewerResourceIdentity(options: {
  nodeId?: number | null;
  stableResourceId?: string | null;
}): string | null {
  const normalizedNodeId = options.nodeId == null
    ? null
    : normalizePositiveInteger(options.nodeId);
  if (normalizedNodeId != null) {
    return `node:${normalizedNodeId}`;
  }

  const stableResourceId = normalizeRequiredText(options.stableResourceId || '', 256);
  if (!stableResourceId || !STABLE_RESOURCE_ID_PATTERN.test(stableResourceId)) {
    return null;
  }
  return `stable:${stableResourceId}`;
}

export function createViewerResourceKey(options: {
  accountScope: string;
  libraryId: number;
  viewerKind: FileViewerFileType;
  nodeId?: number | null;
  stableResourceId?: string | null;
}): ViewerResourceKey | null {
  const accountScope = String(options.accountScope || '').trim();
  const libraryId = normalizePositiveInteger(options.libraryId);
  const resourceIdentity = resolveViewerResourceIdentity(options);
  if (!isViewerAccountScope(accountScope) || libraryId == null || !resourceIdentity) {
    return null;
  }
  return {
    accountScope,
    libraryId,
    resourceIdentity,
    viewerKind: options.viewerKind,
  };
}

export function createViewerDraftKey(
  identity: ViewerResourceKey,
  contentRevision: string,
): ViewerDraftKey | null {
  const normalizedRevision = normalizeRequiredText(contentRevision, 512);
  if (!isViewerResourceKey(identity) || !normalizedRevision) {
    return null;
  }
  return {
    ...identity,
    contentRevision: normalizedRevision,
  };
}

export function createViewerLiveInstanceKey(options: {
  runtimeSessionId: string;
  libraryId: number;
  tabId: string;
  mountGeneration: number;
}): ViewerLiveInstanceKey | null {
  const runtimeSessionId = normalizeRequiredText(options.runtimeSessionId, 256);
  const libraryId = normalizePositiveInteger(options.libraryId);
  const tabId = normalizeRequiredText(options.tabId, 2048);
  const mountGeneration = normalizeNonNegativeInteger(options.mountGeneration);
  if (!runtimeSessionId || libraryId == null || !tabId || mountGeneration == null) {
    return null;
  }
  return {
    runtimeSessionId,
    libraryId,
    tabId,
    mountGeneration,
  };
}

export function createViewerRuntimeSessionId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isViewerResourceKey(
  value: ViewerResourceKey | null | undefined,
): value is ViewerResourceKey {
  return value != null
    && isViewerAccountScope(value.accountScope)
    && normalizePositiveInteger(value.libraryId) != null
    && (/^(?:node:\d+|stable:[A-Za-z0-9][A-Za-z0-9._:-]{0,255})$/).test(value.resourceIdentity);
}

export function isViewerLiveInstanceKey(
  value: ViewerLiveInstanceKey | null | undefined,
): value is ViewerLiveInstanceKey {
  return value != null
    && Boolean(normalizeRequiredText(value.runtimeSessionId, 256))
    && normalizePositiveInteger(value.libraryId) != null
    && Boolean(normalizeRequiredText(value.tabId, 2048))
    && normalizeNonNegativeInteger(value.mountGeneration) != null;
}

export function serializeViewerResourceKey(identity: ViewerResourceKey): string {
  return JSON.stringify([
    identity.accountScope,
    identity.libraryId,
    identity.resourceIdentity,
    identity.viewerKind,
  ]);
}

export function serializeViewerLiveInstanceKey(key: ViewerLiveInstanceKey): string {
  return JSON.stringify([
    key.runtimeSessionId,
    key.libraryId,
    key.tabId,
    key.mountGeneration,
  ]);
}

export function serializeViewerLiveSlotKey(key: ViewerLiveInstanceKey): string {
  return JSON.stringify([key.runtimeSessionId, key.libraryId, key.tabId]);
}
