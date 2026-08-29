import { mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { testUserDataRoot } = vi.hoisted(() => ({
  testUserDataRoot: `${String(process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp')
    .replace(/[\\/]$/, '')}/omniflow-browser-download-test-${process.pid}`,
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataRoot,
  },
  session: {
    defaultSession: {},
    fromPartition: () => ({}),
  },
}))

import { cleanupStaleEmbeddedBrowserDownloadFiles } from './embeddedBrowserService'

afterEach(async () => {
  await rm(testUserDataRoot, { force: true, recursive: true })
})

describe('embeddedBrowserService download staging cleanup', () => {
  it('removes stale files while preserving fresh files and directories', async () => {
    const rootPath = path.join(testUserDataRoot, 'embedded-browser-downloads')
    await mkdir(rootPath, { recursive: true })
    const stalePath = path.join(rootPath, 'stale.mp4')
    const freshPath = path.join(rootPath, 'fresh.mp4')
    const nestedPath = path.join(rootPath, 'unexpected-directory')
    await Promise.all([
      writeFile(stalePath, 'stale'),
      writeFile(freshPath, 'fresh'),
      mkdir(nestedPath),
    ])
    const now = Date.now()
    const staleDate = new Date(now - 25 * 60 * 60 * 1000)
    await utimes(stalePath, staleDate, staleDate)

    await expect(cleanupStaleEmbeddedBrowserDownloadFiles({
      now,
      rootPath,
      staleAfterMs: 24 * 60 * 60 * 1000,
    })).resolves.toBe(1)
    await expect(readdir(rootPath).then(entries => entries.sort())).resolves.toEqual([
      'fresh.mp4',
      'unexpected-directory',
    ])
  })

  it('treats a missing staging root as already clean', async () => {
    await expect(cleanupStaleEmbeddedBrowserDownloadFiles({
      rootPath: path.join(testUserDataRoot, 'missing'),
    })).resolves.toBe(0)
  })
})
