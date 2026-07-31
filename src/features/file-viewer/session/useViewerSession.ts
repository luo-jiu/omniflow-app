import { useCallback, useEffect, useMemo, useRef } from 'react';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { createViewerResourceKey } from './viewer-session-identity';
import {
  viewerSessionRegistry,
  viewerSessionRuntime,
} from './viewer-session-runtime';
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
}

export function useViewerSession<TPayload>(
  options: UseViewerSessionOptions<TPayload>,
): ViewerSessionHandle<TPayload> {
  const activeRef = useRef(options.active);
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
    const liveKey = liveKeyRef.current;
    if (!liveKey) return null;
    try {
      return viewerSessionRegistry.captureLiveInstance<TPayload>(liveKey);
    } catch (error) {
      runtimeLogger.warn('capture viewer session failed', { error });
      return null;
    }
  }, []);

  useEffect(() => {
    if (!identity) return;
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
      } catch (error) {
        runtimeLogger.warn('restore viewer session failed', { error });
      }
    }

    return () => {
      try {
        viewerSessionRegistry.captureLiveInstance(liveKey);
      } catch (error) {
        runtimeLogger.warn('capture viewer session during cleanup failed', { error });
      } finally {
        unregister();
        if (liveKeyRef.current === liveKey) {
          liveKeyRef.current = null;
        }
      }
    };
  }, [
    identity,
    options.adapter,
    options.contentRevision,
    options.reloadToken,
    options.schemaVersion,
    options.tabId,
  ]);

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
  };
}
