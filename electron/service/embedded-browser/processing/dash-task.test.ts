import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { DashTaskExecutor, type DashTaskPlan } from './dash-task'
import type { DashRepresentation } from '../cat-catch-port/dash/parser'

function representation(overrides: Partial<DashRepresentation> = {}): DashRepresentation {
  return {
    baseUrls: ['https://cdn.example/'],
    contentType: 'video',
    id: 'video-1',
    segmentCount: 2,
    segments: [
      { byteRange: { length: 100, offset: 0, raw: '0-99' }, index: 0, url: 'https://cdn.example/one.m4s' },
      { index: 1, url: 'https://cdn.example/two.m4s' },
    ],
    unsupportedReasons: [],
    ...overrides,
  }
}

function plan(representations: DashRepresentation[], overrides: Partial<DashTaskPlan> = {}): DashTaskPlan {
  return {
    hasDrm: false,
    manifestUrl: 'https://cdn.example/manifest.mpd',
    representations,
    ...overrides,
  }
}

function createSidxBytes() {
  const bytes = new Uint8Array(56)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.byteLength, false)
  bytes.set([0x73, 0x69, 0x64, 0x78], 4)
  view.setUint32(12, 1, false)
  view.setUint32(16, 1000, false)
  view.setUint32(20, 0, false)
  view.setUint32(24, 0, false)
  view.setUint16(28, 0, false)
  view.setUint16(30, 2, false)
  view.setUint32(32, 0x00000004, false)
  view.setUint32(36, 1000, false)
  view.setUint32(40, 0x90000000, false)
  view.setUint32(44, 0x00000005, false)
  view.setUint32(48, 2000, false)
  view.setUint32(52, 0x90000000, false)
  return bytes
}

