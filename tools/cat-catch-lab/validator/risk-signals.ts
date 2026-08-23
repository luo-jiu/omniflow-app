import { tryReadGitHead } from './git-input.ts'
import { getString, getStringArray, isJsonObject } from './json.ts'
import { readGitSourceText } from './source-validation.ts'
import type { JsonObject, ValidationContext } from './types.ts'

const API_SIGNAL_PATTERNS: Array<{ pattern: RegExp; signals: string[] }> = [
  {
    pattern: /\b(?:ipcMain|ipcRenderer)\.(?:handle|on|invoke|send)|contextBridge|webContents\.send/,
    signals: ['ipc', 'cross-process', 'production-runtime', 'security-boundary'],
  },
  {
    pattern: /executeJavaScript|addScriptToEvaluateOnNewDocument|postMessage|console-message|isolated[- ]world/i,
    signals: ['page-main-boundary', 'untrusted-page', 'isolated-world', 'cross-process', 'security-boundary'],
  },
  {
    pattern: /\bAuthorization\b|\bBearer\b|x-[\w-]*(?:token|key)|auth[-_]?token/i,
    signals: ['authorization-header', 'credentials', 'security-boundary'],
  },
  {
    pattern: /\bCookie\b|requestHeaders|\bReferer\b|requestContexts?ByRequestId/i,
    signals: ['cookie', 'request-context', 'credentials', 'security-boundary'],
  },
  {
    pattern: /AbortController|\bretr(?:y|ies)\b|setInterval|poll(?:er|ing)?|cancel(?:led|lation)?/i,
    signals: ['retry', 'cancel', 'poller', 'long-task'],
  },
  {
    pattern: /mkdtemp|tmpdir|temp(?:orary)?[-_ ]?(?:file|dir)|workDirectory|createWriteStream|staged[-_ ]output|spool/i,
    signals: ['work-directory', 'staged-output', 'spool', 'temp-file'],
  },
  {
    pattern: /child_process|\bspawn\s*\(|execFile|shell\.openExternal/i,
    signals: ['external-process', 'long-task', 'security-boundary'],
  },
  {
    pattern: /MediaSource|SourceBuffer|\bmse\b/i,
    signals: ['mse', 'large-media', 'long-task'],
  },
  {
    pattern: /m3u8|\bhls\b|EXT-X-/i,
    signals: ['hls', 'large-media', 'long-task'],
  },
  {
    pattern: /\bmpd\b|SegmentTimeline|application\/dash\+xml/i,
    signals: ['dash', 'large-media', 'long-task'],
  },
  {
    pattern: /ffmpeg|ffprobe/i,
    signals: ['ffmpeg', 'large-media', 'long-task', 'external-process'],
  },
  {
    pattern: /session\.webRequest|onResponseStarted|onBeforeSendHeaders|\bfetch\s*\(|XMLHttpRequest|\bWorker\s*\(/,
    signals: ['runtime-adapter', 'production-runtime'],
  },
]

function addMetadataSignals(signals: Set<string>, capability: JsonObject): void {
  const ownerRefs = isJsonObject(capability.ownerRefs) ? capability.ownerRefs : {}
  const searchable = [
    getString(capability.id),
    getString(capability.boundary),
    ...getStringArray(ownerRefs.targetProduction),
    ...getStringArray(ownerRefs.candidate),
    ...getStringArray(ownerRefs.legacy),
  ].filter((value): value is string => Boolean(value)).join(' ').toLowerCase()

  if (getString(capability.origin) === 'cross-boundary') signals.add('cross-process')
  if (/(runtime|capture|network|resource-state|mse|hls|dash|transfer|workflow)/.test(searchable)) {
    signals.add('production-runtime')
  }
  if (/(ipc|preload|renderer|page-hook|page-runtime|console-relay|resource-state)/.test(searchable)) {
    signals.add('cross-process')
  }
  if (/(request-context|credential|authorization|cookie|header)/.test(searchable)) signals.add('credentials')
  if (/(untrusted|nonce|security|console-relay|external-tool)/.test(searchable)) signals.add('security-boundary')
  if (/(task|retry|cancel|poll|mse|hls|dash|transfer|ffmpeg|workflow)/.test(searchable)) signals.add('long-task')
  if (/(temp|spool|staged|workdir|work-directory|output)/.test(searchable)) signals.add('temp-file')
  if (/(mse|hls|dash|media|ffmpeg|fragment|transfer)/.test(searchable)) signals.add('large-media')
}

function addSourceSignals(signals: Set<string>, sourceText: string): void {
  for (const rule of API_SIGNAL_PATTERNS) {
    if (!rule.pattern.test(sourceText)) continue
    for (const signal of rule.signals) signals.add(signal)
  }
}

function anchorWindow(sourceText: string, anchor: string | null): string {
  if (!anchor) return sourceText.slice(0, 128 * 1024)
  const anchorIndex = sourceText.indexOf(anchor)
  if (anchorIndex < 0) return sourceText.slice(0, 128 * 1024)
  return sourceText.slice(Math.max(0, anchorIndex - 4096), anchorIndex + anchor.length + 4096)
}

function addSourceReferenceSignals(
  signals: Set<string>,
  repositoryRoot: string,
  commit: string | null,
  source: unknown,
): void {
  if (!isJsonObject(source)) return
  const sourceText = readGitSourceText(repositoryRoot, commit, source)
  if (!sourceText) return
  addSourceSignals(signals, anchorWindow(sourceText, getString(source.anchor) || getString(source.symbol)))
}

function ownerRefToSource(ownerRef: string): JsonObject {
  const [ownerPath, ...anchorParts] = ownerRef.split('#')
  return { path: ownerPath, anchor: anchorParts.join('#') || null }
}

export function deriveCapabilityRiskSignals(
  context: ValidationContext,
  capability: JsonObject,
): Set<string> {
  const signals = new Set(getStringArray(capability.additionalRiskTags))
  addMetadataSignals(signals, capability)

  const upstreamState = context.documents.get('upstream-state.json')
  const upstreamCommit = getString(capability.auditedThrough) || getString(upstreamState?.observedHead)
  for (const source of Array.isArray(capability.upstreamSources) ? capability.upstreamSources : []) {
    addSourceReferenceSignals(signals, context.upstreamRoot, upstreamCommit, source)
  }

  const appCommit = tryReadGitHead(context.appRoot)
  for (const source of Array.isArray(capability.localContractRefs) ? capability.localContractRefs : []) {
    addSourceReferenceSignals(signals, context.appRoot, appCommit, source)
  }
  const ownerRefs = isJsonObject(capability.ownerRefs) ? capability.ownerRefs : {}
  for (const ownerRef of [
    ...getStringArray(ownerRefs.targetProduction),
    ...getStringArray(ownerRefs.candidate),
    ...getStringArray(ownerRefs.legacy),
  ]) {
    addSourceReferenceSignals(signals, context.appRoot, appCommit, ownerRefToSource(ownerRef))
  }

  const inventory = context.documents.get('legacy-inventory.json')
  const capabilityId = getString(capability.id)
  const inventoryEntries = Array.isArray(inventory?.entries) ? inventory.entries : []
  for (const entry of inventoryEntries) {
    if (!isJsonObject(entry) || entry.entryType !== 'current-node' || entry.capabilityId !== capabilityId) continue
    addSourceReferenceSignals(signals, context.appRoot, appCommit, entry)
  }
  return signals
}
