import { describe, expect, it } from 'vitest'

import {
  filterHlsRenditionsForVariant,
  hlsVariantHasRenditionGroup,
} from './hls-rendition-groups'

describe('HLS variant rendition groups', () => {
  it('hls.master-variant-rendition-groups', () => {
    const variant = {
      audioGroupId: 'audio-en',
      audioGroupIds: ['audio-en', 'audio-ja'],
      subtitlesGroupId: 'sub-en',
      subtitlesGroupIds: ['sub-en', 'sub-ja'],
    }
    const audioRenditions = [
      { groupId: 'audio-en', type: 'AUDIO', url: 'audio/en.m3u8' },
      { groupId: 'audio-ja', type: 'AUDIO', url: 'audio/ja.m3u8' },
      { groupId: 'audio-fr', type: 'AUDIO', url: 'audio/fr.m3u8' },
    ]
    const subtitleRenditions = [
      { groupId: 'sub-en', type: 'SUBTITLES', url: 'sub/en.m3u8' },
      { groupId: 'sub-ja', type: 'SUBTITLES', url: 'sub/ja.m3u8' },
      { groupId: 'sub-fr', type: 'SUBTITLES', url: 'sub/fr.m3u8' },
    ]

    expect(filterHlsRenditionsForVariant(audioRenditions, variant, 'AUDIO'))
      .toEqual(audioRenditions.slice(0, 2))
    expect(filterHlsRenditionsForVariant(subtitleRenditions, variant, 'SUBTITLES'))
      .toEqual(subtitleRenditions.slice(0, 2))
    expect(hlsVariantHasRenditionGroup(variant, 'AUDIO', 'audio-ja')).toBe(true)
    expect(hlsVariantHasRenditionGroup(variant, 'SUBTITLES', 'sub-fr')).toBe(false)
  })

  it('keeps every rendition selectable when the variant declares no group', () => {
    const renditions = [
      { groupId: 'audio-en', type: 'AUDIO', url: 'audio/en.m3u8' },
      { groupId: 'audio-ja', type: 'AUDIO', url: 'audio/ja.m3u8' },
    ]
    expect(filterHlsRenditionsForVariant(renditions, {}, 'AUDIO')).toEqual(renditions)
  })
})
