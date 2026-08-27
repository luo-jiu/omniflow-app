export type HlsManifestFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

/** Pinned Cat Catch m3u8.js manifestLoadError branch: one force-cache attempt after an HTTP response. */
export async function fetchHlsManifestWithForceCacheFallback(input: {
  fetch?: HlsManifestFetch
  headers?: HeadersInit
  initialResponse?: Response
  signal?: AbortSignal
  url: string
}) {
  const fetchImpl = input.fetch || ((url: string, init?: RequestInit) => fetch(url, init))
  const request = (cache?: RequestCache) => fetchImpl(input.url, {
    ...(cache ? { cache } : {}),
    headers: input.headers,
    signal: input.signal,
  })
  const initialResponse = input.initialResponse || await request()
  if (initialResponse.ok || !/^https?:\/\//i.test(input.url)) {
    return initialResponse
  }
  if (initialResponse.body) {
    await initialResponse.body.cancel().catch(() => undefined)
  }
  try {
    return await request('force-cache')
  } catch (error) {
    if (input.signal?.aborted) {
      throw error
    }
    return initialResponse
  }
}
