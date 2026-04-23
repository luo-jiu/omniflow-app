import {
  createEmbeddedBrowserResourceDrainMseScript,
  createEmbeddedBrowserResourceExtractScript,
  createEmbeddedBrowserResourcePreviewScript,
  createEmbeddedBrowserResourceProbeActionScript,
  type EmbeddedBrowserDrainedMseResourcePayload,
  type EmbeddedBrowserExtractedResourcePayload,
  type EmbeddedBrowserResourcePreviewPayload,
} from './embeddedBrowserResourcePageBridge'

type EmbeddedBrowserPageScriptExecutor = (
  script: string,
) => Promise<unknown>

export async function runEmbeddedBrowserResourceProbeAction(
  executeScript: EmbeddedBrowserPageScriptExecutor,
  action: 'exportResource' | 'openResource',
  resourceKey: string,
) {
  const normalizedResourceKey = String(resourceKey || '').trim()
  if (!normalizedResourceKey) {
    return false
  }
  const result = await executeScript(
    createEmbeddedBrowserResourceProbeActionScript(action, normalizedResourceKey),
  )
  return Boolean(result)
}

export async function runEmbeddedBrowserResourcePreview(
  executeScript: EmbeddedBrowserPageScriptExecutor,
  payload: EmbeddedBrowserResourcePreviewPayload,
) {
  const normalizedUrl = String(payload.url || '').trim()
  if (!normalizedUrl) {
    return false
  }
  const result = await executeScript(
    createEmbeddedBrowserResourcePreviewScript(payload),
  )
  return Boolean(result)
}

export async function extractEmbeddedBrowserResourceFromPage(
  executeScript: EmbeddedBrowserPageScriptExecutor,
  resourceKey: string,
) {
  const normalizedResourceKey = String(resourceKey || '').trim()
  if (!normalizedResourceKey) {
    return null
  }
  const result = await executeScript(
    createEmbeddedBrowserResourceExtractScript(normalizedResourceKey),
  )
  if (!result || typeof result !== 'object') {
    return null
  }
  const payload = result as Partial<EmbeddedBrowserExtractedResourcePayload>
  if (typeof payload.base64 !== 'string' || typeof payload.fileName !== 'string') {
    return null
  }
  return {
    base64: payload.base64,
    fileName: payload.fileName,
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
    resourceKey: typeof payload.resourceKey === 'string' ? payload.resourceKey : normalizedResourceKey,
    streamType: payload.streamType === 'audio' || payload.streamType === 'video'
      ? payload.streamType
      : undefined,
  } satisfies EmbeddedBrowserExtractedResourcePayload
}

export async function drainEmbeddedBrowserMseResourceFromPage(
  executeScript: EmbeddedBrowserPageScriptExecutor,
  resourceKey: string,
) {
  const normalizedResourceKey = String(resourceKey || '').trim()
  if (!normalizedResourceKey) {
    return null
  }
  const result = await executeScript(
    createEmbeddedBrowserResourceDrainMseScript(normalizedResourceKey),
  )
  if (!result || typeof result !== 'object') {
    return null
  }
  const payload = result as Partial<EmbeddedBrowserDrainedMseResourcePayload>
  if (typeof payload.fileName !== 'string') {
    return null
  }
  return {
    base64: typeof payload.base64 === 'string' ? payload.base64 : undefined,
    fileName: payload.fileName,
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
    resourceKey: typeof payload.resourceKey === 'string' ? payload.resourceKey : normalizedResourceKey,
    streamType: payload.streamType === 'audio' || payload.streamType === 'video'
      ? payload.streamType
      : undefined,
  } satisfies EmbeddedBrowserDrainedMseResourcePayload
}
