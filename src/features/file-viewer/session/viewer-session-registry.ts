import {
  isViewerLiveInstanceKey,
  isViewerResourceKey,
  serializeViewerLiveDiagnosticKey,
  serializeViewerLiveInstanceKey,
  serializeViewerLiveSlotKey,
  serializeViewerResourceKey,
} from './viewer-session-identity';
import type {
  ViewerLiveInstanceKey,
  ViewerLiveRegistration,
  ViewerLiveRetentionProjection,
  ViewerHotEvictionPreparationResult,
  ViewerHotEvictionPreparationTarget,
  ViewerResourceKey,
  ViewerSessionPinReason,
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
type RetentionListener = () => void;
type CapturedSnapshotListener = (snapshot: ViewerSessionSnapshot) => void;

const VIEWER_SESSION_PIN_REASONS = new Set<ViewerSessionPinReason>([
  'active',
  'dirty',
  'playing',
  'pip',
]);

function readLivePinProjection(registration: ViewerLiveRegistration): {
  pinReasons: ViewerSessionPinReason[];
  projectionReliable: boolean;
} {
  let pinReasons: ViewerSessionPinReason[] = [];
  let projectionReliable = true;
  try {
    const projectedReasons: unknown = registration.adapter.getPinReasons();
    if (!Array.isArray(projectedReasons)) {
      projectionReliable = false;
    } else {
      const uniqueReasons = new Set<ViewerSessionPinReason>();
      projectedReasons.forEach((reason: unknown) => {
        if (!VIEWER_SESSION_PIN_REASONS.has(reason as ViewerSessionPinReason)) {
          projectionReliable = false;
          return;
        }
        uniqueReasons.add(reason as ViewerSessionPinReason);
      });
      pinReasons = Array.from(uniqueReasons);
    }
  } catch {
    projectionReliable = false;
  }
  return { pinReasons, projectionReliable };
}

function readLiveHotCostProjection(registration: ViewerLiveRegistration): number | null {
  if (!registration.adapter.estimateHotCostUnits) return null;
  try {
    const costUnits: unknown = registration.adapter.estimateHotCostUnits();
    return typeof costUnits === 'number' && Number.isFinite(costUnits) && costUnits > 0
      ? costUnits
      : null;
  } catch {
    return null;
  }
}

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
  private readonly capturedSnapshotListeners = new Set<CapturedSnapshotListener>();
  private readonly diagnosticListeners = new Set<DiagnosticListener>();
  private readonly liveEntries = new Map<string, LiveEntry>();
  private readonly liveSlotKeys = new Map<string, string>();
  private readonly now: () => number;
  private readonly retentionListeners = new Set<RetentionListener>();
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private estimatedBytes = 0;
  private maxEntries: number;
  private maxEstimatedBytes: number;
  private retentionRevision = 0;

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

  subscribeRetention(listener: RetentionListener) {
    this.retentionListeners.add(listener);
    return () => {
      this.retentionListeners.delete(listener);
    };
  }

  subscribeCapturedSnapshots(listener: CapturedSnapshotListener) {
    this.capturedSnapshotListeners.add(listener);
    return () => {
      this.capturedSnapshotListeners.delete(listener);
    };
  }

  getRetentionRevision() {
    return this.retentionRevision;
  }

  getState(): ViewerSessionRegistryState {
    return {
      estimatedBytes: this.estimatedBytes,
      liveInstanceCount: this.liveEntries.size,
      snapshotCount: this.snapshots.size,
    };
  }

  getLiveRetentionProjections(): ViewerLiveRetentionProjection[] {
    return Array.from(this.liveEntries.values()).map(({ registration }) => {
      const { pinReasons, projectionReliable } = readLivePinProjection(registration);
      return {
        libraryId: registration.key.libraryId,
        tabId: registration.key.tabId,
        viewerKind: registration.identity.viewerKind,
        hotCostUnits: readLiveHotCostProjection(registration),
        pinReasons,
        pinProjectionReliable: projectionReliable,
      };
    });
  }

  notifyLiveRetentionChanged(key: ViewerLiveInstanceKey): boolean {
    if (!isViewerLiveInstanceKey(key)) return false;
    if (!this.liveEntries.has(serializeViewerLiveInstanceKey(key))) return false;
    this.emitRetentionChanged();
    return true;
  }

  prepareLiveInstanceForHotEviction(
    target: ViewerHotEvictionPreparationTarget,
  ): ViewerHotEvictionPreparationResult {
    const entry = Array.from(this.liveEntries.values()).find(({ registration }) => (
      registration.key.libraryId === target.libraryId
      && registration.key.tabId === target.tabId
    ));
    if (!entry) {
      return {
        status: 'blocked',
        reason: 'live-instance-not-found',
        pinReasons: [],
      };
    }
    if (entry.registration.identity.viewerKind !== target.viewerKind) {
      return {
        status: 'blocked',
        reason: 'viewer-kind-mismatch',
        pinReasons: [],
      };
    }
    const pinProjection = readLivePinProjection(entry.registration);
    if (!pinProjection.projectionReliable) {
      return {
        status: 'blocked',
        reason: 'pin-projection-unreliable',
        pinReasons: pinProjection.pinReasons,
      };
    }
    if (pinProjection.pinReasons.length > 0) {
      return {
        status: 'blocked',
        reason: 'pinned',
        pinReasons: pinProjection.pinReasons,
      };
    }
    try {
      const snapshot = this.captureLiveInstance(entry.registration.key);
      if (!snapshot) {
        return {
          status: 'blocked',
          reason: 'capture-empty',
          pinReasons: [],
        };
      }
      if (!this.hasRestorableSnapshotForHotEviction(target)) {
        return {
          status: 'blocked',
          reason: 'snapshot-not-retained',
          pinReasons: [],
        };
      }
      return { status: 'captured' };
    } catch {
      return {
        status: 'blocked',
        reason: 'capture-failed',
        pinReasons: [],
      };
    }
  }

  hasRestorableSnapshotForHotEviction(
    target: ViewerHotEvictionPreparationTarget,
  ): boolean {
    const entry = Array.from(this.liveEntries.values()).find(({ registration }) => (
      registration.key.libraryId === target.libraryId
      && registration.key.tabId === target.tabId
      && registration.identity.viewerKind === target.viewerKind
    ));
    if (!entry) return false;
    const storedSnapshot = this.snapshots.get(
      serializeViewerResourceKey(entry.registration.identity),
    );
    return Boolean(
      storedSnapshot
      && storedSnapshot.snapshot.schemaVersion === entry.registration.schemaVersion
      && sameRevision(
        storedSnapshot.snapshot.contentRevision,
        entry.registration.contentRevision,
      )
    );
  }

  setBudget(options: Pick<ViewerSessionRegistryOptions, 'maxEntries' | 'maxEstimatedBytes'>) {
    this.maxEntries = normalizeBudget(options.maxEntries, this.maxEntries);
    this.maxEstimatedBytes = normalizeBudget(options.maxEstimatedBytes, this.maxEstimatedBytes);
    this.evictToBudget();
  }

  writeSnapshot<TPayload>(
    snapshot: ViewerSessionSnapshot<TPayload>,
    options: {
      diagnosticType?: 'captured' | 'restored';
      estimatedBytes?: number;
    } = {},
  ) {
    const serialized = serializeSnapshot(snapshot);
    const serializedBytes = getSerializedByteLength(serialized);
    const requestedEstimate = Number.isFinite(options.estimatedBytes)
      ? Math.max(Math.floor(options.estimatedBytes as number), 0)
      : 0;
    const estimatedBytes = Math.max(serializedBytes, requestedEstimate);
    const storedSnapshot = JSON.parse(serialized) as ViewerSessionSnapshot;
    const key = serializeViewerResourceKey(snapshot.identity);
    const previousSnapshot = this.snapshots.get(key)?.snapshot;
    const hadMatchingSnapshot = Boolean(
      previousSnapshot
      && previousSnapshot.schemaVersion === snapshot.schemaVersion
      && sameRevision(previousSnapshot.contentRevision, snapshot.contentRevision),
    );
    this.deleteSnapshotEntry(key);
    this.snapshots.set(key, { estimatedBytes, snapshot: storedSnapshot });
    this.estimatedBytes += estimatedBytes;
    this.emit({
      type: options.diagnosticType ?? 'captured',
      key,
      identity: snapshot.identity,
      schemaVersion: snapshot.schemaVersion,
      estimatedBytes,
    });
    this.evictToBudget();
    if (
      !hadMatchingSnapshot
      && this.hasMatchingSnapshot(snapshot.identity, {
        schemaVersion: snapshot.schemaVersion,
        contentRevision: snapshot.contentRevision,
      })
      && Array.from(this.liveEntries.values()).some(({ registration }) => (
        serializeViewerResourceKey(registration.identity) === key
        && registration.schemaVersion === snapshot.schemaVersion
        && sameRevision(registration.contentRevision, snapshot.contentRevision)
      ))
    ) {
      this.emitRetentionChanged();
    }
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

  hasMatchingSnapshot(
    identity: ViewerResourceKey,
    requirements: ViewerSnapshotReadRequirements = {},
  ): boolean {
    if (!isViewerResourceKey(identity)) return false;
    const entry = this.snapshots.get(serializeViewerResourceKey(identity));
    if (!entry) return false;
    return (
      (requirements.schemaVersion === undefined
        || entry.snapshot.schemaVersion === requirements.schemaVersion)
      && (requirements.contentRevision === undefined
        || sameRevision(entry.snapshot.contentRevision, requirements.contentRevision))
    );
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
      key: serializeViewerLiveDiagnosticKey(registration.key, registration.identity),
      identity: registration.identity,
      schemaVersion: registration.schemaVersion,
    });
    this.emitRetentionChanged();
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
      estimatedBytes: entry.registration.adapter.estimateSnapshotBytes(),
    });
    const capturedSnapshot = cloneSnapshot<TPayload>(snapshot);
    this.capturedSnapshotListeners.forEach((listener) => {
      try {
        listener(capturedSnapshot);
      } catch {
        // Persistence observers must never break the synchronous capture path.
      }
    });
    return capturedSnapshot;
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

  disposeResource(identity: ViewerResourceKey, reason = 'resource-disposed') {
    if (!isViewerResourceKey(identity)) return false;
    const resourceKey = serializeViewerResourceKey(identity);
    let disposed = false;
    if (this.deleteSnapshotEntry(resourceKey)) {
      disposed = true;
      this.emit({ type: 'disposed', key: resourceKey, identity, reason });
    }
    Array.from(this.liveEntries.entries()).forEach(([key, entry]) => {
      if (serializeViewerResourceKey(entry.registration.identity) !== resourceKey) return;
      disposed = this.removeLiveEntry(key, reason) || disposed;
    });
    return disposed;
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
      key: serializeViewerLiveDiagnosticKey(
        entry.registration.key,
        entry.registration.identity,
      ),
      identity: entry.registration.identity,
      schemaVersion: entry.registration.schemaVersion,
      reason,
    });
    this.emitRetentionChanged();
    return true;
  }

  private emitRetentionChanged() {
    this.retentionRevision = this.retentionRevision >= Number.MAX_SAFE_INTEGER
      ? 1
      : this.retentionRevision + 1;
    this.retentionListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Retention observers must never break viewer lifecycle transitions.
      }
    });
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
