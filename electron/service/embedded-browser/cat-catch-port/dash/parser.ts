/**
 * DASH parser behavior ported from the pinned Cat Catch MPD workflow.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/mpd.js#parseMPD and lib/mpd-parser.min.js#parse
 * Reason: MPD playback plans inherit BaseURL/segment info values across
 * MPD, Period, AdaptationSet and Representation, while the page exposes
 * concrete audio/video segment lists and DRM evidence.
 * Adaptation: the pure port receives a platform-neutral XML AST. DOMParser
 * setup stays in the renderer/main adapter and is not part of this module.
 * Fixtures: dash.parser-core, dash.base-url-timeline-ranges,
 * dash.segment-base-and-period-boundary
 */

export type DashXmlElement = {
  attributes?: Readonly<Record<string, string>>
  children?: readonly DashXmlElement[]
  name: string
  textContent?: string
}

export type DashXmlParser = (text: string) => DashXmlElement

export type DashByteRange = {
  length: number
  offset: number
  raw: string
}

export type DashSegment = {
  byteRange?: DashByteRange
  duration?: number
  index: number
  number?: number
  time?: number
  url: string
}

export type DashSegmentBase = {
  indexRange: DashByteRange
  presentationTimeOffset?: number
  timescale?: number
}

export type DashContentProtection = {
  encryptionType: 'Widevine' | 'Microsoft PlayReady' | 'Apple FairPlay' | 'Unknown'
  pssh?: string
  schemeIdUri: string
}

export type DashRepresentation = {
  bandwidth?: number
  baseUrls: string[]
  codecs?: string
  contentType: 'audio' | 'video' | 'unknown'
  frameRate?: string
  height?: number
  id: string
  initializationRange?: DashByteRange
  initializationUrl?: string
  language?: string
  mimeType?: string
  segmentBase?: DashSegmentBase
  segmentCount: number
  segments: DashSegment[]
  unsupportedReasons: string[]
  width?: number
}

export type DashManifest = {
  baseUrls: string[]
  durationSeconds?: number
  hasDrm: boolean
  isDynamic: boolean
  minimumUpdatePeriodSeconds?: number
  protections: DashContentProtection[]
  representations: DashRepresentation[]
  unsupportedReasons: string[]
}

const MAX_EXPANDED_SEGMENTS = 10000

function localName(element: DashXmlElement) {
  return String(element.name || '').split(':').pop() || String(element.name || '')
}

function children(element: DashXmlElement | undefined, name: string) {
  return (element?.children || []).filter(child => localName(child) === name)
}

function firstChild(element: DashXmlElement | undefined, name: string) {
  return children(element, name)[0]
}

function attribute(element: DashXmlElement | undefined, name: string) {
  const value = element?.attributes?.[name]
  return value === undefined ? undefined : String(value)
}

function numberAttribute(element: DashXmlElement | undefined, name: string) {
  const value = attribute(element, name)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function textContent(element: DashXmlElement | undefined) {
  return String(element?.textContent || '').trim()
}

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function resolveUrl(reference: string, baseUrl: string) {
  const normalizedReference = String(reference || '').trim()
  if (!normalizedReference) return ''
  if (/^(data|blob|javascript):/i.test(normalizedReference)) return normalizedReference
  try {
    return new URL(normalizedReference, baseUrl).toString()
  } catch {
    return normalizedReference
  }
}

function resolveBaseUrls(parentBaseUrls: string[], element: DashXmlElement | undefined) {
  const references = children(element, 'BaseURL')
    .map(textContent)
    .filter(Boolean)
  if (!references.length) return parentBaseUrls
  return dedupe(parentBaseUrls.flatMap(parent => (
    references.map(reference => resolveUrl(reference, parent))
  )))
}

function pickAttribute(elements: Array<DashXmlElement | undefined>, name: string) {
  for (const element of elements) {
    const value = attribute(element, name)
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

function parseIsoDurationSeconds(value?: string) {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) return undefined
  const match = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(normalizedValue)
  if (!match) return undefined
  const [, years, months, days, hours, minutes, seconds] = match
  return (Number(years || 0) * 365 * 24 * 60 * 60)
    + (Number(months || 0) * 30 * 24 * 60 * 60)
    + (Number(days || 0) * 24 * 60 * 60)
    + (Number(hours || 0) * 60 * 60)
    + (Number(minutes || 0) * 60)
    + Number(seconds || 0)
}

function parseByteRange(value?: string) {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) return undefined
  const match = /^(\d+)-(\d+)$/.exec(normalizedValue)
  if (!match) return undefined
  const offset = Number(match[1])
  const end = Number(match[2])
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || end < offset) {
    return undefined
  }
  return {
    length: end - offset + 1,
    offset,
    raw: normalizedValue,
  } satisfies DashByteRange
}

