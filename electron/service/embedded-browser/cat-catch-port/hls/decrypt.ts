/**
 * Full-segment AES decryption from Cat Catch's pinned hls.js pipeline.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/m3u8.js#downloadNew, lib/m3u8-decrypt.js#AESDecryptor, and
 * lib/hls.min.js#Decrypter/getAesModeFromFullSegmentMethod
 * Reason: full-segment AES fragments must be decrypted with the manifest IV
 * or the media-sequence-derived default IV before downstream processing.
 * Adaptation: use the standard Web Crypto AES-CBC/AES-CTR primitives instead
 * of carrying a browser-bundled AES implementation into the Electron adapter.
 * Production owner: AES-128 remains delegated to the single cancellable ffmpeg
 * process. AES-256 CBC/CTR use this Web Crypto boundary before ffmpeg because
 * its HLS demuxer does not recognize those METHOD values.
 * Fixtures: hls.decrypt-aes128, hls-aes256-full-segment-output
 */

function asBytes(input: ArrayBuffer | Uint8Array) {
  return input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input)
}

export type HlsFullSegmentEncryptionMethod = 'AES-128' | 'AES-256' | 'AES-256-CTR'

/** Build the 16-byte big-endian default IV defined by HLS for a sequence number. */
export function createHlsDefaultIv(sequence: number) {
  const iv = new Uint8Array(16)
  const safeSequence = Math.max(0, Math.floor(Number(sequence) || 0))
  iv[12] = (safeSequence >>> 24) & 0xff
  iv[13] = (safeSequence >>> 16) & 0xff
  iv[14] = (safeSequence >>> 8) & 0xff
  iv[15] = safeSequence & 0xff
  return iv
}

/** Decrypt one complete full-segment AES resource with the pinned hls.js mode. */
export async function decryptHlsFullSegment(
  input: ArrayBuffer | Uint8Array,
  key: ArrayBuffer | Uint8Array,
  iv: ArrayBuffer | Uint8Array,
  method: HlsFullSegmentEncryptionMethod,
) {
  const encryptedBytes = asBytes(input)
  const keyBytes = asBytes(key)
  const ivBytes = asBytes(iv)
  const expectedKeyLength = method === 'AES-128' ? 16 : 32
  if (keyBytes.byteLength !== expectedKeyLength) {
    throw new Error(`${method} key must be ${expectedKeyLength} bytes, received ${keyBytes.byteLength}`)
  }
  if (ivBytes.byteLength !== 16) {
    throw new Error(`${method} IV must be 16 bytes, received ${ivBytes.byteLength}`)
  }
  if (method !== 'AES-256-CTR'
    && (encryptedBytes.byteLength === 0 || encryptedBytes.byteLength % 16 !== 0)) {
    throw new Error(`${method} fragment must contain complete 16-byte blocks`)
  }

  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto full-segment AES is unavailable')
  }
  const algorithmName = method === 'AES-256-CTR' ? 'AES-CTR' : 'AES-CBC'
  const cryptoKey = await subtle.importKey(
    'raw',
    keyBytes,
    { name: algorithmName },
    false,
    ['decrypt'],
  )
  return subtle.decrypt(
    method === 'AES-256-CTR'
      ? {
          counter: ivBytes,
          length: 64,
          name: algorithmName,
        }
      : {
          iv: ivBytes,
          name: algorithmName,
        },
    cryptoKey,
    encryptedBytes,
  )
}

/** Decrypt one complete AES-128-CBC HLS fragment and remove PKCS#7 padding. */
export function decryptHlsAes128(
  input: ArrayBuffer | Uint8Array,
  key: ArrayBuffer | Uint8Array,
  iv: ArrayBuffer | Uint8Array,
) {
  return decryptHlsFullSegment(input, key, iv, 'AES-128')
}
