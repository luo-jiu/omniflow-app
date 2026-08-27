import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  createHlsDefaultIv,
  decryptHlsAes128,
} from './decrypt'
import { preprocessFragment } from './pipeline'

function encryptAes128(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array) {
  const cipher = createCipheriv('aes-128-cbc', key, iv)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

describe('Cat Catch HLS AES-128 decryption', () => {
  it('hls.decrypt-aes128', async () => {
    const key = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
    const iv = Uint8Array.from({ length: 16 }, (_, index) => 0xf0 - index)
    const plaintext = new TextEncoder().encode('cat-catch-media')
    const encrypted = encryptAes128(plaintext, key, iv)

    const decrypted = await decryptHlsAes128(encrypted, key, iv)

    expect(new Uint8Array(decrypted)).toEqual(plaintext)
  })

  it('creates the HLS sequence-derived default IV in big-endian order', () => {
    expect(Array.from(createHlsDefaultIv(0x01020304))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 1, 2, 3, 4,
    ])
  })

  it('rejects malformed AES-128 inputs before invoking Web Crypto', async () => {
    await expect(decryptHlsAes128(new Uint8Array(15), new Uint8Array(16), new Uint8Array(16)))
      .rejects.toThrow('complete 16-byte blocks')
    await expect(decryptHlsAes128(new Uint8Array(16), new Uint8Array(15), new Uint8Array(16)))
      .rejects.toThrow('key must be 16 bytes')
  })

  it('hls.decrypt-preprocess-order', async () => {
    const key = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
    const iv = new Uint8Array(16)
    const plaintext = new TextEncoder().encode('encrypted-cat-catch-media')
    const encrypted = encryptAes128(plaintext, key, iv)
    const imagePrefix = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47,
      0x49, 0x45, 0x4e, 0x44,
      0x00, 0x00, 0x00, 0x00,
    ])
    const disguised = new Uint8Array(imagePrefix.byteLength + encrypted.byteLength)
    disguised.set(imagePrefix, 0)
    disguised.set(encrypted, imagePrefix.byteLength)

    const mediaBytes = preprocessFragment(disguised.buffer)
    const decrypted = await decryptHlsAes128(mediaBytes, key, iv)

    expect(new TextDecoder().decode(decrypted)).toBe('encrypted-cat-catch-media')
  })
})
