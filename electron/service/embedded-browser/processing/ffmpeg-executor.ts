import { spawn, type ChildProcess } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import { terminateDesktopProcessTree } from '../../../platform/processTree'
import {
  defaultProcessingTaskRegistry,
  type ProcessingTaskRegistration,
} from './task-registry'

export type FfmpegTaskProgress = {
  processedSeconds?: number
  speedText?: string
}

export type FfmpegTaskRequest = {
  commandArgs: string[]
  durationSeconds?: number
  ffmpegPath: string
  onProgress?: (payload: FfmpegTaskProgress) => void
  outputPath: string
  signal?: AbortSignal
}

export type FfmpegTaskResult = {
  commandArgs: string[]
  ffmpegPath: string
  outputPath: string
  stderr: string
  stdout: string
}

const FFMPEG_TERMINATION_GRACE_MS = 1_500
const FFMPEG_TERMINATION_SETTLE_MS = 3_500

function parseFfmpegProgressChunk(
  state: FfmpegTaskProgress,
  chunkText: string,
) {
  String(chunkText || '').split(/\r?\n/).forEach((line) => {
    const normalizedLine = String(line || '').trim()
    if (!normalizedLine || !normalizedLine.includes('=')) {
      return
    }
    const separatorIndex = normalizedLine.indexOf('=')
    const key = normalizedLine.slice(0, separatorIndex).trim()
    const value = normalizedLine.slice(separatorIndex + 1).trim()
    if (!key) {
      return
    }
    if (key === 'out_time_ms' || key === 'out_time_us') {
      const rawValue = Number(value)
      if (Number.isFinite(rawValue) && rawValue >= 0) {
        state.processedSeconds = rawValue / 1_000_000
      }
      return
    }
    if (key === 'speed') {
      state.speedText = value
    }
  })
}

async function assertFfmpegOutputFile(outputPath: string) {
  const output = await stat(outputPath).catch(() => null)
  if (output?.isFile() && output.size > 0) {
    return
  }
  throw new Error('ffmpeg 已退出，但没有生成可用的输出文件')
}

function createFfmpegAbortError() {
  const error = new Error('ffmpeg task aborted')
  error.name = 'AbortError'
  return error
}

function terminateFfmpegProcess(child: ChildProcess, force: boolean) {
  terminateDesktopProcessTree(child, {
    environment: process.env,
    force,
  })
}

export class FfmpegTaskExecutor {
  async execute(input: FfmpegTaskRequest): Promise<FfmpegTaskResult> {
    const abortController = new AbortController()
    const forwardAbort = () => abortController.abort()
    if (input.signal?.aborted) {
      abortController.abort()
    } else {
      input.signal?.addEventListener('abort', forwardAbort, { once: true })
    }

    const run = this.executeTask({
      ...input,
      signal: abortController.signal,
    })
    const settled = run.then(() => undefined, () => undefined)
    let registration: ProcessingTaskRegistration
    try {
      registration = defaultProcessingTaskRegistry.register({
        cancel: () => abortController.abort(),
        kind: 'ffmpeg',
        settled,
      })
    } catch (error) {
      abortController.abort()
      await settled
      input.signal?.removeEventListener('abort', forwardAbort)
      throw error
    }
    try {
      return await run
    } finally {
      input.signal?.removeEventListener('abort', forwardAbort)
      registration.release()
    }
  }

  async dispose() {
    await defaultProcessingTaskRegistry.cancel({ kind: 'ffmpeg' })
  }

