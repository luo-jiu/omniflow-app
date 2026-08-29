import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

import {
  mergeEmbeddedBrowserResourceTracks,
  transcodeEmbeddedBrowserResource,
} from './embeddedBrowserResourceMergeService'

function createFakeFfmpegChild() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter
    stdout: EventEmitter
  }
  child.stderr = new EventEmitter()
  child.stdout = new EventEmitter()
  return child
}

function createMergeRequest(outputPath: string) {
  return {
    audio: {
      base64: Buffer.from('audio-track').toString('base64'),
      fileName: 'fixture-audio.mp4',
      mimeType: 'audio/mp4',
      streamType: 'audio' as const,
    },
    ffmpegPath: process.execPath,
    outputPath,
    video: {
      base64: Buffer.from('video-track').toString('base64'),
      fileName: 'fixture-video.mp4',
      mimeType: 'video/mp4',
      streamType: 'video' as const,
    },
  }
}

function createTranscodeRequest(outputPath: string) {
  return {
    ffmpegPath: process.execPath,
    outputFormat: 'mp4',
    outputPath,
    resource: {
      base64: Buffer.from('media-track').toString('base64'),
      fileName: 'fixture-media.mp4',
      mimeType: 'video/mp4',
      resourceKey: 'resource-1',
      streamType: 'video' as const,
    },
  }
}

describe('EmbeddedBrowser MSE merge output handoff', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('mse.merge-failure-cleans-partial-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-merge-failure-test-'))
    const outputPath = path.join(directory, 'partial.mp4')
    spawnMock.mockImplementation(() => {
      const child = createFakeFfmpegChild()
      queueMicrotask(() => {
        void writeFile(outputPath, Buffer.from('partial-output')).then(() => {
          child.stderr.emit('data', 'invalid media')
          child.emit('exit', 1)
        })
      })
      return child
    })

    try {
      await expect(mergeEmbeddedBrowserResourceTracks(createMergeRequest(outputPath)))
        .rejects.toThrow('invalid media')
      await expect(readFile(outputPath)).rejects.toThrow()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('mse.merge-success-requires-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-merge-missing-test-'))
    const outputPath = path.join(directory, 'missing.mp4')
    spawnMock.mockImplementation(() => {
      const child = createFakeFfmpegChild()
      queueMicrotask(() => {
        child.emit('exit', 0)
      })
      return child
    })

    try {
      await expect(mergeEmbeddedBrowserResourceTracks(createMergeRequest(outputPath)))
        .rejects.toThrow('没有生成可用的输出文件')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('output.transcode-failure-cleans-partial-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-transcode-failure-test-'))
    const outputPath = path.join(directory, 'partial.mp4')
    spawnMock.mockImplementation(() => {
      const child = createFakeFfmpegChild()
      queueMicrotask(() => {
        void writeFile(outputPath, Buffer.from('partial-output')).then(() => {
          child.stderr.emit('data', 'invalid transcode')
          child.emit('exit', 1)
        })
      })
      return child
    })

    try {
      await expect(transcodeEmbeddedBrowserResource(createTranscodeRequest(outputPath)))
        .rejects.toThrow('invalid transcode')
      await expect(readFile(outputPath)).rejects.toThrow()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('output.transcode-success-requires-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-transcode-missing-test-'))
    const outputPath = path.join(directory, 'missing.mp4')
    spawnMock.mockImplementation(() => {
      const child = createFakeFfmpegChild()
      queueMicrotask(() => {
        child.emit('exit', 0)
      })
      return child
    })

    try {
      await expect(transcodeEmbeddedBrowserResource(createTranscodeRequest(outputPath)))
        .rejects.toThrow('没有生成可用的输出文件')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
