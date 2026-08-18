import fs from 'node:fs/promises'
import fsRaw from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const DOWNLOAD_REQUEST_TIMEOUT_MS = 60_000

function formatByteLimit(maxBytes: number) {
  if (maxBytes >= 1024 * 1024 * 1024 && maxBytes % (1024 * 1024 * 1024) === 0) {
    return `${maxBytes / (1024 * 1024 * 1024)}GB`
  }
  if (maxBytes >= 1024 * 1024 && maxBytes % (1024 * 1024) === 0) {
    return `${maxBytes / (1024 * 1024)}MB`
  }
  return `${maxBytes}B`
}

export async function downloadUrlToFile(
  url: string,
  targetPath: string,
  headers: Record<string, string> = {},
  redirectDepth = 0,
  maxBytes = Number.POSITIVE_INFINITY,
  signal?: AbortSignal,
): Promise<void> {
  const MAX_REDIRECT_DEPTH = 3
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`不支持的下载协议: ${parsed.protocol}`)
  }
  const transport = parsed.protocol === 'https:' ? https : http

  await fs.mkdir(path.dirname(targetPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let responseStarted = false
    const settleResolve = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const settleReject = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers,
      signal,
    }, (response: IncomingMessage) => {
      responseStarted = true
      response.setTimeout(DOWNLOAD_REQUEST_TIMEOUT_MS, () => {
        response.destroy(new Error(`下载响应超时: ${DOWNLOAD_REQUEST_TIMEOUT_MS}ms`))
      })

      const statusCode = Number(response.statusCode || 0)
      const redirectLocation = response.headers.location

      if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
        response.resume()
        if (redirectDepth >= MAX_REDIRECT_DEPTH) {
          settleReject(new Error(`下载重定向次数过多: ${url}`))
          return
        }
        const nextUrl = new URL(redirectLocation, url).toString()
        downloadUrlToFile(nextUrl, targetPath, headers, redirectDepth + 1, maxBytes, signal)
          .then(settleResolve)
          .catch(settleReject)
        return
      }

      if (statusCode >= 400) {
        response.resume()
        settleReject(new Error(`下载失败: HTTP ${statusCode} (${url})`))
        return
      }

      const declaredLength = Number(response.headers['content-length'] || 0)
      if (Number.isFinite(maxBytes) && declaredLength > maxBytes) {
        response.resume()
        settleReject(new Error(`文件超过允许的 ${formatByteLimit(maxBytes)} 大小上限`))
        return
      }

      let receivedBytes = 0
      const sizeLimiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          receivedBytes += chunk.byteLength
          if (Number.isFinite(maxBytes) && receivedBytes > maxBytes) {
            callback(new Error(`文件超过允许的 ${formatByteLimit(maxBytes)} 大小上限`))
            return
          }
          callback(null, chunk)
        },
      })
      const fileStream = fsRaw.createWriteStream(targetPath)
      void pipeline(response, sizeLimiter, fileStream)
        .then(settleResolve)
        .catch(async (error) => {
          await fs.rm(targetPath, { force: true }).catch(() => undefined)
          settleReject(error)
        })
    })

    request.setTimeout(DOWNLOAD_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`下载请求超时: ${DOWNLOAD_REQUEST_TIMEOUT_MS}ms`))
    })
    request.on('error', (error) => {
      if (!responseStarted) settleReject(error)
    })
    request.end()
  })
}
