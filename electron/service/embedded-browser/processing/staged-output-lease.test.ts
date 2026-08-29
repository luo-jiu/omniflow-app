import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { StagedOutputLeaseStore } from './staged-output-lease'

async function createStore(now: () => number) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-output-lease-test-'))
  return {
    rootPath,
    store: new StagedOutputLeaseStore({ now, rootPath, ttlMs: 100 }),
  }
}

describe('StagedOutputLeaseStore', () => {
  it('creates an owner-scoped path and permits one delivery claim', async () => {
    const harness = await createStore(() => 1_000)
    try {
      const lease = await harness.store.create({
        fileName: '../video.mp4',
        mimeType: 'video/mp4',
        ownerTaskId: 'task-1',
        purpose: 'library-delivery',
      })
      await writeFile(lease.path, 'payload')

      expect(lease.path.startsWith(path.join(harness.rootPath, lease.leaseId))).toBe(true)
      expect(harness.store.resolvePath(lease.leaseId, 'other-task')).toBeNull()
      expect(harness.store.getSnapshot()[0]).toMatchObject({
        fileName: '.._video.mp4',
        ownerTaskId: 'task-1',
        state: 'staged',
      })

      const claim = harness.store.claim(lease.leaseId, 'delivery-1')
      expect(claim).toMatchObject({ leaseId: lease.leaseId, metadata: { fileName: '.._video.mp4' } })
      expect(harness.store.claim(lease.leaseId, 'delivery-2')).toBeNull()
      expect(harness.store.touch(lease.leaseId, claim!.claimId)).toBe(true)
      expect(harness.store.touch(lease.leaseId, 'wrong-claim')).toBe(false)
    } finally {
      await rm(harness.rootPath, { force: true, recursive: true })
    }
  })

  it('reaps expired staged and claimed files without exposing their paths in snapshots', async () => {
    let now = 1_000
    const harness = await createStore(() => now)
    try {
      const staged = await harness.store.create({
        fileName: 'staged.bin',
        ownerTaskId: 'task-1',
        purpose: 'local-save',
      })
      const claimed = await harness.store.create({
        fileName: 'claimed.bin',
        ownerTaskId: 'task-2',
        purpose: 'external-tool',
      })
      harness.store.claim(claimed.leaseId, 'delivery-1')
      await Promise.all([
        writeFile(staged.path, 'staged'),
        writeFile(claimed.path, 'claimed'),
      ])
      now = 1_101

      expect(harness.store.getSnapshot().every(snapshot => !('path' in snapshot))).toBe(true)
      await expect(harness.store.reapExpired()).resolves.toBe(2)
      await expect(readFile(staged.path)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(claimed.path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(harness.store.getSnapshot()).toEqual([])
    } finally {
      await rm(harness.rootPath, { force: true, recursive: true })
    }
  })

  it('requires the claim token to release a claimed output', async () => {
    const harness = await createStore(() => 1_000)
    try {
      const lease = await harness.store.create({
        fileName: 'output.bin',
        ownerTaskId: 'task-1',
        purpose: 'library-delivery',
      })
      const claim = harness.store.claim(lease.leaseId, 'delivery-1')
      await writeFile(lease.path, 'payload')

      await expect(harness.store.release(lease.leaseId, 'wrong-claim')).resolves.toBe(false)
      await expect(harness.store.release(lease.leaseId, claim!.claimId)).resolves.toBe(true)
      await expect(readFile(lease.path)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(harness.rootPath, { force: true, recursive: true })
    }
  })

  it('quarantines orphaned lease directories without touching unknown entries', async () => {
    const harness = await createStore(() => 1_000)
    const orphanPath = path.join(harness.rootPath, 'output-lease-crashed')
    const unknownPath = path.join(harness.rootPath, 'keep-me')
    try {
      await mkdir(orphanPath, { recursive: true })
      await writeFile(path.join(orphanPath, 'payload'), 'crashed')
      await mkdir(unknownPath, { recursive: true })
      await writeFile(path.join(unknownPath, 'payload'), 'keep')

      await expect(harness.store.quarantineOrphaned()).resolves.toBe(1)
      await expect(readdir(harness.rootPath)).resolves.toEqual(['keep-me'])
      await expect(readFile(path.join(unknownPath, 'payload'), 'utf8')).resolves.toBe('keep')
    } finally {
      await rm(harness.rootPath, { force: true, recursive: true })
    }
  })

  it('rejects crash quarantine while an in-process lease is active', async () => {
    const harness = await createStore(() => 1_000)
    try {
      await harness.store.create({
        fileName: 'active.bin',
        ownerTaskId: 'task-1',
        purpose: 'library-delivery',
      })
      await expect(harness.store.quarantineOrphaned()).rejects.toThrow('活动 lease')
    } finally {
      await rm(harness.rootPath, { force: true, recursive: true })
    }
  })
})
