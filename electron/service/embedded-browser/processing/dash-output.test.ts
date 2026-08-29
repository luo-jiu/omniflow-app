import { describe, expect, it, vi } from 'vitest'

const manifestDownloadMocks = vi.hoisted(() => ({
  single: vi.fn(),
  tracks: vi.fn(),
}))

vi.mock('../../embeddedBrowserResourceManifestDownloadService', () => ({
  downloadEmbeddedBrowserManifestResource: manifestDownloadMocks.single,
  downloadEmbeddedBrowserManifestTracks: manifestDownloadMocks.tracks,
}))

import { mergeDashTaskTracksToOutput } from './dash-output'

const representation = {
  baseUrls: ['https://cdn.example/'],
  contentType: 'video' as const,
  id: 'video-1',
  segmentCount: 0,
  segments: [],
  unsupportedReasons: [],
}

describe('DASH output adapter', () => {
  it('merges independent local video and audio tracks through the shared runner', async () => {
    manifestDownloadMocks.tracks.mockResolvedValueOnce({
      ffmpegPath: '/opt/homebrew/bin/ffmpeg',
      outputPath: '/tmp/output.mp4',
    })

    const signal = new AbortController().signal
    const result = await mergeDashTaskTracksToOutput({
      audio: { path: '/tmp/audio-track.bin', representation: { ...representation, contentType: 'audio', id: 'audio-1' } },
      durationSeconds: 12,
      ffmpegPath: '/custom/ffmpeg',
      outputPath: '/tmp/output.mp4',
      signal,
      video: { path: '/tmp/video-track.bin', representation },
    })

    expect(result).toEqual({
      ffmpegPath: '/opt/homebrew/bin/ffmpeg',
      outputPath: '/tmp/output.mp4',
    })
    expect(manifestDownloadMocks.tracks).toHaveBeenCalledWith({
      audioManifestUrl: '/tmp/audio-track.bin',
      durationSeconds: 12,
      ffmpegPath: '/custom/ffmpeg',
      outputPath: '/tmp/output.mp4',
      signal,
      videoManifestUrl: '/tmp/video-track.bin',
    })
  })

  it('keeps single-track output on the same cancellable runner', async () => {
    manifestDownloadMocks.single.mockResolvedValueOnce({
      ffmpegPath: 'ffmpeg',
      outputPath: '/tmp/audio.m4a',
    })

    const signal = new AbortController().signal
    await expect(mergeDashTaskTracksToOutput({
      audio: { path: '/tmp/audio-track.bin', representation: { ...representation, contentType: 'audio', id: 'audio-1' } },
      outputPath: '/tmp/audio.m4a',
      signal,
    })).resolves.toEqual({
      ffmpegPath: 'ffmpeg',
      outputPath: '/tmp/audio.m4a',
    })
    expect(manifestDownloadMocks.single).toHaveBeenCalledWith({
      durationSeconds: undefined,
      ffmpegPath: undefined,
      kind: 'mpd',
      manifestUrl: '/tmp/audio-track.bin',
      outputPath: '/tmp/audio.m4a',
      signal,
    })
  })
})