  private async executeTask(input: FfmpegTaskRequest): Promise<FfmpegTaskResult> {
    if (!String(input.outputPath || '').trim()) {
      throw new Error('输出路径不能为空')
    }
    if (input.signal?.aborted) {
      throw createFfmpegAbortError()
    }

    return new Promise<FfmpegTaskResult>((resolve, reject) => {
      const stdout: string[] = []
      const stderr: string[] = []
      let child: ChildProcess | null = null
      let forceTimer: ReturnType<typeof setTimeout> | undefined
      let settleTimer: ReturnType<typeof setTimeout> | undefined
      let lastProcessedSeconds = -1
      let lastSpeedText = ''
      let settled = false
      let terminationError: Error | null = null
      const progressState: FfmpegTaskProgress = {}

      const cleanup = () => {
        if (forceTimer) clearTimeout(forceTimer)
        if (settleTimer) clearTimeout(settleTimer)
        input.signal?.removeEventListener('abort', handleAbort)
        child?.stdout?.removeAllListeners()
        child?.stderr?.removeAllListeners()
        child?.removeAllListeners()
      }
      const finish = (handler: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        handler()
      }
      const rejectTask = (error: unknown, removePartialOutput: boolean) => {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        const rejectResult = () => finish(() => reject(normalizedError))
        if (!removePartialOutput) {
          rejectResult()
          return
        }
        void rm(input.outputPath, { force: true })
          .catch(() => undefined)
          .then(rejectResult)
      }
      const terminate = (error: Error) => {
        if (terminationError) return
        terminationError = error
        if (!child) {
          rejectTask(error, false)
          return
        }
        const runningChild = child
        terminateFfmpegProcess(runningChild, false)
        forceTimer = setTimeout(() => {
          terminateFfmpegProcess(runningChild, true)
        }, FFMPEG_TERMINATION_GRACE_MS)
        forceTimer.unref?.()
        settleTimer = setTimeout(() => {
          rejectTask(error, true)
        }, FFMPEG_TERMINATION_SETTLE_MS)
        settleTimer.unref?.()
      }
      const handleAbort = () => terminate(createFfmpegAbortError())

      try {
        child = spawn(input.ffmpegPath, input.commandArgs, {
          detached: process.platform !== 'win32',
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
      } catch (error) {
        rejectTask(error, false)
        return
      }

      child.stdout?.on('data', (chunk) => {
        const chunkText = String(chunk)
        stdout.push(chunkText)
        parseFfmpegProgressChunk(progressState, chunkText)
        const nextProcessedSeconds = progressState.processedSeconds
        const nextSpeedText = progressState.speedText || ''
        const progressChanged = (
          (typeof nextProcessedSeconds === 'number'
            && Math.abs(nextProcessedSeconds - lastProcessedSeconds) >= 0.5)
          || (nextSpeedText && nextSpeedText !== lastSpeedText)
        )
        if (!progressChanged) return
        if (typeof nextProcessedSeconds === 'number') lastProcessedSeconds = nextProcessedSeconds
        if (nextSpeedText) lastSpeedText = nextSpeedText
        input.onProgress?.({
          processedSeconds: typeof nextProcessedSeconds === 'number'
            ? Math.min(nextProcessedSeconds, input.durationSeconds || Number.POSITIVE_INFINITY)
            : undefined,
          speedText: nextSpeedText || undefined,
        })
      })
      child.stderr?.on('data', (chunk) => {
        stderr.push(String(chunk))
      })
      child.once('error', (error) => {
        rejectTask(terminationError || error, true)
      })
      child.once('exit', (code) => {
        if (terminationError) {
          rejectTask(terminationError, true)
          return
        }
        if (code !== 0) {
          rejectTask(new Error(stderr.join('').trim() || `ffmpeg 退出码异常: ${code}`), true)
          return
        }
        void assertFfmpegOutputFile(input.outputPath)
          .then(() => {
            if (terminationError) {
              rejectTask(terminationError, true)
              return
            }
            finish(() => resolve({
              commandArgs: input.commandArgs,
              ffmpegPath: input.ffmpegPath,
              outputPath: input.outputPath,
              stderr: stderr.join(''),
              stdout: stdout.join(''),
            }))
          })
          .catch((error) => rejectTask(error, true))
      })
      if (input.signal?.aborted) {
        handleAbort()
      } else {
        input.signal?.addEventListener('abort', handleAbort, { once: true })
      }
    })
  }
}

export const defaultFfmpegTaskExecutor = new FfmpegTaskExecutor()