export function parseDashByteRange(value?: string) {
  return parseByteRange(value)
}

function getEncryptionType(schemeIdUri: string): DashContentProtection['encryptionType'] {
  const normalized = schemeIdUri.toLowerCase()
  if (normalized.includes('edef8ba9-79d6-4ace-a3c8-27dcd51d21ed')) {
    return 'Widevine'
  }
  if (normalized.includes('9a04f079-9840-4286-ab92-e65be0885f95')) {
    return 'Microsoft PlayReady'
  }
  if (normalized.includes('94ce86fb-07ff-4f43-adb8-93d2fa968ca2')) {
    return 'Apple FairPlay'
  }
  return 'Unknown'
}

function collectContentProtections(root: DashXmlElement) {
  const protections: DashContentProtection[] = []
  const visit = (element: DashXmlElement) => {
    if (localName(element) === 'ContentProtection') {
      const schemeIdUri = String(attribute(element, 'schemeIdUri') || '').trim()
      if (schemeIdUri) {
        const pssh = (element.children || []).find(child => {
          const name = localName(child).toLowerCase()
          return name === 'pssh' || name === 'pro'
        })
        protections.push({
          encryptionType: getEncryptionType(schemeIdUri),
          pssh: textContent(pssh) || undefined,
          schemeIdUri,
        })
      }
    }
    const nestedChildren = element.children || []
    nestedChildren.forEach(visit)
  }
  visit(root)
  return [...new Map(protections.map(item => [item.schemeIdUri, item])).values()]
}

function replaceTemplateTokens(template: string, input: {
  bandwidth?: number
  number?: number
  representationId: string
  time?: number
}) {
  return String(template || '')
    .replace(/\$RepresentationID\$/g, input.representationId)
    .replace(/\$Bandwidth\$/g, String(input.bandwidth ?? ''))
    .replace(/\$Time\$/g, String(input.time ?? ''))
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (_match, width: string | undefined) => {
      const numberText = String(input.number ?? '')
      const paddingWidth = Number(width || 0)
      return paddingWidth > 0 ? numberText.padStart(paddingWidth, '0') : numberText
    })
}

function addReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason)
}

function findNextExplicitTime(items: DashXmlElement[], index: number) {
  for (let nextIndex = index + 1; nextIndex < items.length; nextIndex += 1) {
    const nextTime = numberAttribute(items[nextIndex], 't')
    if (nextTime !== undefined) return nextTime
  }
  return undefined
}

type DashSegmentTiming = Pick<DashSegment, 'duration' | 'number' | 'time'>

