import { describe, expect, it } from 'vitest'

import { parseDashSidx } from './sidx'

function createSidx(input: {
  firstOffset?: number
  references: Array<{ duration: number; size: number; type?: number }>
  version?: 0 | 1
}) {
  const version = input.version || 0
  const headerSize = version === 0 ? 32 : 40
  const bytes = new Uint8Array(headerSize + input.references.length * 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.byteLength, false)
  bytes.set([0x73, 0x69, 0x64, 0x78], 4)
  view.setUint8(8, version)
  view.setUint32(12, 1, false)
  view.setUint32(16, 1000, false)
  if (version === 0) {
    view.setUint32(20, 1000, false)
    view.setUint32(24, input.firstOffset || 0, false)
    view.setUint16(28, 0, false)
    view.setUint16(30, input.references.length, false)
  } else {
    view.setUint32(20, 0, false)
    view.setUint32(24, 1000, false)
    view.setUint32(28, 0, false)
    view.setUint32(32, input.firstOffset || 0, false)
    view.setUint16(36, 0, false)
    view.setUint16(38, input.references.length, false)
  }
  input.references.forEach((reference, index) => {
    const offset = headerSize + index * 12
    view.setUint32(offset, ((reference.type || 0) << 31) | reference.size, false)
    view.setUint32(offset + 4, reference.duration, false)
    view.setUint32(offset + 8, 0x90000000, false)
  })
  return bytes
}

describe('DASH SIDX parser', () => {
  it('dash.segment-base-sidx-expansion', () => {
    const segments = parseDashSidx({
      baseUrl: 'https://cdn.example/media.mp4',
      bytes: createSidx({
        firstOffset: 4,
        references: [
          { duration: 2000, size: 30 },
          { duration: 3000, size: 40 },
        ],
      }),
      indexRange: { length: 56, offset: 100, raw: '100-155' },
    })
    expect(segments).toEqual([
      {
        byteRange: { length: 30, offset: 160, raw: '160-189' },
        duration: 2,
        index: 0,
        time: 1000,
        url: 'https://cdn.example/media.mp4',
      },
      {
        byteRange: { length: 40, offset: 190, raw: '190-229' },
        duration: 3,
        index: 1,
        time: 3000,
        url: 'https://cdn.example/media.mp4',
      },
    ])

    const versionOneSegments = parseDashSidx({
      baseUrl: 'https://cdn.example/version-one.mp4',
      bytes: createSidx({
        references: [{ duration: 1000, size: 8 }],
        version: 1,
      }),
      indexRange: { length: 52, offset: 0, raw: '0-51' },
      presentationTimeOffset: 1000,
    })
    expect(versionOneSegments[0]).toMatchObject({
      byteRange: { length: 8, offset: 52, raw: '52-59' },
      duration: 1,
      time: 0,
    })
  })

  it('rejects malformed or nested-only SIDX references', () => {
    const range = { length: 44, offset: 0, raw: '0-43' }
    expect(() => parseDashSidx({
      baseUrl: 'https://cdn.example/media.mp4',
      bytes: Uint8Array.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]),
      indexRange: range,
    })).toThrow('box type is not sidx')
    expect(() => parseDashSidx({
      baseUrl: 'https://cdn.example/media.mp4',
      bytes: createSidx({ references: [{ duration: 1000, size: 8, type: 1 }] }),
      indexRange: { length: 44, offset: 0, raw: '0-43' },
    })).toThrow('no media references')
  })
})
