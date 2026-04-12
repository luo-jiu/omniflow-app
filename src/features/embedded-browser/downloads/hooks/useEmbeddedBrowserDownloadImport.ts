import React from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { uploadManager } from '@/utils/uploadManager';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { UPLOAD_TASK_STATUS } from '@/modules/upload-center/model/upload-task.types';
import {
  cleanupEmbeddedBrowserDownloadedFile,
  saveEmbeddedBrowserDownloadToDesktop,
  subscribeEmbeddedBrowserDownloads,
} from '../services/embedded-browser-download.api';
import type { EmbeddedBrowserDownloadEvent, LibraryFolderEntry } from '../types';

type FileWithPath = File & { path: string };

function toUploadFile(download: EmbeddedBrowserDownloadEvent): FileWithPath {
  return {
    name: download.fileName,
    size: Math.max(0, Number(download.totalBytes || 0)),
    type: download.mimeType || '',
    path: String(download.tempPath || ''),
  } as FileWithPath;
}

interface UseEmbeddedBrowserDownloadImportOptions {
  onImportSuccess?: (payload: {
    download: EmbeddedBrowserDownloadEvent;
    targetFolder: LibraryFolderEntry;
  }) => void | Promise<void>;
}

export function useEmbeddedBrowserDownloadImport(
  libraryId: number,
  options?: UseEmbeddedBrowserDownloadImportOptions,
) {
  const [queue, setQueue] = React.useState<EmbeddedBrowserDownloadEvent[]>([]);
  const [importingDownloadId, setImportingDownloadId] = React.useState<string | null>(null);
  const [savingDownloadId, setSavingDownloadId] = React.useState<string | null>(null);
  const activeDownload = queue[0] ?? null;

  React.useEffect(() => {
    return subscribeEmbeddedBrowserDownloads((payload) => {
      if (payload.state === 'started') {
        return;
      }

      if (payload.state === 'progress') {
        return;
      }

      if (payload.state === 'completed') {
        setQueue((prev) => {
          if (prev.some((item) => item.downloadId === payload.downloadId)) {
            return prev;
          }
          return [...prev, payload];
        });
        return;
      }

      if (payload.tempPath) {
        void cleanupEmbeddedBrowserDownloadedFile(payload.tempPath).catch(() => undefined);
      }
      Toast.error(payload.error || `下载失败：${payload.fileName}`);
    });
  }, []);

  const closeActiveDownload = React.useCallback(async (options?: { discardFile?: boolean }) => {
    const current = activeDownload;
    setQueue((prev) => prev.slice(1));
    if (!current?.tempPath || !options?.discardFile) {
      return;
    }
    await cleanupEmbeddedBrowserDownloadedFile(current.tempPath).catch(() => undefined);
  }, [activeDownload]);

  const importActiveDownload = React.useCallback(async (targetFolder: LibraryFolderEntry) => {
    const current = activeDownload;
    if (!current?.tempPath) {
      await closeActiveDownload();
      return;
    }

    setImportingDownloadId(current.downloadId);
    setQueue((prev) => prev.slice(1));

    const file = toUploadFile(current);
    const batch = uploadManager.createBatch([{
      file,
      libraryId,
      parentId: targetFolder.id,
      relativePath: current.fileName,
    }]);

    batch.done
      .then(async (results) => {
        const success = results.some((item) => item.taskStatus === UPLOAD_TASK_STATUS.SUCCESS);
        if (success) {
          await cleanupEmbeddedBrowserDownloadedFile(current.tempPath).catch(() => undefined);
          try {
            await options?.onImportSuccess?.({
              download: current,
              targetFolder,
            });
          } catch (error) {
            runtimeLogger.warn('浏览器下载导入后刷新目录失败', error);
          }
          Toast.success(`已导入到 ${targetFolder.name}`);
          return;
        }
        Toast.error(`导入失败：${current.fileName}`);
      })
      .catch(() => {
        Toast.error(`导入失败：${current.fileName}`);
      })
      .finally(() => {
        setImportingDownloadId((prev) => (prev === current.downloadId ? null : prev));
      });
  }, [activeDownload, closeActiveDownload, libraryId, options]);

  const saveActiveDownloadToDesktop = React.useCallback(async () => {
    const current = activeDownload;
    if (!current?.tempPath) {
      await closeActiveDownload();
      return;
    }

    setSavingDownloadId(current.downloadId);
    try {
      const result = await saveEmbeddedBrowserDownloadToDesktop(current.tempPath, current.fileName);
      if (result.canceled) {
        return;
      }
      await cleanupEmbeddedBrowserDownloadedFile(current.tempPath).catch(() => undefined);
      setQueue((prev) => prev.filter((item) => item.downloadId !== current.downloadId));
      Toast.success('已保存到本地');
    } catch (error: any) {
      Toast.error(error?.message || `保存失败：${current.fileName}`);
    } finally {
      setSavingDownloadId((prev) => (prev === current.downloadId ? null : prev));
    }
  }, [activeDownload, closeActiveDownload]);

  return {
    activeDownload,
    importLoading: importingDownloadId === activeDownload?.downloadId,
    savingLoading: savingDownloadId === activeDownload?.downloadId,
    importActiveDownload,
    saveActiveDownloadToDesktop,
    closeActiveDownload,
  };
}
