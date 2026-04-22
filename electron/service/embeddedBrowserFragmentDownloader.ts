export type EmbeddedBrowserDownloadByteRange = {
  length: number
  offset?: number
  raw?: string
}

export type EmbeddedBrowserDownloadFragment = {
  byteRange?: EmbeddedBrowserDownloadByteRange
  duration?: number
  index?: number
  url: string
}

export type EmbeddedBrowserFragmentDownloaderState =
  | 'waiting'
  | 'running'
  | 'done'
  | 'aborted'

export type EmbeddedBrowserFragmentDownloaderEventMap = {
  allCompleted: (
    buffers: Array<ArrayBuffer | null>,
    fragments: EmbeddedBrowserDownloadFragment[],
  ) => void
  completed: (
    buffer: ArrayBuffer,
    fragment: EmbeddedBrowserDownloadFragment,
  ) => void
  downloadError: (
    fragment: EmbeddedBrowserDownloadFragment,
    error: Error,
    attempt: number,
  ) => void
  error: (message: string) => void
  failed: (
    fragments: EmbeddedBrowserDownloadFragment[],
    errors: Set<EmbeddedBrowserDownloadFragment>,
  ) => void
  itemProgress: (
    fragment: EmbeddedBrowserDownloadFragment,
    done: boolean,
    receivedLength: number,
    contentLength: number,
    chunk?: Uint8Array,
  ) => void
  rawBuffer: (
    buffer: ArrayBuffer,
    fragment: EmbeddedBrowserDownloadFragment,
  ) => void
  sequentialPush: (
    buffer: ArrayBuffer,
    fragment: EmbeddedBrowserDownloadFragment,
  ) => void
  start: (
    fragment: EmbeddedBrowserDownloadFragment,
    init: RequestInit,
    attempt: number,
  ) => void
  stop: (
    fragment: EmbeddedBrowserDownloadFragment,
    error: Error,
  ) => void
}

type EmbeddedBrowserFragmentDownloaderOptions = {
  fragments?: EmbeddedBrowserDownloadFragment[]
  headers?: Record<string, string>
  maxRetries?: number
  thread?: number
}

type NormalizedEmbeddedBrowserDownloadFragment = EmbeddedBrowserDownloadFragment & {
  index: number
}

type EmbeddedBrowserFragmentDownloadTask = {
  attempt: number
  fragment: NormalizedEmbeddedBrowserDownloadFragment
}

function mergeHeaders(
  baseHeaders: HeadersInit | undefined,
  overrideHeaders: Record<string, string>,
) {
  const headers = new Headers(baseHeaders)
  Object.entries(overrideHeaders).forEach(([name, value]) => {
    const normalizedName = String(name || '').trim()
    const normalizedValue = String(value || '').trim()
    if (!normalizedName || !normalizedValue) {
      return
    }
    headers.set(normalizedName, normalizedValue)
  })
  return headers
}

function createRangeHeader(
  byteRange?: EmbeddedBrowserDownloadByteRange,
) {
  if (!byteRange || !Number.isFinite(byteRange.length) || byteRange.length <= 0) {
    return null
  }
  const start = Math.max(0, Number(byteRange.offset || 0))
  const end = start + Math.max(0, Number(byteRange.length || 0)) - 1
  if (!Number.isFinite(end) || end < start) {
    return null
  }
  return `bytes=${start}-${end}`
}

async function readResponseBuffer(
  response: Response,
  fragment: NormalizedEmbeddedBrowserDownloadFragment,
  emit: <Key extends keyof EmbeddedBrowserFragmentDownloaderEventMap>(
    eventName: Key,
    ...args: Parameters<EmbeddedBrowserFragmentDownloaderEventMap[Key]>
  ) => void,
) {
  const responseBody = response.body
  const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10) || 0
  if (!responseBody || typeof responseBody.getReader !== 'function') {
    const buffer = await response.arrayBuffer()
    emit('itemProgress', fragment, true, buffer.byteLength, buffer.byteLength)
    return buffer
  }

  const reader = responseBody.getReader()
  const chunks: Uint8Array[] = []
  let receivedLength = 0
  let reading = true
  while (reading) {
    const { value, done } = await reader.read()
    if (done) {
      reading = false
      continue
    }
    if (!value) {
      continue
    }
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
    chunks.push(chunk)
    receivedLength += chunk.byteLength
    emit('itemProgress', fragment, false, receivedLength, contentLength, chunk)
  }

  emit('itemProgress', fragment, true, receivedLength, contentLength)
  const mergedBuffer = new Uint8Array(receivedLength)
  let offset = 0
  chunks.forEach((chunk) => {
    mergedBuffer.set(chunk, offset)
    offset += chunk.byteLength
  })
  return mergedBuffer.buffer
}

