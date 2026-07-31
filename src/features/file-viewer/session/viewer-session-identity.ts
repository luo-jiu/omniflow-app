import type { FileViewerFileType } from '@/shared/file-viewer-types';
import { viewerSessionPolicies } from './viewer-session-policies';
import type {
  ViewerDraftKey,
  ViewerLiveInstanceKey,
  ViewerResourceKey,
} from './viewer-session.types';

const USER_ACCOUNT_SCOPE_PATTERN = /^user:([1-9]\d*)$/;
const DEVICE_ACCOUNT_SCOPE_PATTERN = /^device:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NODE_RESOURCE_IDENTITY_PATTERN = /^node:([1-9]\d*)$/;
const STABLE_RESOURCE_ID_PATTERN = /^([a-z][a-z0-9-]{1,31}):[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STABLE_RESOURCE_ID_NAMESPACES = new Set([
  'external',
  'object',
  'sha256',
  'storage',
  'uuid',
]);

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

export function isViewerAccountScope(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  if (DEVICE_ACCOUNT_SCOPE_PATTERN.test(value)) return true;
  const userMatch = USER_ACCOUNT_SCOPE_PATTERN.exec(value);
  if (!userMatch) return false;
  const userId = Number(userMatch[1]);
  return normalizePositiveInteger(userId) != null && value === `user:${userId}`;
}

export function isViewerKind(value: unknown): value is FileViewerFileType {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(viewerSessionPolicies, value);
}

function isStableResourceId(value: string): boolean {
  if (value.length > 256) return false;
  const match = STABLE_RESOURCE_ID_PATTERN.exec(value);
  return Boolean(match && STABLE_RESOURCE_ID_NAMESPACES.has(match[1]));
}

function isResourceIdentity(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  const nodeMatch = NODE_RESOURCE_IDENTITY_PATTERN.exec(value);
  if (nodeMatch) {
    const nodeId = Number(nodeMatch[1]);
    return normalizePositiveInteger(nodeId) != null && value === `node:${nodeId}`;
  }
  if (!value.startsWith('stable:')) return false;
  return isStableResourceId(value.slice('stable:'.length));
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
  if (!stableResourceId || !isStableResourceId(stableResourceId)) {
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
  if (
    !isViewerAccountScope(accountScope)
    || libraryId == null
    || !resourceIdentity
    || !isViewerKind(options.viewerKind)
  ) {
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
  value: unknown,
): value is ViewerResourceKey {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<ViewerResourceKey>;
  return isViewerAccountScope(candidate.accountScope)
    && typeof candidate.libraryId === 'number'
    && normalizePositiveInteger(candidate.libraryId) != null
    && isResourceIdentity(candidate.resourceIdentity)
    && isViewerKind(candidate.viewerKind);
}

export function isViewerDraftKey(value: unknown): value is ViewerDraftKey {
  if (!isViewerResourceKey(value)) return false;
  const candidate = value as Partial<ViewerDraftKey>;
  return typeof candidate.contentRevision === 'string'
    && normalizeRequiredText(candidate.contentRevision, 512) === candidate.contentRevision;
}

export function isViewerLiveInstanceKey(
  value: unknown,
): value is ViewerLiveInstanceKey {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<ViewerLiveInstanceKey>;
  const runtimeSessionId = typeof candidate.runtimeSessionId === 'string'
    ? normalizeRequiredText(candidate.runtimeSessionId, 256)
    : null;
  const tabId = typeof candidate.tabId === 'string'
    ? normalizeRequiredText(candidate.tabId, 2048)
    : null;
  return runtimeSessionId === candidate.runtimeSessionId
    && typeof candidate.libraryId === 'number'
    && normalizePositiveInteger(candidate.libraryId) != null
    && tabId === candidate.tabId
    && typeof candidate.mountGeneration === 'number'
    && normalizeNonNegativeInteger(candidate.mountGeneration) != null;
}

export function serializeViewerResourceKey(identity: ViewerResourceKey): string {
  return JSON.stringify([
    identity.accountScope,
    identity.libraryId,
    identity.resourceIdentity,
    identity.viewerKind,
  ]);
}

export function serializeViewerDraftKey(key: ViewerDraftKey): string {
  return JSON.stringify([
    key.accountScope,
    key.libraryId,
    key.resourceIdentity,
    key.viewerKind,
    key.contentRevision,
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

export function serializeViewerLiveDiagnosticKey(
  key: ViewerLiveInstanceKey,
  identity: ViewerResourceKey,
): string {
  return JSON.stringify([
    key.runtimeSessionId,
    identity.accountScope,
    identity.libraryId,
    identity.resourceIdentity,
    identity.viewerKind,
    key.mountGeneration,
  ]);
}