function expandSegmentTimelineTimings(input: {
  durationSeconds?: number
  number: number
  periodPresentationTimeOffset: number
  timeline: DashXmlElement
  timescale: number
  reasons: string[]
}) {
  const items = children(input.timeline, 'S')
  const timings: DashSegmentTiming[] = []
  let currentNumber = input.number
  let currentTime = 0

  for (const [itemIndex, item] of items.entries()) {
    const duration = numberAttribute(item, 'd')
    if (!duration || duration <= 0) {
      addReason(input.reasons, 'segment-timeline-duration-invalid')
      continue
    }
    const explicitTime = numberAttribute(item, 't')
    if (explicitTime !== undefined) currentTime = explicitTime
    const repeat = numberAttribute(item, 'r') ?? 0
    if (!Number.isInteger(repeat) || repeat < -1) {
      addReason(input.reasons, 'segment-timeline-repeat-invalid')
      continue
    }

    let repeatCount = repeat
    if (repeat === -1) {
      const nextExplicitTime = findNextExplicitTime(items, itemIndex)
      const periodEnd = input.durationSeconds === undefined
        ? undefined
        : input.durationSeconds * input.timescale + input.periodPresentationTimeOffset
      const endTime = nextExplicitTime ?? periodEnd
      if (endTime === undefined) {
        addReason(input.reasons, 'segment-timeline-negative-repeat-unbounded')
        break
      }
      repeatCount = Math.max(0, Math.ceil((endTime - currentTime) / duration) - 1)
    }

    const segmentCount = repeatCount + 1
    for (let repeatIndex = 0; repeatIndex < segmentCount; repeatIndex += 1) {
      if (timings.length >= MAX_EXPANDED_SEGMENTS) {
        addReason(input.reasons, 'segment-expansion-limit')
        return timings
      }
      timings.push({
        duration: duration / input.timescale,
        number: currentNumber,
        time: currentTime,
      })
      currentNumber += 1
      currentTime += duration
    }
  }
  return timings
}

function expandSegmentTimeline(input: {
  baseUrl: string
  durationSeconds?: number
  media: string
  number: number
  periodPresentationTimeOffset: number
  representationId: string
  timeline: DashXmlElement
  timescale: number
  bandwidth?: number
  reasons: string[]
}) {
  return expandSegmentTimelineTimings(input).map((timing, index) => ({
    ...timing,
    index,
    url: resolveUrl(replaceTemplateTokens(input.media, {
      bandwidth: input.bandwidth,
      number: timing.number,
      representationId: input.representationId,
      time: timing.time,
    }), input.baseUrl),
  } satisfies DashSegment))
}

