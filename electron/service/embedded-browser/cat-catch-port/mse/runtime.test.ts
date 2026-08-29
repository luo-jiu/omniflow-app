import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { installMseRuntime } from './runtime'

const fixtureRoot = fileURLToPath(new URL(
  '../../../../../tools/cat-catch-lab/fixtures/mse-audio-video-flush-reset',
  import.meta.url,
))
const fixture = JSON.parse(readFileSync(`${fixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
  upstreamCommit: string
}
const input = JSON.parse(readFileSync(`${fixtureRoot}/${fixture.input}`, 'utf8')) as {
  appendOrder: Array<[string, number]>
  flushThresholdBytes: number
  streams: Array<{
    chunks: number[][]
    id: string
    mimeType: string
  }>
}
const expected = JSON.parse(readFileSync(`${fixtureRoot}/${fixture.expected}`, 'utf8')) as {
  afterCompleteClear: Record<string, unknown>
  afterFlush: Record<string, unknown>
  afterIncompleteClear: {
    resetStreamIds: string[]
    retainedBytes: number
    streams: Array<Record<string, unknown>>
  }
  flushes: Array<Record<string, unknown>>
  nativeAppendCounts: Record<string, number>
}

class FakeSourceBuffer {
  readonly appended: unknown[] = []

  appendBuffer(value: unknown) {
    this.appended.push(value)
  }
}

class FakeMediaSource {
  readonly sourceBuffers: FakeSourceBuffer[] = []

  addSourceBuffer(mimeType?: string) {
    void mimeType
    const sourceBuffer = new FakeSourceBuffer()
    this.sourceBuffers.push(sourceBuffer)
    return sourceBuffer
  }

  endOfStream() {}
}

function combineChunks(chunks: ArrayBuffer[]) {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const combined = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    const bytes = new Uint8Array(chunk)
    combined.set(bytes, offset)
    offset += bytes.byteLength
  }
  return combined
}

describe('Cat Catch MSE runtime', () => {
  it('mse.audio-video-flush-reset', () => {
    const flushes: Array<Record<string, unknown>> = []
    const resetStreamIds: string[] = []
    const streamIds = input.streams.map(stream => stream.id)
    const runtime = installMseRuntime({
      createStreamId: () => streamIds.shift() || '',
      flushThresholdBytes: input.flushThresholdBytes,
      onFlush: (event) => {
        const bytes = combineChunks(event.chunks)
        flushes.push({
          byteLength: bytes.byteLength,
          bytes: Array.from(bytes),
          streamId: event.streamId,
          streamType: event.streamType,
        })
        return true
      },
      onReset: event => resetStreamIds.push(event.streamId),
      scope: {
        ArrayBuffer,
        MediaSource: FakeMediaSource,
        Uint8Array,
      },
    })

    const mediaSource = new FakeMediaSource()
    const buffers = new Map<string, FakeSourceBuffer>()
    for (const stream of input.streams) {
      buffers.set(
        stream.id,
        mediaSource.addSourceBuffer(stream.mimeType) as FakeSourceBuffer,
      )
    }
    for (const [streamId, chunkIndex] of input.appendOrder) {
      const stream = input.streams.find(item => item.id === streamId)!
      buffers.get(streamId)!.appendBuffer(new Uint8Array(stream.chunks[chunkIndex]))
    }

    expect(flushes).toEqual(expected.flushes)
    expect(runtime.getSnapshot()).toMatchObject(expected.afterFlush)

    expect(runtime.clear()).toBe(true)
    expect(resetStreamIds).toEqual(expected.afterIncompleteClear.resetStreamIds)
    expect(runtime.getSnapshot()).toMatchObject({
      retainedBytes: expected.afterIncompleteClear.retainedBytes,
      streams: expected.afterIncompleteClear.streams,
    })

    mediaSource.endOfStream()
    expect(runtime.getSnapshot().isComplete).toBe(true)
    expect(runtime.clear()).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject(expected.afterCompleteClear)

    for (const [streamId, appendCount] of Object.entries(expected.nativeAppendCounts)) {
      expect(buffers.get(streamId)?.appended).toHaveLength(appendCount)
    }
  })

  it('mse.append-observability', () => {
    const onStreamChanged = vi.fn()
    const runtime = installMseRuntime({
      createStreamId: () => 'video-observed',
      flushThresholdBytes: 1024,
      onStreamChanged,
      scope: {
        ArrayBuffer,
        MediaSource: FakeMediaSource,
        Uint8Array,
      },
    })
    const nativeAddSourceBuffer = runtime.nativeAddSourceBuffer
    const nativeEndOfStream = runtime.nativeEndOfStream
    const mediaSource = new FakeMediaSource()
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4') as FakeSourceBuffer
    const backing = new Uint8Array([99, 1, 2, 3, 88])
    const view = backing.subarray(1, 4)

    expect(sourceBuffer.appendBuffer(view)).toBeUndefined()
    backing.fill(0)
    expect(sourceBuffer.appended).toEqual([view])
    expect(Array.from(new Uint8Array(runtime.readStream('video-observed')![0]))).toEqual([1, 2, 3])
    expect(runtime.getSnapshot()).toMatchObject({
      appendBufferCount: 1,
      isComplete: false,
      retainedBytes: 3,
      streamCount: 1,
    })
    expect(onStreamChanged).toHaveBeenCalled()

    runtime.dispose()
    expect(FakeMediaSource.prototype.addSourceBuffer).toBe(nativeAddSourceBuffer)
    expect(FakeMediaSource.prototype.endOfStream).toBe(nativeEndOfStream)
  })

  it('mse.completion-respects-capture-gate', () => {
    let captureEnabled = false
    const onComplete = vi.fn()
    const runtime = installMseRuntime({
      createStreamId: () => 'gated-video',
      isCaptureEnabled: () => captureEnabled,
      onComplete,
      scope: {
        ArrayBuffer,
        MediaSource: FakeMediaSource,
        Uint8Array,
      },
    })
    const mediaSource = new FakeMediaSource()
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4')
    sourceBuffer.appendBuffer(new Uint8Array([1, 2, 3]).buffer)

    mediaSource.endOfStream()
    expect(runtime.getSnapshot().isComplete).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()

    captureEnabled = true
    mediaSource.endOfStream()
    expect(runtime.getSnapshot().isComplete).toBe(true)
    expect(onComplete).toHaveBeenCalledWith({ streamIds: ['gated-video'] })
    runtime.dispose()
  })

  it('mse.complete-clear-without-streams', () => {
    const runtime = installMseRuntime({
      scope: {
        ArrayBuffer,
        MediaSource: FakeMediaSource,
        Uint8Array,
      },
    })
    const mediaSource = new FakeMediaSource()

    mediaSource.endOfStream()
    expect(runtime.getSnapshot().isComplete).toBe(true)
    expect(runtime.clear()).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject({
      isComplete: false,
      retainedBytes: 0,
      streamCount: 0,
    })
    runtime.dispose()
  })
})
