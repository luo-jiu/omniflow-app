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

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
  },
}))

import { processMediaToolFile } from './mediaToolFfmpegService'

function createFakeFfmpegChild() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter
    stdout: EventEmitter
  }
  child.stderr = new EventEmitter()
  child.stdout = new EventEmitter()
  return child
}

describe('media tool ffmpeg output handoff', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('returns success only after a non-empty output exists', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-media-tool-success-test-'))
    const outputPath = path.join(directory, 'clip-audio.m4a')
    spawnMock.mockImplementation(() => {
      const child = createFakeFfmpegChild()
      queueMicrotask(() => {
        void writeFile(outputPath, Buffer.from('encoded-output')).then(() => child.emit('exit', 0))
      })
      return child
    })

    try {
      const result = await processMediaToolFile({
        ffmpegPath: process.execPath,
        inputFileName: 'clip.mp4',
        inputUrl: 'https://media.example/clip.mp4',
        operation: 'extract-audio',
        outputDirectoryPath: directory,
      })
      expect(result).toMatchObject({
        ffmpegPath: process.execPath,
        ok: true,
        outputPath,
      })
      await expect(readFile(outputPath)).resolves.toEqual(Buffer.from('encoded-output'))
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('returns failure and removes partial output on ffmpeg failure', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-media-tool-failure-test-'))
    const outputPath = path.join(directory, 'clip-compressed.mp4')
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
      const result = await processMediaToolFile({
        ffmpegPath: process.execPath,
        inputFileName: 'clip.mp4',
        inputUrl: 'https://media.example/clip.mp4',
        operation: 'compress-video',
        outputDirectoryPath: directory,
      })
      expect(result).toMatchObject({
        error: 'invalid media',
        ffmpegPath: process.execPath,
        ok: false,
        outputPath,
      })
      await expect(readFile(outputPath)).rejects.toThrow()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
