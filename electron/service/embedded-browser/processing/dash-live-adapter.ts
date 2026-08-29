/**
 * Main-side MPD snapshot adapter for the DASH live task.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/mpd.js#showSegment and lib/mpd-parser.min.js#parse
 * Reason: the live owner needs a real MPD snapshot, while XML parsing and
 * browser-session access must stay outside the pure parser and task owner.
 * Adaptation: fetch is injected by the main process and may be bound to the
 * captured-resource authority; renderer DOM and renderer headers are never
 * used here.
 */

import { DOMParser } from '@xmldom/xmldom'

import type { EmbeddedBrowserFragmentFetch } from '../../embeddedBrowserFragmentDownloader'
import {
  parseDashManifest,
  type DashXmlElement,
} from '../cat-catch-port/dash/parser'
import type { DashLiveTaskSnapshotLoader } from './dash-live-task'
import type { DashTaskPlan } from './dash-task'

export const DEFAULT_DASH_MPD_MAX_BYTES = 8 * 1024 * 1024

export type DashLiveSnapshotAdapterOptions = {
  clientOffsetMs?: number
  fetch: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  manifestUrl: string
  maxManifestBytes?: number
  nowMs?: () => number
}

export type DashLiveSnapshotRequest = {
  clientOffsetMs?: number
  fetch: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  manifestUrl: string
  maxManifestBytes?: number
  nowMs?: () => number
  signal?: AbortSignal
}

function normalizeMaximumBytes(value: unknown) {
  const normalized = Math.floor(Number(value))
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : DEFAULT_DASH_MPD_MAX_BYTES
}

function createAbortError() {
  const error = new Error('DASH MPD 请求已取消')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError()
}

function normalizeHeaders(headers?: Record<string, string>) {
  const normalized = new Headers()
  Object.entries(headers || {}).forEach(([name, value]) => {
    const normalizedName = String(name || '').trim()
    const normalizedValue = String(value || '').trim()
    if (normalizedName && normalizedValue) normalized.set(normalizedName, normalizedValue)
  })
  return normalized
}

async function readResponseText(response: Response, maxBytes: number) {
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10)
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`DASH MPD 响应超过 ${maxBytes} 字节限制`)
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value
      if (receivedBytes + chunk.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`DASH MPD 响应超过 ${maxBytes} 字节限制`)
      }
      chunks.push(chunk)
      receivedBytes += chunk.byteLength
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(receivedBytes)
  let offset = 0
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  })
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('DASH MPD 响应不是有效的 UTF-8 文本')
  }
}

function getLocalName(name: string) {
  return String(name || '').split(':').pop() || String(name || '')
}

function toDashXmlElement(element: Element): DashXmlElement {
  const attributes: Record<string, string> = {}
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index)
    if (attribute) attributes[attribute.name] = attribute.value
  }
  const children: DashXmlElement[] = []
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index)
    if (child?.nodeType === 1) children.push(toDashXmlElement(child as Element))
  }
  return {
    attributes,
    children,
    name: element.nodeName,
    textContent: element.textContent || undefined,
  }
}

function parseMpdXml(text: string) {
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(text)) {
    throw new Error('DASH MPD 不允许包含 DOCTYPE 或 ENTITY')
  }
  const parserErrors: string[] = []
  const document = new DOMParser({
    errorHandler: {
      error: message => parserErrors.push(String(message)),
      fatalError: message => parserErrors.push(String(message)),
      warning: () => undefined,
    },
  }).parseFromString(text, 'application/xml')
  if (parserErrors.length) throw new Error(`DASH MPD XML 解析失败：${parserErrors[0]}`)
  const root = document.documentElement
  if (!root || getLocalName(root.nodeName) !== 'MPD') {
    throw new Error('这条资源不像 MPD manifest')
  }
  return toDashXmlElement(root)
}

function toDashTaskPlan(
  parsed: ReturnType<typeof parseDashManifest>,
  input: { headers?: Record<string, string>; manifestUrl: string },
): DashTaskPlan {
  return {
    durationSeconds: parsed.durationSeconds,
    hasDrm: parsed.hasDrm,
    headers: input.headers,
    isDynamic: parsed.isDynamic,
    manifestUrl: input.manifestUrl,
    minimumUpdatePeriodSeconds: parsed.minimumUpdatePeriodSeconds,
    representations: parsed.representations,
    unsupportedReasons: parsed.unsupportedReasons,
  }
}

export async function loadDashLiveSnapshot(input: DashLiveSnapshotRequest): Promise<DashTaskPlan> {
  const manifestUrl = String(input.manifestUrl || '').trim()
  if (!manifestUrl) throw new Error('缺少 DASH MPD 地址')
  throwIfAborted(input.signal)
  const response = await input.fetch(manifestUrl, {
    headers: normalizeHeaders(input.headers),
    signal: input.signal,
  })
  throwIfAborted(input.signal)
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`DASH MPD 请求失败：HTTP ${response.status}`)
  }
  const text = await readResponseText(response, normalizeMaximumBytes(input.maxManifestBytes))
  throwIfAborted(input.signal)
  const root = parseMpdXml(text)
  const parsed = parseDashManifest({
    baseUrl: manifestUrl,
    clientOffsetMs: input.clientOffsetMs,
    nowMs: input.nowMs?.(),
    root,
    text,
  })
  return toDashTaskPlan(parsed, {
    headers: input.headers,
    manifestUrl,
  })
}

export function createDashLiveSnapshotLoader(
  options: DashLiveSnapshotAdapterOptions,
): DashLiveTaskSnapshotLoader {
  return ({ previousPlan, signal }) => loadDashLiveSnapshot({
    clientOffsetMs: options.clientOffsetMs,
    fetch: options.fetch,
    headers: options.headers,
    manifestUrl: previousPlan?.manifestUrl || options.manifestUrl,
    maxManifestBytes: options.maxManifestBytes,
    nowMs: options.nowMs,
    signal,
  })
}

export const __dashLiveAdapterInternals = {
  parseMpdXml,
  readResponseText,
  toDashXmlElement,
}
