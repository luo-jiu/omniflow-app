/**
 * Ported from xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * catch-script/catch.js#proxyMediaSourceMethods/clearCache.
 *
 * The port owns MediaSource observation and Cat Catch's per-track reset
 * semantics. Page transport, filenames, DOM actions, and Electron spool files
 * remain adapter concerns.
 */

export type MseStreamType = 'audio' | 'video'

type MseSourceBuffer = {
  appendBuffer: (value: AllowSharedBufferSource) => unknown
}

type MseMediaSource = object

type MseMediaSourceConstructor = {
  prototype: {
    addSourceBuffer?: (mimeType: string) => MseSourceBuffer
    endOfStream?: (...argumentsList: unknown[]) => unknown
  }
}

export type MseRuntimeScope = {
  ArrayBuffer: typeof ArrayBuffer
  MediaSource?: MseMediaSourceConstructor
  Uint8Array: typeof Uint8Array
}

export type MseStreamSnapshot = {
  bufferCount: number
  flushedBytes: number
  mimeType: string
  retainedBytes: number
  streamId: string
  streamType?: MseStreamType
  totalBytes: number
}

export type MseRuntimeSnapshot = {
  appendBufferCount: number
  isComplete: boolean
  retainedBytes: number
  sourceBufferCount: number
  streamCount: number
  streams: MseStreamSnapshot[]
  totalBytes: number
}

export type MseFlushEvent = MseStreamSnapshot & {
  chunks: ArrayBuffer[]
}

export type MseResetEvent = Pick<
  MseStreamSnapshot,
  'mimeType' | 'streamId' | 'streamType'
>

export type MseCompleteEvent = {
  streamIds: string[]
}

export type InstallMseRuntimeInput = {
  createStreamId?: () => string
  flushThresholdBytes?: number
  isCaptureEnabled?: () => boolean
  maxInitialRetentionBytes?: number
  maxStreamCount?: number
  onComplete?: (event: MseCompleteEvent) => void
  onError?: (error: unknown) => void
  onFlush?: (event: MseFlushEvent) => boolean | void
  onReset?: (event: MseResetEvent) => void
  onStreamChanged?: (stream: MseStreamSnapshot) => void
  scope: MseRuntimeScope
}

export type MseRuntime = {
  clear: () => boolean
  dispose: () => void
  drainStream: (streamId: string) => MseFlushEvent | null
  flush: () => number
  getSnapshot: () => MseRuntimeSnapshot
  isDisposed: () => boolean
  nativeAddSourceBuffer?: MseMediaSourceConstructor['prototype']['addSourceBuffer']
  nativeEndOfStream?: MseMediaSourceConstructor['prototype']['endOfStream']
  readStream: (streamId: string) => ArrayBuffer[] | null
}

type MseStreamState = MseStreamSnapshot & {
  buffers: ArrayBuffer[]
  initialBuffer: ArrayBuffer | null
}