function expandSegmentTemplate(input: {
  baseUrl: string
  durationSeconds?: number
  element?: DashXmlElement
  representationId: string
  bandwidth?: number
  reasons: string[]
}) {
  if (!input.element) {
    return {
      initializationRange: undefined,
      initializationUrl: undefined,
      segments: [] as DashSegment[],
    }
  }
  const attrs = input.element.attributes || {}
  const timescale = Number(attrs.timescale || 1)
  const startNumber = Number(attrs.startNumber || 1)
  const presentationTimeOffset = Number(attrs.presentationTimeOffset || 0)
  const media = String(attrs.media || '')
  const initialization = String(attrs.initialization || '')
  const initializationUrl = initialization
    ? resolveUrl(replaceTemplateTokens(initialization, {
        bandwidth: input.bandwidth,
        number: startNumber,
        representationId: input.representationId,
      }), input.baseUrl)
    : undefined
  const initializationRange = parseByteRange(attribute(firstChild(input.element, 'Initialization'), 'range'))

  if (!Number.isFinite(timescale) || timescale <= 0) {
    addReason(input.reasons, 'segment-template-timescale-invalid')
    return { initializationRange, initializationUrl, segments: [] as DashSegment[] }
  }
  if (!media) {
    addReason(input.reasons, 'segment-template-media-missing')
    return { initializationRange, initializationUrl, segments: [] as DashSegment[] }
  }

  const timeline = firstChild(input.element, 'SegmentTimeline')
  if (timeline) {
    return {
      initializationRange,
      initializationUrl,
      segments: expandSegmentTimeline({
        bandwidth: input.bandwidth,
        baseUrl: input.baseUrl,
        durationSeconds: input.durationSeconds,
        media,
        number: Number.isFinite(startNumber) ? startNumber : 1,
        periodPresentationTimeOffset: Number.isFinite(presentationTimeOffset)
          ? presentationTimeOffset
          : 0,
        representationId: input.representationId,
        reasons: input.reasons,
        timeline,
        timescale,
      }),
    }
  }

  const duration = Number(attrs.duration || 0)
  if (!Number.isFinite(duration) || duration <= 0) {
    addReason(input.reasons, 'segment-template-duration-missing')
    return { initializationRange, initializationUrl, segments: [] as DashSegment[] }
  }
  if (input.durationSeconds === undefined) {
    addReason(input.reasons, 'segment-template-duration-unbounded')
    return { initializationRange, initializationUrl, segments: [] as DashSegment[] }
  }
  const segmentDuration = duration / timescale
  const count = Math.min(MAX_EXPANDED_SEGMENTS, Math.ceil(input.durationSeconds / segmentDuration))
  if (count >= MAX_EXPANDED_SEGMENTS) addReason(input.reasons, 'segment-expansion-limit')
  return {
    initializationRange,
    initializationUrl,
    segments: Array.from({ length: count }, (_item, index) => {
      const number = (Number.isFinite(startNumber) ? startNumber : 1) + index
      const durationForSegment = input.durationSeconds === undefined
        ? segmentDuration
        : Math.max(0, Math.min(
            segmentDuration,
            input.durationSeconds - index * segmentDuration,
          ))
      return {
        duration: durationForSegment,
        index,
        number,
        url: resolveUrl(replaceTemplateTokens(media, {
          bandwidth: input.bandwidth,
          number,
          representationId: input.representationId,
        }), input.baseUrl),
      } satisfies DashSegment
    }),
  }
}

function parseSegmentList(input: {
  baseUrl: string
  durationSeconds?: number
  element?: DashXmlElement
  reasons: string[]
}) {
  if (!input.element) {
    return {
      initializationRange: undefined,
      initializationUrl: undefined,
      segments: [] as DashSegment[],
    }
  }
  const rawDuration = attribute(input.element, 'duration')
  const duration = numberAttribute(input.element, 'duration')
  const rawTimescale = attribute(input.element, 'timescale')
  const timescale = rawTimescale === undefined ? 1 : numberAttribute(input.element, 'timescale')
  if (rawDuration !== undefined && (duration === undefined || duration <= 0)) {
    addReason(input.reasons, 'segment-list-duration-invalid')
  }
  if (rawTimescale !== undefined && (timescale === undefined || timescale <= 0)) {
    addReason(input.reasons, 'segment-list-timescale-invalid')
  }
  const timeline = firstChild(input.element, 'SegmentTimeline')
  if (rawDuration !== undefined && timeline) {
    addReason(input.reasons, 'segment-list-duration-and-timeline-conflict')
  }
  const timelineTimings = timeline && timescale && timescale > 0 && rawDuration === undefined
    ? expandSegmentTimelineTimings({
        durationSeconds: input.durationSeconds,
        number: numberAttribute(input.element, 'startNumber') || 1,
        periodPresentationTimeOffset: numberAttribute(input.element, 'presentationTimeOffset') || 0,
        reasons: input.reasons,
        timeline,
        timescale,
      })
    : undefined
  if (rawDuration === undefined && !timeline) {
    addReason(input.reasons, 'segment-time-unspecified')
  }
  const segmentUrls = children(input.element, 'SegmentURL')
  const segmentDuration = duration !== undefined && timescale !== undefined && timescale > 0
    ? duration / timescale
    : undefined
  const expectedSegmentCount = timelineTimings
    ? timelineTimings.length
    : segmentDuration !== undefined && input.durationSeconds !== undefined
      ? Math.max(0, Math.ceil(input.durationSeconds / segmentDuration))
      : undefined
  const mappedSegmentUrls = expectedSegmentCount === undefined
    ? segmentUrls
    : segmentUrls.slice(0, expectedSegmentCount)
  const initialization = firstChild(input.element, 'Initialization')
  const initializationUrl = attribute(initialization, 'sourceURL')
    ? resolveUrl(attribute(initialization, 'sourceURL') || '', input.baseUrl)
    : undefined
  const rawInitializationRange = attribute(initialization, 'range')
  const initializationRange = parseByteRange(rawInitializationRange)
  if (rawInitializationRange && !initializationRange) {
    addReason(input.reasons, 'segment-list-initialization-range-invalid')
  }
  if (!segmentUrls.length) addReason(input.reasons, 'segment-list-empty')
  return {
    initializationRange,
    initializationUrl,
    segments: mappedSegmentUrls.map((segment, index) => {
      const rawMedia = attribute(segment, 'media')
      const rawMediaRange = attribute(segment, 'mediaRange')
      const byteRange = parseByteRange(rawMediaRange)
      if (!rawMedia || !String(rawMedia).trim()) {
        addReason(input.reasons, 'segment-list-media-url-missing')
      }
      if (rawMediaRange && !byteRange) {
        addReason(input.reasons, 'segment-list-media-range-invalid')
      }
      return {
        byteRange,
        duration: timelineTimings?.[index]?.duration
          ?? (segmentDuration !== undefined
            ? input.durationSeconds === undefined
              ? segmentDuration
              : Math.max(0, Math.min(
                  segmentDuration,
                  input.durationSeconds - index * segmentDuration,
                ))
            : undefined),
        index,
        number: timelineTimings?.[index]?.number,
        time: timelineTimings?.[index]?.time,
        url: resolveUrl(rawMedia || '', input.baseUrl),
      } satisfies DashSegment
    }),
  }
}

