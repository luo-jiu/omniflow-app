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
    typeof payload.audioResourceKey !== 'string'
    || typeof payload.audioSizeBytes !== 'number'
    || typeof payload.autoSeekToBufferedEnd !== 'boolean'
    || typeof payload.autoDownloadOnComplete !== 'boolean'
    || typeof payload.capturedMediaSizeBytes !== 'number'
    || typeof payload.clearCacheOnComplete !== 'boolean'
    || typeof payload.currentFileName !== 'string'
    || !payload.diagnostics
    || typeof payload.diagnostics !== 'object'
    || typeof payload.diagnostics.appendBufferCount !== 'number'
    || typeof payload.diagnostics.frameUrl !== 'string'
    || typeof payload.diagnostics.hookErrors !== 'number'
    || typeof payload.diagnostics.installedAt !== 'number'
    || typeof payload.diagnostics.lastAppendAt !== 'number'
    || typeof payload.diagnostics.lastError !== 'string'
    || typeof payload.diagnostics.mediaSourceAvailable !== 'boolean'
    || typeof payload.diagnostics.mediaSourceHooked !== 'boolean'
    || typeof payload.diagnostics.sourceBufferCount !== 'number'
    || typeof payload.isCaptureComplete !== 'boolean'
    || typeof payload.manualFileName !== 'string'
    || typeof payload.primaryResourceKey !== 'string'
    || typeof payload.regexWarning !== 'string'
    || typeof payload.regexRule !== 'string'
    || typeof payload.restartAlwaysFromBeginning !== 'boolean'
    || typeof payload.saveEveryGigabyte !== 'boolean'
    || typeof payload.selectorWarning !== 'string'
    || typeof payload.selectorRule !== 'string'
    || typeof payload.streamCount !== 'number'
    || typeof payload.trimExtraMediaHeaders !== 'boolean'
    || typeof payload.videoResourceKey !== 'string'
    || typeof payload.videoSizeBytes !== 'number'
  ) {
    return null
  }

  return {
    audioResourceKey: payload.audioResourceKey,
    audioSizeBytes: payload.audioSizeBytes,
    autoSeekToBufferedEnd: payload.autoSeekToBufferedEnd,
    autoDownloadOnComplete: payload.autoDownloadOnComplete,
    capturedMediaSizeBytes: payload.capturedMediaSizeBytes,
    clearCacheOnComplete: payload.clearCacheOnComplete,
    currentFileName: payload.currentFileName,
    diagnostics: {
      appendBufferCount: payload.diagnostics.appendBufferCount,
      frameCount: typeof payload.diagnostics.frameCount === 'number' ? payload.diagnostics.frameCount : undefined,
      frameUrl: payload.diagnostics.frameUrl,
      hookErrors: payload.diagnostics.hookErrors,
      installedAt: payload.diagnostics.installedAt,
      lastAppendAt: payload.diagnostics.lastAppendAt,
      lastError: payload.diagnostics.lastError,
      mediaSourceAvailable: payload.diagnostics.mediaSourceAvailable,
      mediaSourceHooked: payload.diagnostics.mediaSourceHooked,
      sourceBufferCount: payload.diagnostics.sourceBufferCount,
    },
      isCaptureComplete: payload.isCaptureComplete,
    manualFileName: payload.manualFileName,
    primaryResourceKey: payload.primaryResourceKey,
    regexWarning: payload.regexWarning,
    regexRule: payload.regexRule,
    restartAlwaysFromBeginning: payload.restartAlwaysFromBeginning,
    saveEveryGigabyte: payload.saveEveryGigabyte,
    selectorWarning: payload.selectorWarning,
    selectorRule: payload.selectorRule,
    streamCount: payload.streamCount,
    trimExtraMediaHeaders: payload.trimExtraMediaHeaders,
    videoResourceKey: payload.videoResourceKey,
    videoSizeBytes: payload.videoSizeBytes,
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
