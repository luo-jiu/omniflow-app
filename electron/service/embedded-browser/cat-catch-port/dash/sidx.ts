import type {
  DashByteRange,
  DashSegment,
} from './parser'

export type DashSidxParseInput = {
  baseUrl: string
  bytes: ArrayBuffer | Uint8Array
  indexRange: DashByteRange
  presentationTimeOffset?: number
}

function asBytes(input: ArrayBuffer | Uint8Array) {
  return input instanceof Uint8Array ? input : new Uint8Array(input)
}

function readUint64(view: DataView, offset: number) {
  const value = view.getUint32(offset, false) * 0x100000000 + view.getUint32(offset + 4, false)
  return Number.isSafeInteger(value) ? value : undefined
}

function readType(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function invalidSidx(message: string): never {
  throw new Error(`DASH SIDX 无法解析：${message}`)
}

/**
 * Expand the ISO BMFF Segment Index box used by DASH SegmentBase.
 *
 * The MPD indexRange is an absolute byte range in the media resource. Each
 * SIDX reference points to a media subsegment relative to the end of the SIDX
 * box plus first_offset; reference_type=1 is another (nested) SIDX and is not
 * a downloadable media fragment.
 */
export function parseDashSidx(input: DashSidxParseInput): DashSegment[] {
  const bytes = asBytes(input.bytes)
  const range = input.indexRange
  if (!Number.isSafeInteger(range.offset) || range.offset < 0
    || !Number.isSafeInteger(range.length) || range.length <= 0) {
    invalidSidx('index range invalid')
  }
  if (bytes.byteLength < 8) invalidSidx('box header truncated')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const start = 0
  const declaredSize = view.getUint32(start, false)
  let headerSize = 8
  let boxSize = declaredSize
  if (declaredSize === 1) {
    if (bytes.byteLength < 16) invalidSidx('extended box header truncated')
    boxSize = readUint64(view, 8) || 0
    headerSize = 16
  } else if (declaredSize === 0) {
    boxSize = bytes.byteLength
  }
  if (!boxSize || boxSize < headerSize || boxSize > bytes.byteLength) {
    invalidSidx('box size invalid')
  }
  if (readType(view, 4) !== 'sidx') invalidSidx('box type is not sidx')

  const fullBoxOffset = headerSize
  const version = view.getUint8(fullBoxOffset)
  if (version !== 0 && version !== 1) invalidSidx(`version ${version} unsupported`)
  let cursor = fullBoxOffset + 4
  if (cursor + 8 > boxSize) invalidSidx('header fields truncated')
  cursor += 4 // reference_ID
  const timescale = view.getUint32(cursor, false)
  cursor += 4
  if (!timescale) invalidSidx('timescale invalid')

  const earliestPresentationTime = version === 0
    ? view.getUint32(cursor, false)
    : readUint64(view, cursor)
  cursor += version === 0 ? 4 : 8
  const firstOffset = version === 0
    ? view.getUint32(cursor, false)
    : readUint64(view, cursor)
  cursor += version === 0 ? 4 : 8
  if (earliestPresentationTime === undefined || firstOffset === undefined) {
    invalidSidx('64-bit timing field exceeds safe integer range')
  }
  if (cursor + 4 > boxSize) invalidSidx('reference count truncated')
  cursor += 2 // reserved
  const referenceCount = view.getUint16(cursor, false)
  cursor += 2
  if (cursor + referenceCount * 12 > boxSize) invalidSidx('references truncated')

  let mediaOffset = range.offset + boxSize + firstOffset
  if (!Number.isSafeInteger(mediaOffset) || mediaOffset < 0) {
    invalidSidx('first media offset invalid')
  }
  let mediaTime = earliestPresentationTime
  const segments: DashSegment[] = []
  for (let referenceIndex = 0; referenceIndex < referenceCount; referenceIndex += 1) {
    const reference = view.getUint32(cursor, false)
    const referenceType = reference >>> 31
    const referencedSize = reference & 0x7fffffff
    const subsegmentDuration = view.getUint32(cursor + 4, false)
    cursor += 12
    if (referenceType === 1) continue
    if (!referencedSize) invalidSidx(`reference ${referenceIndex} has an empty size`)
    const end = mediaOffset + referencedSize - 1
    if (!Number.isSafeInteger(end) || end < mediaOffset) {
      invalidSidx(`reference ${referenceIndex} range invalid`)
    }
    const relativeTime = mediaTime - Number(input.presentationTimeOffset || 0)
    segments.push({
      byteRange: {
        length: referencedSize,
        offset: mediaOffset,
        raw: `${mediaOffset}-${end}`,
      },
      duration: subsegmentDuration / timescale,
      index: segments.length,
      time: relativeTime,
      url: input.baseUrl,
    })
    mediaOffset += referencedSize
    mediaTime += subsegmentDuration
  }
  if (!segments.length) invalidSidx('no media references')
  return segments
}
