import { appendFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type MseSpoolFile = {
  bytesWritten: number
  directoryPath: string
  fileName: string
  filePath: string
  mimeType?: string
  resourceKey: string
  streamType?: 'audio' | 'video'
  tabId: string
  updatedAt: number
}

export type MseSpoolAppendInput = {
  chunk: Uint8Array
  fileName?: string
  mimeType?: string
  resourceKey: string
  streamType?: 'audio' | 'video'
  tabId: string
}

export type MseSpoolStoreOptions = {
  maxChunkBytes?: number
  maxEntryBytes?: number
  maxTotalBytes?: number
  now?: () => number
  staleAfterMs?: number
  temporaryRootPath?: string
  ttlMs?: number
}

const SPOOL_DIRECTORY_PREFIX = 'omniflow-mse-spool-'
const DEFAULT_MAX_CHUNK_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_ENTRY_BYTES = 10 * 1024 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000

function normalizePositiveInteger(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0
    ? Math.max(1, Math.floor(number))
    : fallback
}

function normalizeIdentity(value: unknown) {
  return String(value || '').trim()
}

function buildSpoolKey(tabId: string, resourceKey: string) {
  return JSON.stringify([tabId, resourceKey])
}

function sanitizeFileName(value: string) {
  const safeName = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim()
  return safeName || 'media.bin'
}

export class MseSpoolStore {
  private disposed = false
  private readonly entries = new Map<string, MseSpoolFile>()
  private readonly maxChunkBytes: number
  private readonly maxEntryBytes: number
  private readonly maxTotalBytes: number
  private readonly now: () => number
  private readonly pendingOwners = new Map<string, Pick<MseSpoolFile, 'resourceKey' | 'tabId'>>()
  private readonly queues = new Map<string, Promise<MseSpoolFile | null>>()
  private readonly reservedBytesByKey = new Map<string, number>()
  private readonly staleAfterMs: number
  private readonly temporaryRootPath: string
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private totalBytes = 0
  private totalReservedBytes = 0
  private readonly ttlMs: number

  constructor(options: MseSpoolStoreOptions = {}) {
    this.maxChunkBytes = normalizePositiveInteger(options.maxChunkBytes, DEFAULT_MAX_CHUNK_BYTES)
    this.maxEntryBytes = normalizePositiveInteger(options.maxEntryBytes, DEFAULT_MAX_ENTRY_BYTES)
    this.maxTotalBytes = normalizePositiveInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES)
    this.now = options.now || Date.now
    this.staleAfterMs = normalizePositiveInteger(options.staleAfterMs, DEFAULT_STALE_AFTER_MS)
    this.temporaryRootPath = options.temporaryRootPath || os.tmpdir()
    this.ttlMs = normalizePositiveInteger(options.ttlMs, DEFAULT_TTL_MS)
  }

  async append(input: MseSpoolAppendInput): Promise<MseSpoolFile> {
    if (this.disposed) throw new Error('MSE 暂存已关闭')
    const tabId = normalizeIdentity(input.tabId)
    const resourceKey = normalizeIdentity(input.resourceKey)
    const chunk = Buffer.from(input.chunk)
    if (!tabId || !resourceKey || chunk.byteLength === 0) {
      throw new Error('无效的 MSE 暂存分片')
    }
    if (chunk.byteLength > this.maxChunkBytes) {
      throw new Error('MSE 单个暂存分片超过安全上限')
    }

    const key = buildSpoolKey(tabId, resourceKey)
    const entryBytes = this.entries.get(key)?.bytesWritten || 0
    const reservedForKey = this.reservedBytesByKey.get(key) || 0
    if (entryBytes + reservedForKey + chunk.byteLength > this.maxEntryBytes) {
      throw new Error('MSE 单轨暂存数据超过安全上限')
    }
    if (this.totalBytes + this.totalReservedBytes + chunk.byteLength > this.maxTotalBytes) {
      throw new Error('MSE 暂存数据总量超过安全上限，请清理缓存后重试')
    }

    this.totalReservedBytes += chunk.byteLength
    this.reservedBytesByKey.set(key, reservedForKey + chunk.byteLength)
    this.pendingOwners.set(key, { resourceKey, tabId })
    const previousQueue = this.queues.get(key) || Promise.resolve(null)
    const operation = previousQueue
      .catch(() => null)
      .then(async () => {
        if (this.disposed) throw new Error('MSE 暂存已关闭')
        let entry = this.entries.get(key)
        let created = false
        if (!entry) {
          const directoryPath = await mkdtemp(path.join(
            this.temporaryRootPath,
            SPOOL_DIRECTORY_PREFIX,
          ))
          const fileName = sanitizeFileName(input.fileName || `${resourceKey}.bin`)
          entry = {
            bytesWritten: 0,
            directoryPath,
            fileName,
            filePath: path.join(directoryPath, fileName),
            mimeType: input.mimeType,
            resourceKey,
            streamType: input.streamType,
            tabId,
            updatedAt: this.now(),
          }
          this.entries.set(key, entry)
          created = true
        }
        try {
          await appendFile(entry.filePath, chunk)
        } catch (error) {
          if (created && entry.bytesWritten === 0) {
            this.entries.delete(key)
            await rm(entry.directoryPath, { force: true, recursive: true }).catch(() => undefined)
          }
          throw error
        }
        entry.bytesWritten += chunk.byteLength
        entry.updatedAt = this.now()
        if (input.mimeType) entry.mimeType = input.mimeType
        if (input.streamType === 'audio' || input.streamType === 'video') {
          entry.streamType = input.streamType
        }
        this.totalBytes += chunk.byteLength
        this.refreshTtl(key)
        return { ...entry }
      })
      .finally(() => {
        this.totalReservedBytes = Math.max(0, this.totalReservedBytes - chunk.byteLength)
        const nextReserved = Math.max(
          0,
          (this.reservedBytesByKey.get(key) || 0) - chunk.byteLength,
        )
        if (nextReserved === 0) this.reservedBytesByKey.delete(key)
        else this.reservedBytesByKey.set(key, nextReserved)
        if (this.queues.get(key) === operation) {
          this.queues.delete(key)
          this.pendingOwners.delete(key)
        }
      })
    this.queues.set(key, operation)
    return operation.then((entry) => {
      if (!entry) throw new Error('MSE 暂存写入失败')
      return entry
    })
  }

  async get(tabId: string, resourceKey: string): Promise<MseSpoolFile | null> {
    const key = buildSpoolKey(normalizeIdentity(tabId), normalizeIdentity(resourceKey))
    await this.queues.get(key)?.catch(() => undefined)
    const entry = this.entries.get(key)
    return entry ? { ...entry } : null
  }

  async clear(options: { all?: boolean; resourceKey?: string; tabId?: string }) {
    const tabId = normalizeIdentity(options.tabId)
    const resourceKey = normalizeIdentity(options.resourceKey)
    if (!options.all && !tabId && !resourceKey) return 0
    const keys = new Set([...this.entries.keys(), ...this.pendingOwners.keys()])
    const matchingKeys = [...keys].filter((key) => {
      const owner = this.entries.get(key) || this.pendingOwners.get(key)
      if (!owner) return false
      if (tabId && owner.tabId !== tabId) return false
      if (resourceKey && owner.resourceKey !== resourceKey) return false
      return true
    })
    await Promise.all(matchingKeys.map(key => this.enqueueClear(key)))
    return matchingKeys.length
  }

  async sweepStale() {
    const entries = await readdir(this.temporaryRootPath, { withFileTypes: true })
      .catch(() => [])
    const cutoff = this.now() - this.staleAfterMs
    await Promise.all(entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith(SPOOL_DIRECTORY_PREFIX))
      .map(async (entry) => {
        const directoryPath = path.join(this.temporaryRootPath, entry.name)
        const metadata = await stat(directoryPath).catch(() => null)
        if (metadata && metadata.mtimeMs <= cutoff) {
          await rm(directoryPath, { force: true, recursive: true }).catch(() => undefined)
        }
      }))
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    await this.clear({ all: true })
    this.queues.clear()
    this.pendingOwners.clear()
    this.reservedBytesByKey.clear()
    this.totalReservedBytes = 0
  }

  getSnapshot() {
    return {
      fileCount: this.entries.size,
      reservedBytes: this.totalReservedBytes,
      totalBytes: this.totalBytes,
    }
  }

  private async enqueueClear(key: string) {
    const previousQueue = this.queues.get(key) || Promise.resolve(null)
    let operation: Promise<MseSpoolFile | null>
    operation = previousQueue
      .catch(() => null)
      .then(async () => {
        const entry = this.entries.get(key)
        if (!entry) return null
        this.entries.delete(key)
        this.clearTtl(key)
        this.totalBytes = Math.max(0, this.totalBytes - entry.bytesWritten)
        await rm(entry.directoryPath, { force: true, recursive: true }).catch(() => undefined)
        return null
      })
      .finally(() => {
        if (this.queues.get(key) === operation) {
          this.queues.delete(key)
          this.pendingOwners.delete(key)
        }
      })
    this.queues.set(key, operation)
    await operation
  }

  private refreshTtl(key: string) {
    this.clearTtl(key)
    const timer = setTimeout(() => {
      void this.enqueueClear(key)
    }, this.ttlMs)
    timer.unref?.()
    this.timers.set(key, timer)
  }

  private clearTtl(key: string) {
    const timer = this.timers.get(key)
    if (timer) clearTimeout(timer)
    this.timers.delete(key)
  }
}