function parseSegmentBase(input: {
  baseUrl: string
  element?: DashXmlElement
  reasons: string[]
}) {
  if (!input.element) {
    return {
      initializationRange: undefined,
      initializationUrl: undefined,
      segments: [] as DashSegment[],
    }
  }
  const initialization = firstChild(input.element, 'Initialization')
  const rawIndexRange = attribute(input.element, 'indexRange')
  const indexRange = parseByteRange(rawIndexRange)
  const hasInvalidIndexRange = Boolean(rawIndexRange && !indexRange)
  if (hasInvalidIndexRange) {
    addReason(input.reasons, 'segment-base-index-range-invalid')
  }
  const initializationUrl = attribute(initialization, 'sourceURL')
    ? resolveUrl(attribute(initialization, 'sourceURL') || '', input.baseUrl)
    : undefined
  const rawInitializationRange = attribute(initialization, 'range')
  const initializationRange = parseByteRange(rawInitializationRange)
  const hasInvalidInitializationRange = Boolean(rawInitializationRange && !initializationRange)
  if (hasInvalidInitializationRange) {
    addReason(input.reasons, 'segment-base-initialization-range-invalid')
  }
  if (initializationRange && !indexRange) {
    addReason(input.reasons, 'segment-base-initialization-range-requires-split')
  }
  return {
    initializationRange,
    initializationUrl,
    segmentBase: indexRange
      ? {
          indexRange,
          presentationTimeOffset: numberAttribute(input.element, 'presentationTimeOffset'),
          timescale: numberAttribute(input.element, 'timescale'),
        }
      : undefined,
    // A SegmentBase without an index range is a single media file. Preserve
    // that useful case; indexed media is expanded by the main task after its
    // SIDX range is fetched through the captured-resource authority.
    segments: hasInvalidIndexRange || hasInvalidInitializationRange || indexRange || initializationRange
      ? [] as DashSegment[]
      : [{ index: 0, url: input.baseUrl } satisfies DashSegment],
  }
}

