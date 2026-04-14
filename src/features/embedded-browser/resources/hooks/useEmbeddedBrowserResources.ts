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
} from '../types';

const EMPTY_SNAPSHOT: EmbeddedBrowserResourceCaptureSnapshot = {
  deepCaptureEnabled: false,
  enabled: false,
  resources: [],
};

function mergeCapturedResource(
  resources: EmbeddedBrowserCapturedResource[],
  payload: EmbeddedBrowserCapturedResource,
) {
  const existingIndex = resources.findIndex((item) => item.id === payload.id);
  if (existingIndex < 0) {
    return [payload, ...resources].sort((left, right) => right.capturedAt - left.capturedAt);
  }
  const nextResources = [...resources];
  nextResources[existingIndex] = payload;
  return nextResources.sort((left, right) => right.capturedAt - left.capturedAt);
}

export function useEmbeddedBrowserResources(activeTabId: string | null) {
  const [snapshotsByTabId, setSnapshotsByTabId] = React.useState<Record<string, EmbeddedBrowserResourceCaptureSnapshot>>({});
  const [loading, setLoading] = React.useState(false);

  const updateSnapshot = React.useCallback((tabId: string, snapshot: EmbeddedBrowserResourceCaptureSnapshot) => {
    setSnapshotsByTabId((current) => ({
      ...current,
      [tabId]: snapshot,
    }));
  }, []);

  React.useEffect(() => {
    const unsubscribe = subscribeEmbeddedBrowserResources((payload) => {
      if (!payload.tabId) {
        return;
      }
      setSnapshotsByTabId((current) => {
        const previous = current[payload.tabId] ?? EMPTY_SNAPSHOT;
        return {
          ...current,
          [payload.tabId]: {
            ...previous,
            resources: mergeCapturedResource(previous.resources, payload),
          },
        };
      });
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    if (!activeTabId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listEmbeddedBrowserCapturedResources(activeTabId)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        updateSnapshot(activeTabId, snapshot);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTabId, updateSnapshot]);

  const runForActiveTab = React.useCallback(async (
    runner: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>,
  ) => {
    if (!activeTabId) {
      return EMPTY_SNAPSHOT;
    }
    setLoading(true);
    try {
      const snapshot = await runner(activeTabId);
      updateSnapshot(activeTabId, snapshot);
      return snapshot;
    } finally {
      setLoading(false);
    }
  }, [activeTabId, updateSnapshot]);

  const activeSnapshot = activeTabId ? (snapshotsByTabId[activeTabId] ?? EMPTY_SNAPSHOT) : EMPTY_SNAPSHOT;

  return {
    captureEnabled: activeSnapshot.enabled,
    clearResources: () => runForActiveTab(clearEmbeddedBrowserCapturedResources),
    deepCaptureEnabled: activeSnapshot.deepCaptureEnabled,
    loading,
    resources: activeSnapshot.resources,
    startCapture: () => runForActiveTab(startEmbeddedBrowserResourceCapture),
    startDeepCapture: () => runForActiveTab(startEmbeddedBrowserDeepResourceCapture),
    stopCapture: () => runForActiveTab(stopEmbeddedBrowserResourceCapture),
  };
}
