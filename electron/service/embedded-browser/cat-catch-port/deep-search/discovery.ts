/**
 * Ported from xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * catch-script/search.js#findMedia/toUrl.
 */

export type DeepSearchDiscovery =
  | {
    base64: string
    ext: 'key'
    kind: 'key'
  }
  | {
    ext: 'm3u8' | 'mpd'
    kind: 'inline'
    text: string
  }
  | {
    ext: string
    kind: 'media'
    url: string
  }

export type DeepSearchDiscoveryOptions = {
  pageUrl: string
}

const supportedUrlExtensions = new Set([
  'flv',
  'key',
  'm3u',
  'm3u8',
  'mp3',
  'mp4',
  'mpd',
])
const dataUrlPattern = /^data:(application|video|audio)\//i
const keyUriPattern = /URI="(.*)"/
const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function arrayToBase64(input: ArrayBuffer | number[]) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : Uint8Array.from(input)
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] || 0
    const second = bytes[index + 1] || 0
    const third = bytes[index + 2] || 0
    const value = (first << 16) | (second << 8) | third
    output += base64Alphabet[(value >> 18) & 63]
    output += base64Alphabet[(value >> 12) & 63]
    output += index + 1 < bytes.length ? base64Alphabet[(value >> 6) & 63] : '='
    output += index + 2 < bytes.length ? base64Alphabet[value & 63] : '='
  }
  return output
}

function decodeBase64(input: string) {
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(input)
  }
  return ''
}

function getProtocol(pageUrl: string) {
  try {
    return new URL(pageUrl).protocol
  } catch {
    return 'https:'
  }
}

function isCatCatchUrl(input: string) {
  return input.startsWith('http://')
    || input.startsWith('https://')
    || input.startsWith('//')
}

function getExtension(input: string, protocol: string) {
  try {
    const url = new URL(input.startsWith('//') ? `${protocol}${input}` : input)
    const parts = url.pathname.split('.')
    if (parts.length === 1) return undefined
    const extension = String(parts.at(-1) || '').toLowerCase()
    return supportedUrlExtensions.has(extension) ? extension : undefined
  } catch {
    return undefined
  }
}

function getBaseUrl(input: string) {
  const parts = input.split('/')
  parts.pop()
  return `${parts.join('/')}/`
}

function applyProtocolToSegments(text: string, protocol: string) {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || ''
    if (line[0] === '#') continue
    if (line.startsWith('//')) lines[index] = `${protocol}${line}`
  }
  return lines.join('\n')
}

function hasFullSegmentUrl(text: string) {
  const lines = text.split('\n')
  for (const line of lines) {
    if (line[0] === '#') continue
    return isCatCatchUrl(line)
  }
  return false
}

function addBaseUrl(baseUrl: string, text: string) {
  let output = ''
  for (let line of text.split('\n')) {
    if (line === '' || line === ' ' || line === '\n') continue
    if (line.includes('URI=')) {
      const match = keyUriPattern.exec(line)
      if (match?.[1] && !isCatCatchUrl(match[1])) {
        line = line.replace(keyUriPattern, `URI="${baseUrl}${match[1]}"`)
      }
    }
    if (line[0] !== '#' && !isCatCatchUrl(line)) {
      if (line.startsWith('/')) {
        const baseParts = baseUrl.split('/')
        line = `${baseParts[0]}//${baseParts[2]}${line}`
      } else {
        line = `${baseUrl}${line}`
      }
    }
    output += `${line}\n`
  }
  return output
}

function decodeDataManifest(input: string) {
  const content = input.substring(input.indexOf('/') + 1)
  const mimeType = ['vnd.apple.mpegurl', 'x-mpegurl', 'mpegurl']
    .find(value => content.toLowerCase().startsWith(value))
  if (!mimeType) return undefined
  const remaining = content.slice(mimeType.length + 1)
  const [prefix, data] = remaining.split(/,(.+)/)
  if (prefix.toLowerCase() !== 'base64') return remaining
  return data ? decodeBase64(data) : undefined
}

