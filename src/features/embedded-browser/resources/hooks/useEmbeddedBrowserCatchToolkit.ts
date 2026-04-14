import React from 'react';
import type { EmbeddedBrowserCatchToolkitState } from '../types';
import {
  clearEmbeddedBrowserCatchMediaCache,
  downloadEmbeddedBrowserCatchMedia,
  getEmbeddedBrowserCatchToolkitState,
  restartEmbeddedBrowserCatchMediaCapture,
  updateEmbeddedBrowserCatchToolkitState,
} from '../services/embedded-browser-catch-toolkit.api';

const EMPTY_TOOLKIT_STATE: EmbeddedBrowserCatchToolkitState = {
  autoSeekToBufferedEnd: false,
  autoDownloadOnComplete: false,
  capturedMediaSizeBytes: 0,
  clearCacheOnComplete: false,
  currentFileName: '',
  isCaptureComplete: false,
  manualFileName: '',
  regexWarning: '',
  regexRule: '',
  restartAlwaysFromBeginning: false,
  selectorWarning: '',
  selectorRule: '',
  streamCount: 0,
  trimExtraMediaHeaders: true,
};

export function useEmbeddedBrowserCatchToolkit(
  activeTabId: string | null,
  enabled: boolean,
) {
  const [loading, setLoading] = React.useState(false);
  const [state, setState] = React.useState<EmbeddedBrowserCatchToolkitState>(EMPTY_TOOLKIT_STATE);

  const refresh = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      setState(EMPTY_TOOLKIT_STATE);
      return EMPTY_TOOLKIT_STATE;
    }
    setLoading(true);
    try {
      const nextState = await getEmbeddedBrowserCatchToolkitState(activeTabId);
      if (!nextState) {
        setState(EMPTY_TOOLKIT_STATE);
        return EMPTY_TOOLKIT_STATE;
      }
      setState(nextState);
      return nextState;
    } finally {
      setLoading(false);
    }
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
      setLoading(false);
    }
  }, [activeTabId, enabled]);

  const clearCache = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      return false;
    }
    setLoading(true);
    try {
      const success = await clearEmbeddedBrowserCatchMediaCache(activeTabId);
      await refresh();
      return success;
    } finally {
      setLoading(false);
    }
  }, [activeTabId, enabled, refresh]);

  const downloadMedia = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      return false;
    }
    setLoading(true);
    try {
      const success = await downloadEmbeddedBrowserCatchMedia(activeTabId);
      await refresh();
      return success;
    } finally {
      setLoading(false);
    }
  }, [activeTabId, enabled, refresh]);

  const restartCapture = React.useCallback(async () => {
    if (!activeTabId || !enabled) {
      return false;
    }
    setLoading(true);
    try {
      const success = await restartEmbeddedBrowserCatchMediaCapture(activeTabId);
      await refresh();
      return success;
    } finally {
      setLoading(false);
    }
  }, [activeTabId, enabled, refresh]);

  return {
    clearCache,
    downloadMedia,
    enabled: Boolean(activeTabId && enabled),
    loading,
    refresh,
    restartCapture,
    state,
    updateState,
  };
}
