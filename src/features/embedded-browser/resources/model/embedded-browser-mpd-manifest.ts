/**
 * Renderer-facing MPD DTO compatibility facade.
 *
 * Parsing behavior belongs to the pure Cat Catch port in
 * `electron/service/embedded-browser/cat-catch-port/dash/parser.ts`.
 * This module only adapts the browser XML DOM and keeps the existing feature
 * model stable while the DASH download owner is migrated separately.
 */

import {
  parseDashManifest,
  type DashByteRange,
  type DashContentProtection,
  type DashManifest,
  type DashXmlElement,
} from '../../../../../electron/service/embedded-browser/cat-catch-port/dash/parser'

export type EmbeddedBrowserMpdContentProtection = DashContentProtection

export type EmbeddedBrowserMpdSegment = {
  byteRange?: DashByteRange
  duration?: number
  index: number
  number?: number
  time?: number
  url: string
}

export type EmbeddedBrowserMpdRepresentation = {
  bandwidth?: number
  baseUrls?: string[]
  codecs?: string
  contentType: 'audio' | 'video' | 'unknown'
  frameRate?: string
  height?: number
  id: string
  initializationRange?: DashByteRange
  initializationUrl?: string
  language?: string
  mimeType?: string
  segmentCount: number
  segments: EmbeddedBrowserMpdSegment[]
  unsupportedReasons?: string[]
  width?: number
}

export type EmbeddedBrowserMpdManifest = {
  baseUrl: string
  baseUrls?: string[]
  durationSeconds?: number
  hasDrm: boolean
  isDynamic?: boolean
  minimumUpdatePeriodSeconds?: number
  protections: EmbeddedBrowserMpdContentProtection[]
  representations: EmbeddedBrowserMpdRepresentation[]
  unsupportedReasons?: string[]
}

export type EmbeddedBrowserMpdDownloadPlanRepresentation = {
  bandwidth?: number
  baseUrls?: string[]
  codecs?: string
  contentType: EmbeddedBrowserMpdRepresentation['contentType']
  frameRate?: string
  height?: number
  id: string
  initializationRange?: DashByteRange
  initializationUrl?: string
  language?: string
  mimeType?: string
  segmentCount: number
  segments: EmbeddedBrowserMpdSegment[]
  unsupportedReasons?: string[]
  width?: number
}

export type EmbeddedBrowserMpdDownloadPlan = {
  durationSeconds?: number
  hasDrm: boolean
  headers: Record<string, string>
  isDynamic?: boolean
  manifestUrl: string
  minimumUpdatePeriodSeconds?: number
  pageUrl?: string
  protections: EmbeddedBrowserMpdContentProtection[]
  representations: EmbeddedBrowserMpdDownloadPlanRepresentation[]
  unsupportedReasons?: string[]
}

function getLocalName(element: Element) {
  return element.localName || element.nodeName.split(':').pop() || element.nodeName
}

function toDashXmlElement(element: Element): DashXmlElement {
  const attributes: Record<string, string> = {}
  Array.from(element.attributes).forEach((item) => {
    attributes[item.name] = item.value
  })
  return {
    attributes,
    children: Array.from(element.children).map(toDashXmlElement),
    name: element.nodeName,
    textContent: element.textContent || undefined,
  }
}

function mapManifest(parsed: DashManifest, fallbackBaseUrl: string): EmbeddedBrowserMpdManifest {
  return {
    baseUrl: parsed.baseUrls[0] || fallbackBaseUrl,
    baseUrls: parsed.baseUrls,
    durationSeconds: parsed.durationSeconds,
    hasDrm: parsed.hasDrm,
    isDynamic: parsed.isDynamic,
    minimumUpdatePeriodSeconds: parsed.minimumUpdatePeriodSeconds,
    protections: parsed.protections,
    representations: parsed.representations.map(representation => ({
      bandwidth: representation.bandwidth,
      baseUrls: representation.baseUrls,
      codecs: representation.codecs,
      contentType: representation.contentType,
      frameRate: representation.frameRate,
      height: representation.height,
      id: representation.id,
      initializationRange: representation.initializationRange,
      initializationUrl: representation.initializationUrl,
      language: representation.language,
      mimeType: representation.mimeType,
      segmentCount: representation.segmentCount,
      segments: representation.segments,
      unsupportedReasons: representation.unsupportedReasons,
      width: representation.width,
    })),
    unsupportedReasons: parsed.unsupportedReasons,
  }
}

export function parseEmbeddedBrowserMpdManifest(input: {
  baseUrl: string
  text: string
}): EmbeddedBrowserMpdManifest {
  const document = new DOMParser().parseFromString(input.text, 'application/xml')
  const root = document.documentElement
  if (!root || getLocalName(root) !== 'MPD') {
    throw new Error('这条资源不像 MPD manifest')
  }
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('MPD XML 解析失败')
  }
  return mapManifest(parseDashManifest({
    baseUrl: String(input.baseUrl || ''),
    root: toDashXmlElement(root),
    text: input.text,
  }), String(input.baseUrl || ''))
}

export function createEmbeddedBrowserMpdDownloadPlan(input: {
  headers?: Record<string, string>
  manifest: EmbeddedBrowserMpdManifest
  manifestUrl: string
  pageUrl?: string
}): EmbeddedBrowserMpdDownloadPlan {
  return {
    durationSeconds: input.manifest.durationSeconds,
    hasDrm: input.manifest.hasDrm,
    headers: input.headers || {},
    isDynamic: input.manifest.isDynamic,
    manifestUrl: input.manifestUrl,
    minimumUpdatePeriodSeconds: input.manifest.minimumUpdatePeriodSeconds,
    pageUrl: input.pageUrl,
    protections: input.manifest.protections,
    representations: input.manifest.representations.map(representation => ({
      bandwidth: representation.bandwidth,
      baseUrls: representation.baseUrls,
      codecs: representation.codecs,
      contentType: representation.contentType,
      frameRate: representation.frameRate,
      height: representation.height,
      id: representation.id,
      initializationRange: representation.initializationRange,
      initializationUrl: representation.initializationUrl,
      language: representation.language,
      mimeType: representation.mimeType,
      segmentCount: representation.segmentCount,
      segments: representation.segments,
      unsupportedReasons: representation.unsupportedReasons,
      width: representation.width,
    })),
    unsupportedReasons: input.manifest.unsupportedReasons,
  }
}
