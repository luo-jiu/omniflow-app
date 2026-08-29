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

  it('dash.dynamic-drm-rejection', async () => {
    const workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-test-'))
    try {
      const video = representation()
      const mergeTracks = async ({ outputPath }: { outputPath: string }) => ({ outputPath })
      await expect(new DashTaskExecutor({
        mergeTracks,
        outputPath: path.join(workDirectoryPath, 'dynamic.mp4'),
        plan: plan([video], { isDynamic: true }),
        selectedVideoRepresentation: video,
      }).run()).rejects.toThrow('动态 MPD')
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
})
