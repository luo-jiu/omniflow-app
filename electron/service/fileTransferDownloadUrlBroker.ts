import crypto from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { FileTransferDownloadUrlEnvironment } from '@/features/file-transfer/model/file-transfer'
import { normalizeDownloadFileName } from '../../src/features/file-transfer/model/download-file-name'

const DEFAULT_CLAIM_TTL_MS = 5 * 60 * 1000
const DEFAULT_SOURCE_WAIT_MS = 30 * 1000
const MAX_RESOLVED_SOURCE_TTL_MS = 24 * 60 * 60 * 1000
const DOWNLOAD_ROUTE_PREFIX = 'file-transfer-download'

export interface ResolveDownloadUrlClaimInput {
  claimId: string
  fileName: string
  mimeType?: string
  sourceUrl: string
}

export interface RejectDownloadUrlClaimInput {
  claimId: string
  error: string
  fileName?: string
}

export interface ResolvedDownloadUrlClaim {
  claimId: string
  fileName: string
  mimeType?: string
  sourceUrl: string
}

export interface ResolvedLoopbackSource {
  claimId: string
  url: string
}

export interface ResolvedLoopbackSourceOptions {
  ttlMs?: number
}

export interface FileTransferDownloadUrlBrokerOptions {
  claimTtlMs?: number
  sourceWaitMs?: number
  now?: () => number
  runtimeTokenFactory?: () => string
  fetcher?: typeof fetch
}

interface DownloadUrlClaim {
  claimId: string
  fileName: string
  mimeType?: string
  sourceUrl?: string
  error?: string
  createdAt: number
  expiresAt: number
  internalDropConsumed: boolean
  internalDropRegistered: boolean
  waiters: Set<() => void>
}

function normalizeClaimId(value: unknown): string {
  const claimId = String(value || '').trim()
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(claimId)) {
    throw new Error('无效的下载声明')
  }
  return claimId
}

function normalizeSourceUrl(value: unknown): string {
  const sourceUrl = String(value || '').trim()
  const parsed = new URL(sourceUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('下载来源仅支持 HTTP(S)')
  }
  return sourceUrl
}

