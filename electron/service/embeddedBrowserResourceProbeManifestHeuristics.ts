/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under AGPL-3.0
 */
// These body fragments are compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserResourceProbeManifestHeuristicsBody() {
  const vimeoPlaylistUrls = new Set<string>()
  const vimeoPlaylistPattern = /^https:\/\/[^.]*\.vimeocdn\.com\/exp=.*\/playlist\.json\?/i
  const knownManifestBaseUrls = new Set<string>()
  const pendingM3u8TextsBySignature = new Map<string, string>()
  let m3u8Accumulator = ''

  function getBaseUrl(url: string) {
    try {
      const currentUrl = new URL(url, currentLocationHref)
      const parts = currentUrl.toString().split('/')
      parts.pop()
      return `${parts.join('/')}/`
    } catch {
      return ''
    }
  }

  function resolveM3u8Reference(baseUrl: string, reference: string) {
    try {
      return new URL(reference, baseUrl || currentLocationHref).toString()
    } catch {
      return baseUrl ? `${baseUrl}${reference.replace(/^\//, '')}` : reference
    }
  }

  function addBaseUrl(baseUrl: string, m3u8Text: string) {
    if (!baseUrl || !m3u8Text) {
      return m3u8Text
    }
    return m3u8Text.split('\n').map((line) => {
      const currentLine = line.trim()
      if (!currentLine) {
        return line
      }
      if (currentLine.startsWith('#')) {
        if (currentLine.includes('URI="')) {
          return currentLine.replace(/URI="([^"]*)"/g, (_input, keyUrl) => {
            if (toAbsoluteUrl(keyUrl)) {
              return `URI="${keyUrl}"`
            }
            return `URI="${resolveM3u8Reference(baseUrl, keyUrl)}"`
          })
        }
        return line
      }
      if (toAbsoluteUrl(currentLine)) {
        return currentLine
      }
      return resolveM3u8Reference(baseUrl, currentLine)
    }).join('\n')
  }

  function getM3u8PendingSignature(text: string) {
    return String(text || '').replace(/\s+/g, '')
  }

  function getM3u8References(text: string) {
    const references: string[] = []
    String(text || '').split('\n').forEach((line) => {
      const currentLine = line.trim()
      if (!currentLine) {
        return
      }
      if (currentLine.startsWith('#')) {
        const uriMatches = Array.from(currentLine.matchAll(/URI="([^"]*)"/g))
        uriMatches.forEach((match) => {
          const uri = String(match[1] || '').trim()
          if (uri) {
            references.push(uri)
          }
        })
        return
      }
      references.push(currentLine)
    })
    return references
  }

  function hasRelativeM3u8References(text: string) {
    return getM3u8References(text).some((reference) => {
      if (!reference || reference.startsWith('data:') || reference.startsWith('blob:')) {
        return false
      }
      return !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)
    })
  }

  function emitM3u8DataKeyReference(reference: string) {
    const normalizedReference = String(reference || '').trim()
    if (!/^data:application\/octet-stream/i.test(normalizedReference)) {
      return false
    }
    const commaIndex = normalizedReference.indexOf(',')
    if (commaIndex === -1) {
      return false
    }
    const metadata = normalizedReference.slice(0, commaIndex)
    const data = normalizedReference.slice(commaIndex + 1).trim()
    if (!data || !/;base64/i.test(metadata)) {
      return false
    }
    return emitKeyCandidateFromBase64(data)
  }

  function emitM3u8ReferenceResource(reference: string, sourceLine: string, baseUrl: string) {
    const normalizedReference = String(reference || '').trim()
    if (!normalizedReference) {
      return
    }
    const normalizedSourceLine = String(sourceLine || '').trim().toUpperCase()
    if (normalizedReference.startsWith('data:')) {
      if (normalizedSourceLine.startsWith('#EXT-X-KEY')) {
        emitM3u8DataKeyReference(normalizedReference)
      }
      return
    }
    const absoluteUrl = resolveM3u8Reference(baseUrl, normalizedReference)
    if (!absoluteUrl || !toAbsoluteUrl(absoluteUrl)) {
      return
    }
    const inferredKind = classifyKind(absoluteUrl)
    const kind = normalizedSourceLine.startsWith('#EXT-X-KEY')
      ? 'key'
      : normalizedSourceLine.startsWith('#EXT-X-MAP')
        ? 'media'
        : inferredKind
    if (kind === 'other') {
      return
    }
    registerManifestBaseUrl(absoluteUrl)
    emit({
      ext: kind === 'key' ? 'key' : getExtension(absoluteUrl),
      kind,
      resourceType: normalizedSourceLine.startsWith('#EXT-X-KEY')
        ? 'm3u8-key'
        : normalizedSourceLine.startsWith('#EXT-X-MAP')
          ? 'm3u8-map'
          : normalizedSourceLine.startsWith('#')
            ? 'm3u8-uri'
            : 'm3u8-reference',
      source: 'probe',
      url: absoluteUrl,
    })
  }

  function emitM3u8ReferenceResources(text: string, baseUrl: string) {
    String(text || '').split('\n').slice(0, 500).forEach((line) => {
      const currentLine = line.trim()
      if (!currentLine) {
        return
      }
      if (currentLine.startsWith('#')) {
        Array.from(currentLine.matchAll(/URI="([^"]*)"/g)).forEach((match) => {
          emitM3u8ReferenceResource(String(match[1] || ''), currentLine, baseUrl)
        })
        return
      }
      emitM3u8ReferenceResource(currentLine, currentLine, baseUrl)
    })
  }

  function emitM3u8ManifestWithBase(text: string, baseUrl: string, emitReferences = true) {
    const normalizedText = addBaseUrl(baseUrl, text)
    emitGeneratedResource({
      base64: textToBase64(normalizedText),
      ext: 'm3u8',
      kind: 'manifest',
      mimeType: 'application/vnd.apple.mpegurl',
      resourceType: 'inline-manifest',
      signature: `m3u8:${normalizedText}`,
    })
    if (emitReferences) {
      emitM3u8ReferenceResources(text, baseUrl)
    }
  }

  function registerManifestBaseUrl(url: string) {
    const absoluteUrl = toAbsoluteUrl(url)
    const kind = absoluteUrl ? classifyKind(absoluteUrl) : 'other'
    if (kind !== 'manifest' && kind !== 'media') {
      return false
    }
    const baseUrl = getBaseUrl(absoluteUrl)
    if (!baseUrl || knownManifestBaseUrls.has(baseUrl)) {
      return false
    }
    knownManifestBaseUrls.add(baseUrl)
    pendingM3u8TextsBySignature.forEach((text) => {
      emitM3u8ManifestWithBase(text, baseUrl)
    })
    return true
  }

  function emitInlineManifest(text: string, ext: 'm3u8' | 'mpd', baseUrl?: string) {
    const normalizedText = String(text || '').trim()
    if (!normalizedText) {
      return
    }
    if (ext === 'mpd') {
      emitGeneratedResource({
        base64: textToBase64(normalizedText),
        ext,
        kind: 'manifest',
        mimeType: 'application/dash+xml',
        resourceType: 'inline-manifest',
        signature: `${ext}:${normalizedText}`,
      })
      return
    }

    const baseUrlCandidate = String(baseUrl || '').trim()
    const explicitBaseUrl = getBaseUrl(baseUrlCandidate)
    const hasRelativeReferences = hasRelativeM3u8References(normalizedText)
    const isWeakPageBaseUrl = !baseUrlCandidate || baseUrlCandidate === currentLocationHref
    if (explicitBaseUrl && (!hasRelativeReferences || !isWeakPageBaseUrl)) {
      knownManifestBaseUrls.add(explicitBaseUrl)
      emitM3u8ManifestWithBase(normalizedText, explicitBaseUrl)
      return
    }

    if (hasRelativeReferences) {
      pendingM3u8TextsBySignature.set(getM3u8PendingSignature(normalizedText), normalizedText)
      emitM3u8ManifestWithBase(normalizedText, explicitBaseUrl || getBaseUrl(currentLocationHref), !isWeakPageBaseUrl)
      knownManifestBaseUrls.forEach((knownBaseUrl) => {
        emitM3u8ManifestWithBase(normalizedText, knownBaseUrl)
      })
      return
    }

    emitGeneratedResource({
      base64: textToBase64(normalizedText),
      ext,
      kind: 'manifest',
      mimeType: 'application/vnd.apple.mpegurl',
      resourceType: 'inline-manifest',
      signature: `${ext}:${normalizedText}`,
    })
    emitM3u8ReferenceResources(normalizedText, '')
  }

  function createVimeoManifestBlobUrl(text: string, signature: string) {
    const resource = createProbeBlobResource({
      base64: textToBase64(text),
      ext: 'm3u8',
      kind: 'manifest',
      mimeType: 'application/vnd.apple.mpegurl',
      signature,
    })
    return resource.url
  }

  function emitVimeoPlaylistManifest(originalUrl: string, payload: unknown) {
    const normalizedOriginalUrl = String(originalUrl || '').trim()
    if (!normalizedOriginalUrl || !vimeoPlaylistPattern.test(normalizedOriginalUrl) || vimeoPlaylistUrls.has(normalizedOriginalUrl)) {
      return false
    }
    const data = typeof payload === 'string' ? parseMaybeJson(payload) : payload
    if (!data || typeof data !== 'object') {
      return false
    }
    const playlist = data as Record<string, unknown>
    if (typeof playlist.base_url !== 'string' || !Array.isArray(playlist.video)) {
      return false
    }

    try {
      const parsedUrl = new URL(normalizedOriginalUrl)
      const pathBase = parsedUrl.pathname.slice(0, parsedUrl.pathname.lastIndexOf('/') + 1)
      const baseUrl = new URL(`${parsedUrl.origin}${pathBase}${playlist.base_url}`).href
      const masterLines = ['#EXTM3U', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-VERSION:3']

      const createStreamManifestUrl = (stream: Record<string, unknown>) => {
        const segments = Array.isArray(stream.segments) ? stream.segments : []
        if (segments.length === 0) {
          return ''
        }
        const streamBaseUrl = String(stream.base_url || '')
        const manifestLines = [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          `#EXT-X-TARGETDURATION:${Number(stream.duration) || 0}`,
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXT-X-PLAYLIST-TYPE:VOD',
        ]
        if (typeof stream.init_segment === 'string' && stream.init_segment) {
          manifestLines.push(`#EXT-X-MAP:URI="data:application/octet-stream;base64,${stream.init_segment}"`)
        } else if (typeof stream.init_segment_url === 'string' && stream.init_segment_url) {
          manifestLines.push(`#EXT-X-MAP:URI="${baseUrl}${streamBaseUrl}${stream.init_segment_url}"`)
        }

        segments.forEach((segment) => {
          if (!segment || typeof segment !== 'object') {
            return
          }
          const currentSegment = segment as Record<string, unknown>
          const segmentUrl = String(currentSegment.url || '')
          if (!segmentUrl) {
            return
          }
          const start = Number(currentSegment.start) || 0
          const end = Number(currentSegment.end) || start
          manifestLines.push(`#EXTINF:${Math.max(end - start, 0)},`)
          manifestLines.push(`${baseUrl}${streamBaseUrl}${segmentUrl}`)
        })
        manifestLines.push('#EXT-X-ENDLIST')
        const manifestText = manifestLines.join('\n')
        return createVimeoManifestBlobUrl(manifestText, `vimeo-stream:${manifestText}`)
      }

      playlist.video.forEach((stream) => {
        if (!stream || typeof stream !== 'object') {
          return
        }
        const currentStream = stream as Record<string, unknown>
        const streamUrl = createStreamManifestUrl(currentStream)
        if (!streamUrl) {
          return
        }
        masterLines.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${Number(currentStream.bitrate) || 0},RESOLUTION=${Number(currentStream.width) || 0}x${Number(currentStream.height) || 0},CODECS="${String(currentStream.codecs || '')}"`,
        )
        masterLines.push(streamUrl)
      })

      const audioStreams = Array.isArray(playlist.audio) ? playlist.audio : []
      audioStreams.forEach((stream) => {
        if (!stream || typeof stream !== 'object') {
          return
        }
        const currentStream = stream as Record<string, unknown>
        const streamUrl = createStreamManifestUrl(currentStream)
        if (!streamUrl) {
          return
        }
        masterLines.push(
          `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${String(currentStream.id || '')}",NAME="${String(currentStream.bitrate || '')}",URI="${streamUrl}"`,
        )
      })

      if (masterLines.length <= 3) {
        return false
      }
      const masterText = masterLines.join('\n')
      vimeoPlaylistUrls.add(normalizedOriginalUrl)
      emitGeneratedResource({
        base64: textToBase64(masterText),
        ext: 'm3u8',
        kind: 'manifest',
        mimeType: 'application/vnd.apple.mpegurl',
        resourceType: 'inline-manifest',
        signature: `vimeo-master:${masterText}`,
      })
      return true
    } catch {
      return false
    }
  }

}
