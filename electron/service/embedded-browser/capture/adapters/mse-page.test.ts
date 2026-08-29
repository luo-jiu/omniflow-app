import { describe, expect, it, vi } from 'vitest'

import { installMseRuntime } from '../../cat-catch-port/mse/runtime'
import { installMsePageAdapter, type InstallMsePageAdapterInput } from './mse-page'

class FakeSourceBuffer {
  readonly appended: unknown[] = []

  appendBuffer(value: unknown) {
    this.appended.push(value)
  }
}

class FakeMediaSource {
  addSourceBuffer(mimeType?: string) {
    void mimeType
    return new FakeSourceBuffer()
  }

  endOfStream() {}
}

describe('MSE page adapter', () => {
  it('mse.auto-download-after-flush', () => {
    const controls: Array<Record<string, unknown>> = []
    const timers = vi.fn(() => 1)
    const adapter = installMsePageAdapter({
      arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString('base64'),
      combineArrayBuffers: (buffers) => {
        const combined = new Uint8Array(buffers.reduce((total, buffer) => total + buffer.byteLength, 0))
        let offset = 0
        for (const buffer of buffers) {
          const bytes = new Uint8Array(buffer)
          combined.set(bytes, offset)
          offset += bytes.byteLength
        }
        return combined.buffer
      },
      emitCapture: vi.fn(),
      emitControl: (payload) => controls.push(payload),
      guessExtension: () => 'mp4',
      hostProbe: {},
      installRuntime: (runtimeInput) => installMseRuntime({
        ...runtimeInput,
        flushThresholdBytes: 4,
      }),
      preferences: {
        autoDownloadOnComplete: true,
        autoSeekToBufferedEnd: false,
        clearCacheOnComplete: false,
        manualFileName: '',
        regexRule: '',
        regexWarning: '',
        restartAlwaysFromBeginning: false,
        saveEveryGigabyte: false,
        selectorRule: '',
        selectorWarning: '',
        trimExtraMediaHeaders: true,
      },
      resolveFileName: () => 'fixture',
      scope: {
        ArrayBuffer,
        Blob,
        MediaSource: FakeMediaSource,
        URL: {
          createObjectURL: () => 'blob:fixture',
          revokeObjectURL: vi.fn(),
        },
        Uint8Array,
        location: { href: 'https://page.example/watch' },
        setTimeout: timers,
      } as unknown as InstallMsePageAdapterInput['scope'],
    })

    const mediaSource = new FakeMediaSource()
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4')
    sourceBuffer.appendBuffer(new Uint8Array([1, 2, 3, 4]).buffer)
    mediaSource.endOfStream()
    mediaSource.endOfStream()

    expect(controls).toEqual([
      expect.objectContaining({ event: 'mse-flush', resourceKey: expect.stringMatching(/^mse-stream:/) }),
      expect.objectContaining({ event: 'mse-complete', resourceKey: expect.stringMatching(/^mse-stream:/) }),
    ])
    expect(timers).not.toHaveBeenCalledWith(expect.anything(), 500)
    adapter.dispose()
  })

  it('mse.periodic-large-output', () => {
    const controls: Array<Record<string, unknown>> = []
    const adapter = installMsePageAdapter({
      arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString('base64'),
      combineArrayBuffers: (buffers) => {
        const combined = new Uint8Array(buffers.reduce((total, buffer) => total + buffer.byteLength, 0))
        let offset = 0
        for (const buffer of buffers) {
          const bytes = new Uint8Array(buffer)
          combined.set(bytes, offset)
          offset += bytes.byteLength
        }
        return combined.buffer
      },
      emitCapture: vi.fn(),
      emitControl: (payload) => controls.push(payload),
      guessExtension: () => 'mp4',
      hostProbe: {},
      installRuntime: (runtimeInput) => installMseRuntime({
        ...runtimeInput,
        flushThresholdBytes: 4,
      }),
      largeOutputThresholdBytes: 4,
      preferences: {
        autoDownloadOnComplete: false,
        autoSeekToBufferedEnd: false,
        clearCacheOnComplete: false,
        manualFileName: '',
        regexRule: '',
        regexWarning: '',
        restartAlwaysFromBeginning: false,
        saveEveryGigabyte: true,
        selectorRule: '',
        selectorWarning: '',
        trimExtraMediaHeaders: true,
      },
      resolveFileName: () => 'fixture',
      scope: {
        ArrayBuffer,
        Blob,
        MediaSource: FakeMediaSource,
        URL: {
          createObjectURL: () => 'blob:fixture',
          revokeObjectURL: vi.fn(),
        },
        Uint8Array,
        location: { href: 'https://page.example/watch' },
        setTimeout: vi.fn(),
      } as unknown as InstallMsePageAdapterInput['scope'],
    })

    const mediaSource = new FakeMediaSource()
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4')
    sourceBuffer.appendBuffer(new Uint8Array([1, 2, 3, 4]).buffer)

    expect(controls).toEqual([
      expect.objectContaining({ event: 'mse-flush', resourceKey: expect.stringMatching(/^mse-stream:/) }),
      expect.objectContaining({ event: 'mse-save', resourceKey: expect.stringMatching(/^mse-stream:/) }),
    ])

    sourceBuffer.appendBuffer(new Uint8Array([5, 6, 7, 8]).buffer)
    expect(controls.filter(control => control.event === 'mse-save')).toHaveLength(2)
    adapter.clear()
    sourceBuffer.appendBuffer(new Uint8Array([9, 10, 11, 12]).buffer)
    expect(controls.filter(control => control.event === 'mse-save')).toHaveLength(3)
    adapter.dispose()
  })
})
