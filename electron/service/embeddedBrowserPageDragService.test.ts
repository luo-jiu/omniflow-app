import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const { testTempRoot } = vi.hoisted(() => ({
  testTempRoot: `${String(process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp')
    .replace(/[\\/]$/, '')}/omniflow-page-drag-test-${process.pid}`,
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testTempRoot,
  },
}))

import {
  clearEmbeddedBrowserPageDragSources,
  recordEmbeddedBrowserPageDragSource,
  stageEmbeddedBrowserPageDrag,
} from './embeddedBrowserPageDragService'

type FetchCall = {
  input: string
  init?: RequestInit
}

function createOptions(
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
  fetchCapturedResource?: (input: { resourceId: string; tabId: string }) => Promise<{
    resource: { mimeType?: string; name?: string; url: string }
    response: Response
  }>,
) {
  return {
    browserSession: {
      fetch: fetchImpl || (() => Promise.reject(new Error('unexpected HTTP fetch'))),
    } as Electron.Session,
    fetchCapturedResource,
    readPageBlob: () => Promise.reject(new Error('unexpected blob read')),
  }
}

async function listStagingDirectories() {
  const stagingRoot = path.join(testTempRoot, 'omniflow-import-staging')
  const entries = await readdir(stagingRoot, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('page-drag-'))
}

afterEach(async () => {
  clearEmbeddedBrowserPageDragSources()
  await rm(path.join(testTempRoot, 'omniflow-import-staging'), { recursive: true, force: true })
})

afterAll(async () => {
  await rm(testTempRoot, { recursive: true, force: true })
})

describe('embeddedBrowserPageDragService', () => {
  it('stages an inline resource with a normalized cross-platform file name', async () => {
    const [staged] = await stageEmbeddedBrowserPageDrag({
      fallbackResources: [{
        sourceKind: 'image',
        sourceUrl: 'data:image/png;base64,aGVsbG8=',
        suggestedFileName: 'CON',
      }],
    }, createOptions())

    expect(staged.fileName).toBe('_CON.png')
    expect(staged.mimeType).toBe('image/png')
    expect(staged.size).toBe(5)
    expect(await readFile(staged.filePath, 'utf8')).toBe('hello')
  })

  it('uses the captured browser request context when staging an HTTP resource', async () => {
    const calls: FetchCall[] = []
    const sourceUrl = 'https://cdn.example.test/image?id=1'
    recordEmbeddedBrowserPageDragSource('tab-1', {
      pageUrl: 'https://www.example.test/gallery',
      sessionId: 'drag-session-1',
      sourceKind: 'image',
      sourceUrl,
      tabId: 'tab-1',
    }, {
      referer: 'https://www.example.test/gallery',
      requestHeaders: {
        Cookie: 'private-cookie',
        'X-Image-Token': 'image-token',
      },
    })

    const [staged] = await stageEmbeddedBrowserPageDrag({
      sessionId: 'drag-session-1',
      tabId: 'tab-1',
    }, createOptions(async (input, init) => {
      calls.push({ input, init })
      return new Response('image-body', {
        headers: {
          'Content-Disposition': "attachment; filename*=UTF-8''cover.png",
          'Content-Type': 'image/png',
        },
      })
    }))

    expect(calls).toHaveLength(1)
    expect(calls[0].input).toBe(sourceUrl)
    expect(calls[0].init?.credentials).toBe('include')
    expect(calls[0].init?.referrer).toBe('https://www.example.test/gallery')
    expect(new Headers(calls[0].init?.headers).get('x-image-token')).toBe('image-token')
    expect(new Headers(calls[0].init?.headers).has('cookie')).toBe(false)
    expect(staged.fileName).toBe('cover.png')
    expect(await readFile(staged.filePath, 'utf8')).toBe('image-body')
  })

  it('uses the main-owned resource authority when a captured drag source is available', async () => {
    recordEmbeddedBrowserPageDragSource('tab-1', {
      pageUrl: 'https://www.example.test/gallery',
      resourceId: 'resource-opaque',
      sessionId: 'drag-session-authority',
      sourceKind: 'media',
      sourceUrl: 'https://renderer.example/untrusted.mp4',
      tabId: 'tab-1',
    })

    const browserFetch = vi.fn(async () => new Response('wrong-body'))
    const authorityFetch = vi.fn(async () => ({
      resource: {
        mimeType: 'video/mp4',
        name: 'episode.mp4',
        url: 'https://media.example/episode.mp4',
      },
      response: new Response('authority-body', {
        headers: { 'Content-Type': 'video/mp4' },
      }),
    }))
    const [staged] = await stageEmbeddedBrowserPageDrag({
      sessionId: 'drag-session-authority',
      tabId: 'tab-1',
    }, createOptions(browserFetch, authorityFetch))

    expect(authorityFetch).toHaveBeenCalledWith({
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })
    expect(browserFetch).not.toHaveBeenCalled()
    expect(staged.fileName).toBe('episode.mp4')
    expect(staged.sourceUrl).toBe('https://media.example/episode.mp4')
    expect(await readFile(staged.filePath, 'utf8')).toBe('authority-body')
  })

  it('rejects HTML returned for an image drag and removes the partial staging directory', async () => {
    await expect(stageEmbeddedBrowserPageDrag({
      fallbackResources: [{
        sourceKind: 'image',
        sourceUrl: 'https://www.example.test/image-proxy',
      }],
    }, createOptions(async () => new Response('<html></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })))).rejects.toThrow('拖拽图片返回了非图片内容：text/html')

    expect(await listStagingDirectories()).toHaveLength(0)
  })
})
