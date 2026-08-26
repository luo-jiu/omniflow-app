/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under GPL-3.0-only
 */
import { embeddedBrowserResourceProbePageActionsBody } from './embeddedBrowserResourceProbePageActions'
import { embeddedBrowserResourceProbeManifestHeuristicsBody } from './embeddedBrowserResourceProbeManifestHeuristics'
import { embeddedBrowserResourceProbeRuntimeCoreBody } from './embeddedBrowserResourceProbeRuntimeCore'
import { embeddedBrowserResourceProbeRuntimeHooksBody } from './embeddedBrowserResourceProbeRuntimeHooks'

export const EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:'
export const EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE_INSTALL_ERROR__'

function getScriptFunctionBody(fn: (...args: never[]) => unknown) {
  const source = fn.toString()
  const bodyStart = source.indexOf('{')
  const bodyEnd = source.lastIndexOf('}')
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
    return ''
  }
  return source.slice(bodyStart + 1, bodyEnd).trim()
}

const probeRuntimeNames = [
  'addBaseUrl',
  'arrayBufferToBase64',
  'attachTrackedMediaElement',
  'autoRestartHandledMediaElements',
  'base64ToArrayBuffer',
  'bindTrackedMediaElements',
  'buildCatchToolkitState',
  'catchToolkitState',
  'catchToolkitStorageKeys',
  'classifyGeneratedResource',
  'classifyKind',
  'clearCatchMediaCacheInternal',
  'cloneChunk',
  'consumeWorkerRelayMessage',
  'createMseExportName',
  'createMseResourceKey',
  'createProbeBlobResource',
  'createProbeResourceFileName',
  'createProbeResourceKey',
  'createVimeoManifestBlobUrl',
  'currentLocationHost',
  'currentLocationHref',
  'currentLocationProtocol',
  'dataUrlPattern',
  'decodeDataUrlText',
  'decodeXmlEntities',
  'dedupeResourceKey',
  'downloadCatchMediaInternal',
  'emit',
  'emitGeneratedResource',
  'emitInlineManifest',
  'emitKeyCandidateFromBase64',
  'emitKeyCandidateFromBuffer',
  'emitKeyCandidateFromHex',
  'emitM3u8DataKeyReference',
  'emitM3u8ManifestWithBase',
  'emitM3u8ReferenceResource',
  'emitM3u8ReferenceResources',
  'emitMpdReferenceResource',
  'emitMpdReferenceResources',
  'emitMseStream',
  'emitVimeoPlaylistManifest',
  'ensureMseStreamBlobUrl',
  'ensureTrackedMediaObserver',
  'evaluateRegexRule',
  'evaluateSelectorRule',
  'exportMseResource',
  'exportProbeResource',
  'finalizeMseStream',
  'getBaseUrl',
  'getCurrentDocumentTitle',
  'getExtension',
  'getM3u8PendingSignature',
  'getM3u8References',
  'globalScope',
  'guessExtensionFromMimeType',
  'hasRelativeM3u8References',
  'hydrateCatchToolkitStateFromStorage',
  'imageExtensions',
  'imagePattern',
  'inferStreamTypeFromPath',
  'isCaptureComplete',
  'isEmittingKeyCandidate',
  'isLikelyBase64Key',
  'isLikelyHexKey',
  'isMp4HeaderChunk',
  'isRepeatedExpansion',
  'isWebmHeaderChunk',
  'isWorkerScope',
  'keyExtensions',
  'keyPattern',
  'knownManifestBaseUrls',
  'likelyUrlPattern',
  'm3u8Accumulator',
  'manifestExtensions',
  'manifestPattern',
  'mediaExtensions',
  'mediaPattern',
  'mediaSourceStreams',
  'mseSequence',
  'mseStreams',
  'normalizeBuffersForPlayback',
  'normalizePotentialKeyBuffer',
  'openMseResource',
  'openProbeResource',
  'openWindow',
  'originalConsoleInfo',
  'originalJSONParse',
  'pdfPattern',
  'pendingM3u8TextsBySignature',
  'persistCatchToolkitState',
  'probeDiagnostics',
  'probeResourceKeysBySignature',
  'probeResourceSequence',
  'probeResources',
  'readCatchToolkitStorageChecked',
  'readCatchToolkitStorageString',
  'readMseResource',
  'readProbeResource',
  'registerManifestBaseUrl',
  'relayEnvelope',
  'reportCandidate',
  'requestHeadersByUrl',
  'resolveCatchToolkitFileName',
  'resolveM3u8Reference',
  'resolveMpdBaseUrl',
  'resolveMpdReferenceUrl',
  'restartCatchMediaCaptureInternal',
  'sanitizeFileName',
  'scanInlineScriptResourceCandidates',
  'seen',
  'subtitleExtensions',
  'subtitlePattern',
  'textToBase64',
  'toAbsoluteUrl',
  'trackedMediaElements',
  'trackedMediaObserver',
  'uint16ArrayToUint8Array',
  'uint32ArrayToUint8Array',
  'vimeoPlaylistPattern',
  'vimeoPlaylistUrls',
  'walkValue',
  'workerRelayKey',
  'writeCatchToolkitStorageChecked',
  'writeCatchToolkitStorageString',
] as const

