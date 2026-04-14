/**
 * DASH/MPD extraction adapted from cat-catch mpd workflow.
 * Source: https://github.com/xifangczy/cat-catch
 * Licensed under AGPL-3.0
 */

export type EmbeddedBrowserMpdContentProtection = {
  encryptionType: 'Widevine' | 'Microsoft PlayReady' | 'Apple FairPlay' | 'Unknown'
  pssh?: string
  schemeIdUri: string
}

export type EmbeddedBrowserMpdSegment = {
  duration?: number
  index: number
  number?: number
  time?: number
  url: string
}

export type EmbeddedBrowserMpdRepresentation = {
  bandwidth?: number
  codecs?: string
  contentType: 'audio' | 'video' | 'unknown'
  frameRate?: string
  height?: number
  id: string
  initializationUrl?: string
  mimeType?: string
  segmentCount: number
  segments: EmbeddedBrowserMpdSegment[]
  width?: number
}

export type EmbeddedBrowserMpdManifest = {
  baseUrl: string
  durationSeconds?: number
  hasDrm: boolean
  protections: EmbeddedBrowserMpdContentProtection[]
  representations: EmbeddedBrowserMpdRepresentation[]
}

function getLocalName(element: Element) {
  return element.localName || element.nodeName.split(':').pop() || element.nodeName
}

function getChildren(element: Element, localName: string) {
  return Array.from(element.children).filter((child) => getLocalName(child) === localName)
}

function getFirstChild(element: Element, localName: string) {
  return getChildren(element, localName)[0]
}

function getTextChild(element: Element, localName: string) {
  return String(getFirstChild(element, localName)?.textContent || '').trim()
}

function getNumberAttribute(element: Element | undefined, name: string) {
  if (!element) {
    return undefined
  }
  const parsed = Number(element.getAttribute(name) || '')
  return Number.isFinite(parsed) ? parsed : undefined
}

function pickAttribute(elements: Array<Element | undefined>, name: string) {
  for (const element of elements) {
    const value = element?.getAttribute(name)
    if (value) {
      return value
    }
  }
  return undefined
}

function resolveMpdUrl(reference: string, baseUrl: string) {
  const normalizedReference = String(reference || '').trim()
  if (!normalizedReference) {
    return ''
  }
  if (/^(data|blob):/i.test(normalizedReference)) {
    return normalizedReference
  }
  try {
    return new URL(normalizedReference, baseUrl).toString()
  } catch {
    return normalizedReference
  }
}

function combineBaseUrl(parentBaseUrl: string, element: Element) {
  const localBaseUrl = getTextChild(element, 'BaseURL')
  return localBaseUrl ? resolveMpdUrl(localBaseUrl, parentBaseUrl) : parentBaseUrl
}

function parseIsoDurationSeconds(value?: string | null) {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) {
    return undefined
  }
  const match = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(normalizedValue)
  if (!match) {
    return undefined
  }
  const [, years, months, days, hours, minutes, seconds] = match
  return (Number(years || 0) * 365 * 24 * 60 * 60)
    + (Number(months || 0) * 30 * 24 * 60 * 60)
    + (Number(days || 0) * 24 * 60 * 60)
    + (Number(hours || 0) * 60 * 60)
    + (Number(minutes || 0) * 60)
    + Number(seconds || 0)
}

function getEncryptionType(schemeIdUri: string): EmbeddedBrowserMpdContentProtection['encryptionType'] {
  if (schemeIdUri.includes('edef8ba9-79d6-4ace-a3c8-27dcd51d21ed')) {
    return 'Widevine'
  }
  if (schemeIdUri.includes('9a04f079-9840-4286-ab92-e65be0885f95')) {
    return 'Microsoft PlayReady'
  }
  if (schemeIdUri.includes('94ce86fb-07ff-4f43-adb8-93d2fa968ca2')) {
    return 'Apple FairPlay'
  }
  return 'Unknown'
}

function collectContentProtections(root: Element) {
  const protections = Array.from(root.getElementsByTagName('*'))
    .filter((element) => getLocalName(element) === 'ContentProtection')
    .map((element) => {
      const schemeIdUri = String(element.getAttribute('schemeIdUri') || '').trim()
      if (!schemeIdUri) {
        return null
      }
      const pssh = Array.from(element.getElementsByTagName('*'))
        .find((child) => getLocalName(child).toLowerCase() === 'pssh' || child.nodeName.toLowerCase() === 'mspr:pro')
      return {
        encryptionType: getEncryptionType(schemeIdUri),
        pssh: String(pssh?.textContent || '').trim() || undefined,
        schemeIdUri,
      } satisfies EmbeddedBrowserMpdContentProtection
    })
    .filter(Boolean) as EmbeddedBrowserMpdContentProtection[]
  return Array.from(new Map(protections.map((item) => [item.schemeIdUri, item])).values())
}