export class EmbeddedBrowserFragmentDownloader {
  allFragments: EmbeddedBrowserDownloadFragment[]

  buffer: Array<ArrayBuffer | null>

  buffersize: number

  controller: Array<AbortController | null>

  duration: number

  errorList: Set<NormalizedEmbeddedBrowserDownloadFragment>

  headers?: Record<string, string>

  index: number

  pushIndex: number

  running: number

  state: EmbeddedBrowserFragmentDownloaderState

  success: number

  thread: number

  private events: Partial<Record<keyof EmbeddedBrowserFragmentDownloaderEventMap, Array<(...args: any[]) => void>>>

  private fragmentsInternal: NormalizedEmbeddedBrowserDownloadFragment[]

  private maxRetries: number

  private pendingQueue: EmbeddedBrowserFragmentDownloadTask[]

  constructor(options?: EmbeddedBrowserFragmentDownloaderOptions) {
    this.events = {}
    this.thread = Math.max(1, Number(options?.thread || 6))
    this.maxRetries = Math.max(0, Number(options?.maxRetries || 2))
    this.headers = options?.headers
    this.allFragments = []
    this.fragmentsInternal = []
    this.pendingQueue = []
    this.index = 0
    this.buffer = []
    this.state = 'waiting'
    this.success = 0
    this.errorList = new Set()
    this.buffersize = 0
    this.duration = 0
    this.pushIndex = 0
    this.controller = []
    this.running = 0
    this.setFragments(options?.fragments || [])
  }

  on<Key extends keyof EmbeddedBrowserFragmentDownloaderEventMap>(
    eventName: Key,
    callback: EmbeddedBrowserFragmentDownloaderEventMap[Key],
  ) {
    const listeners = (this.events[eventName] || []) as Array<(...args: any[]) => void>
    listeners.push(callback)
    this.events[eventName] = listeners
  }

  emit<Key extends keyof EmbeddedBrowserFragmentDownloaderEventMap>(
    eventName: Key,
    ...args: Parameters<EmbeddedBrowserFragmentDownloaderEventMap[Key]>
  ) {
    const listeners = this.events[eventName]
    listeners?.forEach((callback) => {
      callback(...args)
    })
  }

  setFragments(fragments: EmbeddedBrowserDownloadFragment[]) {
    this.allFragments = fragments.map((fragment) => ({ ...fragment }))
    this.fragmentsInternal = this.allFragments.map((fragment, index) => ({
      ...fragment,
      index,
    }))
    this.resetRuntimeState()
  }

  get fragments() {
    return this.fragmentsInternal
  }

  get total() {
    return this.fragmentsInternal.length
  }

  get totalDuration() {
    return this.fragmentsInternal.reduce((total, fragment) => total + Number(fragment.duration || 0), 0)
  }

  get errorItem() {
    return this.errorList
  }

  get mapTag() {
    return ''
  }

  push(fragment: EmbeddedBrowserDownloadFragment) {
    const nextFragment = {
      ...fragment,
      index: this.fragmentsInternal.length,
    }
    this.allFragments.push({ ...fragment })
    this.fragmentsInternal.push(nextFragment)
    this.buffer.push(null)
    this.controller.push(null)
  }

  stop(index?: number) {
    if (typeof index === 'number') {
      this.controller[index]?.abort()
      return
    }
    this.controller.forEach((controller) => {
      controller?.abort()
    })
    this.pendingQueue = []
    this.state = 'aborted'
  }

  destroy() {
    this.stop()
    this.events = {}
    this.allFragments = []
    this.fragmentsInternal = []
    this.pendingQueue = []
    this.resetRuntimeState()
  }

  range(start = 0, end = this.allFragments.length) {
    const normalizedStart = Math.max(0, Number(start || 0))
    const normalizedEnd = Math.max(0, Number(end || 0))
    if (normalizedStart > normalizedEnd) {
      this.emit('error', 'start > end')
      return false
    }
    if (normalizedEnd > this.allFragments.length) {
      this.emit('error', 'end > total')
      return false
    }
    if (normalizedStart >= this.allFragments.length) {
      this.emit('error', 'start >= total')
      return false
    }

    const selected = this.allFragments.slice(normalizedStart, normalizedEnd)
    this.fragmentsInternal = selected.map((fragment, index) => ({
      ...fragment,
      index,
    }))
    if (!this.fragmentsInternal.length) {
      this.emit('error', 'List is empty')
      return false
    }
    this.resetRuntimeState()
    return true
  }

