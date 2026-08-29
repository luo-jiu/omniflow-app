import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, terminateProcessTreeMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  terminateProcessTreeMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('../../../platform/processTree', () => ({
  terminateDesktopProcessTree: terminateProcessTreeMock,
}))

import { FfmpegTaskExecutor } from './ffmpeg-executor'

function createFakeFfmpegChild() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter
    stdout: EventEmitter
  }
  child.stderr = new EventEmitter()
  child.stdout = new EventEmitter()
  return child
}

describe('FfmpegTaskExecutor lifecycle', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    terminateProcessTreeMock.mockReset()
  })

  it('dispose aborts and waits for active tasks before returning', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-ffmpeg-dispose-test-'))
    const outputPath = path.join(directory, 'partial.mp4')
    const executor = new FfmpegTaskExecutor()
    let child: ReturnType<typeof createFakeFfmpegChild> | undefined
    let releaseChild: (() => void) | undefined
    spawnMock.mockImplementation(() => {
      child = createFakeFfmpegChild()
      terminateProcessTreeMock.mockImplementation((runningChild, options) => {
        if (!options.force) {
          releaseChild = () => runningChild.emit('exit', null)
        }
      })
      return child
    })

    try {
      const run = executor.execute({
        commandArgs: ['-y', outputPath],
        ffmpegPath: process.execPath,
        outputPath,
      })
      await vi.waitFor(() => {
        expect(spawnMock).toHaveBeenCalledTimes(1)
      })

      let disposeSettled = false
      const disposing = executor.dispose().then(() => {
        disposeSettled = true
      })
      await Promise.resolve()
      expect(disposeSettled).toBe(false)
      expect(terminateProcessTreeMock).toHaveBeenCalledWith(child, expect.objectContaining({
        force: false,
      }))
      releaseChild?.()
      await expect(run).rejects.toMatchObject({ name: 'AbortError' })
      await disposing
      expect(disposeSettled).toBe(true)
      await expect(readFile(outputPath)).rejects.toThrow()
      await expect(executor.execute({
        commandArgs: [],
        ffmpegPath: process.execPath,
        outputPath,
      })).rejects.toThrow('ffmpeg task executor 已释放')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
