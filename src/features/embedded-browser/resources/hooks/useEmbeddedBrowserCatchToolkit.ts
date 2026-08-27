import React from 'react';
import type { EmbeddedBrowserCatchToolkitState } from '../types';
import {
  clearEmbeddedBrowserCatchMediaCache,
  downloadEmbeddedBrowserCatchMedia,
  getEmbeddedBrowserCatchToolkitState,
  restartEmbeddedBrowserCatchMediaCapture,
  updateEmbeddedBrowserCatchToolkitState,
} from '../services/embedded-browser-catch-toolkit.api';
import {
  mergeEmbeddedBrowserCapturedMseResources,
  saveEmbeddedBrowserCapturedResource,
} from '../services/embedded-browser-resource.api';

const EMPTY_TOOLKIT_STATE: EmbeddedBrowserCatchToolkitState = {
  audioResourceKey: '',
  audioSizeBytes: 0,
  autoSeekToBufferedEnd: false,
  autoDownloadOnComplete: false,
  capturedMediaSizeBytes: 0,
  clearCacheOnComplete: false,
  currentFileName: '',
  diagnostics: {
    appendBufferCount: 0,
    frameUrl: '',
    hookErrors: 0,
    installedAt: 0,
    lastAppendAt: 0,
    lastError: '',
    mediaSourceAvailable: false,
    mediaSourceHooked: false,
    sourceBufferCount: 0,
  },
  isCaptureComplete: false,
  manualFileName: '',
  primaryResourceKey: '',
  regexWarning: '',
  regexRule: '',
  restartAlwaysFromBeginning: false,
  selectorWarning: '',
  selectorRule: '',
  streamCount: 0,
  trimExtraMediaHeaders: true,
  videoResourceKey: '',
  videoSizeBytes: 0,
};

