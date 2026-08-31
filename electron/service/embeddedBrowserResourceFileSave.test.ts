import { mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { saveEmbeddedBrowserExtractedResourceFile } from './embeddedBrowserResourceFileSaveService'

async function waitForPartialFile(filePath: string, fullSize: number) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const metadata = await stat(filePath).catch(() => null)
    if (metadata && metadata.size > 0 && metadata.size < fullSize) {
      return metadata.size
    }
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('resource copy did not expose an in-flight partial file')
}

describe('EmbeddedBrowser extracted resource file save', () => {
  it('copies a file-backed resource without materializing it as base64', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-resource-save-'))
    const sourcePath = path.join(directory, 'source.bin')
    const outputPath = path.join(directory, 'output.bin')
    try {
      await writeFile(sourcePath, Buffer.from([1, 2, 3, 4]))
      await saveEmbeddedBrowserExtractedResourceFile({
        fileName: 'source.bin',
        filePath: sourcePath,
      }, outputPath)
      await expect(readFile(outputPath)).resolves.toEqual(Buffer.from([1, 2, 3, 4]))
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('mse.file-backed-output-cancel-interrupts-copy', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-resource-save-'))
    const sourcePath = path.join(directory, 'large-source.bin')
    const outputPath = path.join(directory, 'partial-output.bin')
    const sourceBytes = 256 * 1024 * 1024
    const controller = new AbortController()
    try {
      await writeFile(sourcePath, '')
      await truncate(sourcePath, sourceBytes)
      const operation = saveEmbeddedBrowserExtractedResourceFile({
        fileName: 'large-source.bin',
        filePath: sourcePath,
      }, outputPath, { signal: controller.signal })
      const partialBytes = await waitForPartialFile(outputPath, sourceBytes)
      controller.abort()

      await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      expect(partialBytes).toBeGreaterThan(0)
      await expect(stat(outputPath)).resolves.toMatchObject({
        size: expect.any(Number),
      })
      expect((await stat(outputPath)).size).toBeLessThan(sourceBytes)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 10_000)
})
