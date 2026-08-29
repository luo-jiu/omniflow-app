import fs from 'node:fs/promises'
import fsRaw from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type StreamingTransferOptions = {
  maxBytes?: number
  signal?: AbortSignal
}

export type StreamingTransferResult = {
  bytesReceived: number
  outputPath: string
}

function normalizeMaxBytes(value: unknown) {
  const maxBytes = Number(value)
  return Number.isFinite(maxBytes) && maxBytes >= 0
    ? maxBytes
    : Number.POSITIVE_INFINITY
}

function formatByteLimit(maxBytes: number) {
  if (maxBytes >= 1024 * 1024 * 1024 && maxBytes % (1024 * 1024 * 1024) === 0) {
    return `${maxBytes / (1024 * 1024 * 1024)}GB`
  }
  if (maxBytes >= 1024 * 1024 && maxBytes % (1024 * 1024) === 0) {
    return `${maxBytes / (1024 * 1024)}MB`
  }
  return `${maxBytes}B`
}

async function writeResponseToStagedFile(
  response: Response,
  stagedPath: string,
  options: StreamingTransferOptions,
) {
  const maxBytes = normalizeMaxBytes(options.maxBytes)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(maxBytes) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`文件超过允许的 ${formatByteLimit(maxBytes)} 大小上限`)
  }

  let bytesReceived = 0
  if (!response.body) {
    await fs.writeFile(stagedPath, '')
    return bytesReceived
  }

  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytesReceived += buffer.byteLength
      if (Number.isFinite(maxBytes) && bytesReceived > maxBytes) {
        callback(new Error(`文件超过允许的 ${formatByteLimit(maxBytes)} 大小上限`))
        return
      }
      callback(null, buffer)
    },
  })

  const source = Readable.fromWeb(response.body as never)
  const destination = fsRaw.createWriteStream(stagedPath)
  if (options.signal) {
    await pipeline(source, limiter, destination, { signal: options.signal })
  } else {
    await pipeline(source, limiter, destination)
  }
  return bytesReceived
}

/**
 * Streams a response into a sibling temporary directory and publishes it only
 * after the complete body has passed validation. A failed or aborted transfer
 * never removes an existing destination file.
 */
export async function streamResponseToFile(
  response: Response,
  outputPath: string,
  options: StreamingTransferOptions = {},
): Promise<StreamingTransferResult> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`下载失败：HTTP ${response.status}`)
  }

  const normalizedOutputPath = path.resolve(String(outputPath || '').trim())
  if (
    !String(outputPath || '').trim()
    || normalizedOutputPath === path.parse(normalizedOutputPath).root
  ) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('缺少有效的输出路径')
  }

  const outputDirectory = path.dirname(normalizedOutputPath)
  await fs.mkdir(outputDirectory, { recursive: true })
  const stagingDirectory = await fs.mkdtemp(path.join(outputDirectory, '.omniflow-stream-'))
  const stagedPath = path.join(stagingDirectory, 'payload')

  try {
    const bytesReceived = await writeResponseToStagedFile(response, stagedPath, options)
    await fs.rm(normalizedOutputPath, { force: true })
    await fs.rename(stagedPath, normalizedOutputPath)
    return {
      bytesReceived,
      outputPath: normalizedOutputPath,
    }
  } catch (error) {
    await response.body?.cancel().catch(() => undefined)
    throw error
  } finally {
    await fs.rm(stagingDirectory, { force: true, recursive: true }).catch(() => undefined)
  }
}

export class StreamingTransfer {
  private readonly maxBytes: number

  constructor(options: StreamingTransferOptions = {}) {
    this.maxBytes = normalizeMaxBytes(options.maxBytes)
  }

  writeResponse(
    response: Response,
    outputPath: string,
    options: Omit<StreamingTransferOptions, 'maxBytes'> = {},
  ) {
    return streamResponseToFile(response, outputPath, {
      ...options,
      maxBytes: this.maxBytes,
    })
  }
}
