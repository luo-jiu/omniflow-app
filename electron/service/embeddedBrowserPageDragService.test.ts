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

function createOptions(fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>) {
  return {
    browserSession: {
      fetch: fetchImpl || (() => Promise.reject(new Error('unexpected HTTP fetch'))),
    } as Electron.Session,
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