export function installMseRuntime(input: InstallMseRuntimeInput): MseRuntime {
  const runtimeSentinel = '__OMNIFLOW_CAT_CATCH_MSE_RUNTIME_V1__'
  const defaultFlushThresholdBytes = 8 * 1024 * 1024
  const defaultMaxInitialRetentionBytes = 8 * 1024 * 1024
  const defaultMaxStreamCount = 64
  const normalizePositiveInteger = (value: unknown, fallback: number) => {
    const number = Number(value)
    return Number.isFinite(number) && number > 0
      ? Math.max(1, Math.floor(number))
      : fallback
  }
  const flushThresholdBytes = normalizePositiveInteger(
    input.flushThresholdBytes,
    defaultFlushThresholdBytes,
  )
  const maxInitialRetentionBytes = normalizePositiveInteger(
    input.maxInitialRetentionBytes,
    defaultMaxInitialRetentionBytes,
  )
  const maxStreamCount = normalizePositiveInteger(
    input.maxStreamCount,
    defaultMaxStreamCount,
  )
  const scopeRecord = input.scope as unknown as Record<string, unknown>
  const current = scopeRecord[runtimeSentinel] as MseRuntime | undefined
  if (current && !current.isDisposed()) return current

  const mediaSourceConstructor = input.scope.MediaSource
  const nativeAddSourceBuffer = mediaSourceConstructor?.prototype?.addSourceBuffer
  const nativeEndOfStream = mediaSourceConstructor?.prototype?.endOfStream
  const streams = new Map<string, MseStreamState>()
  const mediaSourceStreams = new WeakMap<MseMediaSource, string[]>()
  let appendBufferCount = 0
  let disposed = false
  let initialRetainedBytes = 0
  let isComplete = false
  let retainedBytes = 0
  let sequence = 0
  let sourceBufferCount = 0

  const reportError = (error: unknown) => {
    try {
      input.onError?.(error)
    } catch {
      // Observation errors must never alter page playback.
    }
  }
  const cloneChunk = (value: unknown) => {
    if (value instanceof input.scope.ArrayBuffer) {
      return value.slice(0)
    }
    if (input.scope.ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    }
    return null
  }
  const streamSnapshot = (stream: MseStreamState): MseStreamSnapshot => ({
    bufferCount: stream.bufferCount,
    flushedBytes: stream.flushedBytes,
    mimeType: stream.mimeType,
    retainedBytes: stream.retainedBytes,
    streamId: stream.streamId,
    streamType: stream.streamType,
    totalBytes: stream.totalBytes,
  })
  const emitStreamChanged = (stream: MseStreamState) => {
    try {
      input.onStreamChanged?.(streamSnapshot(stream))
    } catch (error) {
      reportError(error)
    }
  }
  const getSnapshot = (): MseRuntimeSnapshot => ({
    appendBufferCount,
    isComplete,
    retainedBytes,
    sourceBufferCount,
    streamCount: streams.size,
    streams: Array.from(streams.values(), streamSnapshot),
    totalBytes: Array.from(streams.values()).reduce(
      (total, stream) => total + stream.totalBytes,
      0,
    ),
  })
  const flushStream = (stream: MseStreamState) => {
    if (stream.buffers.length === 0 || stream.retainedBytes === 0) return 0
    if (typeof input.onFlush !== 'function') return 0
    const event = {
      ...streamSnapshot(stream),
      chunks: stream.buffers.map(chunk => chunk.slice(0)),
    }
    let accepted = false
    try {
      accepted = input.onFlush(event) !== false
    } catch (error) {
      reportError(error)
    }
    if (!accepted) return 0
    const flushedBytes = stream.retainedBytes
    stream.buffers = []
    stream.retainedBytes = 0
    stream.flushedBytes += flushedBytes
    retainedBytes = Math.max(0, retainedBytes - flushedBytes)
    emitStreamChanged(stream)
    return flushedBytes
  }
  const flush = () => {
    let flushedBytes = 0
    for (const stream of streams.values()) {
      flushedBytes += flushStream(stream)
    }
    return flushedBytes
  }
  const readStream = (streamId: string) => {
    const stream = streams.get(String(streamId || ''))
    return stream ? stream.buffers.map(chunk => chunk.slice(0)) : null
  }
  const drainStream = (streamId: string) => {
    const stream = streams.get(String(streamId || ''))
    if (!stream) return null
    const event = {
      ...streamSnapshot(stream),
      chunks: stream.buffers.map(chunk => chunk.slice(0)),
    }
    retainedBytes = Math.max(0, retainedBytes - stream.retainedBytes)
    stream.buffers = []
    stream.retainedBytes = 0
    emitStreamChanged(stream)
    return event
  }
  const clear = () => {
    if (streams.size === 0) return false
    for (const stream of streams.values()) {
      try {
        input.onReset?.({
          mimeType: stream.mimeType,
          streamId: stream.streamId,
          streamType: stream.streamType,
        })
      } catch (error) {
        reportError(error)
      }
    }
    if (isComplete) {
      streams.clear()
      initialRetainedBytes = 0
      retainedBytes = 0
      isComplete = false
      return true
    }
    retainedBytes = 0
    for (const stream of streams.values()) {
      stream.buffers = stream.initialBuffer ? [stream.initialBuffer.slice(0)] : []
      stream.bufferCount = stream.buffers.length
      stream.flushedBytes = 0
      stream.retainedBytes = stream.initialBuffer?.byteLength || 0
      stream.totalBytes = stream.retainedBytes
      retainedBytes += stream.retainedBytes
      emitStreamChanged(stream)
    }
    isComplete = false
    return true
  }

  let installedAddSourceBuffer: typeof nativeAddSourceBuffer
  let installedEndOfStream: typeof nativeEndOfStream

  if (nativeAddSourceBuffer && mediaSourceConstructor) {
    installedAddSourceBuffer = new Proxy(nativeAddSourceBuffer, {
      apply(target, thisArg, argumentsList) {
        const sourceBuffer = Reflect.apply(target, thisArg, argumentsList) as MseSourceBuffer
        try {
          if (!sourceBuffer || typeof sourceBuffer.appendBuffer !== 'function') return sourceBuffer
          if (streams.size >= maxStreamCount) return sourceBuffer
          const mimeType = String(argumentsList[0] || '').trim()
          const normalizedMimeType = mimeType.split(';')[0]?.trim().toLowerCase() || ''
          const streamType = normalizedMimeType.startsWith('audio/')
            ? 'audio'
            : normalizedMimeType.startsWith('video/')
              ? 'video'
              : undefined
          const streamId = String(input.createStreamId?.() || `${Date.now()}-${++sequence}`)
          if (!streamId || streams.has(streamId)) return sourceBuffer
          const stream: MseStreamState = {
            bufferCount: 0,
            buffers: [],
            flushedBytes: 0,
            initialBuffer: null,
            mimeType: mimeType || (streamType === 'audio' ? 'audio/mp4' : 'video/mp4'),
            retainedBytes: 0,
            streamId,
            streamType,
            totalBytes: 0,
          }
          streams.set(streamId, stream)
          sourceBufferCount += 1
          isComplete = false
          const mediaSource = thisArg as MseMediaSource
          const sourceStreamIds = mediaSourceStreams.get(mediaSource) || []
          sourceStreamIds.push(streamId)
          mediaSourceStreams.set(mediaSource, sourceStreamIds)
          emitStreamChanged(stream)

          const nativeAppendBuffer = sourceBuffer.appendBuffer
          sourceBuffer.appendBuffer = new Proxy(nativeAppendBuffer, {
            apply(appendTarget, appendThisArg, appendArgumentsList) {
              const result = Reflect.apply(appendTarget, appendThisArg, appendArgumentsList)
              try {
                if (input.isCaptureEnabled && !input.isCaptureEnabled()) return result
                const chunk = cloneChunk(appendArgumentsList[0])
                if (!chunk || chunk.byteLength === 0) return result
                if (
                  stream.initialBuffer === null
                  && initialRetainedBytes + chunk.byteLength <= maxInitialRetentionBytes
                ) {
                  stream.initialBuffer = chunk.slice(0)
                  initialRetainedBytes += chunk.byteLength
                }
                stream.buffers.push(chunk)
                stream.bufferCount += 1
                stream.retainedBytes += chunk.byteLength
                stream.totalBytes += chunk.byteLength
                appendBufferCount += 1
                retainedBytes += chunk.byteLength
                emitStreamChanged(stream)
                if (retainedBytes >= flushThresholdBytes) flush()
              } catch (error) {
                reportError(error)
              }
              return result
            },
          })
        } catch (error) {
          reportError(error)
        }
        return sourceBuffer
      },
    })
    mediaSourceConstructor.prototype.addSourceBuffer = installedAddSourceBuffer
  }

  if (nativeEndOfStream && mediaSourceConstructor) {
    installedEndOfStream = new Proxy(nativeEndOfStream, {
      apply(target, thisArg, argumentsList) {
        const result = Reflect.apply(target, thisArg, argumentsList)
        try {
          isComplete = true
          const streamIds = (mediaSourceStreams.get(thisArg as MseMediaSource) || [])
            .filter(streamId => streams.has(streamId))
          for (const streamId of streamIds) {
            const stream = streams.get(streamId)
            if (stream) emitStreamChanged(stream)
          }
          input.onComplete?.({ streamIds })
        } catch (error) {
          reportError(error)
        }
        return result
      },
    })
    mediaSourceConstructor.prototype.endOfStream = installedEndOfStream
  }

  const runtime: MseRuntime = {
    clear,
    dispose() {
      if (disposed) return
      disposed = true
      if (
        mediaSourceConstructor
        && installedAddSourceBuffer
        && mediaSourceConstructor.prototype.addSourceBuffer === installedAddSourceBuffer
      ) {
        mediaSourceConstructor.prototype.addSourceBuffer = nativeAddSourceBuffer
      }
      if (
        mediaSourceConstructor
        && installedEndOfStream
        && mediaSourceConstructor.prototype.endOfStream === installedEndOfStream
      ) {
        mediaSourceConstructor.prototype.endOfStream = nativeEndOfStream
      }
      streams.clear()
      initialRetainedBytes = 0
      retainedBytes = 0
      if (scopeRecord[runtimeSentinel] === runtime) delete scopeRecord[runtimeSentinel]
    },
    drainStream,
    flush,
    getSnapshot,
    isDisposed: () => disposed,
    nativeAddSourceBuffer,
    nativeEndOfStream,
    readStream,
  }
  Object.defineProperty(scopeRecord, runtimeSentinel, {
    configurable: true,
    value: runtime,
  })
  return runtime
}

export function createMseRuntimeInstallerSource() {
  return `(${installMseRuntime.toString()})`
}
