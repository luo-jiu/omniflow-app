import { describe, expect, it, vi } from 'vitest'

import {
  createEmbeddedBrowserCatchToolkitActionScript,
  createEmbeddedBrowserCatchToolkitGetStateScript,
  createEmbeddedBrowserCatchToolkitUpdateStateScript,
} from './embeddedBrowserCatchToolkitPageBridge'
import {
  createEmbeddedBrowserResourceExtractScript,
  createEmbeddedBrowserResourceProbeActionScript,
} from './embeddedBrowserResourcePageBridge'

function executePageScript<T>(
  script: string,
  probe: Record<string, unknown> | undefined,
) {
  return Function('window', `return (${script})`)({
    __OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__: probe,
  }) as T
}

describe('Embedded browser page bridge contracts', () => {
  it('deep.toolkit-page-bridge-contract', () => {
    const getCatchToolkitState = vi.fn(() => ({ manualFileName: 'episode-9' }))
    const updateCatchToolkitState = vi.fn((payload: unknown) => payload)
    const clearCatchMediaCache = vi.fn(() => true)
    const probe = {
      clearCatchMediaCache,
      getCatchToolkitState,
      updateCatchToolkitState,
    }

    expect(executePageScript(
      createEmbeddedBrowserCatchToolkitGetStateScript(),
      probe,
    )).toEqual({ manualFileName: 'episode-9' })
    expect(executePageScript(
      createEmbeddedBrowserCatchToolkitUpdateStateScript({
        autoDownloadOnComplete: true,
        manualFileName: 'episode-10',
      }),
      probe,
    )).toEqual({
      autoDownloadOnComplete: true,
      manualFileName: 'episode-10',
    })
    expect(updateCatchToolkitState).toHaveBeenCalledWith({
      autoDownloadOnComplete: true,
      manualFileName: 'episode-10',
    })
    expect(executePageScript(
      createEmbeddedBrowserCatchToolkitActionScript('clearCatchMediaCache'),
      probe,
    )).toBe(true)
    expect(clearCatchMediaCache).toHaveBeenCalledOnce()
    expect(executePageScript(
      createEmbeddedBrowserCatchToolkitGetStateScript(),
      undefined,
    )).toBeNull()
  })

  it('deep.generated-resource-page-bridge-contract', async () => {
    const openResource = vi.fn(() => 1)
    const exportResource = vi.fn(() => 0)
    const readResource = vi.fn(async (resourceKey: string) => ({
      base64: 'I0VYVE0zVQ==',
      fileName: 'inline.m3u8',
      resourceKey,
    }))
    const probe = { exportResource, openResource, readResource }
    const resourceKey = 'probe-resource:quoted-"-key'

    expect(executePageScript(
      createEmbeddedBrowserResourceProbeActionScript('openResource', resourceKey),
      probe,
    )).toBe(true)
    expect(openResource).toHaveBeenCalledWith(resourceKey)
    expect(executePageScript(
      createEmbeddedBrowserResourceProbeActionScript('exportResource', resourceKey),
      probe,
    )).toBe(false)
    expect(exportResource).toHaveBeenCalledWith(resourceKey)
    await expect(executePageScript<Promise<unknown>>(
      createEmbeddedBrowserResourceExtractScript(resourceKey),
      probe,
    )).resolves.toEqual({
      base64: 'I0VYVE0zVQ==',
      fileName: 'inline.m3u8',
      resourceKey,
    })
    expect(readResource).toHaveBeenCalledWith(resourceKey)
    expect(executePageScript(
      createEmbeddedBrowserResourceProbeActionScript('openResource', resourceKey),
      undefined,
    )).toBe(false)
  })
})
