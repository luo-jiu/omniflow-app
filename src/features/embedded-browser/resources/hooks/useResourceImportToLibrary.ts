import React from 'react'
import { Toast } from '@douyinfe/semi-ui'

import { UPLOAD_TASK_STATUS } from '@/modules/upload-center/model/upload-task.types'
import { uploadManager } from '@/utils/uploadManager'

import {
  cleanupTempImportPath,
  createTempImportDirectory,
  getTempImportFileInfo,
} from '../services/resource-import-file.api'

type FileWithPath = File & { path: string }

type UseResourceImportToLibraryInput = {
  libraryId: number
  onImportSuccess?: (payload: { parentId: number }) => Promise<void> | void
}

function toUploadFile(input: {
  name: string
  path: string
  size: number
}): FileWithPath {
  return {
    name: input.name,
    path: input.path,
    size: input.size,
    type: '',
  } as FileWithPath
}

export function useResourceImportToLibrary(input: UseResourceImportToLibraryInput) {
  const { libraryId, onImportSuccess } = input
  const [importingOutputPath, setImportingOutputPath] = React.useState<string | null>(null)

  const createTaskTempImportDirectory = React.useCallback(async () => {
    return await createTempImportDirectory()
  }, [])

  const cleanupTaskTempImportDirectory = React.useCallback(async (directoryPath: string) => {
    const normalizedDirectoryPath = String(directoryPath || '').trim()
    if (!normalizedDirectoryPath) {
      return false
    }
    return await cleanupTempImportPath(normalizedDirectoryPath).catch(() => false)
  }, [])

  const importOutputToLibrary = React.useCallback(async (
    outputPath: string,
    targetFolder: { id: number; pathLabel: string },
    actionName: string,
  ) => {
    const normalizedOutputPath = String(outputPath || '').trim()
    if (!normalizedOutputPath) {
      throw new Error('缺少可导入的输出文件')
    }

    setImportingOutputPath(normalizedOutputPath)
    try {
      const fileInfo = await getTempImportFileInfo(normalizedOutputPath)
      const batch = uploadManager.createBatch([{
        file: toUploadFile({
          name: fileInfo.name,
          path: fileInfo.filePath,
          size: fileInfo.size,
        }),
        libraryId,
        parentId: targetFolder.id,
        relativePath: fileInfo.name,
      }])
      const results = await batch.done
      const success = results.some((item) => item.taskStatus === UPLOAD_TASK_STATUS.SUCCESS)
      if (!success) {
        throw new Error(`已完成${actionName}，但导入到资源库失败`)
      }

      await cleanupTempImportPath(normalizedOutputPath).catch(() => false)
      const outputDirectoryPath = normalizedOutputPath.replace(/[\\/][^\\/]+$/, '')
      if (outputDirectoryPath && outputDirectoryPath !== normalizedOutputPath) {
        await cleanupTempImportPath(outputDirectoryPath).catch(() => false)
      }
      try {
        await onImportSuccess?.({ parentId: targetFolder.id })
      } catch (error: any) {
        Toast.warning(error?.message || '目录刷新失败，请稍后手动刷新目录树')
      }
      Toast.success(`已完成${actionName}，并导入到资源库：${targetFolder.pathLabel}`)
    } finally {
      setImportingOutputPath((current) => (
        current === normalizedOutputPath ? null : current
      ))
    }
  }, [libraryId, onImportSuccess])

  return {
    cleanupTaskTempImportDirectory,
    createTaskTempImportDirectory,
    importingOutputPath,
    importOutputToLibrary,
  }
}
