import React from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { uploadManager } from '@/utils/uploadManager';
import {
  createUploadTaskInput,
  freezeUploadDeliveryTarget,
} from '@/modules/upload-center/services/upload-delivery-adapter';
import { runtimeLogger } from '@/utils/runtimeLogger';
import {
  cleanupEmbeddedBrowserDownloadedFile,
  saveEmbeddedBrowserDownloadToDesktop,
} from '../services/embedded-browser-download.api';
import type { EmbeddedBrowserDownloadEvent, LibraryFolderEntry } from '../types';
import { downloadHandoff } from '../services/download-handoff';

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
  const queue = React.useSyncExternalStore(
    downloadHandoff.subscribe,
    downloadHandoff.getSnapshot,
    downloadHandoff.getSnapshot,
  );
  const [importingDownloadId, setImportingDownloadId] = React.useState<string | null>(null);
  const [savingDownloadId, setSavingDownloadId] = React.useState<string | null>(null);
  const activeItem = queue[0] ?? null;
  const activeDownload = activeItem?.download ?? null;

  React.useEffect(() => {
    return downloadHandoff.subscribeEvents((payload) => {
      if (payload.state === 'cancelled' || payload.state === 'failed') {
        Toast.error(payload.error || `下载失败：${payload.fileName}`);
      }
    });
  }, []);

  const closeActiveDownload = React.useCallback(async (options?: { discardFile?: boolean }) => {
    const current = activeItem;
    const dismissed = current
      ? downloadHandoff.dismiss(current.download.downloadId)
      : false;
    if (!dismissed || !current.download.tempPath || !options?.discardFile) {
      return;
    }
    await cleanupEmbeddedBrowserDownloadedFile(current.download.tempPath).catch(() => undefined);
  }, [activeItem]);

  const importActiveDownload = React.useCallback(async (targetFolder: LibraryFolderEntry) => {
    const current = activeItem;
    if (!current?.download.tempPath) {
      await closeActiveDownload();
      return;
    }

    setImportingDownloadId(current.download.downloadId);
    try {
      const file = toUploadFile(current.download);
      const target = freezeUploadDeliveryTarget({
        fileName: current.download.fileName,
        libraryId,
        parentId: targetFolder.id,
        relativePath: current.download.fileName,
      });
      const batch = uploadManager.createBatch([createUploadTaskInput(file, target)]);
      const success = await downloadHandoff.linkUploadTask(
        current.download.downloadId,
        batch,
      );
      if (!success) {
        Toast.error(`导入失败：${current.download.fileName}`);
        return;
      }
      try {
        await options?.onImportSuccess?.({
          download: current.download,
          targetFolder,
        });
      } catch (error) {
        runtimeLogger.warn('浏览器下载导入后刷新目录失败', error);
      }
      Toast.success(`已导入到 ${targetFolder.name}`);
    } catch {
      Toast.error(`导入失败：${current.download.fileName}`);
    } finally {
      setImportingDownloadId((prev) => (prev === current.download.downloadId ? null : prev));
    }
  }, [activeItem, closeActiveDownload, libraryId, options]);

  const saveActiveDownloadToDesktop = React.useCallback(async () => {
    const current = activeItem;
    if (!current?.download.tempPath) {
      await closeActiveDownload();
      return;
    }

    setSavingDownloadId(current.download.downloadId);
    try {
      const success = await downloadHandoff.runDelivery(
        current.download.downloadId,
        'saving',
        async () => {
          const result = await saveEmbeddedBrowserDownloadToDesktop(
            current.download.tempPath as string,
            current.download.fileName,
          );
          return !result.canceled;
        },
      );
      if (success) {
        Toast.success('已保存到本地');
      }
    } catch (error: any) {
      Toast.error(error?.message || `保存失败：${current.download.fileName}`);
    } finally {
      setSavingDownloadId((prev) => (prev === current.download.downloadId ? null : prev));
    }
  }, [activeItem, closeActiveDownload]);

  return {
    activeDownload,
    importLoading: activeItem?.status === 'importing' || importingDownloadId === activeDownload?.downloadId,
    savingLoading: activeItem?.status === 'saving' || savingDownloadId === activeDownload?.downloadId,
    importActiveDownload,
    saveActiveDownloadToDesktop,
    closeActiveDownload,
  };
}