function replaceTemplateTokens(template: string, input: {
  bandwidth?: number
  number?: number
  representationId: string
  time?: number
}) {
  return String(template || '')
    .replace(/\$RepresentationID\$/g, input.representationId)
    .replace(/\$Bandwidth\$/g, String(input.bandwidth || ''))
    .replace(/\$Time\$/g, String(input.time ?? ''))
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (_match, width) => {
      const numberText = String(input.number ?? '')
      const paddingWidth = Number(width || 0)
      return paddingWidth > 0 ? numberText.padStart(paddingWidth, '0') : numberText
    })
}

function expandSegmentTimeline(segmentTemplate: Element, input: {
  bandwidth?: number
  baseUrl: string
  media: string
  representationId: string
  startNumber: number
  timescale: number
}) {
  const timeline = getFirstChild(segmentTemplate, 'SegmentTimeline')
  if (!timeline) {
    return []
  }
  const segments: EmbeddedBrowserMpdSegment[] = []
  let currentTime = 0
  let currentNumber = input.startNumber
  getChildren(timeline, 'S').forEach((item) => {
    const duration = getNumberAttribute(item, 'd') || 0
    const repeat = getNumberAttribute(item, 'r') ?? 0
    const explicitTime = getNumberAttribute(item, 't')
    if (typeof explicitTime === 'number') {
      currentTime = explicitTime
    }
    const repeatCount = repeat < 0 ? 0 : repeat
    for (let index = 0; index <= repeatCount && segments.length < 5000; index += 1) {
      const mediaUrl = replaceTemplateTokens(input.media, {
        bandwidth: input.bandwidth,
        number: currentNumber,
        representationId: input.representationId,
        time: currentTime,
      })
      segments.push({
        duration: duration ? duration / input.timescale : undefined,
        index: segments.length,
        number: currentNumber,
        time: currentTime,
        url: resolveMpdUrl(mediaUrl, input.baseUrl),
      })
      currentNumber += 1
      currentTime += duration
    }
  })
  return segments
}

function expandSegmentTemplate(segmentTemplate: Element | undefined, input: {
  bandwidth?: number
  baseUrl: string
  durationSeconds?: number
  representationId: string
}) {
  if (!segmentTemplate) {
    return {
      initializationUrl: undefined,
      segments: [] as EmbeddedBrowserMpdSegment[],
    }
  }
  const timescale = getNumberAttribute(segmentTemplate, 'timescale') || 1
  const startNumber = getNumberAttribute(segmentTemplate, 'startNumber') || 1
  const media = segmentTemplate.getAttribute('media') || ''
  const initialization = segmentTemplate.getAttribute('initialization') || ''
  const initializationUrl = initialization
    ? resolveMpdUrl(replaceTemplateTokens(initialization, {
      bandwidth: input.bandwidth,
      number: startNumber,
      representationId: input.representationId,
    }), input.baseUrl)
    : undefined

  const timelineSegments = media
    ? expandSegmentTimeline(segmentTemplate, {
      bandwidth: input.bandwidth,
      baseUrl: input.baseUrl,
      media,
      representationId: input.representationId,
      startNumber,
      timescale,
    })
    : []
  if (timelineSegments.length > 0) {
    return {
      initializationUrl,
      segments: timelineSegments,
    }
  }

  const duration = getNumberAttribute(segmentTemplate, 'duration')
  if (!media || !duration || !input.durationSeconds) {
    return {
      initializationUrl,
      segments: [] as EmbeddedBrowserMpdSegment[],
    }
  }
  const segmentDuration = duration / timescale
  const count = Math.min(5000, Math.ceil(input.durationSeconds / segmentDuration))
  return {
    initializationUrl,
    segments: Array.from({ length: count }, (_item, index) => {
      const number = startNumber + index
      const mediaUrl = replaceTemplateTokens(media, {
        bandwidth: input.bandwidth,
        number,
        representationId: input.representationId,
      })
      return {
        duration: segmentDuration,
        index,
        number,
        url: resolveMpdUrl(mediaUrl, input.baseUrl),
      } satisfies EmbeddedBrowserMpdSegment
    }),
  }
}

