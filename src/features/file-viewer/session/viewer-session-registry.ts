import {
  isViewerLiveInstanceKey,
  isViewerResourceKey,
  serializeViewerLiveInstanceKey,
  serializeViewerLiveSlotKey,
  serializeViewerResourceKey,
} from './viewer-session-identity';
import type {
  ViewerLiveInstanceKey,
  ViewerLiveRegistration,
  ViewerResourceKey,
  ViewerSessionDiagnosticEvent,
  ViewerSessionSnapshot,
} from './viewer-session.types';

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_ESTIMATED_BYTES = 16 * 1024 * 1024;

interface ViewerSessionRegistryOptions {
  maxEntries?: number;
  maxEstimatedBytes?: number;
  now?: () => number;
}

interface SnapshotEntry {
  estimatedBytes: number;
  snapshot: ViewerSessionSnapshot;
}

interface LiveEntry {
  registration: ViewerLiveRegistration;
  slotKey: string;
}

export interface ViewerSnapshotReadRequirements {
  schemaVersion?: number;
  contentRevision?: string | null;
}

export interface ViewerSessionRegistryState {
  estimatedBytes: number;
  liveInstanceCount: number;
  snapshotCount: number;
}

type DiagnosticListener = (event: ViewerSessionDiagnosticEvent) => void;

function normalizeBudget(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(Math.floor(value as number), 1);
}

function assertSerializable(value: unknown, path = 'payload', seen = new WeakSet<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} is not JSON serializable`);
  }
  if (seen.has(value)) {
    throw new TypeError(`${path} contains a circular reference`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSerializable(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} contains a non-plain object`);
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    assertSerializable(item, `${path}.${key}`, seen);
  });
  seen.delete(value);
}

function serializeSnapshot(snapshot: ViewerSessionSnapshot): string {
  if (!isViewerResourceKey(snapshot.identity)) {
    throw new TypeError('snapshot identity is invalid');
  }
  if (!Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion <= 0) {
    throw new TypeError('snapshot schemaVersion must be a positive integer');
  }
  if (!Number.isFinite(snapshot.savedAt) || snapshot.savedAt <= 0) {
    throw new TypeError('snapshot savedAt must be a positive timestamp');
  }
  if (snapshot.contentRevision !== null && !String(snapshot.contentRevision || '').trim()) {
    throw new TypeError('snapshot contentRevision must be null or a non-empty string');
  }
  assertSerializable(snapshot.payload);
  return JSON.stringify(snapshot);
}

function cloneSnapshot<TPayload>(snapshot: ViewerSessionSnapshot): ViewerSessionSnapshot<TPayload> {
  return JSON.parse(JSON.stringify(snapshot)) as ViewerSessionSnapshot<TPayload>;
}

function getSerializedByteLength(serialized: string): number {
  return new TextEncoder().encode(serialized).byteLength;
}

function sameRevision(left: string | null, right: string | null) {
  return left === right;
}

export class ViewerSessionRegistry {
  private readonly diagnosticListeners = new Set<DiagnosticListener>();
  private readonly liveEntries = new Map<string, LiveEntry>();
  private readonly liveSlotKeys = new Map<string, string>();
  private readonly now: () => number;
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private estimatedBytes = 0;
  private maxEntries: number;
  private maxEstimatedBytes: number;

  constructor(options: ViewerSessionRegistryOptions = {}) {
    this.maxEntries = normalizeBudget(options.maxEntries, DEFAULT_MAX_ENTRIES);
    this.maxEstimatedBytes = normalizeBudget(
      options.maxEstimatedBytes,
      DEFAULT_MAX_ESTIMATED_BYTES,
    );
    this.now = options.now ?? Date.now;
  }

  subscribe(listener: DiagnosticListener) {
    this.diagnosticListeners.add(listener);
    return () => {
      this.diagnosticListeners.delete(listener);
    };
  }

  getState(): ViewerSessionRegistryState {
    return {
      estimatedBytes: this.estimatedBytes,
      liveInstanceCount: this.liveEntries.size,
      snapshotCount: this.snapshots.size,
    };
  }

  setBudget(options: Pick<ViewerSessionRegistryOptions, 'maxEntries' | 'maxEstimatedBytes'>) {
    this.maxEntries = normalizeBudget(options.maxEntries, this.maxEntries);
    this.maxEstimatedBytes = normalizeBudget(options.maxEstimatedBytes, this.maxEstimatedBytes);
    this.evictToBudget();
  }

