import { describe, expect, it } from 'vitest'

import {
  OutputHelpers,
  arrayBufferToBlob,
  filterFileName,
  getUrlFileName,
  stringModify,
} from './output-helpers'

describe('OutputHelpers', () => {
  it('output.filename-template-parity', () => {
    expect(filterFileName('.episode?.mp4')).toBe('catCatch.episode&quest;.mp4')
    expect(stringModify('episode/part?.mp4')).toBe('episode&sol;part&quest;.mp4')
    expect(getUrlFileName('https://media.example/path/episode.m3u8?token=1')).toBe('episode.m3u8')
    expect(OutputHelpers.renderTemplate('${fileName|to:upperCase}.${ext}', {
      url: 'https://media.example/path/episode.mp4?token=1',
    })).toBe('EPISODE.mp4')
    expect(OutputHelpers.renderTemplate('${title|filter}|${url|to:urlEncode}', {
      title: 'A/B',
      url: 'https://media.example/video file.mp4',
    })).toBe('A_B|https%3A%2F%2Fmedia.example%2Fvideo%20file.mp4')
  })

  it('output.large-buffer-delivery', async () => {
    const source = Uint8Array.from([1, 2, 3, 4])
    const view = source.subarray(1, 3)
    const blob = arrayBufferToBlob(view, { type: 'video/mp4' })
    expect(blob.type).toBe('video/mp4')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.from([2, 3]))
    expect((await arrayBufferToBlob(new ArrayBuffer(0)).arrayBuffer()).byteLength).toBe(0)
  })
})
