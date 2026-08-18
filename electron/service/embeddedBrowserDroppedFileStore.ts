type DroppedFileEntry = {
  sizeBytes: number
  timer: ReturnType<typeof setTimeout>
}

type EmbeddedBrowserDroppedFileStoreOptions = {
  cleanupFile: (stagedPath: string) => Promise<unknown>
  cleanupFileSync?: (stagedPath: string) => unknown
  maxTotalBytes?: number
  ttlMs?: number
}

const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const DEFAULT_TTL_MS = 30 * 60 * 1000

export class EmbeddedBrowserDroppedFileStore {
  private readonly cleanupFile: (stagedPath: string) => Promise<unknown>
  private readonly cleanupFileSync?: (stagedPath: string) => unknown
  private readonly maxTotalBytes: number
  private readonly ttlMs: number
  private readonly entriesByTab = new Map<string, Map<string, DroppedFileEntry>>()
  private totalBytes = 0

  constructor(options: EmbeddedBrowserDroppedFileStoreOptions) {
    this.cleanupFile = options.cleanupFile
    this.cleanupFileSync = options.cleanupFileSync
    this.maxTotalBytes = Number.isFinite(options.maxTotalBytes) && Number(options.maxTotalBytes) > 0
      ? Number(options.maxTotalBytes)
      : DEFAULT_MAX_TOTAL_BYTES
    this.ttlMs = Number.isFinite(options.ttlMs) && Number(options.ttlMs) > 0
      ? Number(options.ttlMs)
      : DEFAULT_TTL_MS
  }

  retain(tabId: string, stagedPath: string, sizeBytes: number): void {
    const normalizedTabId = String(tabId || '').trim()
    const normalizedPath = String(stagedPath || '').trim()
    const normalizedSize = Number(sizeBytes)
    if (!normalizedTabId || !normalizedPath || !Number.isFinite(normalizedSize) || normalizedSize < 0) {
      throw new Error('无效的浏览器拖拽暂存文件')
    }
    if (this.totalBytes + normalizedSize > this.maxTotalBytes) {
      throw new Error('浏览器拖拽暂存文件总量超过 1GB 上限，请刷新网页后重试')
    }

    const tabEntries = this.entriesByTab.get(normalizedTabId) || new Map<string, DroppedFileEntry>()
    const previous = tabEntries.get(normalizedPath)
    if (previous) {
      clearTimeout(previous.timer)
      this.totalBytes -= previous.sizeBytes
    }
    const timer = setTimeout(() => {
      void this.release(normalizedTabId, normalizedPath)
    }, this.ttlMs)
    timer.unref?.()
    tabEntries.set(normalizedPath, {
      sizeBytes: normalizedSize,
      timer,
    })
    this.entriesByTab.set(normalizedTabId, tabEntries)
    this.totalBytes += normalizedSize
  }

  async release(tabId: string, stagedPath: string): Promise<boolean> {
    const normalizedTabId = String(tabId || '').trim()
    const normalizedPath = String(stagedPath || '').trim()
    const tabEntries = this.entriesByTab.get(normalizedTabId)
    const entry = tabEntries?.get(normalizedPath)
    if (!tabEntries || !entry) return false
    clearTimeout(entry.timer)
    tabEntries.delete(normalizedPath)
    this.totalBytes = Math.max(0, this.totalBytes - entry.sizeBytes)
    if (tabEntries.size === 0) this.entriesByTab.delete(normalizedTabId)
    await this.cleanupFile(normalizedPath).catch(() => undefined)
    return true
  }

  async releaseTab(tabId: string): Promise<void> {
    const normalizedTabId = String(tabId || '').trim()
    const tabEntries = this.entriesByTab.get(normalizedTabId)
    if (!tabEntries) return
    this.entriesByTab.delete(normalizedTabId)
    const entries = [...tabEntries.entries()]
    entries.forEach(([, entry]) => {
      clearTimeout(entry.timer)
      this.totalBytes = Math.max(0, this.totalBytes - entry.sizeBytes)
    })
    await Promise.all(entries.map(([stagedPath]) => (
      this.cleanupFile(stagedPath).catch(() => undefined)
    )))
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.entriesByTab.keys()].map(tabId => this.releaseTab(tabId)))
  }

  disposeSync(): void {
    for (const tabEntries of this.entriesByTab.values()) {
      for (const [stagedPath, entry] of tabEntries.entries()) {
        clearTimeout(entry.timer)
        try {
          this.cleanupFileSync?.(stagedPath)
        } catch {
          // A later stale-file sweep retries failed shutdown cleanup.
        }
      }
    }
    this.entriesByTab.clear()
    this.totalBytes = 0
  }

  getSnapshot() {
    return {
      fileCount: [...this.entriesByTab.values()].reduce((total, entries) => total + entries.size, 0),
      totalBytes: this.totalBytes,
    }
  }
}