  start(start = 0, end = this.allFragments.length) {
    if (this.state === 'running') {
      this.emit('error', 'state running')
      return
    }
    if (!this.range(start, end)) {
      return
    }
    this.state = 'running'
    this.pendingQueue = this.fragmentsInternal.map((fragment) => ({
      attempt: 1,
      fragment,
    }))
    const workerCount = Math.min(this.thread, this.pendingQueue.length)
    for (let index = 0; index < workerCount; index += 1) {
      void this.scheduleNext()
    }
  }

  retryErrors() {
    if (this.state === 'running') {
      this.emit('error', 'state running')
      return
    }
    const retryFragments = Array.from(this.errorList)
    if (!retryFragments.length) {
      return
    }
    this.errorList.clear()
    retryFragments.forEach((fragment) => {
      this.buffer[fragment.index] = null
      this.pendingQueue.push({
        attempt: 1,
        fragment,
      })
    })
    this.state = 'running'
    const workerCount = Math.min(this.thread, this.pendingQueue.length)
    for (let index = 0; index < workerCount; index += 1) {
      void this.scheduleNext()
    }
  }

  private resetRuntimeState() {
    this.index = 0
    this.pendingQueue = []
    this.buffer = Array.from({ length: this.fragmentsInternal.length }, () => null)
    this.state = 'waiting'
    this.success = 0
    this.errorList = new Set()
    this.buffersize = 0
    this.duration = 0
    this.pushIndex = 0
    this.controller = Array.from({ length: this.fragmentsInternal.length }, () => null)
    this.running = 0
  }

  private async scheduleNext() {
    if (this.state !== 'running') {
      return
    }
    const task = this.pendingQueue.shift()
    if (!task) {
      if (this.running === 0) {
        this.finishIfComplete()
      }
      return
    }
    await this.downloadTask(task)
    if (this.pendingQueue.length > 0 && this.state === 'running') {
      await this.scheduleNext()
      return
    }
    this.finishIfComplete()
  }

  private async downloadTask(task: EmbeddedBrowserFragmentDownloadTask) {
    const { fragment, attempt } = task
    this.running += 1
    const controller = new AbortController()
    this.controller[fragment.index] = controller
    const initHeaders: Record<string, string> = {}
    const rangeHeader = createRangeHeader(fragment.byteRange)
    if (rangeHeader) {
      initHeaders.Range = rangeHeader
    }
    const requestInit: RequestInit = {
      headers: mergeHeaders(this.headers, initHeaders),
      signal: controller.signal,
    }
    this.emit('start', fragment, requestInit, attempt)

    try {
      const response = await fetch(fragment.url, requestInit)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const buffer = await readResponseBuffer(response, fragment, this.emit.bind(this))
      this.emit('rawBuffer', buffer, fragment)
      this.buffer[fragment.index] = buffer
      this.success += 1
      this.buffersize += buffer.byteLength
      this.duration += Number(fragment.duration || 0)
      this.errorList.delete(fragment)
      this.sequentialPush()
      this.emit('completed', buffer, fragment)
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      if (normalizedError.name === 'AbortError') {
        this.emit('stop', fragment, normalizedError)
        return
      }
      this.emit('downloadError', fragment, normalizedError, attempt)
      if (attempt <= this.maxRetries && this.state === 'running') {
        this.pendingQueue.push({
          attempt: attempt + 1,
          fragment,
        })
      } else {
        this.errorList.add(fragment)
      }
    } finally {
      this.running = Math.max(0, this.running - 1)
      this.controller[fragment.index] = null
    }
  }

  private sequentialPush() {
    if (!this.events.sequentialPush?.length) {
      return
    }
    for (; this.pushIndex < this.fragmentsInternal.length; this.pushIndex += 1) {
      const buffer = this.buffer[this.pushIndex]
      if (!buffer) {
        break
      }
      const fragment = this.fragmentsInternal[this.pushIndex]
      if (!fragment) {
        break
      }
      this.emit('sequentialPush', buffer, fragment)
      this.buffer[this.pushIndex] = null
    }
  }

  private finishIfComplete() {
    if (this.state !== 'running' || this.running > 0 || this.pendingQueue.length > 0) {
      return
    }
    if (this.success === this.fragmentsInternal.length) {
      this.state = 'done'
      this.emit('allCompleted', this.buffer, this.fragmentsInternal)
      return
    }
    if (this.errorList.size > 0) {
      this.state = 'waiting'
      this.emit('failed', this.fragmentsInternal, this.errorList)
    }
  }
}
