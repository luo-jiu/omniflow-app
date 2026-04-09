import { uploadManager, type UploadManagerEvent } from '@/utils/uploadManager';
import { runtimeLogger } from '@/utils/runtimeLogger';
import {
  AUTO_IMPORT_MAX_FILES_PER_BATCH,
  getAutoImportEnabled,
  getAutoImportWatchDirectory,
} from './settings';
import {
  claimAutoImportFilesFromDesktop,
  cleanupAutoImportStagedFile,
} from '../services/desktop-auto-import.api';

export interface AutoImportTickParams {
  libraryId: number;
  rootNodeId: number;
  onNodeCreated?: (newNode: unknown) => void;
}

function buildAutoImportGroupId(): string {
  return `auto-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupStagedFileAfterSuccess(event: UploadManagerEvent, groupId: string) {
  if (event.type !== 'task' || event.reason !== 'SUCCESS') {
    return;
  }
  if (event.task.meta.folderGroupId !== groupId) {
    return;
  }
  const stagedPath = event.task.meta.localPath;
  if (!stagedPath) {
    return;
  }
  await cleanupAutoImportStagedFile(stagedPath);
}

export async function runAutoImportTick(params: AutoImportTickParams): Promise<void> {
  if (!getAutoImportEnabled()) {
    return;
  }

  const watchDirectory = getAutoImportWatchDirectory();

  const files = await claimAutoImportFilesFromDesktop(
    watchDirectory,
    AUTO_IMPORT_MAX_FILES_PER_BATCH,
  );
  if (!files.length) {
    return;
  }

  const groupId = buildAutoImportGroupId();
  const tasks = files.map((item) => ({
    file: item.file,
    parentId: params.rootNodeId,
    libraryId: params.libraryId,
    relativePath: item.relativePath,
    folderGroupId: groupId,
  }));

  uploadManager.createBatch(tasks, {
    onSingleSuccess: params.onNodeCreated,
    onEvent: (event) => {
      void cleanupStagedFileAfterSuccess(event, groupId).catch((error) => {
        runtimeLogger.warn('cleanup auto-import staged file failed', error);
      });
    },
  });
}