function isLooseCatCatchKey(input: unknown): input is number[] {
  return Array.isArray(input)
    && input.length === 16
    && input.every(value => typeof value === 'number' && value <= 256)
}

export function discoverResources(
  input: unknown,
  options: DeepSearchDiscoveryOptions,
): DeepSearchDiscovery[] {
  const discoveries: DeepSearchDiscovery[] = []
  const emittedValues = new Set<string>()
  const baseUrls = new Set<string>()
  const pendingManifests: string[] = []
  const protocol = getProtocol(options.pageUrl)

  function emitInline(text: string, ext: 'm3u8' | 'mpd') {
    discoveries.push({ ext, kind: 'inline', text })
  }

  function emitMedia(url: string, ext: string) {
    if (emittedValues.has(url)) return
    emittedValues.add(url)
    discoveries.push({ ext, kind: 'media', url })
  }

  function emitKey(value: ArrayBuffer | number[]) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value)
    if (bytes.byteLength === 0) return
    if (
      (bytes[4] === 0x73 || bytes[4] === 0x66)
      && bytes[5] === 0x74
      && bytes[6] === 0x79
      && bytes[7] === 0x70
    ) {
      return
    }
    const base64 = arrayToBase64(value)
    if (!base64 || base64.startsWith('AAAAAAAAAAAAAAAAAAAA') || emittedValues.has(base64)) return
    emittedValues.add(base64)
    discoveries.push({ base64, ext: 'key', kind: 'key' })
  }

  function rememberBaseUrl(url: string) {
    const baseUrl = getBaseUrl(url)
    if (baseUrls.has(baseUrl)) return
    for (const manifest of pendingManifests) {
      emitInline(addBaseUrl(baseUrl, manifest), 'm3u8')
    }
    baseUrls.add(baseUrl)
  }

  function emitManifest(value: string, ext: 'm3u8' | 'mpd' = 'm3u8') {
    if (!value) return
    if (ext === 'mpd') {
      emitInline(value, ext)
      return
    }
    const normalized = applyProtocolToSegments(value, protocol)
    if (hasFullSegmentUrl(normalized)) {
      emitInline(normalized, ext)
      return
    }
    for (const baseUrl of baseUrls) {
      emitInline(addBaseUrl(baseUrl, normalized), ext)
    }
    pendingManifests.push(normalized)
  }

  function visit(value: unknown, depth = 0) {
    if (!value) return
    if (isLooseCatCatchKey(value)) {
      emitKey(value)
      return
    }
    if (value instanceof ArrayBuffer && value.byteLength === 16) {
      emitKey(value)
      return
    }

    for (const key in Object(value)) {
      const nestedValue = (value as Record<string, unknown>)[key]
      if (typeof nestedValue === 'object') {
        if (isLooseCatCatchKey(nestedValue)) {
          emitKey(nestedValue)
          continue
        }
        if (depth <= 20) visit(nestedValue, depth + 1)
        continue
      }
      if (typeof nestedValue !== 'string') continue
      if (isCatCatchUrl(nestedValue)) {
        const extension = getExtension(nestedValue, protocol)
        if (extension) {
          const url = nestedValue.startsWith('//') ? `${protocol}${nestedValue}` : nestedValue
          rememberBaseUrl(url)
          emitMedia(url, extension)
        }
        continue
      }
      if (nestedValue.substring(0, 7).toUpperCase() === '#EXTM3U') {
        emitManifest(nestedValue)
        continue
      }
      if (dataUrlPattern.test(nestedValue.substring(0, 17))) {
        const decoded = decodeDataManifest(nestedValue)
        if (decoded) emitManifest(decoded)
        continue
      }
      if (nestedValue.toLowerCase().includes('urn:mpeg:dash:schema:mpd')) {
        emitManifest(nestedValue, 'mpd')
      }
    }
  }

  rememberBaseUrl(options.pageUrl)
  visit(input)
  return discoveries
}