  writeSnapshot<TPayload>(
    snapshot: ViewerSessionSnapshot<TPayload>,
    options: { estimatedBytes?: number } = {},
  ) {
    const serialized = serializeSnapshot(snapshot);
    const serializedBytes = getSerializedByteLength(serialized);
    const requestedEstimate = Number.isFinite(options.estimatedBytes)
      ? Math.max(Math.floor(options.estimatedBytes as number), 0)
      : 0;
    const estimatedBytes = Math.max(serializedBytes, requestedEstimate);
    const storedSnapshot = JSON.parse(serialized) as ViewerSessionSnapshot;
    const key = serializeViewerResourceKey(snapshot.identity);
    this.deleteSnapshotEntry(key);
    this.snapshots.set(key, { estimatedBytes, snapshot: storedSnapshot });
    this.estimatedBytes += estimatedBytes;
    this.emit({
      type: 'captured',
      key,
      identity: snapshot.identity,
      schemaVersion: snapshot.schemaVersion,
      estimatedBytes,
    });
    this.evictToBudget();
  }

  readSnapshot<TPayload>(
    identity: ViewerResourceKey,
    requirements: ViewerSnapshotReadRequirements = {},
  ): ViewerSessionSnapshot<TPayload> | null {
    if (!isViewerResourceKey(identity)) return null;
    const key = serializeViewerResourceKey(identity);
    const entry = this.snapshots.get(key);
    if (!entry) return null;
    if (
      requirements.schemaVersion !== undefined
      && entry.snapshot.schemaVersion !== requirements.schemaVersion
    ) {
      this.deleteSnapshotEntry(key);
      this.emit({
        type: 'restore-skipped',
        key,
        identity,
        schemaVersion: entry.snapshot.schemaVersion,
        reason: 'schema-version-mismatch',
      });
      return null;
    }
    if (
      requirements.contentRevision !== undefined
      && !sameRevision(entry.snapshot.contentRevision, requirements.contentRevision)
    ) {
      this.deleteSnapshotEntry(key);
      this.emit({
        type: 'restore-skipped',
        key,
        identity,
        schemaVersion: entry.snapshot.schemaVersion,
        reason: 'content-revision-mismatch',
      });
      return null;
    }
    this.snapshots.delete(key);
    this.snapshots.set(key, entry);
    this.emit({
      type: 'restored',
      key,
      identity,
      schemaVersion: entry.snapshot.schemaVersion,
      estimatedBytes: entry.estimatedBytes,
    });
    return cloneSnapshot<TPayload>(entry.snapshot);
  }

  invalidateSnapshot(identity: ViewerResourceKey, reason = 'explicit-invalidation') {
    if (!isViewerResourceKey(identity)) return false;
    const key = serializeViewerResourceKey(identity);
    const deleted = this.deleteSnapshotEntry(key);
    if (deleted) {
      this.emit({ type: 'invalidated', key, identity, reason });
    }
    return deleted;
  }

  registerLiveInstance<TPayload>(registration: ViewerLiveRegistration<TPayload>) {
    this.assertLiveRegistration(registration);
    const serializedKey = serializeViewerLiveInstanceKey(registration.key);
    const slotKey = serializeViewerLiveSlotKey(registration.key);
    const previousSerializedKey = this.liveSlotKeys.get(slotKey);
    if (previousSerializedKey && previousSerializedKey !== serializedKey) {
      this.removeLiveEntry(previousSerializedKey, 'new-mount-generation');
    } else if (previousSerializedKey === serializedKey) {
      this.removeLiveEntry(previousSerializedKey, 'registration-replaced');
    }
    const erasedRegistration = registration as ViewerLiveRegistration;
    this.liveEntries.set(serializedKey, {
      registration: erasedRegistration,
      slotKey,
    });
    this.liveSlotKeys.set(slotKey, serializedKey);
    this.emit({
      type: 'registered',
      key: serializedKey,
      identity: registration.identity,
      schemaVersion: registration.schemaVersion,
    });
    return () => {
      const currentSerializedKey = this.liveSlotKeys.get(slotKey);
      if (currentSerializedKey === serializedKey) {
        this.removeLiveEntry(serializedKey, 'adapter-unregistered');
      }
    };
  }

  captureLiveInstance<TPayload>(key: ViewerLiveInstanceKey): ViewerSessionSnapshot<TPayload> | null {
    if (!isViewerLiveInstanceKey(key)) return null;
    const entry = this.liveEntries.get(serializeViewerLiveInstanceKey(key));
    if (!entry) return null;
    const payload = entry.registration.adapter.capture();
    if (payload === null) return null;
    const snapshot: ViewerSessionSnapshot = {
      schemaVersion: entry.registration.schemaVersion,
      identity: entry.registration.identity,
      contentRevision: entry.registration.contentRevision,
      savedAt: this.now(),
      payload,
    };
    this.writeSnapshot(snapshot, {
      estimatedBytes: entry.registration.adapter.estimateCost(),
    });
    return cloneSnapshot<TPayload>(snapshot);
  }