function inferContentType(
  adaptationSet: DashXmlElement,
  representation: DashXmlElement,
): DashRepresentation['contentType'] {
  const contentType = pickAttribute([representation, adaptationSet], 'contentType')
  const mimeType = String(pickAttribute([representation, adaptationSet], 'mimeType') || '').toLowerCase()
  if (contentType === 'audio' || mimeType.startsWith('audio/')) return 'audio'
  if (contentType === 'video' || mimeType.startsWith('video/')) return 'video'
  return 'unknown'
}

function parseRepresentation(input: {
  adaptationSet: DashXmlElement
  baseUrls: string[]
  durationSeconds?: number
  index: number
  periodSegmentBase?: DashXmlElement
  periodSegmentList?: DashXmlElement
  periodSegmentTemplate?: DashXmlElement
  representation: DashXmlElement
}) {
  const representationId = attribute(input.representation, 'id') || String(input.index + 1)
  const reasons: string[] = []
  const representationTemplate = firstChild(input.representation, 'SegmentTemplate')
  const adaptationTemplate = firstChild(input.adaptationSet, 'SegmentTemplate')
  const periodTemplate = input.periodSegmentTemplate
  const templateElement = representationTemplate || adaptationTemplate || periodTemplate
  const effectiveTemplate = templateElement
    ? {
        ...templateElement,
        attributes: {
          ...(periodTemplate?.attributes || {}),
          ...(adaptationTemplate?.attributes || {}),
          ...(representationTemplate?.attributes || {}),
        },
        children: representationTemplate?.children?.length
          ? representationTemplate.children
          : adaptationTemplate?.children?.length
            ? adaptationTemplate.children
            : periodTemplate?.children,
      }
    : undefined
  const templateResult = expandSegmentTemplate({
    bandwidth: numberAttribute(input.representation, 'bandwidth'),
    baseUrl: input.baseUrls[0] || '',
    durationSeconds: input.durationSeconds,
    element: effectiveTemplate,
    representationId,
    reasons,
  })
  const representationList = firstChild(input.representation, 'SegmentList')
  const adaptationList = firstChild(input.adaptationSet, 'SegmentList')
  const periodList = input.periodSegmentList
  const listElement = representationList || adaptationList || periodList
  const effectiveList = listElement
    ? {
        ...listElement,
        attributes: {
          ...(periodList?.attributes || {}),
          ...(adaptationList?.attributes || {}),
          ...(representationList?.attributes || {}),
        },
        children: representationList?.children?.length
          ? representationList.children
          : adaptationList?.children?.length
            ? adaptationList.children
            : periodList?.children,
      }
    : undefined
  const listResult = templateResult.segments.length > 0 || effectiveTemplate
    ? {
        initializationRange: undefined,
        initializationUrl: undefined,
        segments: [] as DashSegment[],
      }
    : parseSegmentList({
        baseUrl: input.baseUrls[0] || '',
        durationSeconds: input.durationSeconds,
        element: effectiveList,
        reasons,
      })
  const representationBase = firstChild(input.representation, 'SegmentBase')
  const adaptationBase = firstChild(input.adaptationSet, 'SegmentBase')
  const periodBase = input.periodSegmentBase
  const segmentBase = representationBase || adaptationBase || periodBase
  const effectiveBase = segmentBase
    ? {
        ...segmentBase,
        attributes: {
          ...(periodBase?.attributes || {}),
          ...(adaptationBase?.attributes || {}),
          ...(representationBase?.attributes || {}),
        },
        children: representationBase?.children?.length
          ? representationBase.children
          : adaptationBase?.children?.length
            ? adaptationBase.children
            : periodBase?.children,
      }
    : undefined
  const baseResult = templateResult.segments.length || listResult.segments.length || effectiveTemplate || listElement
    ? {
        initializationRange: undefined,
        initializationUrl: undefined,
        segments: [] as DashSegment[],
      }
    : parseSegmentBase({ baseUrl: input.baseUrls[0] || '', element: effectiveBase, reasons })
  const segments = templateResult.segments.length > 0
    ? templateResult.segments
    : listResult.segments.length > 0
      ? listResult.segments
      : baseResult.segments
  return {
    bandwidth: numberAttribute(input.representation, 'bandwidth'),
    baseUrls: input.baseUrls,
    codecs: pickAttribute([input.representation, input.adaptationSet], 'codecs'),
    contentType: inferContentType(input.adaptationSet, input.representation),
    frameRate: pickAttribute([input.representation, input.adaptationSet], 'frameRate'),
    height: numberAttribute(input.representation, 'height')
      ?? numberAttribute(input.adaptationSet, 'height'),
    id: representationId,
    initializationRange: templateResult.initializationRange
      || listResult.initializationRange
      || baseResult.initializationRange,
    initializationUrl: templateResult.initializationUrl
      || listResult.initializationUrl
      || baseResult.initializationUrl,
    language: pickAttribute([input.representation, input.adaptationSet], 'lang'),
    mimeType: pickAttribute([input.representation, input.adaptationSet], 'mimeType'),
    segmentBase: baseResult.segmentBase,
    segmentCount: segments.length,
    segments,
    unsupportedReasons: reasons,
    width: numberAttribute(input.representation, 'width')
      ?? numberAttribute(input.adaptationSet, 'width'),
  } satisfies DashRepresentation
}