function parseSegmentList(segmentList: Element | undefined, baseUrl: string) {
  if (!segmentList) {
    return {
      initializationUrl: undefined,
      segments: [] as EmbeddedBrowserMpdSegment[],
    }
  }
  const initialization = getFirstChild(segmentList, 'Initialization')?.getAttribute('sourceURL') || ''
  const initializationUrl = initialization ? resolveMpdUrl(initialization, baseUrl) : undefined
  const duration = getNumberAttribute(segmentList, 'duration')
  const timescale = getNumberAttribute(segmentList, 'timescale') || 1
  return {
    initializationUrl,
    segments: getChildren(segmentList, 'SegmentURL').map((segment, index) => ({
      duration: duration ? duration / timescale : undefined,
      index,
      url: resolveMpdUrl(segment.getAttribute('media') || '', baseUrl),
    })),
  }
}

function inferContentType(adaptationSet: Element, representation: Element): EmbeddedBrowserMpdRepresentation['contentType'] {
  const contentType = pickAttribute([representation, adaptationSet], 'contentType')
  const mimeType = String(pickAttribute([representation, adaptationSet], 'mimeType') || '').toLowerCase()
  if (contentType === 'audio' || mimeType.startsWith('audio/')) {
    return 'audio'
  }
  if (contentType === 'video' || mimeType.startsWith('video/')) {
    return 'video'
  }
  return 'unknown'
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
  const durationSeconds = parseIsoDurationSeconds(root.getAttribute('mediaPresentationDuration'))
  const manifestBaseUrl = combineBaseUrl(String(input.baseUrl || ''), root)
  const representations: EmbeddedBrowserMpdRepresentation[] = []

  getChildren(root, 'Period').forEach((period) => {
    const periodBaseUrl = combineBaseUrl(manifestBaseUrl, period)
    const periodDurationSeconds = parseIsoDurationSeconds(period.getAttribute('duration')) || durationSeconds
    getChildren(period, 'AdaptationSet').forEach((adaptationSet) => {
      const adaptationBaseUrl = combineBaseUrl(periodBaseUrl, adaptationSet)
      const adaptationTemplate = getFirstChild(adaptationSet, 'SegmentTemplate')
      const adaptationSegmentList = getFirstChild(adaptationSet, 'SegmentList')
      getChildren(adaptationSet, 'Representation').forEach((representation) => {
        const representationId = representation.getAttribute('id') || String(representations.length + 1)
        const representationBaseUrl = combineBaseUrl(adaptationBaseUrl, representation)
        const bandwidth = getNumberAttribute(representation, 'bandwidth')
        const templateResult = expandSegmentTemplate(
          getFirstChild(representation, 'SegmentTemplate') || adaptationTemplate,
          {
            bandwidth,
            baseUrl: representationBaseUrl,
            durationSeconds: periodDurationSeconds,
            representationId,
          },
        )
        const listResult = templateResult.segments.length > 0
          ? { initializationUrl: undefined, segments: [] as EmbeddedBrowserMpdSegment[] }
          : parseSegmentList(getFirstChild(representation, 'SegmentList') || adaptationSegmentList, representationBaseUrl)
        const segments = templateResult.segments.length > 0 ? templateResult.segments : listResult.segments
        representations.push({
          bandwidth,
          codecs: pickAttribute([representation, adaptationSet], 'codecs'),
          contentType: inferContentType(adaptationSet, representation),
          frameRate: pickAttribute([representation, adaptationSet], 'frameRate'),
          height: getNumberAttribute(representation, 'height') || getNumberAttribute(adaptationSet, 'height'),
          id: representationId,
          initializationUrl: templateResult.initializationUrl || listResult.initializationUrl,
          mimeType: pickAttribute([representation, adaptationSet], 'mimeType'),
          segmentCount: segments.length,
          segments,
          width: getNumberAttribute(representation, 'width') || getNumberAttribute(adaptationSet, 'width'),
        })
      })
    })
  })

  const protections = collectContentProtections(root)
  return {
    baseUrl: manifestBaseUrl,
    durationSeconds,
    hasDrm: protections.length > 0,
    protections,
    representations,
  }
}

export function createEmbeddedBrowserMpdDownloadPlan(input: {
  headers?: Record<string, string>
  manifest: EmbeddedBrowserMpdManifest
  manifestUrl: string
  pageUrl?: string
}) {
  return {
    durationSeconds: input.manifest.durationSeconds,
    hasDrm: input.manifest.hasDrm,
    headers: input.headers || {},
    manifestUrl: input.manifestUrl,
    pageUrl: input.pageUrl,
    protections: input.manifest.protections,
    representations: input.manifest.representations.map((representation) => ({
      bandwidth: representation.bandwidth,
      codecs: representation.codecs,
      contentType: representation.contentType,
      frameRate: representation.frameRate,
      height: representation.height,
      id: representation.id,
      initializationUrl: representation.initializationUrl,
      mimeType: representation.mimeType,
      segmentCount: representation.segmentCount,
      segments: representation.segments,
      width: representation.width,
    })),
  }
}
