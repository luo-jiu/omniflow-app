import React from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { uploadManager } from '@/utils/uploadManager';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { UPLOAD_TASK_STATUS } from '@/modules/upload-center/model/upload-task.types';
import {
  cleanupEmbeddedBrowserDownloadedFile,
  saveEmbeddedBrowserDownloadToDesktop,
} from '../services/embedded-browser-download.api';
import type { EmbeddedBrowserDownloadEvent, LibraryFolderEntry } from '../types';
import { capturedOutputWorkflowCoordinator } from '../../workflows/captured-output-workflow-coordinator';

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
    capturedOutputWorkflowCoordinator.subscribe,
    capturedOutputWorkflowCoordinator.getSnapshot,
    capturedOutputWorkflowCoordinator.getSnapshot,
  );
  const [importingDownloadId, setImportingDownloadId] = React.useState<string | null>(null);
  const [savingDownloadId, setSavingDownloadId] = React.useState<string | null>(null);
  const activeItem = queue[0] ?? null;
  const activeDownload = activeItem?.download ?? null;

  React.useEffect(() => {
    return capturedOutputWorkflowCoordinator.subscribeEvents((payload) => {
      if (payload.state === 'cancelled' || payload.state === 'failed') {
        Toast.error(payload.error || `下载失败：${payload.fileName}`);
      }
    });
  }, []);

  const closeActiveDownload = React.useCallback(async (options?: { discardFile?: boolean }) => {
    const current = activeItem;
    const dismissed = current
      ? capturedOutputWorkflowCoordinator.dismiss(current.download.downloadId)
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
      const success = await capturedOutputWorkflowCoordinator.runDelivery(
        current.download.downloadId,
        'importing',
        async () => {
          const file = toUploadFile(current.download);
          const batch = uploadManager.createBatch([{
            file,
            libraryId,
            parentId: targetFolder.id,
            relativePath: current.download.fileName,
          }]);
          const results = await batch.done;
          return results.some((item) => item.taskStatus === UPLOAD_TASK_STATUS.SUCCESS);
        },
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
      const success = await capturedOutputWorkflowCoordinator.runDelivery(
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
