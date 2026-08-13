import { runtimeLogger } from '@/utils/runtimeLogger';
import { serializeViewerResourceKey } from './viewer-session-identity';
import { viewerPolicyUsesDeviceCold } from './viewer-session-policies';
import type { ViewerSessionRegistry } from './viewer-session-registry';
import type { ViewerSessionColdStore } from './viewer-session-cold-store';
import type { ViewerResourceKey, ViewerSessionSnapshot } from './viewer-session.types';

const DEFAULT_WRITE_DEBOUNCE_MS = 1_000;

interface PendingColdWrite {
  snapshot: ViewerSessionSnapshot;
  timer: ReturnType<typeof setTimeout>;
}

interface ViewerSessionColdRuntimeOptions {
  onError?: (message: string, error: unknown) => void;
  writeDebounceMs?: number;
}

function cloneSnapshot(snapshot: ViewerSessionSnapshot): ViewerSessionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ViewerSessionSnapshot;
}

export class ViewerSessionColdRuntime {
  private readonly pendingWrites = new Map<string, PendingColdWrite>();
  private readonly onError: (message: string, error: unknown) => void;
  private readonly writeDebounceMs: number;
  private unsubscribeCapturedSnapshots: (() => void) | null = null;

  constructor(
    private readonly registry: ViewerSessionRegistry,
    private readonly store: Pick<
      ViewerSessionColdStore,
      'deleteLibrary' | 'deleteResources' | 'writeSnapshot'
    >,
    options: ViewerSessionColdRuntimeOptions = {},
  ) {
    this.onError = options.onError ?? ((message, error) => {
      runtimeLogger.warn(message, { error });
    });
    this.writeDebounceMs = Number.isFinite(options.writeDebounceMs)
      ? Math.max(Math.floor(Number(options.writeDebounceMs)), 0)
      : DEFAULT_WRITE_DEBOUNCE_MS;
  }

  start = () => {
    if (this.unsubscribeCapturedSnapshots) return;
    this.unsubscribeCapturedSnapshots = this.registry.subscribeCapturedSnapshots((snapshot) => {
      this.scheduleSnapshot(snapshot);
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide);
    }
  };

  dispose = () => {
    this.unsubscribeCapturedSnapshots?.();
    this.unsubscribeCapturedSnapshots = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
    }
    void this.flushAll();
  };

  async deleteLibrary(accountScope: string, libraryId: number): Promise<void> {
    this.cancelWhere((snapshot) => (
      snapshot.identity.accountScope === accountScope
      && snapshot.identity.libraryId === libraryId
    ));
    await this.store.deleteLibrary(accountScope, libraryId);
  }

  async deleteResources(identities: ViewerResourceKey[]): Promise<void> {
    const deviceIdentities = identities.filter(identity => (
      viewerPolicyUsesDeviceCold(identity.viewerKind)
    ));
    const keys = new Set(deviceIdentities.map(serializeViewerResourceKey));
    this.cancelWhere((snapshot) => keys.has(serializeViewerResourceKey(snapshot.identity)));
    if (deviceIdentities.length > 0) {
      await this.store.deleteResources(deviceIdentities);
    }
  }

  flushAll(): Promise<void> {
    const snapshots = Array.from(this.pendingWrites.values()).map(entry => entry.snapshot);
    this.pendingWrites.forEach(entry => clearTimeout(entry.timer));
    this.pendingWrites.clear();
    return Promise.allSettled(snapshots.map(snapshot => this.persistSnapshot(snapshot)))
      .then(() => undefined);
  }

  scheduleSnapshot(snapshot: ViewerSessionSnapshot): void {
    if (!viewerPolicyUsesDeviceCold(snapshot.identity.viewerKind)) return;
    const key = serializeViewerResourceKey(snapshot.identity);
    const previous = this.pendingWrites.get(key);
    if (previous) clearTimeout(previous.timer);
    const detachedSnapshot = cloneSnapshot(snapshot);
    const timer = setTimeout(() => {
      const current = this.pendingWrites.get(key);
      if (!current || current.snapshot !== detachedSnapshot) return;
      this.pendingWrites.delete(key);
      void this.persistSnapshot(detachedSnapshot);
    }, this.writeDebounceMs);
    this.pendingWrites.set(key, { snapshot: detachedSnapshot, timer });
  }

  private cancelWhere(predicate: (snapshot: ViewerSessionSnapshot) => boolean) {
    this.pendingWrites.forEach((entry, key) => {
      if (!predicate(entry.snapshot)) return;
      clearTimeout(entry.timer);
      this.pendingWrites.delete(key);
    });
  }

  private readonly handlePageHide = () => {
    void this.flushAll();
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      void this.flushAll();
    }
  };

  private async persistSnapshot(snapshot: ViewerSessionSnapshot): Promise<void> {
    try {
      await this.store.writeSnapshot(snapshot);
    } catch (error) {
      this.onError('persist viewer session snapshot to Cold Store failed', error);
    }
  }
}
