import React from 'react';
import {
  clearEmbeddedBrowserCapturedResources,
  listEmbeddedBrowserCapturedResources,
  startEmbeddedBrowserDeepResourceCapture,
  startEmbeddedBrowserResourceCapture,
  stopEmbeddedBrowserResourceCapture,
  subscribeEmbeddedBrowserResources,
} from '../services/embedded-browser-resource.api';
import type {
  EmbeddedBrowserCapturedResource,
  EmbeddedBrowserResourceCaptureSnapshot,
  EmbeddedBrowserResourceStateSnapshot,
} from '../types';
import { CapturedResourceContract } from '../types';

const EMPTY_RESOURCES: EmbeddedBrowserCapturedResource[] = [];

function createEmptySnapshot(tabId: string): EmbeddedBrowserResourceCaptureSnapshot {
  return {
    captureMode: 'off',
    incarnation: 1,
    resources: [],
    revision: 1,
    status: 'active',
    tabId,
  };
}

export function useEmbeddedBrowserResources(activeTabId: string | null) {
  const snapshotsRef = React.useRef<Record<string, EmbeddedBrowserResourceStateSnapshot>>({});
  const resyncInFlightRef = React.useRef<Set<string>>(new Set());
  const [snapshotsByTabId, setSnapshotsByTabId] = React.useState<Record<string, EmbeddedBrowserResourceStateSnapshot>>({});
  const [loading, setLoading] = React.useState(false);

  const commitSnapshot = React.useCallback((tabId: string, snapshot: EmbeddedBrowserResourceStateSnapshot) => {
    const next = {
      ...snapshotsRef.current,
      [tabId]: snapshot,
    };
    snapshotsRef.current = next;
    setSnapshotsByTabId(next);
  }, []);

  const requestSnapshot = React.useCallback(async (tabId: string) => {
    const normalizedTabId = String(tabId || '').trim();
    if (!normalizedTabId || resyncInFlightRef.current.has(normalizedTabId)) return;
    resyncInFlightRef.current.add(normalizedTabId);
    try {
      const incoming = await listEmbeddedBrowserCapturedResources(normalizedTabId);
      if (!incoming) return;
      const reduced = CapturedResourceContract.reduce(
        snapshotsRef.current[normalizedTabId] || null,
        incoming,
      );
      if (reduced.decision === 'applied' && reduced.state) {
        commitSnapshot(normalizedTabId, reduced.state);
      }
    } finally {
      resyncInFlightRef.current.delete(normalizedTabId);
    }
  }, [commitSnapshot]);

  React.useEffect(() => subscribeEmbeddedBrowserResources((message) => {
    const reducedMessage = CapturedResourceContract.reduce(
      snapshotsRef.current[message.tabId] || null,
      message,
    );
    if (reducedMessage.decision === 'applied' && reducedMessage.state) {
      commitSnapshot(message.tabId, reducedMessage.state);
      return;
    }
    if (reducedMessage.decision === 'resync') {
      void requestSnapshot(message.tabId);
    }
  }), [commitSnapshot, requestSnapshot]);

  React.useEffect(() => {
    if (!activeTabId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void requestSnapshot(activeTabId)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTabId, requestSnapshot]);

  const runForActiveTab = React.useCallback(async (
    runner: (tabId: string) => Promise<EmbeddedBrowserResourceStateSnapshot | null>,
  ) => {
    if (!activeTabId) {
      return null;
    }
    setLoading(true);
    try {
      const snapshot = await runner(activeTabId);
      if (snapshot) {
        const reduced = CapturedResourceContract.reduce(
          snapshotsRef.current[activeTabId] || null,
          snapshot,
        );
        if (reduced.decision === 'applied' && reduced.state) {
          commitSnapshot(activeTabId, reduced.state);
        } else if (reduced.decision === 'resync') {
          await requestSnapshot(activeTabId);
        }
      }
      return snapshot;
    } finally {
      setLoading(false);
    }
  }, [activeTabId, commitSnapshot, requestSnapshot]);

  const activeSnapshot = activeTabId
    ? (snapshotsByTabId[activeTabId] ?? createEmptySnapshot(activeTabId))
    : null;
  const captureMode = activeSnapshot?.status === 'active' ? activeSnapshot.captureMode : 'off';
  const resources = activeSnapshot?.status === 'active' ? activeSnapshot.resources : EMPTY_RESOURCES;

  return {
    captureEnabled: captureMode !== 'off',
    clearResources: () => runForActiveTab(clearEmbeddedBrowserCapturedResources),
    deepCaptureEnabled: captureMode === 'deep',
    loading,
    resources,
    startCapture: () => runForActiveTab(startEmbeddedBrowserResourceCapture),
    startDeepCapture: () => runForActiveTab(startEmbeddedBrowserDeepResourceCapture),
    stopCapture: () => runForActiveTab(stopEmbeddedBrowserResourceCapture),
  };
}