describe('DASH task executor', () => {
  it('dash.download-merge-cancel', async () => {
    const workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-test-'))
    const outputPath = path.join(workDirectoryPath, 'output.mp4')
    const video = representation()
    const audio = representation({
      contentType: 'audio',
      id: 'audio-1',
      segments: [{ index: 0, url: 'https://cdn.example/audio.m4s' }],
      segmentCount: 1,
    })
    const calls: Array<{ range?: string; url: string }> = []
    try {
      const executor = new DashTaskExecutor({
        fetch: async (url, init) => {
          calls.push({
            range: new Headers(init?.headers).get('Range') || undefined,
            url,
          })
          return new Response(new Uint8Array([url.includes('audio') ? 3 : 1]))
        },
        mergeTracks: async ({ audio: audioTrack, outputPath: targetPath, video: videoTrack }) => {
          const buffers = await Promise.all([
            videoTrack ? readFile(videoTrack.path) : Buffer.alloc(0),
            audioTrack ? readFile(audioTrack.path) : Buffer.alloc(0),
          ])
          await writeFile(targetPath, Buffer.concat(buffers))
          return { outputPath: targetPath }
        },
        outputPath,
        plan: plan([video, audio]),
        selectedAudioRepresentation: audio,
        selectedVideoRepresentation: video,
      })
      const result = await executor.run()
      expect(result.outputPath).toBe(outputPath)
      expect(await readFile(outputPath)).toEqual(Buffer.from([1, 1, 3]))
      expect(calls).toEqual(expect.arrayContaining([
        { range: 'bytes=0-99', url: 'https://cdn.example/one.m4s' },
      ]))
      await expect(stat(result.workDirectoryPath)).rejects.toThrow()

      const cancelledOutputPath = path.join(workDirectoryPath, 'cancelled.mp4')
      const cancelExecutor = new DashTaskExecutor({
        fetch: async (_url, init) => new Promise<Response>((resolve, reject) => {
          const abortError = new Error('aborted')
          abortError.name = 'AbortError'
          init?.signal?.addEventListener('abort', () => reject(abortError), { once: true })
          setTimeout(() => resolve(new Response(new Uint8Array([1]))), 100)
        }),
        mergeTracks: async ({ outputPath: targetPath }) => ({ outputPath: targetPath }),
        outputPath: cancelledOutputPath,
        plan: plan([video]),
        selectedVideoRepresentation: video,
      })
      const pendingCancellation = cancelExecutor.run()
      setTimeout(() => cancelExecutor.cancel(), 5)
      await expect(pendingCancellation).rejects.toMatchObject({ name: 'AbortError' })
      await expect(stat(cancelledOutputPath)).rejects.toThrow()
    } finally {
      await rm(workDirectoryPath, { force: true, recursive: true })
    }
  })

  it('dash.negative-repeat', async () => {
    const workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-test-'))
    try {
      const unresolved = representation({
        unsupportedReasons: ['segment-timeline-negative-repeat-unbounded'],
      })
      const executor = new DashTaskExecutor({
        mergeTracks: async ({ outputPath }) => ({ outputPath }),
        outputPath: path.join(workDirectoryPath, 'output.mp4'),
        plan: plan([unresolved]),
        selectedVideoRepresentation: unresolved,
      })
      await expect(executor.run()).rejects.toThrow('轨道暂不可下载')
    } finally {
      await rm(workDirectoryPath, { force: true, recursive: true })
    }
  })

  it('dash.segment-base-sidx-task-fetch', async () => {
    const workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-sidx-test-'))
    try {
      const sidx = createSidxBytes()
      const video = representation({
        baseUrls: ['https://cdn.example/video.mp4'],
        id: 'sidx-video',
        segmentBase: {
          indexRange: { length: sidx.byteLength, offset: 0, raw: '0-55' },
        },
        segmentCount: 0,
        segments: [],
      })
      const calls: Array<{ range: string | undefined; url: string }> = []
      const outputPath = path.join(workDirectoryPath, 'output.mp4')
      const executor = new DashTaskExecutor({
        fetch: async (url, init) => {
          const range = new Headers(init?.headers).get('Range') || undefined
          calls.push({ range, url })
          if (range === 'bytes=0-55') return new Response(sidx)
          return new Response(new Uint8Array([range === 'bytes=56-59' ? 2 : 3]))
        },
        mergeTracks: async ({ outputPath: targetPath, video: track }) => {
          await writeFile(targetPath, track ? await readFile(track.path) : Buffer.alloc(0))
          return { outputPath: targetPath }
        },
        outputPath,
        plan: plan([video]),
        selectedVideoRepresentation: video,
      })
      await executor.run()
      expect(await readFile(outputPath)).toEqual(Buffer.from([2, 3]))
      expect(calls).toEqual([
        { range: 'bytes=0-55', url: 'https://cdn.example/video.mp4' },
        { range: 'bytes=56-59', url: 'https://cdn.example/video.mp4' },
        { range: 'bytes=60-64', url: 'https://cdn.example/video.mp4' },
      ])
    } finally {
      await rm(workDirectoryPath, { force: true, recursive: true })
    }
  })

  it('dash.segment-base-nested-sidx-task-fetch', async () => {
    const workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-nested-sidx-test-'))
    try {
      const createSidxBox = (references: Array<{ duration: number; size: number; type?: 0 | 1 }>) => {
        const bytes = new Uint8Array(32 + references.length * 12)
        const view = new DataView(bytes.buffer)
        view.setUint32(0, bytes.byteLength, false)
        bytes.set([0x73, 0x69, 0x64, 0x78], 4)
        view.setUint32(12, 1, false)
        view.setUint32(16, 1000, false)
        view.setUint32(20, 0, false)
        view.setUint32(24, 0, false)
        view.setUint16(28, 0, false)
        view.setUint16(30, references.length, false)
        references.forEach((reference, index) => {
          const offset = 32 + index * 12
          view.setUint32(offset, (reference.type ? 0x80000000 : 0) | reference.size, false)
          view.setUint32(offset + 4, reference.duration, false)
          view.setUint32(offset + 8, 0x90000000, false)
        })
        return bytes
      }
      const nestedSidx = createSidxBox([
        { duration: 1000, size: 3 },
        { duration: 1000, size: 2 },
      ])
      const topSidx = createSidxBox([{ duration: 2000, size: nestedSidx.byteLength, type: 1 }])
      const outputPath = path.join(workDirectoryPath, 'output.mp4')
      const calls: string[] = []
      const video = representation({
        baseUrls: ['https://cdn.example/nested-video.mp4'],
        id: 'nested-sidx-video',
        segmentBase: {
          indexRange: { length: topSidx.byteLength, offset: 0, raw: `0-${topSidx.byteLength - 1}` },
        },
        segmentCount: 0,
        segments: [],
      })
      const executor = new DashTaskExecutor({
        fetch: async (_url, init) => {
          const range = new Headers(init?.headers).get('Range') || ''
          calls.push(range)
          if (range === `bytes=0-${topSidx.byteLength - 1}`) return new Response(topSidx)
          if (range === `bytes=${topSidx.byteLength}-${topSidx.byteLength + nestedSidx.byteLength - 1}`) {
            return new Response(nestedSidx)
          }
          if (range === 'bytes=100-102') return new Response(new Uint8Array([7, 8, 9]))
          if (range === 'bytes=103-104') return new Response(new Uint8Array([10, 11]))
          throw new Error(`unexpected range ${range}`)
        },
        mergeTracks: async ({ outputPath: targetPath, video: track }) => {
          await writeFile(targetPath, track ? await readFile(track.path) : Buffer.alloc(0))
          return { outputPath: targetPath }
        },
        outputPath,
        plan: plan([video]),
        selectedVideoRepresentation: video,
      })

      await executor.run()

      expect(await readFile(outputPath)).toEqual(Buffer.from([7, 8, 9, 10, 11]))
      expect(calls).toEqual(expect.arrayContaining([
        `bytes=0-${topSidx.byteLength - 1}`,
        `bytes=${topSidx.byteLength}-${topSidx.byteLength + nestedSidx.byteLength - 1}`,
        'bytes=100-102',
        'bytes=103-104',
      ]))
    } finally {
      await rm(workDirectoryPath, { force: true, recursive: true })
    }
  })

  it('dash.dynamic-drm-rejection', async () => {
    const workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-test-'))
    try {
      const video = representation()
      const mergeTracks = async ({ outputPath }: { outputPath: string }) => ({ outputPath })
      await expect(new DashTaskExecutor({
        mergeTracks,
        outputPath: path.join(workDirectoryPath, 'dynamic.mp4'),
        plan: plan([representation({ segments: [], segmentCount: 0 })], { isDynamic: true }),
        selectedVideoRepresentation: representation({ segments: [], segmentCount: 0 }),
      }).run()).rejects.toThrow('当前窗口没有可下载分片')
      await expect(new DashTaskExecutor({
        mergeTracks,
        outputPath: path.join(workDirectoryPath, 'drm.mp4'),
        plan: plan([video], { hasDrm: true }),
        selectedVideoRepresentation: video,
      }).run()).rejects.toThrow('DRM')
    } finally {
      await rm(workDirectoryPath, { force: true, recursive: true })
    }
  })

  it('dash.dynamic-snapshot-download', async () => {
    const workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-dynamic-test-'))
    try {
      const video = representation({
        id: 'dynamic-video',
        segments: [
          { duration: 2, index: 0, number: 17, time: 32, url: 'https://cdn.example/live-17.m4s' },
          { duration: 2, index: 1, number: 18, time: 34, url: 'https://cdn.example/live-18.m4s' },
        ],
        segmentCount: 2,
      })
      const outputPath = path.join(workDirectoryPath, 'dynamic.mp4')
      const calls: string[] = []
      const executor = new DashTaskExecutor({
        fetch: async (url) => {
          calls.push(url)
          return new Response(new Uint8Array([url.endsWith('17.m4s') ? 7 : 8]))
        },
        mergeTracks: async ({ outputPath: targetPath, video: track }) => {
          await writeFile(targetPath, track ? await readFile(track.path) : Buffer.alloc(0))
          return { outputPath: targetPath }
        },
        outputPath,
        plan: plan([video], { isDynamic: true }),
        selectedVideoRepresentation: video,
      })

      const result = await executor.run()

      expect(result.outputPath).toBe(outputPath)
      expect(await readFile(outputPath)).toEqual(Buffer.from([7, 8]))
      expect([...calls].sort()).toEqual([
        'https://cdn.example/live-17.m4s',
        'https://cdn.example/live-18.m4s',
      ].sort())
    } finally {
      await rm(workDirectoryPath, { force: true, recursive: true })
    }
  })
})
