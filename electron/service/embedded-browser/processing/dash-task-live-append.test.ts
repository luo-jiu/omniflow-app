import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { DashRepresentation } from '../cat-catch-port/dash/parser'
import { appendDashRepresentationSegments } from './dash-task'

function representation(overrides: Partial<DashRepresentation> = {}): DashRepresentation {
  return {
    baseUrls: ['https://cdn.example/'],
    contentType: 'video',
    id: 'video-1',
    segmentCount: 1,
    segments: [{ duration: 2, index: 0, number: 1, url: 'https://cdn.example/1.m4s' }],
    unsupportedReasons: [],
    ...overrides,
  }
}

describe('DASH live append transfer', () => {
  it('dash.dynamic-live-append', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-append-test-'))
    const outputPath = path.join(directory, 'video-track.bin')
    const fetch = vi.fn(async (url: string) => new Response(
      url.endsWith('init.mp4') ? 'INIT|' : url.endsWith('1.m4s') ? 'ONE|' : 'TWO|',
      { status: 200 },
    ))
    try {
      await appendDashRepresentationSegments(representation({
        initializationUrl: 'https://cdn.example/init.mp4',
      }), outputPath, { fetch, signal: new AbortController().signal })
      await appendDashRepresentationSegments(representation({
        initializationUrl: 'https://cdn.example/init.mp4',
        segments: [{ duration: 2, index: 0, number: 2, url: 'https://cdn.example/2.m4s' }],
      }), outputPath, {
        appendInitialization: false,
        fetch,
        signal: new AbortController().signal,
      })

      expect((await readFile(outputPath)).toString()).toBe('INIT|ONE|TWO|')
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('dash.dynamic-live-append-cancel', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-append-cancel-'))
    const controller = new AbortController()
    let observedSignal: AbortSignal | undefined
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      observedSignal = init?.signal || undefined
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })
    try {
      const run = appendDashRepresentationSegments(
        representation(),
        path.join(directory, 'video-track.bin'),
        { fetch, signal: controller.signal },
      )
      await vi.waitFor(() => expect(observedSignal).toBeDefined())
      controller.abort()
      await expect(run).rejects.toMatchObject({ name: 'AbortError' })
      expect(observedSignal?.aborted).toBe(true)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
