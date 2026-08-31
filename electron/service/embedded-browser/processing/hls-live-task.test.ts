import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { HlsLiveTask } from './hls-live-task'

const MANIFEST_URL = 'https://live.example/channel/index.m3u8'

function createLiveManifest(firstSequence: number, segmentCount = 3) {
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const sequence = firstSequence + index
    return `#EXTINF:2,\nsegment-${sequence}.ts`
  })
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`,
    ...segments,
    '',
  ].join('\n')
}

describe('HLS live task', () => {
  const cleanupDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(cleanupDirectories.splice(0).map(directory => (
      rm(directory, { force: true, recursive: true })
    )))
  })

  it('hls.live-bounded-continuity', async () => {
    const workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-test-'))
    cleanupDirectories.push(workDirectoryPath)
    const snapshotCount = 32
    const manifests = Array.from(
      { length: snapshotCount },
      (_, index) => createLiveManifest(100 + index),
    )
    const scheduledCallbacks: Array<() => void> = []
    const segmentRequests = new Map<number, number>()
    let manifestRequestCount = 0
    const fetch = vi.fn(async (url: string) => {
      if (url === MANIFEST_URL) {
        const manifest = manifests[Math.min(manifestRequestCount, manifests.length - 1)]!
        manifestRequestCount += 1
        return new Response(manifest, {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
          status: 200,
        })
      }
      const match = /segment-(\d+)\.ts$/u.exec(url)
      if (!match) return new Response('not found', { status: 404 })
      const sequence = Number(match[1])
      segmentRequests.set(sequence, (segmentRequests.get(sequence) || 0) + 1)
      return new Response(`fragment-${sequence}`, { status: 200 })
    })
    const task = new HlsLiveTask({
      clearSchedule: (handle) => {
        const callback = handle as unknown as () => void
        const index = scheduledCallbacks.indexOf(callback)
        if (index >= 0) scheduledCallbacks.splice(index, 1)
      },
      fetch,
      manifestUrl: MANIFEST_URL,
      schedule: (callback) => {
        scheduledCallbacks.push(callback)
        return callback as unknown as ReturnType<typeof setTimeout>
      },
      workDirectoryPath,
    })

    await task.start()
    for (let index = 1; index < snapshotCount; index += 1) {
      const callback = scheduledCallbacks.shift()
      expect(callback).toBeDefined()
      callback?.()
      await vi.waitFor(() => {
        expect(manifestRequestCount).toBe(index + 1)
        expect(scheduledCallbacks).toHaveLength(1)
      })
    }

    const result = await task.stop()
    const expectedSegmentCount = snapshotCount + 2
    expect(result).toMatchObject({
      durationSeconds: expectedSegmentCount * 2,
      totalFragments: expectedSegmentCount,
      workDirectoryPath,
    })
    expect(scheduledCallbacks).toHaveLength(0)
    expect(segmentRequests.size).toBe(expectedSegmentCount)
    expect([...segmentRequests.values()]).toEqual(
      Array.from({ length: expectedSegmentCount }, () => 1),
    )
    const playlist = await readFile(result.playlistPath, 'utf8')
    expect(playlist.match(/#EXTINF:/gu)).toHaveLength(expectedSegmentCount)
    expect(playlist).toContain('segments/00001.ts')
    expect(playlist).toContain(`segments/${String(expectedSegmentCount).padStart(5, '0')}.ts`)
    const segmentFiles = (await readdir(path.join(workDirectoryPath, 'segments'))).sort()
    expect(segmentFiles).toHaveLength(expectedSegmentCount)
    await expect(readFile(path.join(workDirectoryPath, 'segments', segmentFiles[0]!)))
      .resolves.toEqual(Buffer.from('fragment-100'))
    await expect(readFile(path.join(workDirectoryPath, 'segments', segmentFiles.at(-1)!)))
      .resolves.toEqual(Buffer.from(`fragment-${100 + expectedSegmentCount - 1}`))
  })
})
