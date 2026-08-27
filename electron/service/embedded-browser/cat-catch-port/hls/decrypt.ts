/**
 * AES-128-CBC fragment decryption from Cat Catch's HLS pipeline.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/m3u8.js#downloadNew and lib/m3u8-decrypt.js#AESDecryptor
 * Reason: HLS AES-128 fragments must be decrypted with the manifest IV or the
 * media-sequence-derived default IV before downstream processing.
 * Adaptation: use the standard Web Crypto AES-CBC primitive instead of
 * carrying a browser-bundled AES implementation into the Electron adapter.
 * Production owner: local output keeps key/IV tags in its rewritten playlist
 * and delegates decrypt + remux to the single cancellable ffmpeg process; this
 * pure function remains the behavior reference and processor boundary.
 * Fixture: hls.decrypt-aes128
 */

function asBytes(input: ArrayBuffer | Uint8Array) {
  return input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input)
}

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

/** Decrypt one complete AES-128-CBC HLS fragment and remove PKCS#7 padding. */
export async function decryptHlsAes128(
  input: ArrayBuffer | Uint8Array,
  key: ArrayBuffer | Uint8Array,
  iv: ArrayBuffer | Uint8Array,
) {
  const encryptedBytes = asBytes(input)
  const keyBytes = asBytes(key)
  const ivBytes = asBytes(iv)
  if (keyBytes.byteLength !== 16) {
    throw new Error(`AES-128 key must be 16 bytes, received ${keyBytes.byteLength}`)
  }
  if (ivBytes.byteLength !== 16) {
    throw new Error(`AES-128 IV must be 16 bytes, received ${ivBytes.byteLength}`)
  }
  if (encryptedBytes.byteLength === 0 || encryptedBytes.byteLength % 16 !== 0) {
    throw new Error('AES-128 fragment must contain complete 16-byte blocks')
  }

  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto AES-CBC is unavailable')
  }
  const cryptoKey = await subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  )
  return subtle.decrypt(
    {
      iv: ivBytes,
      name: 'AES-CBC',
    },
    cryptoKey,
    encryptedBytes,
  )
}