export function useEmbeddedBrowserCatchToolkit(
  activeTabId: string | null,
  enabled: boolean,
) {
  const [loading, setLoading] = React.useState(false);
  const [state, setState] = React.useState<EmbeddedBrowserCatchToolkitState>(EMPTY_TOOLKIT_STATE);
  const autoExportKeyRef = React.useRef('');
  const mutationCountRef = React.useRef(0);

  const refresh = React.useCallback(async (options?: { force?: boolean }) => {
    if (!activeTabId || !enabled) {
      setState(EMPTY_TOOLKIT_STATE);
      return EMPTY_TOOLKIT_STATE;
    }
    const nextState = await getEmbeddedBrowserCatchToolkitState(activeTabId);
    if (!nextState) {
      if (options?.force || mutationCountRef.current === 0) {
        setState(EMPTY_TOOLKIT_STATE);
      }
      return EMPTY_TOOLKIT_STATE;
    }
    if (options?.force || mutationCountRef.current === 0) {
      setState(nextState);
    }
    return nextState;
  }, [activeTabId, enabled]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!activeTabId || !enabled) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1500);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeTabId, enabled, refresh]);

  const updateState = React.useCallback(async (payload: Partial<EmbeddedBrowserCatchToolkitState>) => {
    if (!activeTabId || !enabled) {
      return EMPTY_TOOLKIT_STATE;
    }
    mutationCountRef.current += 1;
    setLoading(true);
    try {
      const nextState = await updateEmbeddedBrowserCatchToolkitState(activeTabId, payload);
      if (!nextState) {
        setState(EMPTY_TOOLKIT_STATE);
        return EMPTY_TOOLKIT_STATE;
      }
      setState(nextState);
      return nextState;
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
      setLoading(false);
    }
  }, [activeTabId, enabled]);

  const clearCache = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      return false;
    }
    mutationCountRef.current += 1;
    setLoading(true);
    try {
      const success = await clearEmbeddedBrowserCatchMediaCache(activeTabId);
      await refresh({ force: true });
      return success;
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
      setLoading(false);
    }
  }, [activeTabId, enabled, refresh]);

  const downloadMedia = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      return false;
    }
    mutationCountRef.current += 1;
    setLoading(true);
    try {
      const success = await downloadEmbeddedBrowserCatchMedia(activeTabId);
      await refresh({ force: true });
      return success;
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
      setLoading(false);
    }
  }, [activeTabId, enabled, refresh]);

  const mergeCapturedMedia = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      return null;
    }
    if (!state.videoResourceKey || !state.audioResourceKey) {
      return null;
    }
    mutationCountRef.current += 1;
    setLoading(true);
    try {
      const result = await mergeEmbeddedBrowserCapturedMseResources(activeTabId, {
        audioResourceId: state.audioResourceKey,
        suggestedFileName: state.currentFileName ? `${state.currentFileName}.mp4` : undefined,
        videoResourceId: state.videoResourceKey,
      });
      await refresh({ force: true });
      return result;
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
      setLoading(false);
    }
  }, [
    activeTabId,
    enabled,
    refresh,
    state.audioResourceKey,
    state.currentFileName,
    state.videoResourceKey,
  ]);

  const saveCapturedMedia = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      return null;
    }
    const resourceId = state.primaryResourceKey || state.videoResourceKey || state.audioResourceKey;
    if (!resourceId) {
      return null;
    }
    mutationCountRef.current += 1;
    setLoading(true);
    try {
      const result = await saveEmbeddedBrowserCapturedResource(activeTabId, {
        resourceId,
        suggestedFileName: state.currentFileName || undefined,
      });
      await refresh({ force: true });
      return result;
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
      setLoading(false);
    }
  }, [
    activeTabId,
    enabled,
    refresh,
    state.audioResourceKey,
    state.currentFileName,
    state.primaryResourceKey,
    state.videoResourceKey,
  ]);

  const restartCapture = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      return false;
    }
    mutationCountRef.current += 1;
    setLoading(true);
    try {
      const success = await restartEmbeddedBrowserCatchMediaCapture(activeTabId);
      await refresh({ force: true });
      return success;
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
      setLoading(false);
    }
  }, [activeTabId, enabled, refresh]);

  React.useEffect(() => {
    if (!activeTabId || !enabled || !state.autoDownloadOnComplete || !state.isCaptureComplete) {
      return;
    }
    if (state.capturedMediaSizeBytes <= 0) {
      return;
    }
    const autoExportKey = [
      activeTabId,
      state.capturedMediaSizeBytes,
      state.audioResourceKey,
      state.videoResourceKey,
      state.primaryResourceKey,
    ].join(':');
    if (autoExportKeyRef.current === autoExportKey) {
      return;
    }
    autoExportKeyRef.current = autoExportKey;
    const runAutoExport = async () => {
      let exportSucceeded = false;
      if (state.videoResourceKey && state.audioResourceKey) {
        const result = await mergeCapturedMedia();
        exportSucceeded = Boolean(result?.ok);
      } else {
        const result = await saveCapturedMedia();
        exportSucceeded = Boolean(result?.ok);
      }
      if (exportSucceeded && state.clearCacheOnComplete) {
        await clearCache();
      }
    };
    void runAutoExport().catch(() => {
      autoExportKeyRef.current = '';
    });
  }, [
    activeTabId,
    clearCache,
    enabled,
    mergeCapturedMedia,
    saveCapturedMedia,
    state.audioResourceKey,
    state.autoDownloadOnComplete,
    state.capturedMediaSizeBytes,
    state.clearCacheOnComplete,
    state.isCaptureComplete,
    state.primaryResourceKey,
    state.videoResourceKey,
  ]);

  return {
    clearCache,
    downloadMedia,
    enabled: Boolean(activeTabId && enabled),
    loading,
    mergeCapturedMedia,
    refresh,
    restartCapture,
    saveCapturedMedia,
    state,
    updateState,
  };
}