function restoreProbeRuntimeNames(source: string) {
  return probeRuntimeNames.reduce((nextSource, name) => {
    return nextSource.replace(new RegExp(`\\b${name}\\d+\\b`, 'g'), name)
  }, source)
}

function createProbeBootstrapFunctionSource() {
  return `function createProbeBootstrapSource(nextConsolePrefix) {
  return [
    ';(() => {',
    'try {',
    'delete globalThis[' + JSON.stringify(${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}) + '];',
    'const consolePrefix = ' + JSON.stringify(String(nextConsolePrefix || '')) + ';',
    'const probeRuntimeCoreBodySource = ' + JSON.stringify(probeRuntimeCoreBodySource) + ';',
    'const probeManifestHeuristicsBodySource = ' + JSON.stringify(probeManifestHeuristicsBodySource) + ';',
    'const probePageActionsBodySource = ' + JSON.stringify(probePageActionsBodySource) + ';',
    'const probeRuntimeHooksBodySource = ' + JSON.stringify(probeRuntimeHooksBodySource) + ';',
    createProbeBootstrapSource.toString(),
    probeRuntimeCoreBodySource,
    probeManifestHeuristicsBodySource,
    probePageActionsBodySource,
    probeRuntimeHooksBodySource,
    "return 'installed';",
    '} catch (error) {',
    'try { globalThis[' + JSON.stringify(${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}) + '] = { message: error instanceof Error ? error.message : String(error), name: error && error.name ? String(error.name) : "", stack: error && error.stack ? String(error.stack).slice(0, 600) : "", at: Date.now() }; } catch (_) {}',
    "return 'install-error';",
    '}',
    '})();',
  ].join('\\n')
}`
}

export function createProbeScriptTemplate(input: {
  consolePrefix: string
  manifestHeuristicsBodySource: string
  pageActionsBodySource: string
  runtimeCoreBodySource: string
  runtimeHooksBodySource: string
}) {
  return [
    ';(() => {',
    'try {',
    `delete globalThis[${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}];`,
    `const consolePrefix = ${JSON.stringify(input.consolePrefix)};`,
    `const probeRuntimeCoreBodySource = ${JSON.stringify(input.runtimeCoreBodySource)};`,
    `const probeManifestHeuristicsBodySource = ${JSON.stringify(input.manifestHeuristicsBodySource)};`,
    `const probePageActionsBodySource = ${JSON.stringify(input.pageActionsBodySource)};`,
    `const probeRuntimeHooksBodySource = ${JSON.stringify(input.runtimeHooksBodySource)};`,
    createProbeBootstrapFunctionSource(),
    input.runtimeCoreBodySource,
    input.manifestHeuristicsBodySource,
    input.pageActionsBodySource,
    input.runtimeHooksBodySource,
    "return 'installed';",
    '} catch (error) {',
    `try { globalThis[${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}] = { message: error instanceof Error ? error.message : String(error), name: error && error.name ? String(error.name) : '', stack: error && error.stack ? String(error.stack).slice(0, 600) : '', at: Date.now() }; } catch (_) {}`,
    "return 'install-error';",
    '}',
    '})();',
  ].join('\n')
}

export function createEmbeddedBrowserResourceProbeScript(input?: {
  consolePrefix?: string
}) {
  const consolePrefix = String(input?.consolePrefix || '').trim()
    || EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX
  return createProbeScriptTemplate({
    consolePrefix,
    manifestHeuristicsBodySource: restoreProbeRuntimeNames(getScriptFunctionBody(embeddedBrowserResourceProbeManifestHeuristicsBody)),
    pageActionsBodySource: restoreProbeRuntimeNames(getScriptFunctionBody(embeddedBrowserResourceProbePageActionsBody)),
    runtimeCoreBodySource: restoreProbeRuntimeNames(getScriptFunctionBody(embeddedBrowserResourceProbeRuntimeCoreBody)),
    runtimeHooksBodySource: restoreProbeRuntimeNames(getScriptFunctionBody(embeddedBrowserResourceProbeRuntimeHooksBody)),
  })
}
