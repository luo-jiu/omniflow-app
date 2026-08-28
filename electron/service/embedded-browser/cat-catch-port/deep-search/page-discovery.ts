/**
 * Ported from xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * catch-script/search.js#vimeo/DOMContentLoaded inline script scan.
 */

const vimeoPlaylistPattern = /^https:\/\/[^.]*\.vimeocdn\.com\/exp=.*\/playlist\.json\?/i
const inlineMediaPattern = /["']((?:(?:https?:)?\/\/)?[^"'\s]*?\.(?:m3u8|mp4|flv)(?:\?[^"'\s]*)?)["']/gi

function isCatCatchUrl(value: string) {
  return value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('//')
}

export function extractInlineScriptMediaCandidates(
  scriptTexts: Iterable<string>,
  protocol: string,
) {
  const candidates: string[] = []
  for (const scriptText of scriptTexts) {
    if (!scriptText) continue
    const pattern = new RegExp(inlineMediaPattern.source, inlineMediaPattern.flags)
    let match = pattern.exec(scriptText)
    while (match) {
      let url = String(match[1] || match[0] || '').replace(/["']/g, '').trim()
      if (url && !url.startsWith('http')) {
        url = `${protocol}//${url.replace(/^\/\//, '')}`
      }
      if (url && isCatCatchUrl(url)) candidates.push(url)
      match = pattern.exec(scriptText)
    }
  }
  return candidates
}

type VimeoStream = {
  base_url?: unknown
  bitrate?: unknown
  codecs?: unknown
  duration?: unknown
  height?: unknown
  id?: unknown
  init_segment?: unknown
  init_segment_url?: unknown
  segments?: unknown
  width?: unknown
}

type VimeoPlaylist = {
  audio?: unknown
  base_url?: unknown
  video?: unknown
}

function parsePlaylist(input: unknown): VimeoPlaylist | undefined {
  if (typeof input === 'string') {
    try {
      const value = JSON.parse(input) as unknown
      return value && typeof value === 'object' ? value as VimeoPlaylist : undefined
    } catch {
      return undefined
    }
  }
  return input && typeof input === 'object' ? input as VimeoPlaylist : undefined
}

export function buildVimeoHlsManifest(
  originalUrl: string,
  input: unknown,
  materializeManifest: (text: string) => string,
) {
  const normalizedUrl = String(originalUrl || '').trim()
  if (!vimeoPlaylistPattern.test(normalizedUrl)) return undefined
  const playlist = parsePlaylist(input)
  if (!playlist?.base_url || !Array.isArray(playlist.video)) return undefined

  try {
    const url = new URL(normalizedUrl)
    const pathBase = `${url.pathname.substring(0, url.pathname.lastIndexOf('/'))}/`
    const baseUrl = new URL(`${url.origin}${pathBase}${String(playlist.base_url)}`).href
    const masterLines = ['#EXTM3U', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-VERSION:3']

    const materializeStream = (stream: VimeoStream) => {
      if (!Array.isArray(stream.segments) || stream.segments.length === 0) return undefined
      const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        `#EXT-X-TARGETDURATION:${String(stream.duration)}`,
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
      ]
      if (stream.init_segment) {
        lines.push(`#EXT-X-MAP:URI="data:application/octet-stream;base64,${String(stream.init_segment)}"`)
      } else if (stream.init_segment_url) {
        lines.push(`#EXT-X-MAP:URI="${baseUrl}${String(stream.base_url || '')}${String(stream.init_segment_url)}"`)
      }
      for (const segmentValue of stream.segments) {
        const segment = segmentValue as { end?: unknown; start?: unknown; url?: unknown }
        lines.push(`#EXTINF:${Number(segment.end) - Number(segment.start)},`)
        lines.push(`${baseUrl}${String(stream.base_url || '')}${String(segment.url)}`)
      }
      lines.push('#EXT-X-ENDLIST')
      return materializeManifest(lines.join('\n'))
    }

    for (const streamValue of playlist.video) {
      const stream = streamValue as VimeoStream
      const streamUrl = materializeStream(stream)
      if (!streamUrl) continue
      masterLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${String(stream.bitrate)},RESOLUTION=${String(stream.width)}x${String(stream.height)},CODECS="${String(stream.codecs)}"`,
      )
      masterLines.push(streamUrl)
    }

    if (Array.isArray(playlist.audio)) {
      for (const streamValue of playlist.audio) {
        const stream = streamValue as VimeoStream
        const streamUrl = materializeStream(stream)
        if (!streamUrl) continue
        masterLines.push(
          `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${String(stream.id)}",NAME="${String(stream.bitrate)}",URI="${streamUrl}"`,
        )
      }
    }

    return masterLines.join('\n')
  } catch {
    return undefined
  }
}
