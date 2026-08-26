import { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { requestDesktopWindowActivation } from '@/utils/windowActivation';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { uploadManager } from '@/utils/uploadManager.ts';
import { UPLOAD_TASK_STATUS } from '@/modules/upload-center/model/upload-task.types';
import {
  isIgnoredSystemFilePath,
  pickUploadFilesFromDesktop,
  pickUploadFoldersFromDesktop,
} from '@/features/file-explorer/services/desktop-upload-picker.api';
import type { UploadCandidateFile } from '@/features/file-explorer/services/desktop-upload-picker.api';
import {
  extractExternalBrowserResourceDrop,
  stageExternalBrowserResourceUploadCandidates,
} from '@/features/file-explorer/services/external-browser-resource-upload.api';
import { normalizeUploadRelativePath, UploadPathResolver } from '@/features/file-explorer/services/upload-path-resolver';
import { fetchProviders } from '@/features/storage-config/services/storage-config.api';
import { openOverlaySession } from '@/service/overlay/overlay.api';
import type {
  OverlayStorageProvider,
  OverlayTargetNode,
  UploadConfirmResult,
} from '@/service/overlay/types';
import { resourceMonitorProbeRuntime } from '@/features/resource-monitor/services/resource-monitor-runtime';
import {
  ensureStorageProviderAvailable,
  getStorageProviderProbeStatus,
} from '@/features/resource-monitor/services/storage-provider-health';

type UploadModalTargetNode = OverlayTargetNode;

type UseDirectoryUploadArgs = {
  libraryId: number;
  onUploadSuccess?: (parentNode: any, newNode: any) => void;
  resolveParentNodeForAppend: (parentId: number) => any | null;
  resolveRootParentId: () => number | null;
  resolveTargetPath: (node: any) => string;
  rootNodeId: number | null;
};

const hashString = (input: string): string => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const buildUploadGroupId = (
  relativePath: string,
  fallbackFileName: string,
  localPath: string,
  batchSeed: string,
): string => {
  const segments = String(relativePath || fallbackFileName || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  const rootSegment = segments[0] || fallbackFileName || 'file';
  const normalizedLocalPath = String(localPath || '').replace(/\\/g, '/');
  const suffix = segments.slice(1).join('/');
  const rootLocalPath = suffix && normalizedLocalPath.endsWith(`/${suffix}`)
    ? normalizedLocalPath.slice(0, normalizedLocalPath.length - suffix.length - 1)
    : normalizedLocalPath;
  return `${batchSeed}:${rootSegment}:${hashString(rootLocalPath || normalizedLocalPath || relativePath)}`;
};

const nextMicroTask = () =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });

async function cleanupUploadCandidateTempPaths(files: UploadCandidateFile[]) {
  const cleanupTargets = Array.from(new Set(
    files
      .map((candidate) => String(candidate.cleanupPath || '').trim())
      .filter(Boolean),
  ));
  if (!cleanupTargets.length || !window.electronAPI?.cleanupTempImportPath) {
    return;
  }
  await Promise.all(cleanupTargets.map((targetPath) => (
    window.electronAPI.cleanupTempImportPath(targetPath).catch(() => false)
  )));
}

