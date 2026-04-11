import { useCallback, useState } from 'react';
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
import { normalizeUploadRelativePath, UploadPathResolver } from '@/features/file-explorer/services/upload-path-resolver';

type UploadModalTargetNode = {
  id: number;
  key: string;
  label: string;
  libraryId: number;
};

type UseDirectoryUploadArgs = {
  libraryId: number;
  onUploadSuccess?: (parentNode: any, newNode: any) => void;
  resolveParentNodeForAppend: (parentId: number) => any | null;
  resolveRootParentId: () => number | null;
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

export function useDirectoryUpload({
  libraryId,
  onUploadSuccess,
  resolveParentNodeForAppend,
  resolveRootParentId,
  rootNodeId,
}: UseDirectoryUploadArgs) {
  const [uploadModal, setUploadModal] = useState<{
    visible: boolean;
    files: UploadCandidateFile[];
    targetNode: UploadModalTargetNode | null;
    loading: boolean;
  }>({
    visible: false,
    files: [],
    targetNode: null,
    loading: false,
  });

  const toUploadModalTargetNode = useCallback((node: any | null): UploadModalTargetNode | null => {
    if (!node) {
      const rootParentId = resolveRootParentId();
      if (rootParentId === null) return null;
      return {
        id: rootParentId,
        key: 'root',
        label: '根目录',
        libraryId,
      };
    }
    const fallbackId = rootNodeId !== null ? rootNodeId : Number(node.id);
    return {
      id: Number(node.id || fallbackId),
      key: String(node.key || 'root'),
      label: String(node.label || node.data?.rawName || '根目录'),
      libraryId: Number(node.libraryId || libraryId),
    };
  }, [libraryId, resolveRootParentId, rootNodeId]);

  const buildUploadCandidateFromDragFile = useCallback((file: File): UploadCandidateFile => {
    const rawRelativePath = (file as any).webkitRelativePath || file.name;
    const relativePath = normalizeUploadRelativePath(rawRelativePath || file.name);
    return {
      file,
      relativePath: relativePath || file.name,
    };
  }, []);

  const openUploadModal = useCallback((targetNode: UploadModalTargetNode, files: UploadCandidateFile[]) => {
    if (!files.length) {
      Toast.warning('未选择可上传文件');
      return;
    }
    setUploadModal({
      visible: true,
      files,
      targetNode,
      loading: false,
    });
  }, []);

  const handleExternalDropOnFolder = useCallback((treeNode: any, e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;

    requestDesktopWindowActivation(true);
    const candidates = files
      .map(buildUploadCandidateFromDragFile)
      .filter(candidate => !isIgnoredSystemFilePath(candidate.relativePath || candidate.file.name));
    if (!candidates.length) {
      Toast.warning('拖拽内容仅包含系统隐藏文件，已忽略');
      return;
    }
    const targetNode = toUploadModalTargetNode(treeNode);
    if (!targetNode) {
      return;
    }
    openUploadModal(targetNode, candidates);
  }, [buildUploadCandidateFromDragFile, openUploadModal, toUploadModalTargetNode]);

  const startUploadInBackground = useCallback(async (
    files: UploadCandidateFile[],
    targetNode: UploadModalTargetNode,
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

    const results = (await Promise.all(donePromises)).flat();
    const successCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.SUCCESS).length;
    const failedCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.FAILED).length;
    const canceledCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.CANCELED).length;

    if (failedCount === 0 && canceledCount === 0) {
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

  const handleConfirmUpload = useCallback(async () => {
    const { files, targetNode } = uploadModal;
    if (!files.length || !targetNode) return;

    setUploadModal({ visible: false, files: [], targetNode: null, loading: false });
    Toast.info(`正在准备上传队列（${files.length} 个文件）`);

    void startUploadInBackground(files, targetNode).catch((error) => {
      runtimeLogger.error('上传执行失败:', error);
      Toast.error((error as any)?.message || '上传过程中出现未知错误');
    });
  }, [startUploadInBackground, uploadModal]);

  const handleCancelUpload = useCallback(() => {
    if (uploadModal.loading) {
      return;
    }
    setUploadModal({ visible: false, files: [], targetNode: null, loading: false });
  }, [uploadModal.loading]);

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
      openUploadModal(targetNode, files);
    } catch (error: any) {
      runtimeLogger.error(`选择${mode === 'file' ? '文件' : '文件夹'}失败:`, error);
      Toast.error(error?.message || `选择${mode === 'file' ? '文件' : '文件夹'}失败`);
    }
  }, [openUploadModal, toUploadModalTargetNode]);

  return {
    handleCancelUpload,
    handleConfirmUpload,
    handleExternalDropOnFolder,
    handlePickUploadFromDesktop,
    uploadModal,
  };
}
