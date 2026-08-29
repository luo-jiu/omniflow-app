export type NativeDownloadItem = {
  cancel: () => void
  getFilename: () => string
  getMimeType: () => string
  getReceivedBytes: () => number
  getTotalBytes: () => number
  getURL: () => string
  on: (event: 'updated', listener: (_event: unknown, state: string) => void) => void
  once: (event: 'done', listener: (_event: unknown, state: string) => void) => void
  setSavePath: (path: string) => void
}

export type NativeDownloadSessionPayload = {
  downloadId: string
  error?: string
  fileName: string
  mimeType?: string
  pageUrl?: string
  receivedBytes: number
  state: 'started' | 'progress' | 'completed' | 'cancelled' | 'failed'
  tabId?: string
  tempPath?: string
  totalBytes: number
  url: string
}

export type NativeDownloadSessionOptions = {
  downloadId: string
  emit: (payload: NativeDownloadSessionPayload) => void
  fileName: string
  item: NativeDownloadItem
  onSettled?: () => void
  pageUrl?: string
  tabId: string
  tempPath: string
  url: string
  cleanup: (tempPath: string) => Promise<void>
}

function normalizeByteCount(value: unknown) {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0
}

/** Owns one Electron DownloadItem from staging through a single terminal event. */
export class NativeDownloadSession {
  private readonly options: NativeDownloadSessionOptions

  private started = false

  private settledState = false

  private readonly settledPromise: Promise<void>

  private settlePromise: (() => void) | undefined

  constructor(options: NativeDownloadSessionOptions) {
    this.options = options
    this.settledPromise = new Promise<void>((resolve) => {
      this.settlePromise = resolve
    })
  }

  get settled() {
    return this.settledPromise
  }

  start() {
    if (this.started) {
      throw new Error('native download session 已启动')
    }
    this.started = true
    this.options.item.on('updated', (_event, state) => {
      if (state !== 'progressing' || this.settledState) {
        return
      }
      this.emit('progress')
    })
    this.options.item.once('done', (_event, state) => {
      void this.finish(state).catch(() => undefined)
    })
    try {
      this.options.item.setSavePath(this.options.tempPath)
      this.emit('started')
    } catch (error) {
      void this.finish('failed', error).catch(() => undefined)
    }
    return this
  }

  cancel() {
    if (this.settledState) {
      return
    }
    try {
      this.options.item.cancel()
    } catch (error) {
      void this.finish('failed', error).catch(() => undefined)
    }
  }

  private emit(
    state: NativeDownloadSessionPayload['state'],
    error?: unknown,
  ) {
    const item = this.options.item
    const message = error instanceof Error ? error.message : String(error || '')
    this.options.emit({
      downloadId: this.options.downloadId,
      fileName: this.options.fileName,
      mimeType: item.getMimeType() || undefined,
      pageUrl: this.options.pageUrl,
      receivedBytes: normalizeByteCount(item.getReceivedBytes()),
      state,
      tabId: this.options.tabId,
      tempPath: this.options.tempPath,
      totalBytes: normalizeByteCount(item.getTotalBytes()),
      url: this.options.url,
      ...(message ? { error: message } : {}),
    })
  }

  private async finish(state: string, cause?: unknown) {
    if (this.settledState) {
      return
    }
    this.settledState = true
    try {
      const completed = state === 'completed' && !cause
      if (completed) {
        this.emit('completed')
      } else {
        await this.options.cleanup(this.options.tempPath).catch(() => undefined)
        const cancelled = state === 'cancelled'
        this.emit(
          cancelled ? 'cancelled' : 'failed',
          cause || (cancelled ? '下载已取消' : `下载失败：${state}`),
        )
      }
    } finally {
      this.settlePromise?.()
      this.options.onSettled?.()
    }
  }
}
