import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MseSpoolStore } from './mse-spool'

const temporaryDirectories = new Set<string>()

async function createTemporaryRoot() {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-test-'))
  temporaryDirectories.add(directoryPath)
  return directoryPath
}

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map(directoryPath => (
    rm(directoryPath, { force: true, recursive: true })
  )))
  temporaryDirectories.clear()
})

describe('MSE spool store', () => {
  it('mse.lifecycle-cleanup', async () => {
    const temporaryRootPath = await createTemporaryRoot()
    const store = new MseSpoolStore({ temporaryRootPath })
    const first = await store.append({
      chunk: new Uint8Array([1, 2]),
      fileName: 'video.mp4',
      resourceKey: 'mse-stream:video',
      streamType: 'video',
      tabId: 'tab-a',
    })
    const second = await store.append({
      chunk: new Uint8Array([3]),
      fileName: 'audio.m4a',
      resourceKey: 'mse-stream:audio',
      streamType: 'audio',
      tabId: 'tab-b',
    })

    await store.clear({ tabId: 'tab-a' })
    await expect(access(first.filePath)).rejects.toThrow()
    await expect(readFile(second.filePath)).resolves.toEqual(Buffer.from([3]))
    expect(store.getSnapshot()).toEqual({
      fileCount: 1,
      reservedBytes: 0,
      totalBytes: 1,
    })

    await store.dispose()
    await expect(access(second.filePath)).rejects.toThrow()
    expect(store.getSnapshot()).toEqual({
      fileCount: 0,
      reservedBytes: 0,
      totalBytes: 0,
    })
  })

  it('mse.spool-budget-recovery', async () => {
    const temporaryRootPath = await createTemporaryRoot()
    const store = new MseSpoolStore({
      maxChunkBytes: 4,
      maxEntryBytes: 4,
      maxTotalBytes: 4,
      temporaryRootPath,
    })
    await store.append({
      chunk: new Uint8Array([1, 2, 3, 4]),
      resourceKey: 'mse-stream:full',
      tabId: 'tab-budget',
    })
    await expect(store.append({
      chunk: new Uint8Array([5]),
      resourceKey: 'mse-stream:blocked',
      tabId: 'tab-budget',
    })).rejects.toThrow('总量超过安全上限')
    expect(store.getSnapshot()).toMatchObject({ totalBytes: 4 })

    await store.clear({ resourceKey: 'mse-stream:full', tabId: 'tab-budget' })
    const recovered = await store.append({
      chunk: new Uint8Array([5]),
      resourceKey: 'mse-stream:recovered',
      tabId: 'tab-budget',
    })
    await expect(readFile(recovered.filePath)).resolves.toEqual(Buffer.from([5]))
    expect(store.getSnapshot()).toEqual({
      fileCount: 1,
      reservedBytes: 0,
      totalBytes: 1,
    })
    await store.dispose()
  })
})
