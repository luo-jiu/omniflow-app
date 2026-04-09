import React from 'react';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { AUTO_IMPORT_SCAN_INTERVAL_MS } from '../auto-import/settings';
import { runAutoImportTick } from '../auto-import/runner';

interface UseDesktopAutoImportOptions {
  libraryId: number;
  rootNodeId: number | null;
  onNodeCreated?: (newNode: unknown) => void;
}

export function useDesktopAutoImport({
  libraryId,
  rootNodeId,
  onNodeCreated,
}: UseDesktopAutoImportOptions) {
  const isRunningRef = React.useRef(false);

  const runTick = React.useCallback(async () => {
    if (isRunningRef.current) {
      return;
    }
    if (!Number.isFinite(rootNodeId) || Number(rootNodeId) <= 0) {
      return;
    }

    isRunningRef.current = true;
    try {
      await runAutoImportTick({
        libraryId,
        rootNodeId: Number(rootNodeId),
        onNodeCreated,
      });
    } catch (error) {
      runtimeLogger.error('自动导入扫描失败:', error);
    } finally {
      isRunningRef.current = false;
    }
  }, [libraryId, onNodeCreated, rootNodeId]);

  React.useEffect(() => {
    let disposed = false;
    const safeRunTick = async () => {
      if (disposed) {
        return;
      }
      await runTick();
    };

    const timer = window.setInterval(() => {
      void safeRunTick();
    }, AUTO_IMPORT_SCAN_INTERVAL_MS);
    void safeRunTick();

    return () => {
      disposed = true;
      window.clearInterval(timer);
      isRunningRef.current = false;
    };
  }, [runTick]);
}
