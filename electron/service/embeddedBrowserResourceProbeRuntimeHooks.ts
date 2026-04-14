/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under AGPL-3.0
 */
// These body fragments are compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserResourceProbeRuntimeHooksBody() {
  const nativeWorker = globalScope.Worker
  if (typeof nativeWorker === 'function') {
    globalScope.Worker = new Proxy(nativeWorker, {
      construct(target, argumentsList, newTarget) {
        const [scriptURL, options] = argumentsList as [string | URL, WorkerOptions | undefined]

        const createInjectedWorkerUrl = () => {
          const originalUrl = typeof scriptURL === 'string' ? scriptURL : String(scriptURL)
          const absoluteUrl = toAbsoluteUrl(originalUrl) || originalUrl
          if (!absoluteUrl) {
            return ''
          }

          const bootstrapSource = createProbeBootstrapSource(consolePrefix)
          let workerSource = ''

          if (options?.type === 'module') {
            workerSource = `${bootstrapSource}import ${JSON.stringify(absoluteUrl)};\n`
          } else {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', absoluteUrl, false)
            xhr.send()
            if (xhr.status < 200 || xhr.status >= 300 || !xhr.responseText) {
              return ''
            }
            workerSource = `${bootstrapSource}${xhr.responseText}`
          }

          return URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
        }

        let injectedUrl = ''
        try {
          injectedUrl = createInjectedWorkerUrl()
        } catch {
          injectedUrl = ''
        }

        const worker = injectedUrl
          ? Reflect.construct(target, [injectedUrl, options], newTarget) as Worker
          : Reflect.construct(target, argumentsList, newTarget) as Worker

        worker.addEventListener('message', (event) => {
          if (consumeWorkerRelayMessage(event.data)) {
            event.stopImmediatePropagation()
          }
        }, { capture: true })

        if (injectedUrl) {
          setTimeout(() => {
            URL.revokeObjectURL(injectedUrl)
          }, 60_000)
        }

        return worker
      },
    }) as typeof Worker
    globalScope.Worker.toString = function () {
      return nativeWorker.toString()
    }
  }

  const mediaSourceConstructor = globalScope.MediaSource
  if (mediaSourceConstructor?.prototype?.addSourceBuffer) {
    const originalAddSourceBuffer = mediaSourceConstructor.prototype.addSourceBuffer
    mediaSourceConstructor.prototype.addSourceBuffer = new Proxy(originalAddSourceBuffer, {
      apply(target, thisArg, argumentsList) {
        const sourceBuffer = Reflect.apply(target, thisArg, argumentsList) as SourceBuffer & {
          appendBuffer?: SourceBuffer['appendBuffer']
        }
        try {
          ensureTrackedMediaObserver()
          isCaptureComplete = false
          const mediaSource = thisArg as MediaSource
          const mimeType = String(argumentsList?.[0] || '').trim()
          const normalizedMimeType = mimeType.split(';')[0]?.trim().toLowerCase() || ''
          const streamType = normalizedMimeType.startsWith('audio/')
            ? 'audio'
            : normalizedMimeType.startsWith('video/')
              ? 'video'
              : undefined
          const streamId = `${Date.now()}-${++mseSequence}`
          const existingStreamIds = mediaSourceStreams.get(mediaSource) || []
          existingStreamIds.push(streamId)
          mediaSourceStreams.set(mediaSource, existingStreamIds)
          mseStreams.set(streamId, {
            blobUrl: '',
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: mimeType || (streamType === 'audio' ? 'audio/mp4' : 'video/mp4'),
            streamId,
            streamType,
            totalBytes: 0,
          })

          emitMseStream(streamId)

          if (sourceBuffer && typeof sourceBuffer.appendBuffer === 'function') {
            const originalAppendBuffer = sourceBuffer.appendBuffer
            sourceBuffer.appendBuffer = new Proxy(originalAppendBuffer, {
              apply(appendTarget, appendThisArg, appendArgumentsList) {
                const appendResult = Reflect.apply(appendTarget, appendThisArg, appendArgumentsList)
                const stream = mseStreams.get(streamId)
                if (!stream) {
                  return appendResult
                }
                const chunk = cloneChunk(appendArgumentsList?.[0])
                if (!chunk || chunk.byteLength === 0) {
                  return appendResult
                }
                stream.buffers.push(chunk)
                stream.bufferCount += 1
                stream.totalBytes += chunk.byteLength
                const shouldReport = (
                  stream.bufferCount <= 3
                  || stream.bufferCount - stream.lastReportedBufferCount >= 8
                  || stream.totalBytes - stream.lastReportedBytes >= 1024 * 512
                )
                if (shouldReport) {
                  stream.lastReportedBufferCount = stream.bufferCount
                  stream.lastReportedBytes = stream.totalBytes
                  emitMseStream(streamId)
                }
                return appendResult
              },
            })
          }
        } catch {
          // ignore MSE hook failures and keep playback usable
        }
        return sourceBuffer
      },
    })
  }

  if (mediaSourceConstructor?.prototype?.endOfStream) {
    const originalEndOfStream = mediaSourceConstructor.prototype.endOfStream
    mediaSourceConstructor.prototype.endOfStream = new Proxy(originalEndOfStream, {
      apply(target, thisArg, argumentsList) {
        const result = Reflect.apply(target, thisArg, argumentsList)
        try {
          isCaptureComplete = true
          const streamIds = mediaSourceStreams.get(thisArg as MediaSource) || []
          streamIds.forEach((streamId) => {
            finalizeMseStream(streamId)
          })
          if (catchToolkitState.autoDownloadOnComplete) {
            setTimeout(() => {
              downloadCatchMediaInternal()
            }, 500)
            return result
          }
          if (catchToolkitState.clearCacheOnComplete) {
            setTimeout(() => {
              clearCatchMediaCacheInternal()
            }, 0)
          }
        } catch {
          // ignore MSE hook failures and keep playback usable
        }
        return result
      },
    })
  }

  function reportCandidate(
    input: unknown,
    meta?: { baseUrl?: string; mimeType?: string; resourceType?: string; streamType?: 'audio' | 'video' },
  ) {
    if (typeof input !== 'string') {
      return
    }
    const value = input.trim()
    if (!value) {
      return
    }
    if (emitKeyCandidateFromBase64(value)) {
      return
    }
    const sanitizedHexValue = value.split('\u0010').join('').trim()
    if (emitKeyCandidateFromHex(sanitizedHexValue)) {
      return
    }
    if (dataUrlPattern.test(value)) {
      const decodedDataUrlText = decodeDataUrlText(value)
      decodedDataUrlText && reportCandidate(decodedDataUrlText, meta)
      return
    }
    const parsedJson = parseMaybeJson(value)
    if (parsedJson) {
      walkValue(parsedJson)
      return
    }
    const uppercaseValue = value.toUpperCase()
    if (uppercaseValue.startsWith('#EXTM3U') || uppercaseValue.includes('#EXTINF:')) {
      emitInlineManifest(value, 'm3u8', meta?.baseUrl)
      return
    }
    if (value.toLowerCase().includes('urn:mpeg:dash:schema:mpd') || (value.includes('<MPD') && value.includes('</MPD>'))) {
      emitInlineManifest(value, 'mpd', meta?.baseUrl)
      return
    }
    const absoluteUrl = toAbsoluteUrl(value)
    if (!absoluteUrl) {
      return
    }
    emit({
      kind: classifyKind(absoluteUrl, meta?.mimeType),
      mimeType: meta?.mimeType,
      resourceType: meta?.resourceType,
      source: 'probe',
      streamType: meta?.streamType,
      url: absoluteUrl,
    })
  }

  function walkValue(value: unknown, depth = 0, visited = new WeakSet<object>(), path: string[] = []) {
    if (depth > 6 || value == null) {
      return
    }
    if (value instanceof ArrayBuffer) {
      emitKeyCandidateFromBuffer(value)
      return
    }
    if (ArrayBuffer.isView(value)) {
      emitKeyCandidateFromBuffer(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
      return
    }
    if (typeof value === 'string') {
      reportCandidate(value, {
        baseUrl: currentLocationHref,
        resourceType: 'json',
        streamType: inferStreamTypeFromPath(path),
      })
      return
    }
    if (typeof value !== 'object') {
      return
    }
    const objectValue = value as object
    if (visited.has(objectValue)) {
      return
    }
    visited.add(objectValue)

    if (Array.isArray(value)) {
      if (
        value.length === 16
        && value.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 255)
      ) {
        emitKeyCandidateFromBuffer(Uint8Array.from(value).buffer)
        return
      }
      value.slice(0, 80).forEach((item, index) => {
        walkValue(item, depth + 1, visited, path.concat(String(index)))
      })
      return
    }

    Object.keys(value as Record<string, unknown>).slice(0, 80).forEach((key) => {
      walkValue((value as Record<string, unknown>)[key], depth + 1, visited, path.concat(key))
    })
  }

  const originalFetch = typeof globalScope.fetch === 'function' ? globalScope.fetch.bind(globalScope) : null
  if (originalFetch) {
    globalScope.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input)
      reportCandidate(requestUrl, { resourceType: 'fetch' })
      const response = await originalFetch(input, init)
      reportCandidate(response.url || requestUrl, {
        mimeType: response.headers.get('content-type') || undefined,
        resourceType: 'fetch',
      })
      const clonedResponse = response.clone()
      void clonedResponse.arrayBuffer()
        .then((buffer) => {
          if (!buffer.byteLength) {
            return
          }
          if (emitKeyCandidateFromBuffer(buffer)) {
            return
          }
          const decodedText = new TextDecoder().decode(buffer)
          if (!decodedText.trim()) {
            return
          }
          reportCandidate(decodedText, {
            baseUrl: response.url || requestUrl,
            mimeType: response.headers.get('content-type') || undefined,
            resourceType: 'fetch-body',
          })
        })
        .catch(() => undefined)
      return response
    }
    globalScope.fetch.toString = function () {
      return originalFetch.toString()
    }
  }

  const xhrUrlKey = '__OMNIFLOW_RESOURCE_PROBE_XHR_URL__'
  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (_method: string, url: string | URL) {
    ;(this as XMLHttpRequest & Record<string, unknown>)[xhrUrlKey] = typeof url === 'string' ? url : String(url)
    return originalOpen.apply(this, arguments as any)
  }

  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('loadend', function () {
      if (this.status < 200 || this.status >= 400) {
        return
      }
      const rawUrl = (this as XMLHttpRequest & Record<string, unknown>)[xhrUrlKey]
      const responseUrl = this.responseURL || (typeof rawUrl === 'string' ? rawUrl : '')
      reportCandidate(responseUrl, {
        mimeType: this.getResponseHeader('content-type') || undefined,
        resourceType: 'xhr',
      })
      if (this.response instanceof ArrayBuffer) {
        if (emitKeyCandidateFromBuffer(this.response)) {
          return
        }
        const decodedText = new TextDecoder().decode(this.response)
        decodedText && reportCandidate(decodedText, {
          baseUrl: responseUrl,
          mimeType: this.getResponseHeader('content-type') || undefined,
          resourceType: 'xhr-body',
        })
        return
      }
      if (typeof this.response === 'string') {
        reportCandidate(this.response, {
          baseUrl: responseUrl,
          mimeType: this.getResponseHeader('content-type') || undefined,
          resourceType: 'xhr-body',
        })
        return
      }
      if (this.response && typeof this.response === 'object') {
        walkValue(this.response)
        return
      }
      if (typeof this.responseText === 'string' && this.responseText.trim()) {
        reportCandidate(this.responseText, {
          baseUrl: responseUrl,
          mimeType: this.getResponseHeader('content-type') || undefined,
          resourceType: 'xhr-body',
        })
      }
    }, { once: true })
    return originalSend.apply(this, arguments as any)
  }
  XMLHttpRequest.prototype.open.toString = function () {
    return originalOpen.toString()
  }
  XMLHttpRequest.prototype.send.toString = function () {
    return originalSend.toString()
  }

  JSON.parse = function () {
    const value = originalJSONParse.apply(this, arguments as any)
    walkValue(value)
    return value
  }
  JSON.parse.toString = function () {
    return originalJSONParse.toString()
  }

  const originalBtoa = btoa
  ;((globalScope as unknown) as { btoa: typeof btoa }).btoa = function (this: unknown, data: string) {
    const base64 = originalBtoa.apply(this, arguments as any)
    emitKeyCandidateFromBase64(base64)
    reportCandidate(data, { baseUrl: currentLocationHref, resourceType: 'btoa' })
    return base64
  }
  btoa.toString = function () {
    return originalBtoa.toString()
  }

  const originalAtob = atob
  ;((globalScope as unknown) as { atob: typeof atob }).atob = function (this: unknown, base64: string) {
    const decoded = originalAtob.apply(this, arguments as any)
    emitKeyCandidateFromBase64(base64)
    reportCandidate(decoded, { baseUrl: currentLocationHref, resourceType: 'atob' })
    return decoded
  }
  atob.toString = function () {
    return originalAtob.toString()
  }

  const originalFromCharCode = String.fromCharCode
  String.fromCharCode = new Proxy(originalFromCharCode, {
    apply(target, thisArg, argumentsList) {
      const value = Reflect.apply(target, thisArg, argumentsList) as string
      if (value.length >= 7) {
        if (value.startsWith('#EXTM3U') || value.includes('#EXTINF:')) {
          m3u8Accumulator += value
          if (m3u8Accumulator.includes('#EXT-X-ENDLIST')) {
            const completedManifest = m3u8Accumulator.split('#EXT-X-ENDLIST')[0] + '#EXT-X-ENDLIST'
            emitInlineManifest(completedManifest, 'm3u8', currentLocationHref)
            m3u8Accumulator = ''
          }
        }
        const normalizedValue = value.split('\u0010').join('').trim()
        emitKeyCandidateFromHex(normalizedValue)
      }
      return value
    },
  })
  String.fromCharCode.toString = function () {
    return originalFromCharCode.toString()
  }

  const originalArraySlice = Array.prototype.slice
  Array.prototype.slice = function (this: unknown[]) {
    const sliced = originalArraySlice.apply(this, arguments as any)
    if (
      Array.isArray(sliced)
      && sliced.length === 16
      && sliced.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 255)
    ) {
      emitKeyCandidateFromBuffer(Uint8Array.from(sliced).buffer)
    }
    return sliced
  }
  Array.prototype.slice.toString = function () {
    return originalArraySlice.toString()
  }

  const originalArrayJoin = Array.prototype.join
  Array.prototype.join = function () {
    const joined = originalArrayJoin.apply(this, arguments as any)
    if (typeof joined === 'string') {
      if (joined.startsWith('#EXTM3U') || joined.includes('#EXTINF:')) {
        reportCandidate(joined, { baseUrl: currentLocationHref, resourceType: 'array-join' })
      }
      emitKeyCandidateFromBase64(joined)
    }
    return joined
  }
  Array.prototype.join.toString = function () {
    return originalArrayJoin.toString()
  }

  const originalDataView = globalScope.DataView as typeof DataView | undefined
  if (typeof originalDataView === 'function') {
    const wrappedDataView = function (buffer: ArrayBufferLike, byteOffset?: number, byteLength?: number) {
      const instance = new originalDataView(buffer, byteOffset, byteLength)
      const emitViewBuffer = () => {
        const slicedBuffer = instance.buffer.slice(instance.byteOffset, instance.byteOffset + instance.byteLength)
        emitKeyCandidateFromBuffer(slicedBuffer)
      }

      ;(['setInt8', 'setUint8', 'setInt16', 'setUint16', 'setInt32', 'setUint32'] as const).forEach((methodName) => {
        const originalMethod = instance[methodName]
        if (typeof originalMethod !== 'function') {
          return
        }
        instance[methodName] = function (this: DataView) {
          const result = originalMethod.apply(this, arguments as any)
          emitViewBuffer()
          return result
        } as typeof originalMethod
      })

      emitViewBuffer()
      return instance
    } as unknown as typeof DataView

    ;(wrappedDataView as unknown as { prototype: DataView }).prototype = originalDataView.prototype
    wrappedDataView.toString = function () {
      return originalDataView.toString()
    }
    globalScope.DataView = wrappedDataView
  }

  function createSubarrayWrapper(
    originalSubarray: (begin?: number, end?: number) => ArrayBufferView,
  ) {
    return function (this: ArrayBufferView) {
      const subarray = originalSubarray.apply(this, arguments as any)
      if (subarray?.byteLength === 16) {
        emitKeyCandidateFromBuffer(subarray.buffer.slice(subarray.byteOffset, subarray.byteOffset + subarray.byteLength))
      }
      return subarray
    }
  }

  const originalInt8ArraySubarray = Int8Array.prototype.subarray
  Int8Array.prototype.subarray = createSubarrayWrapper(originalInt8ArraySubarray) as typeof Int8Array.prototype.subarray
  Int8Array.prototype.subarray.toString = function () {
    return originalInt8ArraySubarray.toString()
  }

  const originalUint8ArraySubarray = Uint8Array.prototype.subarray
  Uint8Array.prototype.subarray = createSubarrayWrapper(originalUint8ArraySubarray) as typeof Uint8Array.prototype.subarray
  Uint8Array.prototype.subarray.toString = function () {
    return originalUint8ArraySubarray.toString()
  }

  const originalStringIndexOf = String.prototype.indexOf
  String.prototype.indexOf = function (searchValue: string, fromIndex?: number) {
    const matchIndex = originalStringIndexOf.apply(this, arguments as any)
    if (searchValue === '#EXTM3U' && matchIndex !== -1) {
      const sourceText = String(this)
      reportCandidate(sourceText.slice(Math.max(fromIndex ?? 0, 0)), {
        baseUrl: currentLocationHref,
        resourceType: 'string-indexof',
      })
    }
    return matchIndex
  }
  String.prototype.indexOf.toString = function () {
    return originalStringIndexOf.toString()
  }

}
