export const EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:'
export const EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE_INSTALL_ERROR__'

const probeRuntimeNames = [
  'MSE_FLUSH_THRESHOLD_BYTES',
  'arrayBufferToBase64',
  'attachTrackedMediaElement',
  'autoRestartHandledMediaElements',
  'bindTrackedMediaElements',
  'buildCatchToolkitState',
  'catchToolkitProjection',
  'classifyKind',
  'clearCatchMediaCacheInternal',
  'clearMseFlushTimer',
  'cloneChunk',
  'combineArrayBuffers',
  'createMseExportName',
  'createMseResourceKey',
  'currentLocationHref',
  'downloadCatchMediaInternal',
  'drainMseResource',
  'emit',
  'emitMseStream',
  'emitMseStreamReset',
  'emitProbeConsolePayload',
  'ensureMseStreamBlobUrl',
  'ensureTrackedMediaObserver',
  'exportMseResource',
  'finalizeMseStream',
  'flushMseStreamBuffers',
  'getChunkBytes',
  'globalScope',
  'guessExtensionFromMimeType',
  'isCaptureComplete',
  'isMp4HeaderChunk',
  'isWebmHeaderChunk',
  'isWorkerScope',
  'mediaSourceStreams',
  'mseSequence',
  'mseStreams',
  'normalizeBuffersForPlayback',
  'openMseResource',
  'openWindow',
  'probeDiagnostics',
  'readMseResource',
  'resolveMseCaptureFileName',
  'restartCatchMediaCaptureInternal',
  'scheduleMseStreamFlush',
  'seen',
  'trackedMediaElements',
  'trackedMediaObserver',
  'workerRelayKey',
] as const

export function createProbeBodySource(fn: (...args: never[]) => unknown) {
  const source = fn.toString()
  const bodyStart = source.indexOf('{')
  const bodyEnd = source.lastIndexOf('}')
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) return ''
  const body = source.slice(bodyStart + 1, bodyEnd).trim()
  return probeRuntimeNames.reduce((nextSource, name) => {
    return nextSource.replace(new RegExp(`\\b${name}\\d+\\b`, 'g'), name)
  }, body)
}

/**
 * Generic document-start composition boundary. Capability owners provide body
 * sources in dependency order; this template only supplies the guarded IIFE
 * and install-error projection consumed by Electron diagnostics.
 */
export function createProbeScriptTemplate(input: {
  bodySources: string[]
  consolePrefix: string
}) {
  return [
    ';(() => {',
    'try {',
    `delete globalThis[${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}];`,
    `const consolePrefix = ${JSON.stringify(input.consolePrefix)};`,
    ...input.bodySources.filter(source => String(source || '').trim()),
    "return 'installed';",
    '} catch (error) {',
    `try { globalThis[${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}] = { message: error instanceof Error ? error.message : String(error), name: error && error.name ? String(error.name) : '', stack: error && error.stack ? String(error.stack).slice(0, 600) : '', at: Date.now() }; } catch (_) {}`,
    "return 'install-error';",
    '}',
    '})();',
  ].join('\n')
}
