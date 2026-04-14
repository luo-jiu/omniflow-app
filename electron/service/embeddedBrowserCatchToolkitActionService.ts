import {
  createEmbeddedBrowserCatchToolkitActionScript,
  createEmbeddedBrowserCatchToolkitGetStateScript,
  createEmbeddedBrowserCatchToolkitUpdateStateScript,
  type EmbeddedBrowserCatchToolkitStatePayload,
} from './embeddedBrowserCatchToolkitPageBridge'

type EmbeddedBrowserPageScriptExecutor = (
  script: string,
) => Promise<unknown>

function normalizeCatchToolkitStatePayload(
  value: unknown,
): EmbeddedBrowserCatchToolkitStatePayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as Partial<EmbeddedBrowserCatchToolkitStatePayload>
  if (
    typeof payload.autoSeekToBufferedEnd !== 'boolean'
    || typeof payload.autoDownloadOnComplete !== 'boolean'
    || typeof payload.capturedMediaSizeBytes !== 'number'
    || typeof payload.clearCacheOnComplete !== 'boolean'
    || typeof payload.currentFileName !== 'string'
    || typeof payload.isCaptureComplete !== 'boolean'
    || typeof payload.manualFileName !== 'string'
    || typeof payload.regexWarning !== 'string'
    || typeof payload.regexRule !== 'string'
    || typeof payload.restartAlwaysFromBeginning !== 'boolean'
    || typeof payload.selectorWarning !== 'string'
    || typeof payload.selectorRule !== 'string'
    || typeof payload.streamCount !== 'number'
    || typeof payload.trimExtraMediaHeaders !== 'boolean'
  ) {
    return null
  }

  return {
    autoSeekToBufferedEnd: payload.autoSeekToBufferedEnd,
    autoDownloadOnComplete: payload.autoDownloadOnComplete,
    capturedMediaSizeBytes: payload.capturedMediaSizeBytes,
    clearCacheOnComplete: payload.clearCacheOnComplete,
    currentFileName: payload.currentFileName,
    isCaptureComplete: payload.isCaptureComplete,
    manualFileName: payload.manualFileName,
    regexWarning: payload.regexWarning,
    regexRule: payload.regexRule,
    restartAlwaysFromBeginning: payload.restartAlwaysFromBeginning,
    selectorWarning: payload.selectorWarning,
    selectorRule: payload.selectorRule,
    streamCount: payload.streamCount,
    trimExtraMediaHeaders: payload.trimExtraMediaHeaders,
  }
}

export async function getEmbeddedBrowserCatchToolkitState(
  executeScript: EmbeddedBrowserPageScriptExecutor,
) {
  const result = await executeScript(createEmbeddedBrowserCatchToolkitGetStateScript())
  return normalizeCatchToolkitStatePayload(result)
}

export async function updateEmbeddedBrowserCatchToolkitState(
  executeScript: EmbeddedBrowserPageScriptExecutor,
  payload: Partial<EmbeddedBrowserCatchToolkitStatePayload>,
) {
  const result = await executeScript(
    createEmbeddedBrowserCatchToolkitUpdateStateScript(payload),
  )
  return normalizeCatchToolkitStatePayload(result)
}

export async function runEmbeddedBrowserCatchToolkitAction(
  executeScript: EmbeddedBrowserPageScriptExecutor,
  action: 'clearCatchMediaCache' | 'downloadCatchMedia' | 'restartCatchMediaCapture',
) {
  const result = await executeScript(
    createEmbeddedBrowserCatchToolkitActionScript(action),
  )
  return Boolean(result)
}
