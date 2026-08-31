import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type DownloadHandoffPayload = {
  downloadId: string
  error?: string
  fileName: string
  mimeType?: string
  pageUrl?: string
  receivedBytes: number
  state: 'completed'
  tabId?: string
  tempPath: string
  totalBytes: number
  url: string
}

type DownloadHandoffRecord = {
  download: DownloadHandoffPayload
  queuedAt: number
}

type PersistedDownloadHandoff = {
  items: DownloadHandoffRecord[]
  version: number
}

export type DownloadHandoffStoreOptions = {
  cleanup?: (tempPath: string) => Promise<unknown>
  journalPath: string
  maxAgeMs?: number
  now?: () => number
  stagingRootPath: string
}

const DOWNLOAD_HANDOFF_VERSION = 1
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_ITEMS = 64

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeByteCount(value: unknown) {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null
}

function normalizePayload(value: unknown): DownloadHandoffPayload | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<DownloadHandoffPayload>
  const downloadId = normalizeText(input.downloadId)
  const fileName = normalizeText(input.fileName)
  const tempPath = normalizeText(input.tempPath)
  const url = normalizeText(input.url)
  const receivedBytes = normalizeByteCount(input.receivedBytes)
  const totalBytes = normalizeByteCount(input.totalBytes)
  if (
    !downloadId
    || !fileName
    || !tempPath
    || !url
    || input.state !== 'completed'
    || receivedBytes === null
    || totalBytes === null
  ) {
    return null
  }
  return {
    downloadId,
    error: normalizeText(input.error) || undefined,
    fileName,
    mimeType: normalizeText(input.mimeType) || undefined,
    pageUrl: normalizeText(input.pageUrl) || undefined,
    receivedBytes,
    state: 'completed',
    tabId: normalizeText(input.tabId) || undefined,
    tempPath: path.resolve(tempPath),
    totalBytes,
    url,
  }
}

function isPathInside(filePath: string, directoryPath: string) {
  const resolvedFilePath = path.resolve(filePath)
  const resolvedDirectoryPath = path.resolve(directoryPath)
  return resolvedFilePath !== resolvedDirectoryPath
    && resolvedFilePath.startsWith(`${resolvedDirectoryPath}${path.sep}`)
}

function parseRecord(value: unknown): DownloadHandoffRecord | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<DownloadHandoffRecord>
  const queuedAt = Number(input.queuedAt)
  if (!Number.isFinite(queuedAt) || queuedAt <= 0) {
    return null
  }
  const download = normalizePayload(input.download)
  return download ? { download, queuedAt } : null
}

/** Main-only durable handoff for completed browser outputs that outlive a renderer view. */
export class DownloadHandoffStore {
  private readonly cleanup?: (tempPath: string) => Promise<unknown>

  private readonly journalPath: string

  private readonly maxAgeMs: number

  private readonly now: () => number

  private readonly stagingRootPath: string

  private readonly records = new Map<string, DownloadHandoffRecord>()

  private readonly pendingRecords = new Map<string, DownloadHandoffRecord>()

  private readyPromise: Promise<void> | null = null

  private persistPromise: Promise<void> = Promise.resolve()

  constructor(options: DownloadHandoffStoreOptions) {
    const journalPath = normalizeText(options.journalPath)
    const stagingRootPath = normalizeText(options.stagingRootPath)
    if (!journalPath || !stagingRootPath) {
      throw new Error('download handoff store 路径无效')
    }
    this.cleanup = options.cleanup
    this.journalPath = path.resolve(journalPath)
    this.maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) && Number(options.maxAgeMs) > 0
      ? Number(options.maxAgeMs)
      : DEFAULT_MAX_AGE_MS
    this.now = options.now || Date.now
    this.stagingRootPath = path.resolve(stagingRootPath)
  }

  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = this.initialize()
    }
    await this.readyPromise
    await this.flushPendingRecords()
  }

  record(payload: unknown) {
    const download = normalizePayload(payload)
    if (!download || !isPathInside(download.tempPath, this.stagingRootPath)) {
      return false
    }
    const record = { download, queuedAt: this.now() }
    this.pendingRecords.set(download.downloadId, record)
    void this.ensureReady().then(() => this.persist()).catch(() => undefined)
    return true
  }

  async list() {
    await this.ensureReady()
    if (await this.pruneUnavailableRecords()) {
      await this.persist()
    }
    return [...this.records.values()].map(record => ({ ...record.download }))
  }

  async acknowledge(downloadId: string) {
    await this.ensureReady()
    const normalizedId = normalizeText(downloadId)
    const removed = this.records.delete(normalizedId) || this.pendingRecords.delete(normalizedId)
    if (removed) {
      await this.persist()
    }
    return removed
  }

  async flush() {
    await this.ensureReady()
    await this.persistPromise
  }

  private async initialize() {
    await this.load()
    if (await this.pruneUnavailableRecords()) {
      await this.persist()
    }
  }

  private async load() {
    const raw = await readFile(this.journalPath, 'utf8').catch(() => null)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedDownloadHandoff>
      if (parsed.version !== DOWNLOAD_HANDOFF_VERSION || !Array.isArray(parsed.items)) return
      parsed.items.forEach((item) => {
        const record = parseRecord(item)
        if (!record || !isPathInside(record.download.tempPath, this.stagingRootPath)) return
        if (!this.records.has(record.download.downloadId)) {
          this.records.set(record.download.downloadId, record)
        }
      })
      this.trim()
    } catch {
      // A corrupt handoff journal is disposable; the staging TTL remains the final cleanup boundary.
    }
  }

  private async flushPendingRecords() {
    if (!this.pendingRecords.size) return
    this.pendingRecords.forEach((record, downloadId) => {
      this.records.set(downloadId, record)
    })
    this.pendingRecords.clear()
    this.trim()
  }

  private async pruneUnavailableRecords() {
    const invalidRecords: DownloadHandoffRecord[] = []
    for (const [downloadId, record] of this.records) {
      const available = this.now() - record.queuedAt <= this.maxAgeMs
        && isPathInside(record.download.tempPath, this.stagingRootPath)
        && await stat(record.download.tempPath)
          .then(metadata => metadata.isFile())
          .catch(() => false)
      if (available) {
        continue
      }
      this.records.delete(downloadId)
      invalidRecords.push(record)
    }
    await Promise.all(invalidRecords.map(record => (
      this.cleanup?.(record.download.tempPath).catch(() => undefined)
    )))
    return invalidRecords.length
  }

  private trim() {
    if (this.records.size <= MAX_ITEMS) return
    const retained = [...this.records.entries()]
      .sort(([, left], [, right]) => left.queuedAt - right.queuedAt)
      .slice(-MAX_ITEMS)
    this.records.clear()
    retained.forEach(([downloadId, record]) => this.records.set(downloadId, record))
  }

  private persist() {
    this.persistPromise = this.persistPromise
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.journalPath), { recursive: true })
        const payload: PersistedDownloadHandoff = {
          items: [...this.records.values()],
          version: DOWNLOAD_HANDOFF_VERSION,
        }
        if (!payload.items.length) {
          await rm(this.journalPath, { force: true }).catch(() => undefined)
          return
        }
        const temporaryPath = `${this.journalPath}.${process.pid}.${randomUUID()}.tmp`
        try {
          await writeFile(temporaryPath, JSON.stringify(payload), 'utf8')
          await rename(temporaryPath, this.journalPath)
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => undefined)
        }
      })
    return this.persistPromise
  }
}
