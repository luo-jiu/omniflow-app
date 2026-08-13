import { useCallback, useEffect, useMemo, useRef } from 'react';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { createViewerResourceKey } from './viewer-session-identity';
import {
  viewerSessionRegistry,
  viewerSessionRuntime,
} from './viewer-session-runtime';
import { viewerSessionColdStore } from './viewer-session-cold-store';
import { viewerPolicyUsesDeviceCold } from './viewer-session-policies';
import {
  ViewerSessionRestoreGate,
  type ViewerInitialRestoreSource,
} from './viewer-session-restore-gate';
import type {
  ViewerLiveInstanceKey,
  ViewerSessionAdapter,
  ViewerSessionSnapshot,
} from './viewer-session.types';
import type { FileViewerFileType } from '@/shared/file-viewer-types';

interface UseViewerSessionOptions<TPayload> {
  accountScope: string | null;
  active: boolean;
  adapter: ViewerSessionAdapter<TPayload>;
  contentRevision: string | null;
  coldRestoreReady?: boolean;
  libraryId: number | null;
  nodeId: number | null;
  reloadToken: number;
  schemaVersion: number;
  stableResourceId?: string | null;
  tabId: string;
  viewerKind: FileViewerFileType;
}

export interface ViewerSessionHandle<TPayload> {
  capture: () => ViewerSessionSnapshot<TPayload> | null;
  enabled: boolean;
  markInteracted: () => boolean;
  notifyRetentionChanged: () => boolean;
  waitForInitialRestore: () => Promise<ViewerInitialRestoreSource>;
}

function isViewerContentInteraction(event: Event): boolean {
  const target = event.target;
  return typeof Element !== 'undefined'
    && target instanceof Element
    && target.closest('[data-viewer-interaction-root]') !== null;
}

