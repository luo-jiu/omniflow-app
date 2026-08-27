/**
 * HLS fragment preprocessing ported from the pinned Cat Catch workflow.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/m3u8.js#dataPreprocessing
 * Reason: some servers prepend a PNG/JPEG cover image to media bytes; the
 * optional preprocessing step removes only a complete image prefix.
 * Adaptation: pure ArrayBuffer function; enabling it remains an application concern.
 * Fixture: hls.cache-fallback-disguised
 */

const pngSignature = [0x89, 0x50, 0x4e, 0x47]
const jpegSignature = [0xff, 0xd8, 0xff]
const pngEndMarker = [0x49, 0x45, 0x4e, 0x44]

function startsWithBytes(view: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => view[index] === byte)
}

/** Remove a complete PNG/JPEG prefix, matching Cat Catch's conservative fallback. */
export function preprocessFragment(input: ArrayBuffer): ArrayBuffer {
  const view = new Uint8Array(input)
  if (view.length < 8) return input

  let mediaStartIndex = -1
  if (startsWithBytes(view, pngSignature)) {
    for (let index = 0; index < view.length - 4; index += 1) {
      if (startsWithBytes(view.subarray(index), pngEndMarker)) {
        mediaStartIndex = index + 8
        break
      }
    }
  } else if (startsWithBytes(view, jpegSignature)) {
    for (let index = 0; index < view.length - 2; index += 1) {
      if (view[index] === 0xff && view[index + 1] === 0xd9) {
        mediaStartIndex = index + 2
        break
      }
    }
  }

  if (mediaStartIndex === -1 || mediaStartIndex >= view.length) return input
  return input.slice(mediaStartIndex)
}
