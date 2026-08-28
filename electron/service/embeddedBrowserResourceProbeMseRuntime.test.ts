import { createContext, runInContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

import {
  EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX,
  createEmbeddedBrowserResourceProbeScript,
} from './embeddedBrowserResourceProbe'

describe('Embedded browser MSE page runtime', () => {
  it('mse.append-observability', async () => {
    const anchors: Array<{
      click: ReturnType<typeof vi.fn>
      download: string
      href: string
      remove: ReturnType<typeof vi.fn>
    }> = []
    const consoleMessages: string[] = []
    const open = vi.fn()
    let blobSequence = 0

    class FakeSourceBuffer {
      readonly appended: unknown[] = []

      appendBuffer(value: unknown) {
        this.appended.push(value)
      }
    }

    class FakeMediaSource {
      readonly sourceBuffers: FakeSourceBuffer[] = []

      addSourceBuffer() {
        const sourceBuffer = new FakeSourceBuffer()
        this.sourceBuffers.push(sourceBuffer)
        return sourceBuffer
      }

      endOfStream() {}
    }

    class BrowserUrl extends URL {
      static createObjectURL() {
        return `blob:mse-runtime-${++blobSequence}`
      }

      static revokeObjectURL() {}
    }

    const context = createContext({
      Blob,
      MediaSource: FakeMediaSource,
      URL: BrowserUrl,
      atob,
      btoa,
      clearTimeout: vi.fn(),
      console: {
        info: (message: string) => consoleMessages.push(message),
        log: vi.fn(),
      },
      document: {
        createElement: vi.fn(() => {
          const anchor = {
            click: vi.fn(),
            download: '',
            href: '',
            remove: vi.fn(),
          }
          anchors.push(anchor)
          return anchor
        }),
        documentElement: {},
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        readyState: 'complete',
        title: 'MSE Fixture',
      },
      localStorage: {
        getItem: vi.fn(() => null),
        removeItem: vi.fn(),
        setItem: vi.fn(),
      },
      location: {
        href: 'https://page.example/watch',
        hostname: 'page.example',
        protocol: 'https:',
      },
      open,
      setTimeout: vi.fn(() => 1),
    })

    const script = createEmbeddedBrowserResourceProbeScript()
    expect(runInContext(script, context)).toBe('installed')
    const installedAddSourceBuffer = runInContext(
      'MediaSource.prototype.addSourceBuffer',
      context,
    )
    expect(runInContext(script, context)).toBe('already-installed')
    expect(runInContext('MediaSource.prototype.addSourceBuffer', context))
      .toBe(installedAddSourceBuffer)
    const observed = JSON.parse(runInContext(`
      (() => {
        const mediaSource = new MediaSource();
        const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1"');
        sourceBuffer.appendBuffer(new Uint8Array([1, 2, 3, 4]).buffer);
        globalThis.__MSE_FIXTURE_MEDIA_SOURCE__ = mediaSource;
        const state = globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__.getCatchToolkitState();
        return JSON.stringify({
          appendedCount: sourceBuffer.appended.length,
          diagnostics: state.diagnostics,
          resourceKey: state.videoResourceKey,
          state,
        });
      })()
    `, context)) as {
      appendedCount: number
      diagnostics: Record<string, unknown>
      resourceKey: string
      state: Record<string, unknown>
    }

    expect(observed).toMatchObject({
      appendedCount: 1,
      diagnostics: {
        appendBufferCount: 1,
        mediaSourceAvailable: true,
        mediaSourceHooked: true,
        sourceBufferCount: 1,
      },
      state: {
        capturedMediaSizeBytes: 4,
        isCaptureComplete: false,
        streamCount: 1,
        videoSizeBytes: 4,
      },
    })
    expect(observed.resourceKey).toMatch(/^mse-stream:/)

    const read = await runInContext(
      `globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__.readResource(${JSON.stringify(observed.resourceKey)})`,
      context,
    ) as Record<string, unknown>
    expect(read).toMatchObject({
      base64: 'AQIDBA==',
      fileName: 'MSE Fixture-video.mp4',
      mimeType: 'video/mp4; codecs="avc1"',
      resourceKey: observed.resourceKey,
      streamType: 'video',
    })

    runInContext('globalThis.__MSE_FIXTURE_MEDIA_SOURCE__.endOfStream()', context)
    expect(runInContext(
      'globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__.getCatchToolkitState().isCaptureComplete',
      context,
    )).toBe(true)
    expect(runInContext(
      `globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__.openResource(${JSON.stringify(observed.resourceKey)})`,
      context,
    )).toBe(true)
    expect(open).toHaveBeenCalledWith(
      'blob:mse-runtime-1',
      '_blank',
      'noopener,noreferrer',
    )
    expect(runInContext(
      `globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__.exportResource(${JSON.stringify(observed.resourceKey)})`,
      context,
    )).toBe(true)
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({
      download: 'MSE Fixture-video.mp4',
      href: 'blob:mse-runtime-1',
    })
    expect(anchors[0]?.click).toHaveBeenCalledOnce()
    expect(anchors[0]?.remove).toHaveBeenCalledOnce()

    const drained = runInContext(
      `globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__.drainResource(${JSON.stringify(observed.resourceKey)})`,
      context,
    ) as Record<string, unknown>
    expect(drained).toMatchObject({
      base64: 'AQIDBA==',
      resourceKey: observed.resourceKey,
      streamType: 'video',
    })
    await expect(runInContext(
      `globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__.readResource(${JSON.stringify(observed.resourceKey)})`,
      context,
    )).resolves.toBeNull()

    const capturePayloads = consoleMessages
      .filter(message => message.startsWith(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX))
      .map(message => JSON.parse(message.slice(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX.length)))
      .filter(payload => payload.resourceType === 'mse-stream')
    expect(capturePayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentLength: 0,
        kind: 'media',
        resourceKey: observed.resourceKey,
        streamType: 'video',
      }),
      expect.objectContaining({
        contentLength: 4,
        resourceKey: observed.resourceKey,
        url: expect.stringMatching(/^mse:\/\/capturing\//),
      }),
      expect.objectContaining({
        contentLength: 4,
        resourceKey: observed.resourceKey,
        url: 'blob:mse-runtime-1',
      }),
    ]))
  })
})