export function useViewerSession<TPayload>(
  options: UseViewerSessionOptions<TPayload>,
): ViewerSessionHandle<TPayload> {
  const activeRef = useRef(options.active);
  const hasRestorableSnapshotRef = useRef(false);
  const initialRestoreGateRef = useRef<ViewerSessionRestoreGate | null>(null);
  const liveKeyRef = useRef<ViewerLiveInstanceKey | null>(null);
  activeRef.current = options.active;

  const identity = useMemo(() => {
    if (!options.accountScope || options.libraryId == null) return null;
    return createViewerResourceKey({
      accountScope: options.accountScope,
      libraryId: options.libraryId,
      nodeId: options.nodeId,
      stableResourceId: options.stableResourceId,
      viewerKind: options.viewerKind,
    });
  }, [
    options.accountScope,
    options.libraryId,
    options.nodeId,
    options.stableResourceId,
    options.viewerKind,
  ]);

  const capture = useCallback(() => {
    const restoreGate = initialRestoreGateRef.current;
    if (restoreGate && restoreGate.getSettledSource() === null) return null;
    const liveKey = liveKeyRef.current;
    if (!liveKey) return null;
    try {
      return viewerSessionRegistry.captureLiveInstance<TPayload>(liveKey);
    } catch (error) {
      runtimeLogger.warn('capture viewer session failed', { error });
      return null;
    }
  }, []);

  const notifyRetentionChanged = useCallback(() => {
    const liveKey = liveKeyRef.current;
    return liveKey
      ? viewerSessionRegistry.notifyLiveRetentionChanged(liveKey)
      : false;
  }, []);

  const markInteracted = useCallback(() => {
    if (!activeRef.current) return false;
    const restoreGate = initialRestoreGateRef.current;
    if (!restoreGate) return false;
    restoreGate.markInteracted();
    return true;
  }, []);

  const waitForInitialRestore = useCallback(() => (
    initialRestoreGateRef.current?.wait() ?? Promise.resolve('none' as const)
  ), []);

  useEffect(() => {
    if (!identity) return;
    const restoreGate = new ViewerSessionRestoreGate();
    hasRestorableSnapshotRef.current = false;
    initialRestoreGateRef.current = restoreGate;
    viewerSessionRuntime.prepareResource(identity, options.reloadToken);
    const liveKey = viewerSessionRuntime.createLiveInstanceKey({
      libraryId: identity.libraryId,
      tabId: options.tabId,
    });
    if (!liveKey) return;

    liveKeyRef.current = liveKey;
    const unregister = viewerSessionRegistry.registerLiveInstance({
      key: liveKey,
      identity,
      schemaVersion: options.schemaVersion,
      contentRevision: options.contentRevision,
      adapter: options.adapter,
    });
    const snapshot = viewerSessionRegistry.readSnapshot<TPayload>(identity, {
      schemaVersion: options.schemaVersion,
      contentRevision: options.contentRevision,
    });
    if (snapshot) {
      try {
        options.adapter.restore(snapshot.payload);
        hasRestorableSnapshotRef.current = true;
        restoreGate.settle('warm');
      } catch (error) {
        viewerSessionRegistry.invalidateSnapshot(identity, 'warm-restore-failed');
        runtimeLogger.warn('restore viewer session failed', { error });
        restoreGate.settle('none');
      }
    } else if (
      options.coldRestoreReady === false
      || !viewerPolicyUsesDeviceCold(identity.viewerKind)
    ) {
      restoreGate.settle('none');
    } else {
      void viewerSessionColdStore.readSnapshot<TPayload>(identity, {
        schemaVersion: options.schemaVersion,
        contentRevision: options.contentRevision,
      }).then((coldSnapshot) => {
        if (liveKeyRef.current !== liveKey) return;
        const hasNewerWarmSnapshot = viewerSessionRegistry.hasMatchingSnapshot(identity, {
          schemaVersion: options.schemaVersion,
          contentRevision: options.contentRevision,
        });
        if (!restoreGate.canApplyCold({
          hasNewerWarmSnapshot,
        })) {
          if (hasNewerWarmSnapshot) restoreGate.settle('warm');
          return;
        }
        if (!coldSnapshot) {
          restoreGate.settle('none');
          if (capture()) hasRestorableSnapshotRef.current = true;
          return;
        }
        try {
          viewerSessionRegistry.writeSnapshot(coldSnapshot, {
            diagnosticType: 'restored',
          });
          options.adapter.restore(coldSnapshot.payload);
          hasRestorableSnapshotRef.current = true;
          restoreGate.settle('cold');
        } catch (error) {
          viewerSessionRegistry.invalidateSnapshot(identity, 'cold-restore-failed');
          runtimeLogger.warn('restore viewer session from Cold Store failed', { error });
          restoreGate.settle('none');
          if (capture()) hasRestorableSnapshotRef.current = true;
        }
      }).catch((error) => {
        if (liveKeyRef.current !== liveKey) return;
        runtimeLogger.warn('read viewer session from Cold Store failed', { error });
        restoreGate.settle('none');
        if (capture()) hasRestorableSnapshotRef.current = true;
      });
    }

    const markInteracted = (event: Event) => {
      if (activeRef.current && isViewerContentInteraction(event)) {
        restoreGate.markInteracted();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', markInteracted, true);
      window.addEventListener('pointerdown', markInteracted, true);
      window.addEventListener('touchstart', markInteracted, true);
      window.addEventListener('wheel', markInteracted, true);
    }

    return () => {
      const shouldCaptureOnCleanup = restoreGate.getSettledSource() !== null;
      restoreGate.dispose();
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', markInteracted, true);
        window.removeEventListener('pointerdown', markInteracted, true);
        window.removeEventListener('touchstart', markInteracted, true);
        window.removeEventListener('wheel', markInteracted, true);
      }
      try {
        if (shouldCaptureOnCleanup) {
          viewerSessionRegistry.captureLiveInstance(liveKey);
        }
      } catch (error) {
        runtimeLogger.warn('capture viewer session during cleanup failed', { error });
      } finally {
        unregister();
        if (liveKeyRef.current === liveKey) {
          liveKeyRef.current = null;
        }
        if (initialRestoreGateRef.current === restoreGate) {
          initialRestoreGateRef.current = null;
        }
      }
    };
  }, [
    capture,
    identity,
    options.adapter,
    options.coldRestoreReady,
    options.contentRevision,
    options.reloadToken,
    options.schemaVersion,
    options.tabId,
  ]);

  useEffect(() => {
    if (!identity || hasRestorableSnapshotRef.current) return;
    const restoreGate = initialRestoreGateRef.current;
    if (!restoreGate || restoreGate.getSettledSource() === null) return;
    if (viewerSessionRegistry.hasMatchingSnapshot(identity, {
      schemaVersion: options.schemaVersion,
      contentRevision: options.contentRevision,
    })) {
      hasRestorableSnapshotRef.current = true;
      return;
    }
    if (capture()) {
      hasRestorableSnapshotRef.current = true;
    }
  });

  useEffect(() => {
    if (!liveKeyRef.current) return;
    try {
      if (options.active) {
        options.adapter.resume();
      } else {
        capture();
        options.adapter.suspend();
      }
    } catch (error) {
      runtimeLogger.warn('change viewer session activity failed', { error });
    }
  }, [capture, options.active, options.adapter]);

  return {
    capture,
    enabled: identity != null,
    markInteracted,
    notifyRetentionChanged,
    waitForInitialRestore,
  };
}
