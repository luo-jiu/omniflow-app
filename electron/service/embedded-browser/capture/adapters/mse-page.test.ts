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

class FakeMediaElement {
  readonly listeners = new Map<string, () => void>()
  readonly endCalls: number[] = []
  readonly buffered = {
    length: 2,
    end: (index: number) => {
      this.endCalls.push(index)
      return index === 0 ? 10 : 100
    },
  }
  duration = 200
  currentTime = 0

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener)
  }

  trigger(type: string) {
    this.listeners.get(type)?.()
  }
}

class FakeMutationObserver {
  constructor(callback: () => void) {
    void callback
  }

  disconnect() {}

  observe() {}
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

  it('mse.cross-flush-header-trim', () => {
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
      preferences: {
        autoDownloadOnComplete: false,
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
        setTimeout: vi.fn(),
      } as unknown as InstallMsePageAdapterInput['scope'],
    })

    const mediaSource = new FakeMediaSource()
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4')
    sourceBuffer.appendBuffer(new Uint8Array([1, 2, 3, 4]).buffer)
    sourceBuffer.appendBuffer(new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 5]).buffer)

    const flushes = controls.filter(control => control.event === 'mse-flush')
    expect(flushes).toHaveLength(2)
    expect(flushes[0]).toMatchObject({ trimBeforeHeader: false })
    expect(flushes[1]).toMatchObject({ trimBeforeHeader: true })
    adapter.dispose()
  })

  it('mse.drain-header-trim', () => {
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
      emitControl: vi.fn(),
      guessExtension: () => 'webm',
      hostProbe: {},
      installRuntime: (runtimeInput) => installMseRuntime({
        ...runtimeInput,
        createStreamId: () => 'webm-drain',
        flushThresholdBytes: 16,
      }),
      preferences: {
        autoDownloadOnComplete: false,
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
        setTimeout: vi.fn(),
      } as unknown as InstallMsePageAdapterInput['scope'],
    })

    const mediaSource = new FakeMediaSource()
    const sourceBuffer = mediaSource.addSourceBuffer('video/webm')
    sourceBuffer.appendBuffer(new Uint8Array([1, 2, 3, 4]).buffer)
    adapter.runtime.flush()
    sourceBuffer.appendBuffer(new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 5]).buffer)

    expect(adapter.drainResource('mse-stream:webm-drain')).toMatchObject({
      base64: Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 5]).toString('base64'),
      trimBeforeHeader: true,
    })
    adapter.dispose()
  })

  it('mse.auto-buffer-seek-uses-first-range', () => {
    const mediaElement = new FakeMediaElement()
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
      document: {
        body: {},
        documentElement: {},
        querySelectorAll: () => [mediaElement],
      } as unknown as Document,
      emitCapture: vi.fn(),
      emitControl: vi.fn(),
      guessExtension: () => 'mp4',
      hostProbe: {},
      installRuntime: (runtimeInput) => installMseRuntime(runtimeInput),
      preferences: {
        autoDownloadOnComplete: false,
        autoSeekToBufferedEnd: true,
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
        Element: class FakeElement {},
        HTMLMediaElement: FakeMediaElement,
        MediaSource: FakeMediaSource,
        MutationObserver: FakeMutationObserver,
        URL: {
          createObjectURL: () => 'blob:fixture',
          revokeObjectURL: vi.fn(),
        },
        Uint8Array,
        location: { href: 'https://page.example/watch' },
        setTimeout: vi.fn(),
      } as unknown as InstallMsePageAdapterInput['scope'],
    })

    mediaElement.trigger('progress')

    expect(mediaElement.endCalls).toEqual([0])
    expect(mediaElement.currentTime).toBe(5)
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

  it('mse.periodic-large-output-uses-total-bytes', () => {
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
        flushThresholdBytes: 12,
      }),
      largeOutputThresholdBytes: 10,
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
    const videoBuffer = mediaSource.addSourceBuffer('video/mp4')
    const audioBuffer = mediaSource.addSourceBuffer('audio/mp4')
    videoBuffer.appendBuffer(new Uint8Array([1, 2, 3, 4, 5, 6]).buffer)
    audioBuffer.appendBuffer(new Uint8Array([7, 8, 9, 10, 11, 12]).buffer)

    expect(controls.filter(control => control.event === 'mse-save')).toHaveLength(1)
    expect(controls.filter(control => control.event === 'mse-flush')).toHaveLength(2)
    adapter.dispose()
  })
})
