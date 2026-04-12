import fs from 'node:fs/promises'
import fsRaw from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'

const DOWNLOAD_REQUEST_TIMEOUT_MS = 60_000

export async function downloadUrlToFile(
  url: string,
  targetPath: string,
  headers: Record<string, string> = {},
  redirectDepth = 0,
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
    }, (response: IncomingMessage) => {
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
        downloadUrlToFile(nextUrl, targetPath, headers, redirectDepth + 1)
          .then(settleResolve)
          .catch(settleReject)
        return
      }

      if (statusCode >= 400) {
        response.resume()
        settleReject(new Error(`下载失败: HTTP ${statusCode} (${url})`))
        return
      }

      const fileStream = fsRaw.createWriteStream(targetPath)
      const cleanupAndReject = async (error: unknown) => {
        try {
          fileStream.destroy()
        } catch {
          // ignore
        }
        try {
          await fs.rm(targetPath, { force: true })
        } catch {
          // ignore
        }
        settleReject(error)
      }

      response.on('error', (error) => {
        void cleanupAndReject(error)
      })
      fileStream.on('error', (error) => {
        void cleanupAndReject(error)
      })
      fileStream.on('finish', () => settleResolve())

      response.pipe(fileStream)
    })

    request.setTimeout(DOWNLOAD_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`下载请求超时: ${DOWNLOAD_REQUEST_TIMEOUT_MS}ms`))
    })
    request.on('error', (error) => settleReject(error))
    request.end()
  })
}
