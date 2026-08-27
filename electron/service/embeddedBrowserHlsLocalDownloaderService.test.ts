import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import {
  downloadEmbeddedBrowserHlsToLocalWorkDirectory,
} from './embeddedBrowserHlsLocalDownloaderService'

function createPlan() {
  return {
    fragments: [{
      discontinuitySequence: 0,
      duration: 1,
      index: 0,
      part: false,
      sequence: 1,
      url: 'https://media.example/segment.ts',
    }],
    manifestUrl: 'https://media.example/playlist.m3u8',
  }
}

describe('EmbeddedBrowser HLS local downloader', () => {
  it('writes preprocessed fragment bytes while preserving the default raw path', async () => {
    const imagePrefix = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47,
      0x49, 0x45, 0x4e, 0x44,
      0x00, 0x00, 0x00, 0x00,
    ])
    const mediaBytes = Uint8Array.from([0x47, 0x01, 0x02, 0x03])
    const rawBytes = new Uint8Array(imagePrefix.byteLength + mediaBytes.byteLength)
    rawBytes.set(imagePrefix, 0)
    rawBytes.set(mediaBytes, imagePrefix.byteLength)
    const fetchImpl = vi.fn(async () => new Response(rawBytes.buffer))
    const preprocessedDirectory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-preprocess-test-'))
    const rawDirectory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-raw-test-'))

    try {
      const preprocessedResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan: createPlan(),
        preprocessFragments: true,
        workDirectoryPath: preprocessedDirectory,
      })
      const rawResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan: createPlan(),
        workDirectoryPath: rawDirectory,
      })

      await expect(readFile(path.join(preprocessedResult.workDirectoryPath, 'segments', '00001.ts')))
        .resolves.toEqual(Buffer.from(mediaBytes))
      await expect(readFile(path.join(rawResult.workDirectoryPath, 'segments', '00001.ts')))
        .resolves.toEqual(Buffer.from(rawBytes))
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      await Promise.all([
        rm(preprocessedDirectory, { force: true, recursive: true }),
        rm(rawDirectory, { force: true, recursive: true }),
      ])
    }
  })
})
