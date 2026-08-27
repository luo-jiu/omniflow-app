import type {
  CapturedResourceAccessService,
  CapturedResourceFetchResult,
} from './captured-resource-access'
import {
  fetchHlsManifestWithForceCacheFallback,
} from '../cat-catch-port/hls/cache-fallback'

const DEFAULT_MAX_INSPECTION_BYTES = 4 * 1024 * 1024

export const CAPTURED_RESOURCE_INSPECTION_ENCODINGS = ['base64', 'utf8'] as const

export type CapturedResourceInspectionEncoding =
  typeof CAPTURED_RESOURCE_INSPECTION_ENCODINGS[number]

export type CapturedResourceInspectionRequest = {
  encoding: CapturedResourceInspectionEncoding
  resourceId: string
  tabId: string
}

export type CapturedResourceInspectionResult = {
  body: string
  contentType?: string
  encoding: CapturedResourceInspectionEncoding
  receivedBytes: number
  resource: CapturedResourceFetchResult['resource']
  status: number
  truncated: boolean
}

export type CapturedResourceInspectionServiceOptions = {
  access: Pick<CapturedResourceAccessService, 'fetch'>
  maxBytes?: number
}

const inspectionEncodingSet = new Set<string>(CAPTURED_RESOURCE_INSPECTION_ENCODINGS)

function isInspectionEncoding(value: string): value is CapturedResourceInspectionEncoding {
  return inspectionEncodingSet.has(value)
}

function normalizeIdentifier(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function normalizeMaximumBytes(value: unknown) {
  const normalized = Math.floor(Number(value))
  return Number.isFinite(normalized) && normalized > 0
    ? normalized
    : DEFAULT_MAX_INSPECTION_BYTES
}

function isHlsManifestResource(
  resource: CapturedResourceFetchResult['resource'],
) {
  if (resource.kind !== 'manifest') return false
  const extension = String(resource.ext || '').trim().toLowerCase()
  const mimeType = String(resource.mimeType || '').trim().toLowerCase()
  const url = String(resource.url || '').trim().toLowerCase()
  return extension === 'm3u8'
    || extension === 'm3u'
    || mimeType.includes('mpegurl')
    || /\.m3u8?(?:$|[?#])/.test(url)
}

async function readBoundedBody(response: Response, maxBytes: number) {
  if (!response.body) {
    return {
      bytes: Buffer.alloc(0),
      truncated: false,
    }
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let receivedBytes = 0
  let truncated = false
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      const remainingBytes = Math.max(0, maxBytes - receivedBytes)
      if (next.value.byteLength > remainingBytes) {
        if (remainingBytes > 0) {
          chunks.push(Buffer.from(next.value.subarray(0, remainingBytes)))
          receivedBytes += remainingBytes
        }
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(Buffer.from(next.value))
      receivedBytes += next.value.byteLength
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  return {
    bytes: Buffer.concat(chunks, receivedBytes),
    truncated,
  }
}

/** Main-only bounded reader for manifest/key inspection by opaque resource id. */
export class CapturedResourceInspectionService {
  private readonly maxBytes: number
  private readonly options: CapturedResourceInspectionServiceOptions

  constructor(options: CapturedResourceInspectionServiceOptions) {
    this.options = options
    this.maxBytes = normalizeMaximumBytes(options.maxBytes)
  }

  async inspect(input: CapturedResourceInspectionRequest): Promise<CapturedResourceInspectionResult> {
    const encoding = normalizeIdentifier(input?.encoding)
    const resourceId = normalizeIdentifier(input?.resourceId)
    const tabId = normalizeIdentifier(input?.tabId)
    if (!encoding || !isInspectionEncoding(encoding) || !resourceId || !tabId) {
      throw new Error('Captured resource inspection request is invalid')
    }

    let result = await this.options.access.fetch({
      purpose: 'resource-inspection',
      resourceId,
      tabId,
    })
    if (!result.response.ok && isHlsManifestResource(result.resource)) {
      result = {
        ...result,
        response: await fetchHlsManifestWithForceCacheFallback({
          fetch: async (_url, init) => {
            const cached = await this.options.access.fetch({
              cache: init?.cache,
              purpose: 'resource-inspection',
              resourceId,
              tabId,
            })
            return cached.response
          },
          initialResponse: result.response,
          url: result.resource.url,
        }),
      }
    }
    const body = await readBoundedBody(result.response, this.maxBytes)
    const contentType = normalizeIdentifier(result.response.headers.get('content-type')) || undefined
    return {
      body: encoding === 'base64'
        ? body.bytes.toString('base64')
        : new TextDecoder().decode(body.bytes),
      contentType,
      encoding,
      receivedBytes: body.bytes.byteLength,
      resource: result.resource,
      status: result.response.status,
      truncated: body.truncated,
    }
  }
}
