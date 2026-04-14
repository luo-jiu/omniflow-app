/**
 * Key verification heuristics adapted from cat-catch m3u8 workflow.
 * Source: https://github.com/xifangczy/cat-catch
 * Licensed under AGPL-3.0
 */

export type EmbeddedBrowserHlsKeyCandidate = {
  base64: string
  label: string
  source: 'manifest-key-url' | 'captured-key' | 'manual'
}

export type EmbeddedBrowserHlsKeyVerificationResult = {
  candidate?: EmbeddedBrowserHlsKeyCandidate
  error?: string
  mediaAlreadyReadable: boolean
  ok: boolean
}

function base64ToBytes(base64: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return window.btoa(binary)
}

function hexToBytes(hex: string) {
  const normalizedHex = String(hex || '').replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '')
  if (!normalizedHex || normalizedHex.length % 2 !== 0) {
    return null
  }
  const bytes = new Uint8Array(normalizedHex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(normalizedHex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

export function normalizeHlsKeyCandidateValue(
  value: string,
): string | null {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) {
    return null
  }
  const dataUriMatch = /^data:[^,]*;base64,(.+)$/i.exec(normalizedValue)
  if (dataUriMatch?.[1]) {
    return normalizeHlsKeyCandidateValue(dataUriMatch[1])
  }
  if (/^(?:0x)?[0-9a-f]{32}$/i.test(normalizedValue)) {
    const bytes = hexToBytes(normalizedValue)
    return bytes && bytes.byteLength === 16 ? bytesToBase64(bytes) : null
  }
  try {
    const bytes = base64ToBytes(normalizedValue)
    return bytes.byteLength === 16 ? normalizedValue : null
  } catch {
    return null
  }
}

export function parseHlsIv(iv: string | undefined, sequence: number) {
  const bytes = iv ? hexToBytes(iv) : null
  if (bytes?.byteLength === 16) {
    return bytes
  }
  const defaultIv = new Uint8Array(16)
  const safeSequence = Math.max(0, Math.floor(sequence || 0))
  defaultIv[12] = (safeSequence >>> 24) & 0xff
  defaultIv[13] = (safeSequence >>> 16) & 0xff
  defaultIv[14] = (safeSequence >>> 8) & 0xff
  defaultIv[15] = safeSequence & 0xff
  return defaultIv
}

export function looksLikeDecodedHlsMedia(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.byteLength < 4) {
    return false
  }
  if (
    bytes.byteLength >= 8
    && (bytes[4] === 0x73 || bytes[4] === 0x66)
    && bytes[5] === 0x74
    && bytes[6] === 0x79
    && bytes[7] === 0x70
  ) {
    return true
  }
  if (
    bytes.byteLength >= 8
    && bytes[4] === 0x6d
    && bytes[5] === 0x6f
    && bytes[6] === 0x6f
    && bytes[7] === 0x66
  ) {
    return true
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return true
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return true
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return true
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0) {
    return true
  }
  const maxCheckLength = Math.min(512, bytes.byteLength)
  for (let index = 0; index < maxCheckLength; index += 1) {
    if (bytes[index] === 0x47 && (index + 188) < bytes.byteLength && bytes[index + 188] === 0x47) {
      return true
    }
  }
  return false
}

async function decryptHlsAes128(
  encryptedBytes: Uint8Array,
  keyBytes: Uint8Array,
  ivBytes: Uint8Array,
) {
  const usableLength = encryptedBytes.byteLength - (encryptedBytes.byteLength % 16)
  if (usableLength <= 0) {
    return null
  }
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  )
  const decrypted = await window.crypto.subtle.decrypt(
    {
      iv: ivBytes,
      name: 'AES-CBC',
    },
    cryptoKey,
    encryptedBytes.slice(0, usableLength),
  )
  return new Uint8Array(decrypted)
}

export async function verifyEmbeddedBrowserHlsKeyCandidates(input: {
  candidates: EmbeddedBrowserHlsKeyCandidate[]
  encryptedSegmentBase64: string
  iv?: string
  sequence: number
}): Promise<EmbeddedBrowserHlsKeyVerificationResult> {
  const encryptedBytes = base64ToBytes(input.encryptedSegmentBase64)
  if (looksLikeDecodedHlsMedia(encryptedBytes)) {
    return {
      mediaAlreadyReadable: true,
      ok: true,
    }
  }
  const ivBytes = parseHlsIv(input.iv, input.sequence)
  for (const candidate of input.candidates) {
    const normalizedBase64 = normalizeHlsKeyCandidateValue(candidate.base64)
    if (!normalizedBase64) {
      continue
    }
    try {
      const keyBytes = base64ToBytes(normalizedBase64)
      const decrypted = await decryptHlsAes128(encryptedBytes, keyBytes, ivBytes)
      if (decrypted && looksLikeDecodedHlsMedia(decrypted)) {
        return {
          candidate: {
            ...candidate,
            base64: normalizedBase64,
          },
          mediaAlreadyReadable: false,
          ok: true,
        }
      }
    } catch {
      // Keep trying the remaining candidates.
    }
  }
  return {
    error: '未在候选 key 里验证出可用密钥',
    mediaAlreadyReadable: false,
    ok: false,
  }
}