  replaceLiveInstance<TPayload>(
    previousKey: ViewerLiveInstanceKey,
    nextRegistration: ViewerLiveRegistration<TPayload>,
  ) {
    this.assertLiveRegistration(nextRegistration);
    this.captureLiveInstance(previousKey);
    this.removeLiveEntry(serializeViewerLiveInstanceKey(previousKey), 'resource-replaced');
    return this.registerLiveInstance(nextRegistration);
  }

  disposeLibrary(libraryId: number, accountScope?: string) {
    if (!Number.isSafeInteger(libraryId) || libraryId <= 0) return;
    Array.from(this.snapshots.entries()).forEach(([key, entry]) => {
      const identity = entry.snapshot.identity;
      if (identity.libraryId !== libraryId) return;
      if (accountScope && identity.accountScope !== accountScope) return;
      this.deleteSnapshotEntry(key);
      this.emit({ type: 'disposed', key, identity, reason: 'library-disposed' });
    });
    Array.from(this.liveEntries.entries()).forEach(([key, entry]) => {
      const identity = entry.registration.identity;
      if (identity.libraryId !== libraryId) return;
      if (accountScope && identity.accountScope !== accountScope) return;
      this.removeLiveEntry(key, 'library-disposed');
    });
  }

  disposeSession() {
    Array.from(this.snapshots.entries()).forEach(([key, entry]) => {
      this.deleteSnapshotEntry(key);
      this.emit({
        type: 'disposed',
        key,
        identity: entry.snapshot.identity,
        reason: 'session-disposed',
      });
    });
    Array.from(this.liveEntries.keys()).forEach((key) => {
      this.removeLiveEntry(key, 'session-disposed');
    });
  }

  private assertLiveRegistration<TPayload>(registration: ViewerLiveRegistration<TPayload>) {
    if (!isViewerLiveInstanceKey(registration.key)) {
      throw new TypeError('live instance key is invalid');
    }
    if (!isViewerResourceKey(registration.identity)) {
      throw new TypeError('live instance resource identity is invalid');
    }
    if (registration.key.libraryId !== registration.identity.libraryId) {
      throw new TypeError('live instance and resource libraryId must match');
    }
    if (!Number.isInteger(registration.schemaVersion) || registration.schemaVersion <= 0) {
      throw new TypeError('live instance schemaVersion must be a positive integer');
    }
  }

  private deleteSnapshotEntry(key: string) {
    const entry = this.snapshots.get(key);
    if (!entry) return false;
    this.snapshots.delete(key);
    this.estimatedBytes = Math.max(0, this.estimatedBytes - entry.estimatedBytes);
    return true;
  }

  private evictToBudget() {
    while (
      this.snapshots.size > this.maxEntries
      || this.estimatedBytes > this.maxEstimatedBytes
    ) {
      const oldest = this.snapshots.entries().next().value as [string, SnapshotEntry] | undefined;
      if (!oldest) break;
      const [key, entry] = oldest;
      this.deleteSnapshotEntry(key);
      this.emit({
        type: 'evicted',
        key,
        identity: entry.snapshot.identity,
        schemaVersion: entry.snapshot.schemaVersion,
        estimatedBytes: entry.estimatedBytes,
        reason: 'warm-budget-exceeded',
      });
    }
  }

  private removeLiveEntry(serializedKey: string, reason: string) {
    const entry = this.liveEntries.get(serializedKey);
    if (!entry) return false;
    try {
      entry.registration.adapter.suspend();
    } catch {
      // React cleanup remains the resource owner; registry disposal must continue.
    }
    this.liveEntries.delete(serializedKey);
    if (this.liveSlotKeys.get(entry.slotKey) === serializedKey) {
      this.liveSlotKeys.delete(entry.slotKey);
    }
    this.emit({
      type: 'disposed',
      key: serializedKey,
      identity: entry.registration.identity,
      schemaVersion: entry.registration.schemaVersion,
      reason,
    });
    return true;
  }

  private emit(event: Omit<ViewerSessionDiagnosticEvent, 'occurredAt' | 'libraryId' | 'viewerKind'> & {
    identity: ViewerResourceKey;
  }) {
    const { identity, ...rest } = event;
    const diagnosticEvent: ViewerSessionDiagnosticEvent = {
      ...rest,
      occurredAt: this.now(),
      libraryId: identity.libraryId,
      viewerKind: identity.viewerKind,
    };
    this.diagnosticListeners.forEach((listener) => {
      try {
        listener(diagnosticEvent);
      } catch {
        // Diagnostics must never break viewer state transitions.
      }
    });
  }
}
