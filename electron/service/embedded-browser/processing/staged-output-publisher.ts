import { copyFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  createOutputDeliveryTerminal,
  createProcessingTaskTerminal,
  type OutputDeliveryTerminal,
  type ProcessingTaskTerminal,
} from '../contracts/processing-task'
import { StagedOutputLeaseStore } from './staged-output-lease'

export type StagedOutputPublishResult = {
  deliveryTerminal: OutputDeliveryTerminal
  leaseId: string
  outputPath: string
  processingTerminal: ProcessingTaskTerminal
}

export type StagedOutputPublishInput = {
  fileName?: string
  mimeType?: string
  ownerTaskId: string
  purpose: string
  sizeBytes?: number
  store: StagedOutputLeaseStore
  targetPath: string
  write: (stagedPath: string) => Promise<void>
}

export type StagedOutputPublishDependencies = {
  copyFile?: typeof copyFile
  mkdtemp?: typeof mkdtemp
  removeFile?: typeof rm
  renameFile?: typeof rename
  statFile?: typeof stat
}

function normalizeTargetPath(value: unknown) {
  const rawPath = String(value || '').trim()
  const normalizedPath = path.resolve(rawPath)
  if (!rawPath || normalizedPath === path.parse(normalizedPath).root) {
    throw new Error('缺少有效的输出路径')
  }
  return normalizedPath
}

function isCrossDeviceError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EXDEV')
}

async function replaceTemporaryFile(
  sourcePath: string,
  targetPath: string,
  dependencies: StagedOutputPublishDependencies,
) {
  const renameFile = dependencies.renameFile || rename
  const removeFile = dependencies.removeFile || rm
  const statFile = dependencies.statFile || stat
  try {
    await renameFile(sourcePath, targetPath)
    return
  } catch (initialError) {
    const targetStat = await statFile(targetPath).catch(() => null)
    if (!targetStat?.isFile()) {
      throw initialError
    }
  }

  const backupPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.omniflow-${randomUUID()}.backup`,
  )
  await renameFile(targetPath, backupPath)
  try {
    await renameFile(sourcePath, targetPath)
  } catch (replaceError) {
    try {
      await renameFile(backupPath, targetPath)
    } catch {
      throw new Error('输出目标替换失败，原文件已保留为同目录临时备份')
    }
    throw replaceError
  }
  await removeFile(backupPath, { force: true }).catch(() => undefined)
}

async function publishClaimedOutput(
  sourcePath: string,
  targetPath: string,
  dependencies: StagedOutputPublishDependencies,
) {
  const targetDirectory = path.dirname(targetPath)
  await mkdir(targetDirectory, { recursive: true })
  try {
    await replaceTemporaryFile(sourcePath, targetPath, dependencies)
    return
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      throw error
    }
  }

  const publishDirectory = await (dependencies.mkdtemp || mkdtemp)(
    path.join(targetDirectory, '.omniflow-output-publish-'),
  )
  const publishPath = path.join(publishDirectory, 'payload')
  try {
    await (dependencies.copyFile || copyFile)(sourcePath, publishPath)
    await replaceTemporaryFile(publishPath, targetPath, dependencies)
    await (dependencies.removeFile || rm)(sourcePath, { force: true })
  } finally {
    await (dependencies.removeFile || rm)(publishDirectory, { force: true, recursive: true }).catch(() => undefined)
  }
}

/** Owns one processing output until it is claimed and published to its final destination. */
export async function publishStagedOutput(
  input: StagedOutputPublishInput,
  dependencies: StagedOutputPublishDependencies = {},
): Promise<StagedOutputPublishResult> {
  const targetPath = normalizeTargetPath(input.targetPath)
  const lease = await input.store.create({
    fileName: input.fileName || path.basename(targetPath),
    mimeType: input.mimeType,
    ownerTaskId: input.ownerTaskId,
    purpose: input.purpose,
    sizeBytes: input.sizeBytes,
  })
  let claimId: string | undefined
  try {
    await input.write(lease.path)
    const processingTerminal = createProcessingTaskTerminal({
      stagedOutput: {
        fileName: lease.metadata.fileName,
        leaseId: lease.leaseId,
        mimeType: lease.metadata.mimeType,
        sizeBytes: lease.metadata.sizeBytes,
      },
      status: 'success',
      taskId: input.ownerTaskId,
    })
    const claim = input.store.claim(lease.leaseId, `delivery-${randomUUID()}`)
    if (!claim) {
      throw new Error('输出暂存已过期，无法交付')
    }
    claimId = claim.claimId
    const claimedPath = input.store.resolvePath(lease.leaseId, input.ownerTaskId)
    if (!claimedPath) {
      throw new Error('输出暂存不存在或不属于当前任务')
    }
    await publishClaimedOutput(claimedPath, targetPath, dependencies)
    await input.store.release(lease.leaseId, claimId)
    claimId = undefined
    return {
      deliveryTerminal: createOutputDeliveryTerminal({
        processing: processingTerminal,
        status: 'success',
      }),
      leaseId: lease.leaseId,
      outputPath: targetPath,
      processingTerminal,
    }
  } catch (error) {
    await input.store.release(lease.leaseId, claimId).catch(() => undefined)
    throw error
  }
}