export function useDirectoryUpload({
  libraryId,
  onUploadSuccess,
  resolveParentNodeForAppend,
  resolveRootParentId,
  resolveTargetPath,
  rootNodeId,
}: UseDirectoryUploadArgs) {
  const toUploadModalTargetNode = useCallback((node: any | null): UploadModalTargetNode | null => {
    if (!node) {
      const rootParentId = resolveRootParentId();
      if (rootParentId === null) return null;
      return {
        id: rootParentId,
        key: 'root',
        label: '根目录',
        libraryId,
        path: '/',
      };
    }
    const fallbackId = rootNodeId !== null ? rootNodeId : Number(node.id);
    return {
      id: Number(node.id || fallbackId),
      key: String(node.key || 'root'),
      label: String(node.label || node.data?.rawName || '根目录'),
      libraryId: Number(node.libraryId || libraryId),
      path: resolveTargetPath(node),
    };
  }, [libraryId, resolveRootParentId, resolveTargetPath, rootNodeId]);

  const buildUploadCandidateFromDragFile = useCallback((file: File): UploadCandidateFile => {
    const rawRelativePath = (file as any).webkitRelativePath || file.name;
    const relativePath = normalizeUploadRelativePath(rawRelativePath || file.name);
    return {
      file,
      relativePath: relativePath || file.name,
    };
  }, []);

  const startUploadInBackground = useCallback(async (
    files: UploadCandidateFile[],
    targetNode: UploadModalTargetNode,
    storageProvider: string,
    onQueuePrepared?: () => void,
  ) => {
    const pathResolver = new UploadPathResolver({
      libraryId: targetNode.libraryId,
      rootParentId: targetNode.id,
      onDirectoryCreated: ({ parentId, newDirectoryNode }) => {
        if (!onUploadSuccess) return;
        const parentNode = resolveParentNodeForAppend(parentId);
        if (!parentNode) return;
        onUploadSuccess(parentNode, newDirectoryNode);
      },
    });

    const CHUNK_SIZE = 120;
    const batchSeed = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const donePromises: Array<Promise<any>> = [];

    for (let start = 0; start < files.length; start += CHUNK_SIZE) {
      const chunk = files.slice(start, start + CHUNK_SIZE);
      const chunkTasks = await Promise.all(
        chunk.map(async (candidate) => {
          const relativePath = normalizeUploadRelativePath(candidate.relativePath || candidate.file.name);
          const parentId = await pathResolver.resolveParentId(relativePath);
          return {
            file: candidate.file,
            parentId,
            libraryId: targetNode.libraryId,
            relativePath,
            storageProvider,
            folderGroupId: buildUploadGroupId(
              relativePath,
              candidate.file.name,
              String((candidate.file as any)?.path || ''),
              batchSeed,
            ),
          };
        }),
      );

      const batch = uploadManager.createBatch(chunkTasks, {
        onSingleSuccess: (newNode) => {
          const parentId = Number((newNode as any)?.parentId || targetNode.id);
          const parentNode = resolveParentNodeForAppend(parentId);
          if (onUploadSuccess && parentNode) {
            onUploadSuccess(parentNode, newNode);
          }
        },
      });
      donePromises.push(batch.done);
      await nextMicroTask();
    }

    onQueuePrepared?.();

    const results = (await Promise.all(donePromises)).flat();
    const successCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.SUCCESS).length;
    const failedCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.FAILED).length;
    const canceledCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.CANCELED).length;

    if (failedCount === 0 && canceledCount === 0) {
      void cleanupUploadCandidateTempPaths(files);
      Toast.success(`成功上传 ${successCount} 个文件`);
    } else if (failedCount === 0 && canceledCount > 0) {
      Toast.info(`上传已中断：成功 ${successCount} 个，中断 ${canceledCount} 个`);
    } else if (successCount > 0 || canceledCount > 0) {
      Toast.warning(
        `部分上传成功：成功 ${successCount} 个，失败 ${failedCount} 个，中断 ${canceledCount} 个`,
      );
    } else {
      Toast.error('全部文件上传失败');
    }
  }, [onUploadSuccess, resolveParentNodeForAppend]);

  const openUploadModal = useCallback(async (
    targetNode: UploadModalTargetNode,
    files: UploadCandidateFile[],
  ) => {
    if (!files.length) {
      Toast.warning('未选择可上传文件');
      return;
    }
    const fileSummaries = files.map((candidate) => ({
      name: candidate.file.name,
      size: Number(candidate.file.size || 0),
      relativePath: candidate.relativePath || candidate.file.name,
    }));

    let providers: OverlayStorageProvider[] = [];
    let defaultProvider = '';
    try {
      const providerData = await fetchProviders();
      defaultProvider = providerData.defaultProvider || '';
      providers = (providerData.providers || []).map((provider) => ({
        alias: provider.alias,
        type: provider.type,
        endpoint: provider.endpoint,
        bucket: provider.bucket,
        label: provider.label,
        useSSL: provider.useSSL,
        healthStatus: getStorageProviderProbeStatus(
          resourceMonitorProbeRuntime.getState().snapshot,
          provider.alias,
        ),
      }));
    } catch (error) {
      runtimeLogger.warn('加载存储 Provider 失败，上传确认弹框将使用后端默认分配:', error);
    }

    const buildOverlayProps = () => ({
      defaultProvider,
      fileSummaries,
      providers: providers.map((provider) => ({
        ...provider,
        healthStatus: getStorageProviderProbeStatus(
          resourceMonitorProbeRuntime.getState().snapshot,
          provider.alias,
        ),
      })),
      targetNode,
    });

    let result: UploadConfirmResult;
    let stopHealthUpdates: (() => void) | null = null;
    try {
      const session = openOverlaySession('upload-confirm', buildOverlayProps());
      stopHealthUpdates = resourceMonitorProbeRuntime.subscribe(() => {
        void session.updateProps(buildOverlayProps()).catch((error) => {
          runtimeLogger.warn('上传确认弹框未能同步存储探活状态:', error);
        });
      });
      resourceMonitorProbeRuntime.start();
      void resourceMonitorProbeRuntime.refresh({ silent: true });
      result = await session.result;
    } catch (error) {
      runtimeLogger.error('上传确认弹框无法打开:', error);
      Toast.error('上传确认弹框无法打开');
      void cleanupUploadCandidateTempPaths(files);
      return;
    } finally {
      stopHealthUpdates?.();
    }

    if (result.type !== 'confirm') {
      void cleanupUploadCandidateTempPaths(files);
      return;
    }
    const availability = await ensureStorageProviderAvailable(result.storageProvider);
    if (!availability.available) {
      Toast.warning(availability.message);
      void cleanupUploadCandidateTempPaths(files);
      return;
    }

    const preparingToastId = Toast.info({
      content: `正在准备上传队列（${files.length} 个文件）`,
      duration: 8,
      showClose: true,
    });
    let preparingToastClosed = false;
    const closePreparingToast = () => {
      if (preparingToastClosed) return;
      preparingToastClosed = true;
      Toast.close(preparingToastId);
    };

    void startUploadInBackground(files, targetNode, result.storageProvider, closePreparingToast)
      .catch((error) => {
        runtimeLogger.error('上传执行失败:', error);
        Toast.error((error as any)?.message || '上传过程中出现未知错误');
        void cleanupUploadCandidateTempPaths(files);
      })
      .finally(closePreparingToast);
  }, [startUploadInBackground]);

  const handleExternalDropOnFolder = useCallback((treeNode: any, e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files || []);
    const browserResourceDrop = files.length > 0
      ? null
      : extractExternalBrowserResourceDrop(e.dataTransfer);
    if (
      !files.length
      && !browserResourceDrop?.sessionId
      && !browserResourceDrop?.fallbackResources.length
    ) {
      Toast.warning('拖拽内容不是可上传文件或可下载网页资源');
      return;
    }

    requestDesktopWindowActivation(true);
    const targetNode = toUploadModalTargetNode(treeNode);
    if (!targetNode) {
      return;
    }

    if (files.length > 0) {
      const candidates = files
        .map(buildUploadCandidateFromDragFile)
        .filter(candidate => !isIgnoredSystemFilePath(candidate.relativePath || candidate.file.name));
      if (!candidates.length) {
        Toast.warning('拖拽内容仅包含系统隐藏文件，已忽略');
        return;
      }
      void openUploadModal(targetNode, candidates);
      return;
    }

    const preparingToastId = Toast.info({
      content: '正在读取网页拖拽资源',
      duration: 0,
      showClose: false,
    });
    void stageExternalBrowserResourceUploadCandidates(browserResourceDrop!)
      .then((candidates) => {
        if (!candidates.length) {
          Toast.warning('未获取到可上传的网页资源');
          return;
        }
        void openUploadModal(targetNode, candidates);
      })
      .catch((error) => {
        runtimeLogger.warn('网页资源拖拽导入失败:', error);
        Toast.error((error as any)?.message || '网页资源读取失败');
      })
      .finally(() => Toast.close(preparingToastId));
  }, [buildUploadCandidateFromDragFile, openUploadModal, toUploadModalTargetNode]);

  const handlePickUploadFromDesktop = useCallback(async (mode: 'file' | 'folder', node: any | null) => {
    try {
      requestDesktopWindowActivation(true);
      const targetNode = toUploadModalTargetNode(node);
      if (!targetNode) {
        return;
      }
      const files = mode === 'file'
        ? await pickUploadFilesFromDesktop()
        : await pickUploadFoldersFromDesktop();
      if (!files.length) {
        return;
      }
      await openUploadModal(targetNode, files);
    } catch (error: any) {
      runtimeLogger.error(`选择${mode === 'file' ? '文件' : '文件夹'}失败:`, error);
      Toast.error(error?.message || `选择${mode === 'file' ? '文件' : '文件夹'}失败`);
    }
  }, [openUploadModal, toUploadModalTargetNode]);

  return {
    handleExternalDropOnFolder,
    handlePickUploadFromDesktop,
  };
}
