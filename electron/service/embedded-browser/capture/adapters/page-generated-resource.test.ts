import { describe, expect, it, vi } from 'vitest'

import { installPageGeneratedResourceStore } from './page-generated-resource'

describe('Page generated resource store', () => {
  it('deep.generated-resource-page-owner', async () => {
    const captures: Array<Record<string, unknown>> = []
    const anchor = {
      click: vi.fn(),
      download: '',
      href: '',
      remove: vi.fn(),
    }
    const previousExportResource = vi.fn((resourceKey: string) => resourceKey === 'mse-stream:1')
    const previousOpenResource = vi.fn((resourceKey: string) => resourceKey === 'mse-stream:1')
    const previousReadResource = vi.fn(async (resourceKey: string) => (
      resourceKey === 'mse-stream:1'
        ? { base64: 'bXNl', fileName: 'mse.mp4', resourceKey }
        : null
    ))
    const hostProbe = {
      exportResource: previousExportResource,
      openResource: previousOpenResource,
      readResource: previousReadResource,
    }
    const createObjectURL = vi.fn(() => 'blob:generated-owner-1')
    const revokeObjectURL = vi.fn()
    const open = vi.fn()
    const scope = {
      Blob,
      TextEncoder,
      URL: { createObjectURL, revokeObjectURL },
      atob,
      btoa,
      location: { hostname: 'page.example' },
      open,
    }
    const store = installPageGeneratedResourceStore({
      document: {
        createElement: vi.fn(() => anchor) as unknown as Document['createElement'],
        title: 'Episode 12',
      },
      emitCapture: payload => captures.push(payload),
      hostProbe,
      scope,
    })
    const payload = {
      base64: Buffer.from('#EXTM3U').toString('base64'),
      ext: 'm3u8' as const,
      kind: 'manifest' as const,
      mimeType: 'application/vnd.apple.mpegurl',
      resourceType: 'deep-json',
      signature: 'm3u8:#EXTM3U',
    }

    const first = store.materializeGeneratedResource(payload)
    const repeated = store.materializeGeneratedResource(payload)
    expect(repeated).toEqual(first)
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(first).toMatchObject({
      contentLength: 7,
      fileName: 'Episode 12.m3u8',
      url: 'blob:generated-owner-1',
    })
    store.emitGeneratedResource(payload)
    expect(captures).toEqual([expect.objectContaining({
      resourceKey: first.resourceKey,
      resourceType: 'deep-json',
      url: 'blob:generated-owner-1',
    })])
    await expect(hostProbe.readResource(first.resourceKey)).resolves.toMatchObject({
      base64: payload.base64,
      fileName: 'Episode 12.m3u8',
      resourceKey: first.resourceKey,
    })
    expect(hostProbe.openResource(first.resourceKey)).toBe(true)
    expect(open).toHaveBeenCalledWith(
      'blob:generated-owner-1',
      '_blank',
      'noopener,noreferrer',
    )
    expect(hostProbe.exportResource(first.resourceKey)).toBe(true)
    expect(anchor).toMatchObject({
      download: 'Episode 12.m3u8',
      href: 'blob:generated-owner-1',
    })
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()

    expect(hostProbe.exportResource('mse-stream:1')).toBe(true)
    expect(hostProbe.openResource('mse-stream:1')).toBe(true)
    await expect(hostProbe.readResource('mse-stream:1')).resolves.toMatchObject({
      fileName: 'mse.mp4',
    })
    expect(previousExportResource).toHaveBeenCalledWith('mse-stream:1')
    expect(previousOpenResource).toHaveBeenCalledWith('mse-stream:1')
    expect(previousReadResource).toHaveBeenCalledWith('mse-stream:1')
    expect(store.textToBase64('中文 playlist')).toBe(
      Buffer.from('中文 playlist').toString('base64'),
    )

    store.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:generated-owner-1')
    expect(hostProbe.exportResource).toBe(previousExportResource)
    expect(hostProbe.openResource).toBe(previousOpenResource)
    expect(hostProbe.readResource).toBe(previousReadResource)
  })
})