export function parseDashManifest(input: {
  baseUrl: string
  parseXml?: DashXmlParser
  root?: DashXmlElement
  text: string
}): DashManifest {
  const root = input.root || input.parseXml?.(input.text)
  if (!root || localName(root) !== 'MPD') {
    throw new Error('这条资源不像 MPD manifest')
  }
  const durationSeconds = parseIsoDurationSeconds(attribute(root, 'mediaPresentationDuration'))
  const baseUrls = resolveBaseUrls([String(input.baseUrl || '')], root)
  const protections = collectContentProtections(root)
  const unsupportedReasons: string[] = []
  const representations: DashRepresentation[] = []
  const periods = children(root, 'Period')
  if (!periods.length) throw new Error('MPD manifest 没有 Period')
  if (periods.length > 1) {
    addReason(unsupportedReasons, 'multi-period-not-expanded')
  }

  periods.forEach((period, periodIndex) => {
    const periodBaseUrls = resolveBaseUrls(baseUrls, period)
    const periodDurationSeconds = parseIsoDurationSeconds(attribute(period, 'duration')) ?? durationSeconds
    const periodSegmentBase = firstChild(period, 'SegmentBase')
    const periodSegmentList = firstChild(period, 'SegmentList')
    const periodSegmentTemplate = firstChild(period, 'SegmentTemplate')
    children(period, 'AdaptationSet').forEach((adaptationSet) => {
      const adaptationBaseUrls = resolveBaseUrls(periodBaseUrls, adaptationSet)
      children(adaptationSet, 'Representation').forEach((representation, representationIndex) => {
        const representationBaseUrls = resolveBaseUrls(adaptationBaseUrls, representation)
        const parsed = parseRepresentation({
          adaptationSet,
          baseUrls: representationBaseUrls,
          durationSeconds: periodDurationSeconds,
          index: representations.length + representationIndex + periodIndex,
          periodSegmentBase,
          periodSegmentList,
          periodSegmentTemplate,
          representation,
        })
        parsed.unsupportedReasons.forEach(reason => addReason(unsupportedReasons, reason))
        representations.push(parsed)
      })
    })
  })

  return {
    baseUrls,
    durationSeconds,
    hasDrm: protections.length > 0,
    isDynamic: String(attribute(root, 'type') || 'static').toLowerCase() === 'dynamic',
    minimumUpdatePeriodSeconds: parseIsoDurationSeconds(attribute(root, 'minimumUpdatePeriod')),
    protections,
    representations,
    unsupportedReasons,
  }
}