function quoteContentDispositionFileName(fileName: string): string {
  const fallback = normalizeDownloadFileName(fileName)
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function writeError(response: ServerResponse, statusCode: number, message: string) {
  if (response.headersSent || response.writableEnded) return
  const body = Buffer.from(message, 'utf8')
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': body.byteLength,
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

export class FileTransferDownloadUrlBroker {
  private readonly claimTtlMs: number
  private readonly sourceWaitMs: number
  private readonly now: () => number
  private readonly runtimeToken: string
  private readonly fetcher: typeof fetch
  private readonly claims = new Map<string, DownloadUrlClaim>()
  private server: http.Server | null = null
  private origin = ''

  constructor(options: FileTransferDownloadUrlBrokerOptions = {}) {
    this.claimTtlMs = Number.isFinite(options.claimTtlMs) && Number(options.claimTtlMs) > 0
      ? Number(options.claimTtlMs)
      : DEFAULT_CLAIM_TTL_MS
    this.sourceWaitMs = Number.isFinite(options.sourceWaitMs) && Number(options.sourceWaitMs) > 0
      ? Number(options.sourceWaitMs)
      : DEFAULT_SOURCE_WAIT_MS
    this.now = options.now || Date.now
    this.runtimeToken = (options.runtimeTokenFactory || (() => crypto.randomBytes(32).toString('hex')))()
    this.fetcher = options.fetcher || globalThis.fetch
  }

  async start(): Promise<void> {
    if (this.server) return
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        writeError(response, 502, error instanceof Error ? error.message : '文件导出失败')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('文件导出服务未取得本地端口')
    }
    this.server = server
    this.origin = `http://127.0.0.1:${address.port}`
  }

  getEnvironment(): FileTransferDownloadUrlEnvironment {
    if (!this.server || !this.origin) {
      throw new Error('文件导出服务尚未启动')
    }
    return {
      origin: this.origin,
      runtimeToken: this.runtimeToken,
      claimTtlMs: this.claimTtlMs,
    }
  }

  resolveClaim(input: ResolveDownloadUrlClaimInput): void {
    const claimId = normalizeClaimId(input.claimId)
    const sourceUrl = normalizeSourceUrl(input.sourceUrl)
    const claim = this.getOrCreateClaim(claimId, input.fileName)
    if (claim.expiresAt <= this.now()) {
      this.claims.delete(claimId)
      throw new Error('文件导出声明已过期')
    }
    claim.fileName = normalizeDownloadFileName(input.fileName || claim.fileName)
    claim.mimeType = String(input.mimeType || '').trim() || undefined
    claim.sourceUrl = sourceUrl
    claim.error = undefined
    this.notifyWaiters(claim)
  }

  createResolvedLoopbackSource(
    input: Omit<ResolveDownloadUrlClaimInput, 'claimId'>,
    options: ResolvedLoopbackSourceOptions = {},
  ): ResolvedLoopbackSource {
    const environment = this.getEnvironment()
    const claimId = crypto.randomUUID()
    const fileName = normalizeDownloadFileName(input.fileName)
    this.resolveClaim({ ...input, claimId, fileName })
    const requestedTtlMs = Number(options.ttlMs)
    if (Number.isFinite(requestedTtlMs) && requestedTtlMs > 0) {
      const claim = this.claims.get(claimId)
      if (claim) {
        claim.expiresAt = this.now() + Math.min(requestedTtlMs, MAX_RESOLVED_SOURCE_TTL_MS)
      }
    }
    return {
      claimId,
      url: `${environment.origin}/${DOWNLOAD_ROUTE_PREFIX}/${environment.runtimeToken}/${claimId}/${encodeURIComponent(fileName)}`,
    }
  }

  releaseClaim(claimId: string): boolean {
    const normalizedClaimId = normalizeClaimId(claimId)
    const claim = this.claims.get(normalizedClaimId)
    if (!claim) return false
    claim.error = '文件来源声明已释放'
    this.notifyWaiters(claim)
    return this.claims.delete(normalizedClaimId)
  }

  rejectClaim(input: RejectDownloadUrlClaimInput): void {
    const claimId = normalizeClaimId(input.claimId)
    const claim = this.getOrCreateClaim(claimId, input.fileName || 'file')
    claim.error = String(input.error || '无法取得文件访问链接')
    this.notifyWaiters(claim)
  }

  registerInternalDropClaim(claimId: string, fileName: string): void {
    const normalizedClaimId = normalizeClaimId(claimId)
    this.sweepExpired()
    const claim = this.getOrCreateClaim(normalizedClaimId, fileName)
    if (claim.internalDropConsumed) {
      throw new Error('文件传输声明已被使用')
    }
    claim.internalDropRegistered = true
  }

  async waitForResolvedClaim(
    claimId: string,
    fileName: string,
    signal?: AbortSignal,
  ): Promise<ResolvedDownloadUrlClaim> {
    const normalizedClaimId = normalizeClaimId(claimId)
    this.sweepExpired()
    const claim = this.claims.get(normalizedClaimId)
    if (!claim?.internalDropRegistered) {
      throw new Error('文件传输声明未授权')
    }
    if (claim.fileName !== normalizeDownloadFileName(fileName)) {
      throw new Error('文件传输声明与文件名不匹配')
    }
    if (claim.internalDropConsumed) {
      throw new Error('文件传输声明已被使用')
    }
    claim.internalDropConsumed = true
    await this.waitForClaimSource(claim, signal)
    if (claim.expiresAt <= this.now()) {
      this.claims.delete(normalizedClaimId)
      throw new Error('文件传输声明已过期')
    }
    if (claim.error || !claim.sourceUrl) {
      throw new Error(claim.error || '文件访问链接不可用')
    }
    return {
      claimId: normalizedClaimId,
      fileName: claim.fileName,
      mimeType: claim.mimeType,
      sourceUrl: claim.sourceUrl,
    }
  }

  sweepExpired(): number {
    const now = this.now()
    const expired = [...this.claims.values()].filter((claim) => claim.expiresAt <= now)
    expired.forEach((claim) => {
      claim.error = '文件导出声明已过期'
      this.notifyWaiters(claim)
      this.claims.delete(claim.claimId)
    })
    return expired.length
  }

  async close(): Promise<void> {
    this.claims.forEach((claim) => {
      claim.error = '文件导出服务已关闭'
      this.notifyWaiters(claim)
    })
    this.claims.clear()
    const server = this.server
    this.server = null
    this.origin = ''
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private getOrCreateClaim(claimId: string, fileName: string): DownloadUrlClaim {
    const existing = this.claims.get(claimId)
    if (existing) return existing
    const createdAt = this.now()
    const claim: DownloadUrlClaim = {
      claimId,
      fileName: normalizeDownloadFileName(fileName),
      createdAt,
      expiresAt: createdAt + this.claimTtlMs,
      internalDropConsumed: false,
      internalDropRegistered: false,
      waiters: new Set(),
    }
    this.claims.set(claimId, claim)
    return claim
  }

  private notifyWaiters(claim: DownloadUrlClaim) {
    const waiters = [...claim.waiters]
    claim.waiters.clear()
    waiters.forEach((notify) => notify())
  }

  private async waitForClaimSource(claim: DownloadUrlClaim, signal?: AbortSignal): Promise<void> {
    if (claim.sourceUrl || claim.error) return
    if (signal?.aborted) {
      const error = new Error('文件传输已取消')
      error.name = 'AbortError'
      throw error
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', abort)
      }
      const timeoutId = setTimeout(() => {
        claim.waiters.delete(notify)
        signal?.removeEventListener('abort', abort)
        resolve()
      }, this.sourceWaitMs)
      const notify = () => {
        cleanup()
        resolve()
      }
      const abort = () => {
        claim.waiters.delete(notify)
        cleanup()
        const error = new Error('文件传输已取消')
        error.name = 'AbortError'
        reject(error)
      }
      claim.waiters.add(notify)
      signal?.addEventListener('abort', abort, { once: true })
    })
    if (!claim.sourceUrl && !claim.error) {
      claim.error = '等待文件访问链接超时'
    }
  }

  private parseRequest(request: IncomingMessage): { claimId: string; fileName: string } | null {
    const requestUrl = new URL(request.url || '/', this.origin || 'http://127.0.0.1')
    const segments = requestUrl.pathname.split('/').filter(Boolean)
    if (segments.length !== 4 || segments[0] !== DOWNLOAD_ROUTE_PREFIX) return null
    if (segments[1] !== this.runtimeToken) return null
    let fileName = 'file'
    try {
      fileName = decodeURIComponent(segments[3])
    } catch {
      return null
    }
    try {
      return {
        claimId: normalizeClaimId(segments[2]),
        fileName: normalizeDownloadFileName(fileName),
      }
    } catch {
      return null
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeError(response, 405, 'method not allowed')
      return
    }
    const parsed = this.parseRequest(request)
    if (!parsed) {
      writeError(response, 404, 'not found')
      return
    }
    this.sweepExpired()
    const claim = this.getOrCreateClaim(parsed.claimId, parsed.fileName)
    await this.waitForClaimSource(claim)
    if (claim.error || !claim.sourceUrl) {
      writeError(response, 502, claim.error || '文件访问链接不可用')
      return
    }

    const abortController = new AbortController()
    response.once('close', () => {
      if (!response.writableEnded) abortController.abort()
    })
    const upstreamHeaders: Record<string, string> = { 'Accept-Encoding': 'identity' }
    if (request.headers.range) upstreamHeaders.Range = request.headers.range
    const upstream = await this.fetcher(claim.sourceUrl, {
      headers: upstreamHeaders,
      method: 'GET',
      redirect: 'follow',
      signal: abortController.signal,
    })
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel().catch(() => undefined)
      writeError(response, 502, `文件来源响应异常: ${upstream.status}`)
      return
    }

    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'Content-Disposition': quoteContentDispositionFileName(claim.fileName),
      'Content-Type': claim.mimeType || upstream.headers.get('content-type') || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    }
    for (const name of ['accept-ranges', 'content-length', 'content-range', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name)
      if (value) headers[name] = value
    }
    response.writeHead(upstream.status === 206 ? 206 : 200, headers)
    if (request.method === 'HEAD') {
      await upstream.body.cancel().catch(() => undefined)
      response.end()
      return
    }
    try {
      await pipeline(Readable.fromWeb(upstream.body as never), response)
    } catch (error) {
      if (!response.destroyed) response.destroy(error as Error)
    }
  }
}
