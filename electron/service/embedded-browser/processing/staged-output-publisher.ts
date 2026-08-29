import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { StagedOutputLeaseStore } from './staged-output-lease'

export type StagedOutputPublishResult = {
  leaseId: string
  outputPath: string
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

async function publishClaimedOutput(sourcePath: string, targetPath: string) {
  const targetDirectory = path.dirname(targetPath)
  await mkdir(targetDirectory, { recursive: true })
  try {
    await rm(targetPath, { force: true })
    await rename(sourcePath, targetPath)
    return
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      throw error
    }
  }

  const publishDirectory = await mkdtemp(path.join(targetDirectory, '.omniflow-output-publish-'))
  const publishPath = path.join(publishDirectory, 'payload')
  try {
    await copyFile(sourcePath, publishPath)
    await rm(targetPath, { force: true })
    await rename(publishPath, targetPath)
    await rm(sourcePath, { force: true })
  } finally {
    await rm(publishDirectory, { force: true, recursive: true }).catch(() => undefined)
  }
}

/** Owns one processing output until it is claimed and published to its final destination. */
export async function publishStagedOutput(
  input: StagedOutputPublishInput,
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
    const claim = input.store.claim(lease.leaseId, `delivery-${randomUUID()}`)
    if (!claim) {
      throw new Error('输出暂存已过期，无法交付')
    }
    claimId = claim.claimId
    const claimedPath = input.store.resolvePath(lease.leaseId, input.ownerTaskId)
    if (!claimedPath) {
      throw new Error('输出暂存不存在或不属于当前任务')
    }
    await publishClaimedOutput(claimedPath, targetPath)
    await input.store.release(lease.leaseId, claimId)
    claimId = undefined
    return {
      leaseId: lease.leaseId,
      outputPath: targetPath,
    }
  } catch (error) {
    await input.store.release(lease.leaseId, claimId).catch(() => undefined)
    throw error
  }
}
