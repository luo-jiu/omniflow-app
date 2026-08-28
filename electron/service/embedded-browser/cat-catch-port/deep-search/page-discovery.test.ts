import { describe, expect, it, vi } from 'vitest'

import {
  buildVimeoHlsManifest,
  extractInlineScriptMediaCandidates,
} from './page-discovery'

describe('Cat Catch deep-search page discovery', () => {
  it('deep.inline-script-url-scan', () => {
    expect(extractInlineScriptMediaCandidates([
      `
        const master = "//cdn.example/live/master.m3u8?token=1";
        const video = 'https://cdn.example/video.mp4';
        const relative = "relative.flv";
        const ignoredSubtitle = "//cdn.example/subtitle.vtt";
      `,
      `const duplicate = "//cdn.example/live/master.m3u8?token=1";`,
    ], 'https:')).toEqual([
      'https://cdn.example/live/master.m3u8?token=1',
      'https://cdn.example/video.mp4',
      'https://relative.flv',
      'https://cdn.example/live/master.m3u8?token=1',
    ])
  })

  it('deep.vimeo-playlist-translation', () => {
    const materializeManifest = vi.fn((text: string) => (
      `blob:manifest-${text.length > 0 ? materializeManifest.mock.calls.length : 0}`
    ))
    const master = buildVimeoHlsManifest(
      'https://skyfire.vimeocdn.com/exp=123/path/playlist.json?token=abc',
      {
        audio: [{
          base_url: 'audio/',
          bitrate: 128000,
          duration: 4,
          id: 'audio-main',
          init_segment: 'AAA=',
          segments: [{ end: 4, start: 0, url: 'segment.m4s' }],
        }],
        base_url: '../media/',
        video: [{
          base_url: 'video/',
          bitrate: 900000,
          codecs: 'avc1.640028',
          duration: 4,
          height: 720,
          init_segment_url: 'init.mp4',
          segments: [{ end: 4, start: 1, url: 'segment.m4s' }],
          width: 1280,
        }],
      },
      materializeManifest,
    )

    expect(materializeManifest).toHaveBeenNthCalledWith(1, [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-MAP:URI="https://skyfire.vimeocdn.com/exp=123/media/video/init.mp4"',
      '#EXTINF:3,',
      'https://skyfire.vimeocdn.com/exp=123/media/video/segment.m4s',
      '#EXT-X-ENDLIST',
    ].join('\n'))
    expect(materializeManifest).toHaveBeenNthCalledWith(2, [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-MAP:URI="data:application/octet-stream;base64,AAA="',
      '#EXTINF:4,',
      'https://skyfire.vimeocdn.com/exp=123/media/audio/segment.m4s',
      '#EXT-X-ENDLIST',
    ].join('\n'))
    expect(master).toBe([
      '#EXTM3U',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-VERSION:3',
      '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720,CODECS="avc1.640028"',
      'blob:manifest-1',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-main",NAME="128000",URI="blob:manifest-2"',
    ].join('\n'))

    const emptyMaterializer = vi.fn(() => 'blob:unused')
    expect(buildVimeoHlsManifest(
      'https://skyfire.vimeocdn.com/exp=123/path/playlist.json?token=abc',
      { base_url: '../media/', video: [] },
      emptyMaterializer,
    )).toBe('#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-VERSION:3')
    expect(emptyMaterializer).not.toHaveBeenCalled()
  })
})
