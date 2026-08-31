import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rm, stat, truncate, writeFile } from 'node:fs/promises'
import http, { type Server, type ServerResponse } from 'node:http'
import path from 'node:path'

import { app, BrowserWindow, ipcMain, WebContentsView, type WebContents } from 'electron'

import { registerFileIpc } from '../../electron/ipc/file'
import {
  cleanupEmbeddedBrowserDownloadFile,
  EMBEDDED_BROWSER_PARTITION,
  getEmbeddedBrowserDownloadStagingRoot,
  initializeEmbeddedBrowserDownloadBridge,
  type EmbeddedBrowserDownloadPayload,
} from '../../electron/service/embeddedBrowserService'
import { DownloadHandoffStore } from '../../electron/service/embedded-browser/processing/download-handoff-store'
import { EmbeddedBrowserDashLiveSessionOwner } from '../../electron/service/embedded-browser/processing/dash-live-session-owner'
import { DashTaskExecutor } from '../../electron/service/embedded-browser/processing/dash-task'
import { defaultProcessingTaskRegistry } from '../../electron/service/embedded-browser/processing/task-registry'
import { defaultFfmpegTaskExecutor } from '../../electron/service/embedded-browser/processing/ffmpeg-executor'
import { EmbeddedBrowserHlsSessionOwner } from '../../electron/service/embedded-browser/processing/hls-session-owner'
import { HlsTaskExecutor } from '../../electron/service/embedded-browser/processing/hls-task'
import { stageMseDownloadResource } from '../../electron/service/embedded-browser/processing/mse-download-output'
import { StreamingTransfer } from '../../electron/service/embedded-browser/processing/streaming-transfer'
import { StagedOutputLeaseStore } from '../../electron/service/embedded-browser/processing/staged-output-lease'
import { publishStagedOutput } from '../../electron/service/embedded-browser/processing/staged-output-publisher'
import { EmbeddedBrowserCaptureRuntime } from '../../electron/service/embedded-browser/orchestration/embedded-browser-capture-runtime'
import type { CapturedResourceProjection } from '../../electron/service/embedded-browser/contracts/captured-resource'
import type { EmbeddedBrowserHlsDownloadPlan } from '../../electron/service/embedded-browser/contracts/hls'
import type { DashRepresentation } from '../../electron/service/embedded-browser/cat-catch-port/dash/parser'
import { installEmbeddedBrowserResourceProbe } from '../../electron/service/embeddedBrowserViewLifecycle'
import { saveEmbeddedBrowserExtractedResourceFile } from '../../electron/service/embeddedBrowserResourceFileSaveService'
import { mergeEmbeddedBrowserResourceTracks } from '../../electron/service/embeddedBrowserResourceMergeService'
import { resolveDesktopFfmpegPath } from '../../electron/platform/mediaExecutable'

const RESULT_PREFIX = 'OMNIFLOW_CAT_CATCH_HOST_SMOKE_RESULT='
const SMALL_FIXTURE = Buffer.from('OmniFlow Cat Catch Electron host smoke\n', 'utf8')
const CAPTURE_FIXTURE = Buffer.from('OmniFlow authenticated captured media fixture\n', 'utf8')
const CAPTURE_TAB_ID = 'cat-catch-host-smoke-capture-tab'
const DASH_PROTOCOL_TAB_ID = 'cat-catch-host-smoke-dash-protocol-tab'
const DOWNLOAD_TAB_ID = 'cat-catch-host-smoke-tab'
const FFMPEG_TAB_ID = 'cat-catch-host-smoke-ffmpeg-tab'
const HLS_PROTOCOL_TAB_ID = 'cat-catch-host-smoke-hls-protocol-tab'
const MSE_MERGE_TAB_ID = 'cat-catch-host-smoke-mse-merge-tab'
const MSE_OUTPUT_TAB_ID = 'cat-catch-host-smoke-mse-output-tab'
const STREAMING_TAB_ID = 'cat-catch-host-smoke-streaming-tab'
const MSE_FILE_FIXTURE_BYTES = 256 * 1024 * 1024
const SLOW_FIXTURE_BYTES = 64 * 1024 * 1024
const LARGE_FIXTURE_CHUNK = Buffer.allocUnsafe(64 * 1024)
for (let index = 0; index < LARGE_FIXTURE_CHUNK.byteLength; index += 1) {
  LARGE_FIXTURE_CHUNK[index] = index % 251
}
const verifySystemSaveDialog = process.env.OMNIFLOW_CAT_CATCH_SMOKE_SAVE_DIALOG === '1'
const verifyLargeMedia = process.env.OMNIFLOW_CAT_CATCH_SMOKE_LARGE_MEDIA === '1'
const STEP_TIMEOUT_MS = verifySystemSaveDialog ? 120_000 : verifyLargeMedia ? 60_000 : 15_000

function parseFixtureBytes() {
  if (!verifyLargeMedia) return SMALL_FIXTURE.byteLength
  const value = Number(process.env.OMNIFLOW_CAT_CATCH_SMOKE_FIXTURE_BYTES)
  if (!Number.isSafeInteger(value) || value <= 0 || value > 512 * 1024 * 1024) {
    throw new Error('OMNIFLOW_CAT_CATCH_SMOKE_FIXTURE_BYTES must be between 1 byte and 512 MiB')
  }
  return value
}

const fixtureBytes = parseFixtureBytes()

function getFixtureChunk(offset: number) {
  if (!verifyLargeMedia) return SMALL_FIXTURE.subarray(offset)
  return LARGE_FIXTURE_CHUNK.subarray(0, Math.min(LARGE_FIXTURE_CHUNK.byteLength, fixtureBytes - offset))
}

function calculateFixtureSha256() {
  const hash = createHash('sha256')
  for (let offset = 0; offset < fixtureBytes;) {
    const chunk = getFixtureChunk(offset)
    hash.update(chunk)
    offset += chunk.byteLength
  }
  return hash.digest('hex')
}

const fixtureSha256 = calculateFixtureSha256()

function requiredPath(name: string) {
  const value = String(process.env[name] || '').trim()
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`)
  }
  return path.resolve(value)
}

async function canonicalizePendingFilePath(filePath: string) {
  return path.join(await realpath(path.dirname(filePath)), path.basename(filePath))
}

const userDataPath = requiredPath('OMNIFLOW_CAT_CATCH_SMOKE_USER_DATA')
const outputRootPath = requiredPath('OMNIFLOW_CAT_CATCH_SMOKE_OUTPUT_ROOT')
const preloadPath = requiredPath('OMNIFLOW_CAT_CATCH_SMOKE_PRELOAD')

app.setName('OmniFlow Cat Catch Smoke')
app.setPath('userData', userDataPath)
app.on('window-all-closed', event => event.preventDefault())

function reportPhase(phase: string) {
  process.stderr.write(`[cat-catch-host-smoke] ${phase}\n`)
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), STEP_TIMEOUT_MS)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

type CaptureRequest = {
  authorization: string
  cookie: string
}

type ProtocolFixtureBytes = Record<'dash' | 'hls', number>

type MseMergeFixtureBytes = Record<'audio' | 'video', number>

async function startFixtureServer(): Promise<{
  cancelUrl: string
  captureRequests: CaptureRequest[]
  captureUrl: string
  dashCancelUrl: string
  deepJsonUrl: string
  deepMediaUrl: string
  hlsCancelUrl: string
  inlineManifestUrl: string
  mseMergeAudioUrl: string
  mseMergeFixtureBytes: MseMergeFixtureBytes
  mseMergeVideoUrl: string
  pageUrl: string
  protocolFixtureBytes: ProtocolFixtureBytes
  server: Server
  setMseMergeFixtures: (fixtures: Record<'audio' | 'video', Buffer>) => void
}> {
  const token = randomUUID()
  const captureRequests: CaptureRequest[] = []
  const mseMergeFixtureBytes: MseMergeFixtureBytes = { audio: 0, video: 0 }
  let mseMergeFixtures: Partial<Record<'audio' | 'video', Buffer>> = {}
  const protocolFixtureBytes: ProtocolFixtureBytes = { dash: 0, hls: 0 }
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
    if (requestUrl.pathname === `/page/${token}`) {
      const fixtureOrigin = `http://${request.headers.host}`
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      })
      response.end(`<!doctype html><html><body><a id="download" download href="/file/${token}">download</a><a id="cancel-download" download href="/slow-file/${token}">cancel download</a><script>globalThis.__CAT_CATCH_INLINE_MANIFEST__=${JSON.stringify(`${fixtureOrigin}/inline/${token}.m3u8`)}</script></body></html>`)
      return
    }
    if (requestUrl.pathname === `/file/${token}`) {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="cat-catch-host-smoke.${verifyLargeMedia ? 'bin' : 'txt'}"`,
        'Content-Length': fixtureBytes,
        'Content-Type': verifyLargeMedia ? 'application/octet-stream' : 'text/plain; charset=utf-8',
      })
      streamFixtureResponse(response)
      return
    }
    const protocolKind = requestUrl.pathname === `/slow-hls/${token}`
      ? 'hls'
      : requestUrl.pathname === `/slow-dash/${token}`
        ? 'dash'
        : null
    if (requestUrl.pathname === `/slow-file/${token}` || protocolKind) {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment; filename="cat-catch-host-smoke-cancel.bin"',
        'Content-Length': SLOW_FIXTURE_BYTES,
        'Content-Type': 'application/octet-stream',
      })
      streamSlowFixtureResponse(response, chunkBytes => {
        if (protocolKind) protocolFixtureBytes[protocolKind] += chunkBytes
      })
      return
    }
    if (requestUrl.pathname === `/capture/${token}.mp4`) {
      captureRequests.push({
        authorization: String(request.headers.authorization || ''),
        cookie: String(request.headers.cookie || ''),
      })
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': CAPTURE_FIXTURE.byteLength,
        'Content-Type': 'video/mp4',
      })
      response.end(CAPTURE_FIXTURE)
      return
    }
    if (requestUrl.pathname === `/deep/${token}.json`) {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      })
      response.end(JSON.stringify({
        video: `http://${request.headers.host}/deep-media/${token}.mp4`,
      }))
      return
    }
    const mseMergeKind = requestUrl.pathname === `/mse-merge-audio/${token}.mp4`
      ? 'audio'
      : requestUrl.pathname === `/mse-merge-video/${token}.mp4`
        ? 'video'
        : null
    if (mseMergeKind) {
      const fixture = mseMergeFixtures[mseMergeKind]
      if (!fixture) {
        response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('MSE merge fixture is not ready')
        return
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': fixture.byteLength,
        'Content-Type': `${mseMergeKind}/mp4`,
      })
      streamSlowBufferResponse(response, fixture, chunkBytes => {
        mseMergeFixtureBytes[mseMergeKind] += chunkBytes
      })
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })
  await withTimeout(new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  }), 'fixture server startup')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('fixture server did not expose a TCP port')
  }
  return {
    cancelUrl: `http://127.0.0.1:${address.port}/slow-file/${token}`,
    captureRequests,
    captureUrl: `http://127.0.0.1:${address.port}/capture/${token}.mp4`,
    dashCancelUrl: `http://127.0.0.1:${address.port}/slow-dash/${token}`,
    deepJsonUrl: `http://127.0.0.1:${address.port}/deep/${token}.json`,
    deepMediaUrl: `http://127.0.0.1:${address.port}/deep-media/${token}.mp4`,
    hlsCancelUrl: `http://127.0.0.1:${address.port}/slow-hls/${token}`,
    inlineManifestUrl: `http://127.0.0.1:${address.port}/inline/${token}.m3u8`,
    mseMergeAudioUrl: `http://127.0.0.1:${address.port}/mse-merge-audio/${token}.mp4`,
    mseMergeFixtureBytes,
    mseMergeVideoUrl: `http://127.0.0.1:${address.port}/mse-merge-video/${token}.mp4`,
    pageUrl: `http://127.0.0.1:${address.port}/page/${token}`,
    protocolFixtureBytes,
    server,
    setMseMergeFixtures: fixtures => {
      mseMergeFixtures = fixtures
      mseMergeFixtureBytes.audio = 0
      mseMergeFixtureBytes.video = 0
    },
  }
}

function streamSlowFixtureResponse(response: ServerResponse, onChunk?: (chunkBytes: number) => void) {
  let offset = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const writeNext = () => {
    if (response.destroyed || offset >= SLOW_FIXTURE_BYTES) {
      clearTimer()
      if (!response.destroyed) response.end()
      return
    }
    const chunk = LARGE_FIXTURE_CHUNK.subarray(
      0,
      Math.min(LARGE_FIXTURE_CHUNK.byteLength, SLOW_FIXTURE_BYTES - offset),
    )
    offset += chunk.byteLength
    response.write(chunk)
    onChunk?.(chunk.byteLength)
    timer = setTimeout(writeNext, 25)
  }
  response.once('close', clearTimer)
  writeNext()
}

function streamSlowBufferResponse(
  response: ServerResponse,
  buffer: Buffer,
  onChunk: (chunkBytes: number) => void,
) {
  let offset = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const writeNext = () => {
    if (response.destroyed || offset >= buffer.byteLength) {
      clearTimer()
      if (!response.destroyed) response.end()
      return
    }
    const chunk = buffer.subarray(offset, Math.min(buffer.byteLength, offset + 512))
    offset += chunk.byteLength
    response.write(chunk)
    onChunk(chunk.byteLength)
    timer = setTimeout(writeNext, 10)
  }
  response.once('close', clearTimer)
  writeNext()
}

function streamFixtureResponse(response: ServerResponse) {
  let offset = 0
  const writeAvailable = () => {
    while (offset < fixtureBytes && !response.destroyed) {
      const chunk = getFixtureChunk(offset)
      offset += chunk.byteLength
      if (!response.write(chunk)) {
        response.once('drain', writeAvailable)
        return
      }
    }
    if (!response.destroyed) response.end()
  }
  writeAvailable()
}

async function verifyFixtureFile(filePath: string, label: string) {
  const fileStat = await stat(filePath)
  if (fileStat.size !== fixtureBytes) {
    throw new Error(`${label} size differs from the loopback fixture: ${fileStat.size}`)
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  if (hash.digest('hex') !== fixtureSha256) {
    throw new Error(`${label} SHA-256 differs from the loopback fixture`)
  }
}

async function createSmokeWindow(pageUrl: string) {
  const window = new BrowserWindow({
    height: 480,
    show: verifySystemSaveDialog,
    title: 'OmniFlow Cat Catch Save Dialog Smoke',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false,
    },
    width: 720,
  })
  await withTimeout(window.loadURL(pageUrl), 'smoke page load')
  return window
}

async function waitForRegistryRelease() {
  const startedAt = Date.now()
  while (defaultProcessingTaskRegistry.size > 0) {
    if (Date.now() - startedAt > STEP_TIMEOUT_MS) {
      throw new Error('processing task did not leave ProcessingTaskRegistry')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitForPartialOutputFile(rootPath: string) {
  const startedAt = Date.now()
  for (;;) {
    const entries = await readdir(rootPath, { recursive: true }).catch(() => [])
    for (const entry of entries) {
      const fileStat = await stat(path.join(rootPath, String(entry))).catch(() => null)
      if (fileStat?.isFile() && fileStat.size > 0) return fileStat.size
    }
    if (Date.now() - startedAt > STEP_TIMEOUT_MS) {
      throw new Error('processing task did not write a partial staged file')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitForPartialFile(filePath: string, fullSize: number) {
  const startedAt = Date.now()
  for (;;) {
    const fileStat = await stat(filePath).catch(() => null)
    if (fileStat?.isFile() && fileStat.size > 0 && fileStat.size < fullSize) {
      return fileStat.size
    }
    if (Date.now() - startedAt > STEP_TIMEOUT_MS) {
      throw new Error('processing task did not expose an in-flight partial file')
    }
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

async function waitForProtocolFixtureBytes(
  getBytes: () => number,
  label: string,
) {
  const startedAt = Date.now()
  for (;;) {
    const bytes = getBytes()
    if (bytes > 0 && bytes < SLOW_FIXTURE_BYTES) return bytes
    if (Date.now() - startedAt > STEP_TIMEOUT_MS) {
      throw new Error(`${label} did not enter an in-flight protocol transfer`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitForMseMergeFixtureBytes(getBytes: () => MseMergeFixtureBytes) {
  const startedAt = Date.now()
  for (;;) {
    const bytes = getBytes()
    if (bytes.audio > 0 && bytes.video > 0) return { ...bytes }
    if (Date.now() - startedAt > STEP_TIMEOUT_MS) {
      throw new Error('MSE merge did not enter both in-flight HTTP inputs')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitForCapturedResource(runtime: EmbeddedBrowserCaptureRuntime, url: string) {
  const startedAt = Date.now()
  for (;;) {
    const snapshot = runtime.getSnapshot(CAPTURE_TAB_ID)
    if (snapshot?.status === 'active') {
      const resource = snapshot.resources.find(item => item.url === url)
      if (resource) return resource
    }
    if (Date.now() - startedAt > STEP_TIMEOUT_MS) {
      throw new Error('real Electron page request was not captured')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitForProbeResource(
  runtime: EmbeddedBrowserCaptureRuntime,
  predicate: (resource: CapturedResourceProjection) => boolean,
  label: string,
) {
  const startedAt = Date.now()
  for (;;) {
    const snapshot = runtime.getSnapshot(CAPTURE_TAB_ID)
    if (snapshot?.status === 'active') {
      const resource = snapshot.resources.find(item => item.source === 'probe' && predicate(item))
      if (resource) return resource
    }
    if (Date.now() - startedAt > STEP_TIMEOUT_MS) {
      throw new Error(`${label} was not captured by the real Electron page probe`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function runHostSmoke() {
  reportPhase('waiting for Electron app readiness')
  await app.whenReady()
  registerFileIpc(ipcMain)

  reportPhase('starting loopback fixture and initial renderer')
  const {
    cancelUrl,
    captureRequests,
    captureUrl,
    dashCancelUrl,
    deepJsonUrl,
    deepMediaUrl,
    hlsCancelUrl,
    inlineManifestUrl,
    mseMergeAudioUrl,
    mseMergeFixtureBytes,
    mseMergeVideoUrl,
    pageUrl,
    protocolFixtureBytes,
    server,
    setMseMergeFixtures,
  } = await startFixtureServer()
  const ownedWebContentsIds = new Set<number>()
  const windows = new Set<BrowserWindow>()
  let activeWindow = await createSmokeWindow(pageUrl)
  windows.add(activeWindow)
  const embeddedView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: EMBEDDED_BROWSER_PARTITION,
      sandbox: true,
    },
  })
  activeWindow.contentView.addChildView(embeddedView)
  embeddedView.setBounds({ height: 320, width: 640, x: 0, y: 0 })
  await withTimeout(embeddedView.webContents.loadURL(pageUrl), 'embedded smoke page load')
  ownedWebContentsIds.add(embeddedView.webContents.id)
  const browserSession = embeddedView.webContents.session
  const probeControlEvents: string[] = []
  const probeErrors: string[] = []
  const captureRuntime = new EmbeddedBrowserCaptureRuntime({
    emitChange: () => undefined,
    fetch: (url, init) => browserSession.fetch(url, init),
    onProbeControlPayload: (_tabId, payload) => {
      probeControlEvents.push(String(payload.event || ''))
    },
    onProbeError: (_tabId, error) => {
      probeErrors.push(error instanceof Error ? error.message : String(error))
    },
    pageUrlPolicy: { damn: true },
    webRequest: browserSession.webRequest,
  })
  if (!captureRuntime.registerView({
    pageUrl,
    tabId: CAPTURE_TAB_ID,
    webContents: embeddedView.webContents,
  })) {
    throw new Error('real Electron capture view registration failed')
  }
  captureRuntime.setCaptureMode(CAPTURE_TAB_ID, 'deep')
  const currentProbeDocument = captureRuntime.bindProbeDocument(CAPTURE_TAB_ID)
  const nextProbeDocument = captureRuntime.prepareNextProbeDocument(CAPTURE_TAB_ID)
  if (
    !currentProbeDocument
    || !nextProbeDocument
    || !await installEmbeddedBrowserResourceProbe(CAPTURE_TAB_ID, embeddedView, {
      current: currentProbeDocument,
      next: nextProbeDocument,
    })
  ) {
    throw new Error('real Electron production page probe installation failed')
  }

  const stagingRootPath = getEmbeddedBrowserDownloadStagingRoot()
  const journalPath = path.join(userDataPath, 'embedded-browser-download-handoff.json')
  const handoffStore = new DownloadHandoffStore({
    cleanup: cleanupEmbeddedBrowserDownloadFile,
    journalPath,
    stagingRootPath,
  })
  const streamingLeaseRootPath = path.join(outputRootPath, 'streaming-cancel-leases')
  const streamingLeaseStore = new StagedOutputLeaseStore({ rootPath: streamingLeaseRootPath })
  const streamingTransfer = new StreamingTransfer()
  const ffmpegLeaseRootPath = path.join(outputRootPath, 'ffmpeg-cancel-leases')
  const ffmpegLeaseStore = new StagedOutputLeaseStore({ rootPath: ffmpegLeaseRootPath })
  const hlsProtocolLeaseRootPath = path.join(outputRootPath, 'hls-protocol-cancel-leases')
  const hlsProtocolLeaseStore = new StagedOutputLeaseStore({ rootPath: hlsProtocolLeaseRootPath })
  const hlsSessionOwner = new EmbeddedBrowserHlsSessionOwner<never, never>()
  const hlsTaskExecutor = new HlsTaskExecutor()
  const dashProtocolLeaseRootPath = path.join(outputRootPath, 'dash-protocol-cancel-leases')
  const dashProtocolLeaseStore = new StagedOutputLeaseStore({ rootPath: dashProtocolLeaseRootPath })
  const dashSessionOwner = new EmbeddedBrowserDashLiveSessionOwner<never>()
  const mseMergeLeaseRootPath = path.join(outputRootPath, 'mse-merge-cancel-leases')
  const mseMergeLeaseStore = new StagedOutputLeaseStore({ rootPath: mseMergeLeaseRootPath })
  const states: EmbeddedBrowserDownloadPayload['state'][] = []
  let settleCancelStarted: ((payload: EmbeddedBrowserDownloadPayload) => void) | undefined
  let rejectCancelStarted: ((error: Error) => void) | undefined
  const cancelStarted = new Promise<EmbeddedBrowserDownloadPayload>((resolve, reject) => {
    settleCancelStarted = resolve
    rejectCancelStarted = reject
  })
  let settleCancelled: ((payload: EmbeddedBrowserDownloadPayload) => void) | undefined
  let rejectCancelled: ((error: Error) => void) | undefined
  const cancelled = new Promise<EmbeddedBrowserDownloadPayload>((resolve, reject) => {
    settleCancelled = resolve
    rejectCancelled = reject
  })
  let settleCompleted: ((payload: EmbeddedBrowserDownloadPayload) => void) | undefined
  let rejectCompleted: ((error: Error) => void) | undefined
  const completed = new Promise<EmbeddedBrowserDownloadPayload>((resolve, reject) => {
    settleCompleted = resolve
    rejectCompleted = reject
  })

  initializeEmbeddedBrowserDownloadBridge({
    emitDownload: payload => {
      states.push(payload.state)
      const isCancellationFixture = payload.url === cancelUrl
      if (isCancellationFixture && payload.state === 'started') {
        settleCancelStarted?.(payload)
      }
      if (isCancellationFixture && payload.state === 'cancelled') {
        settleCancelled?.(payload)
        return
      }
      if (isCancellationFixture && payload.state === 'completed') {
        rejectCancelled?.(new Error('cancel fixture completed before registry cancellation'))
        return
      }
      if (payload.state === 'failed') {
        if (isCancellationFixture) {
          rejectCancelStarted?.(new Error(payload.error || 'cancel fixture failed before start'))
          rejectCancelled?.(new Error(payload.error || 'cancel fixture failed instead of cancelling'))
          return
        }
        rejectCompleted?.(new Error(payload.error || `download ended as ${payload.state}`))
        return
      }
      if (payload.state === 'cancelled') {
        rejectCompleted?.(new Error(payload.error || 'completion fixture was cancelled'))
        return
      }
      if (payload.state !== 'completed') {
        return
      }
      if (!handoffStore.record(payload)) {
        rejectCompleted?.(new Error('completed native download was rejected by DownloadHandoffStore'))
        return
      }
      settleCompleted?.(payload)
    },
    resolveTabIdByWebContents: (webContents: WebContents) => (
      ownedWebContentsIds.has(webContents.id) ? DOWNLOAD_TAB_ID : null
    ),
  })

  try {
    reportPhase('exercising production Deep and MSE hooks in a real Electron page')
    const pageProbeResult = await withTimeout(embeddedView.webContents.executeJavaScript(`
      (async () => {
        const deepResponse = await fetch(${JSON.stringify(deepJsonUrl)}, { cache: 'no-store' });
        const deepPayload = await deepResponse.json();
        const decodedManifest = new TextDecoder().decode(new TextEncoder().encode(
          '#EXTM3U\\n#EXTINF:1,\\n' + ${JSON.stringify(deepMediaUrl)} + '\\n',
        ));
        const probe = globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__;
        if (!probe) throw new Error('production page probe global is missing');
        const candidates = [
          'video/mp4; codecs="avc1.42E01E"',
          'audio/mp4; codecs="mp4a.40.2"',
        ];
        const mimeType = typeof MediaSource === 'function'
          ? candidates.find(candidate => MediaSource.isTypeSupported(candidate)) || ''
          : '';
        if (!mimeType) {
          return {
            decodedManifestLength: decodedManifest.length,
            deepPayloadVideo: deepPayload.video,
            mseSupported: false,
          };
        }
        const mediaSource = new MediaSource();
        const mediaElement = document.createElement(mimeType.startsWith('video/') ? 'video' : 'audio');
        const objectUrl = URL.createObjectURL(mediaSource);
        mediaElement.src = objectUrl;
        document.body.appendChild(mediaElement);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('MediaSource sourceopen timed out')), 5000);
          mediaSource.addEventListener('sourceopen', () => {
            clearTimeout(timer);
            resolve(undefined);
          }, { once: true });
        });
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        let appendError = '';
        try {
          sourceBuffer.appendBuffer(new Uint8Array([1, 2, 3, 4]).buffer);
        } catch (error) {
          appendError = error instanceof Error ? error.message : String(error);
        }
        await new Promise(resolve => setTimeout(resolve, 25));
        const state = probe.getCatchToolkitState();
        const resourceKey = state.videoResourceKey || state.audioResourceKey || '';
        const resource = resourceKey ? await probe.readResource(resourceKey) : null;
        URL.revokeObjectURL(objectUrl);
        mediaElement.remove();
        return {
          appendError,
          decodedManifestLength: decodedManifest.length,
          deepPayloadVideo: deepPayload.video,
          mseCapturedBytes: resource?.base64 ? atob(resource.base64).length : 0,
          mseMimeType: mimeType,
          mseResourceKey: resourceKey,
          mseSourceBufferCount: Number(state.diagnostics?.sourceBufferCount || 0),
          mseStreamCount: Number(state.streamCount || 0),
          mseSupported: true,
        };
      })()
    `), 'real Electron Deep/MSE page hooks') as {
      appendError?: string
      decodedManifestLength: number
      deepPayloadVideo: string
      mseCapturedBytes?: number
      mseMimeType?: string
      mseResourceKey?: string
      mseSourceBufferCount?: number
      mseStreamCount?: number
      mseSupported: boolean
    }
    if (
      pageProbeResult.deepPayloadVideo !== deepMediaUrl
      || pageProbeResult.decodedManifestLength <= 0
      || !pageProbeResult.mseSupported
      || pageProbeResult.appendError
      || pageProbeResult.mseCapturedBytes !== 4
      || !pageProbeResult.mseResourceKey?.startsWith('mse-stream:')
      || pageProbeResult.mseSourceBufferCount !== 1
      || pageProbeResult.mseStreamCount !== 1
    ) {
      throw new Error(`real Electron Deep/MSE page hook result was invalid: ${JSON.stringify(pageProbeResult)}`)
    }
    const [deepFetchResource, inlineResource, textDecoderResource, mseResource] = await Promise.all([
      waitForProbeResource(
        captureRuntime,
        resource => resource.url === deepMediaUrl && resource.resourceType === 'deep-fetch',
        'Deep fetch media resource',
      ),
      waitForProbeResource(
        captureRuntime,
        resource => resource.url === inlineManifestUrl && resource.resourceType === 'deep-inline-script',
        'Deep inline-script manifest resource',
      ),
      waitForProbeResource(
        captureRuntime,
        resource => resource.kind === 'manifest' && resource.resourceType === 'deep-text-decoder',
        'Deep TextDecoder generated manifest resource',
      ),
      waitForProbeResource(
        captureRuntime,
        resource => resource.resourceType === 'mse-stream' && resource.contentLength === 4,
        'MSE append resource',
      ),
    ])
    if (
      deepFetchResource.kind !== 'media'
      || inlineResource.kind !== 'manifest'
      || textDecoderResource.kind !== 'manifest'
      || mseResource.kind !== 'media'
      || probeErrors.length
    ) {
      throw new Error(`real Electron page probe projection was invalid: ${JSON.stringify({
        deepFetchResource,
        inlineResource,
        mseResource,
        probeErrors,
        textDecoderResource,
      })}`)
    }
    reportPhase('verifying production document-start probe on real navigation')
    await withTimeout(
      embeddedView.webContents.loadURL(`${pageUrl}?document-start=1`),
      'embedded document-start probe navigation',
    )
    const documentStartProbeInstalled = await embeddedView.webContents.executeJavaScript(
      'Boolean(globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__)',
    )
    if (!documentStartProbeInstalled) {
      throw new Error('production document-start page probe was absent after navigation')
    }
    const documentStartInlineResource = await waitForProbeResource(
      captureRuntime,
      resource => resource.url === inlineManifestUrl && resource.resourceType === 'deep-inline-script',
      'document-start Deep inline-script manifest resource',
    )
    if (documentStartInlineResource.kind !== 'manifest' || probeErrors.length) {
      throw new Error(`production document-start page probe projection was invalid: ${JSON.stringify({
        documentStartInlineResource,
        probeErrors,
      })}`)
    }

    reportPhase('capturing authenticated media from real Electron page')
    const captureCookieValue = randomUUID()
    const captureAuthorization = `Bearer ${randomUUID()}`
    await browserSession.cookies.set({
      name: 'omniflow-capture-smoke',
      path: '/',
      url: new URL(pageUrl).origin,
      value: captureCookieValue,
    })
    const capturedBytes = await embeddedView.webContents.executeJavaScript(`
      fetch(${JSON.stringify(captureUrl)}, {
        cache: 'no-store',
        headers: { Authorization: ${JSON.stringify(captureAuthorization)} },
      }).then(async response => {
        if (!response.ok) throw new Error('capture fixture failed: ' + response.status)
        return (await response.arrayBuffer()).byteLength
      })
    `)
    if (Number(capturedBytes) !== CAPTURE_FIXTURE.byteLength) {
      throw new Error('real Electron page received unexpected captured media bytes')
    }
    const capturedResource = await waitForCapturedResource(captureRuntime, captureUrl)
    if (JSON.stringify(capturedResource).includes(captureAuthorization)) {
      throw new Error('captured renderer projection leaked Authorization')
    }
    if (!capturedResource.context?.hasAuthorization || !capturedResource.context.hasCookie) {
      throw new Error('captured renderer projection omitted opaque credential capabilities')
    }
    const grant = captureRuntime.access.redeem({
      purpose: 'resource-download',
      resourceId: capturedResource.id,
      tabId: CAPTURE_TAB_ID,
    })
    if (!grant || !grant.headers.some(([name, value]) => (
      name === 'authorization' && value === captureAuthorization
    ))) {
      throw new Error('main capture authority did not redeem the scoped Authorization header')
    }
    const replay = await captureRuntime.access.fetch({
      cache: 'no-store',
      purpose: 'resource-download',
      resourceId: capturedResource.id,
      tabId: CAPTURE_TAB_ID,
    })
    const replayBytes = Buffer.from(await replay.response.arrayBuffer())
    if (!replayBytes.equals(CAPTURE_FIXTURE)) {
      throw new Error('main capture authority replayed different media bytes')
    }
    if (
      captureRequests.length !== 2
      || captureRequests.some(request => request.authorization !== captureAuthorization)
      || captureRequests.some(request => !request.cookie.includes(
        `omniflow-capture-smoke=${captureCookieValue}`,
      ))
    ) {
      throw new Error('captured media credentials were not preserved across main replay')
    }

    reportPhase('cancelling real streaming output through task registry')
    const streamingOutputPath = path.join(outputRootPath, 'cancelled-streaming-output.bin')
    const streamingOperation = defaultProcessingTaskRegistry.run({
      kind: 'streaming-transfer',
      tabId: STREAMING_TAB_ID,
    }, async (signal, taskId) => {
      const response = await fetch(cancelUrl, { signal })
      return publishStagedOutput({
        fileName: path.basename(streamingOutputPath),
        ownerTaskId: taskId,
        purpose: 'host-smoke-streaming-cancel',
        store: streamingLeaseStore,
        targetPath: streamingOutputPath,
        write: async (stagedPath) => {
          await streamingTransfer.writeResponse(response, stagedPath, { signal })
        },
      })
    })
    const streamingPartialBytes = await waitForPartialOutputFile(streamingLeaseRootPath)
    const streamingCancelledTaskCount = await defaultProcessingTaskRegistry.cancel({
      kind: 'streaming-transfer',
      tabId: STREAMING_TAB_ID,
    })
    if (streamingCancelledTaskCount !== 1) {
      throw new Error(`streaming cancellation matched ${streamingCancelledTaskCount} tasks`)
    }
    const streamingCancellationError = await withTimeout(
      streamingOperation.then(() => null, error => error),
      'streaming output cancellation',
    )
    await waitForRegistryRelease()
    if (!(streamingCancellationError instanceof Error) || streamingCancellationError.name !== 'AbortError') {
      throw new Error(`streaming cancellation returned an unexpected terminal: ${String(streamingCancellationError)}`)
    }
    const streamingTargetExists = await stat(streamingOutputPath).then(() => true).catch(() => false)
    const streamingLeaseEntries = await readdir(streamingLeaseRootPath).catch(() => [])
    if (streamingTargetExists || streamingLeaseEntries.length || streamingLeaseStore.getSnapshot().length) {
      throw new Error('streaming cancellation left target, partial lease, or in-memory lease state behind')
    }

    reportPhase('cancelling real file-backed MSE output through task registry')
    const mseSourcePath = path.join(outputRootPath, 'mse-file-backed-source.bin')
    const mseOutputPath = path.join(outputRootPath, 'cancelled-mse-output.bin')
    await writeFile(mseSourcePath, '')
    await truncate(mseSourcePath, MSE_FILE_FIXTURE_BYTES)
    let mseCompletionEmitted = false
    const mseOperation = defaultProcessingTaskRegistry.run({
      kind: 'mse-download',
      tabId: MSE_OUTPUT_TAB_ID,
    }, async (signal) => stageMseDownloadResource({
      emitCompleted: async () => {
        mseCompletionEmitted = true
      },
      filePath: mseOutputPath,
      resource: {
        fileName: 'mse-file-backed-source.bin',
        filePath: mseSourcePath,
        resourceKey: 'mse-stream:host-smoke',
      },
      signal,
      writeResourceToFile: async (resource, targetPath) => {
        await saveEmbeddedBrowserExtractedResourceFile(resource, targetPath, { signal })
      },
    }))
    const msePartialBytes = await waitForPartialFile(mseOutputPath, MSE_FILE_FIXTURE_BYTES)
    const mseCancelledTaskCount = await defaultProcessingTaskRegistry.cancel({
      kind: 'mse-download',
      tabId: MSE_OUTPUT_TAB_ID,
    })
    if (mseCancelledTaskCount !== 1) {
      throw new Error(`MSE output cancellation matched ${mseCancelledTaskCount} tasks`)
    }
    const mseCancellationError = await withTimeout(
      mseOperation.then(() => null, error => error),
      'MSE file-backed output cancellation',
    )
    await waitForRegistryRelease()
    if (!(mseCancellationError instanceof Error) || mseCancellationError.name !== 'AbortError') {
      throw new Error(`MSE output cancellation returned an unexpected terminal: ${String(mseCancellationError)}`)
    }
    if (mseCompletionEmitted || await stat(mseOutputPath).then(() => true).catch(() => false)) {
      throw new Error('MSE output cancellation emitted completion or left partial staging behind')
    }
    await rm(mseSourcePath, { force: true })

    reportPhase('cancelling real HLS protocol transfer through task registry')
    const hlsProtocolOutputPath = path.join(outputRootPath, 'cancelled-hls-protocol-output.mp4')
    const hlsProtocolWorkDirectoryPath = path.join(outputRootPath, 'hls-protocol-cancel-work')
    const hlsProtocolPlan: EmbeddedBrowserHlsDownloadPlan = {
      durationSeconds: 600,
      encryptedSegmentCount: 0,
      fragmentCount: 1,
      fragments: [{
        discontinuitySequence: 0,
        duration: 600,
        index: 0,
        part: false,
        sequence: 0,
        url: hlsCancelUrl,
      }],
      headers: {},
      isLive: false,
      isMaster: false,
      keys: [],
      manifestUrl: hlsCancelUrl,
      mapTag: '',
      maps: [],
      partCount: 0,
      renditions: [],
      segmentCount: 1,
      segments: [{
        discontinuitySequence: 0,
        duration: 600,
        part: false,
        sequence: 0,
        url: hlsCancelUrl,
      }],
      suggestedThreadCount: 1,
      variants: [],
    }
    let hlsMergeCalled = false
    const hlsProtocolOperation = hlsSessionOwner.runActiveTask({
      requestId: 'host-smoke-hls-protocol-cancel',
      tabId: HLS_PROTOCOL_TAB_ID,
    }, async signal => {
      await mkdir(hlsProtocolWorkDirectoryPath, { recursive: true })
      try {
        return await publishStagedOutput({
          fileName: path.basename(hlsProtocolOutputPath),
          mimeType: 'video/mp4',
          ownerTaskId: 'host-smoke-hls-protocol-output',
          purpose: 'host-smoke-hls-protocol-cancel',
          store: hlsProtocolLeaseStore,
          targetPath: hlsProtocolOutputPath,
          write: async stagedPath => {
            await hlsTaskExecutor.executePlanToOutput({
              outputPath: stagedPath,
              plan: hlsProtocolPlan,
              runFfmpeg: async input => {
                hlsMergeCalled = true
                return { ffmpegPath: 'unexpected', outputPath: input.outputPath }
              },
              signal,
              workDirectoryPath: hlsProtocolWorkDirectoryPath,
            })
          },
        })
      } finally {
        await rm(hlsProtocolWorkDirectoryPath, { force: true, recursive: true })
      }
    })
    const hlsProtocolBytes = await waitForProtocolFixtureBytes(
      () => protocolFixtureBytes.hls,
      'HLS protocol cancellation fixture',
    )
    const hlsProtocolCancelledTaskCount = await defaultProcessingTaskRegistry.cancel({
      kind: 'hls-task',
      tabId: HLS_PROTOCOL_TAB_ID,
    })
    if (hlsProtocolCancelledTaskCount !== 1) {
      throw new Error(`HLS protocol cancellation matched ${hlsProtocolCancelledTaskCount} tasks`)
    }
    const hlsProtocolCancellationError = await withTimeout(
      hlsProtocolOperation.then(() => null, error => error),
      'HLS protocol transfer cancellation',
    )
    await waitForRegistryRelease()
    if (!(hlsProtocolCancellationError instanceof Error) || hlsProtocolCancellationError.name !== 'AbortError') {
      throw new Error(`HLS protocol cancellation returned an unexpected terminal: ${String(hlsProtocolCancellationError)}`)
    }
    const hlsProtocolTargetExists = await stat(hlsProtocolOutputPath).then(() => true).catch(() => false)
    const hlsProtocolWorkDirectoryExists = await stat(hlsProtocolWorkDirectoryPath).then(() => true).catch(() => false)
    const hlsProtocolLeaseEntries = await readdir(hlsProtocolLeaseRootPath).catch(() => [])
    if (
      hlsMergeCalled
      || hlsProtocolTargetExists
      || hlsProtocolWorkDirectoryExists
      || hlsProtocolLeaseEntries.length
      || hlsProtocolLeaseStore.getSnapshot().length
    ) {
      throw new Error('HLS protocol cancellation merged output or left target, work directory, or lease state behind')
    }

    reportPhase('cancelling real DASH protocol transfer through task registry')
    const dashProtocolOutputPath = path.join(outputRootPath, 'cancelled-dash-protocol-output.mp4')
    const dashProtocolWorkDirectoryPath = path.join(outputRootPath, 'dash-protocol-cancel-work')
    const dashVideoRepresentation: DashRepresentation = {
      baseUrls: [dashCancelUrl],
      contentType: 'video',
      id: 'host-smoke-video',
      segmentCount: 1,
      segments: [{ index: 0, url: dashCancelUrl }],
      unsupportedReasons: [],
    }
    let dashMergeCalled = false
    let dashWorkDirectoryEntriesBeforeCleanup: string[] = []
    const dashActiveTask = dashSessionOwner.beginActiveTask({
      requestId: 'host-smoke-dash-protocol-cancel',
      tabId: DASH_PROTOCOL_TAB_ID,
    })
    const dashProtocolOperation = (async () => {
      try {
        await mkdir(dashProtocolWorkDirectoryPath, { recursive: true })
        return await publishStagedOutput({
          fileName: path.basename(dashProtocolOutputPath),
          mimeType: 'video/mp4',
          ownerTaskId: 'host-smoke-dash-protocol-output',
          purpose: 'host-smoke-dash-protocol-cancel',
          store: dashProtocolLeaseStore,
          targetPath: dashProtocolOutputPath,
          write: async stagedPath => {
            await new DashTaskExecutor({
              mergeTracks: async input => {
                dashMergeCalled = true
                return { outputPath: input.outputPath }
              },
              outputPath: stagedPath,
              plan: {
                hasDrm: false,
                manifestUrl: dashCancelUrl,
                representations: [dashVideoRepresentation],
                unsupportedReasons: [],
              },
              selectedVideoRepresentation: dashVideoRepresentation,
              signal: dashActiveTask.signal,
              threadCount: 1,
              workDirectoryPath: dashProtocolWorkDirectoryPath,
            }).run()
          },
        })
      } finally {
        dashWorkDirectoryEntriesBeforeCleanup = await readdir(dashProtocolWorkDirectoryPath).catch(() => [])
        await rm(dashProtocolWorkDirectoryPath, { force: true, recursive: true })
        dashActiveTask.complete()
      }
    })()
    const dashProtocolBytes = await waitForProtocolFixtureBytes(
      () => protocolFixtureBytes.dash,
      'DASH protocol cancellation fixture',
    )
    const dashProtocolCancelledTaskCount = await defaultProcessingTaskRegistry.cancel({
      kind: 'dash-task',
      tabId: DASH_PROTOCOL_TAB_ID,
    })
    if (dashProtocolCancelledTaskCount !== 1) {
      throw new Error(`DASH protocol cancellation matched ${dashProtocolCancelledTaskCount} tasks`)
    }
    const dashProtocolCancellationError = await withTimeout(
      dashProtocolOperation.then(() => null, error => error),
      'DASH protocol transfer cancellation',
    )
    await waitForRegistryRelease()
    if (!(dashProtocolCancellationError instanceof Error) || dashProtocolCancellationError.name !== 'AbortError') {
      throw new Error(`DASH protocol cancellation returned an unexpected terminal: ${String(dashProtocolCancellationError)}`)
    }
    const dashProtocolTargetExists = await stat(dashProtocolOutputPath).then(() => true).catch(() => false)
    const dashProtocolWorkDirectoryExists = await stat(dashProtocolWorkDirectoryPath).then(() => true).catch(() => false)
    const dashProtocolLeaseEntries = await readdir(dashProtocolLeaseRootPath).catch(() => [])
    if (
      dashMergeCalled
      || dashProtocolTargetExists
      || dashProtocolWorkDirectoryExists
      || dashProtocolLeaseEntries.length
      || dashProtocolLeaseStore.getSnapshot().length
      || dashWorkDirectoryEntriesBeforeCleanup.some(entry => entry.includes('.parts-'))
    ) {
      throw new Error('DASH protocol cancellation merged output or left target, part, work directory, or lease state behind')
    }

    const ffmpegPath = await resolveDesktopFfmpegPath()
    let ffmpegCancellation: {
      partialBytes: number
      partialCleanup: boolean
      supported: boolean
      taskCount: number
    } = {
      partialBytes: 0,
      partialCleanup: false,
      supported: false,
      taskCount: 0,
    }
    let mseMergeCancellation: {
      audioBytesTransferred: number
      partialCleanup: boolean
      supported: boolean
      taskCount: number
      videoBytesTransferred: number
    } = {
      audioBytesTransferred: 0,
      partialCleanup: false,
      supported: false,
      taskCount: 0,
      videoBytesTransferred: 0,
    }
    if (ffmpegPath) {
      reportPhase('cancelling real FFmpeg output through task registry')
      const ffmpegOutputPath = path.join(outputRootPath, 'cancelled-ffmpeg-output.mp4')
      const ffmpegOperation = defaultProcessingTaskRegistry.run({
        kind: 'streaming-transfer',
        tabId: FFMPEG_TAB_ID,
      }, async (signal, taskId) => publishStagedOutput({
        fileName: path.basename(ffmpegOutputPath),
        mimeType: 'video/mp4',
        ownerTaskId: taskId,
        purpose: 'host-smoke-ffmpeg-cancel',
        store: ffmpegLeaseStore,
        targetPath: ffmpegOutputPath,
        write: async (stagedPath) => {
          await defaultFfmpegTaskExecutor.execute({
            commandArgs: [
              '-y',
              '-v',
              'error',
              '-progress',
              'pipe:1',
              '-re',
              '-f',
              'lavfi',
              '-i',
              'testsrc2=size=320x180:rate=30',
              '-t',
              '600',
              '-c:v',
              'mpeg4',
              '-q:v',
              '5',
              '-movflags',
              'frag_keyframe+empty_moov',
              stagedPath,
            ],
            ffmpegPath,
            outputPath: stagedPath,
            signal,
          })
        },
      }))
      const ffmpegPartialBytes = await waitForPartialOutputFile(ffmpegLeaseRootPath)
      const ffmpegCancelledTaskCount = await defaultProcessingTaskRegistry.cancel({
        kind: 'streaming-transfer',
        tabId: FFMPEG_TAB_ID,
      })
      if (ffmpegCancelledTaskCount !== 1) {
        throw new Error(`FFmpeg cancellation matched ${ffmpegCancelledTaskCount} outer tasks`)
      }
      const ffmpegCancellationError = await withTimeout(
        ffmpegOperation.then(() => null, error => error),
        'FFmpeg output cancellation',
      )
      await waitForRegistryRelease()
      if (!(ffmpegCancellationError instanceof Error) || ffmpegCancellationError.name !== 'AbortError') {
        throw new Error(`FFmpeg cancellation returned an unexpected terminal: ${String(ffmpegCancellationError)}`)
      }
      const ffmpegTargetExists = await stat(ffmpegOutputPath).then(() => true).catch(() => false)
      const ffmpegLeaseEntries = await readdir(ffmpegLeaseRootPath).catch(() => [])
      if (ffmpegTargetExists || ffmpegLeaseEntries.length || ffmpegLeaseStore.getSnapshot().length) {
        throw new Error('FFmpeg cancellation left target, partial lease, or in-memory lease state behind')
      }
      ffmpegCancellation = {
        partialBytes: ffmpegPartialBytes,
        partialCleanup: true,
        supported: true,
        taskCount: ffmpegCancelledTaskCount,
      }

      reportPhase('cancelling real MSE track merge through task registry')
      const mseMergeFixtureVideoPath = path.join(outputRootPath, 'mse-merge-video-fixture.mp4')
      const mseMergeFixtureAudioPath = path.join(outputRootPath, 'mse-merge-audio-fixture.mp4')
      try {
        await Promise.all([
          defaultFfmpegTaskExecutor.execute({
            commandArgs: [
              '-y',
              '-v',
              'error',
              '-f',
              'lavfi',
              '-i',
              'testsrc2=size=128x72:rate=25:duration=1',
              '-an',
              '-c:v',
              'mpeg4',
              '-q:v',
              '5',
              '-movflags',
              'empty_moov+default_base_moof',
              '-f',
              'mp4',
              mseMergeFixtureVideoPath,
            ],
            ffmpegPath,
            outputPath: mseMergeFixtureVideoPath,
          }),
          defaultFfmpegTaskExecutor.execute({
            commandArgs: [
              '-y',
              '-v',
              'error',
              '-f',
              'lavfi',
              '-i',
              'sine=frequency=440:sample_rate=44100:duration=1',
              '-vn',
              '-c:a',
              'aac',
              '-b:a',
              '64k',
              '-movflags',
              'empty_moov+default_base_moof',
              '-f',
              'mp4',
              mseMergeFixtureAudioPath,
            ],
            ffmpegPath,
            outputPath: mseMergeFixtureAudioPath,
          }),
        ])
        setMseMergeFixtures({
          audio: await readFile(mseMergeFixtureAudioPath),
          video: await readFile(mseMergeFixtureVideoPath),
        })
      } finally {
        await Promise.all([
          rm(mseMergeFixtureAudioPath, { force: true }),
          rm(mseMergeFixtureVideoPath, { force: true }),
        ])
      }

      const mseMergeOutputPath = path.join(outputRootPath, 'cancelled-mse-merge-output.mp4')
      const mseMergeOperation = defaultProcessingTaskRegistry.run({
        kind: 'streaming-transfer',
        tabId: MSE_MERGE_TAB_ID,
      }, async (signal, taskId) => publishStagedOutput({
        fileName: path.basename(mseMergeOutputPath),
        mimeType: 'video/mp4',
        ownerTaskId: taskId,
        purpose: 'host-smoke-mse-merge-cancel',
        store: mseMergeLeaseStore,
        targetPath: mseMergeOutputPath,
        write: async stagedPath => {
          await mergeEmbeddedBrowserResourceTracks({
            audio: {
              fileName: 'mse-merge-audio.mp4',
              mimeType: 'audio/mp4',
              streamType: 'audio',
              url: mseMergeAudioUrl,
            },
            ffmpegPath,
            outputPath: stagedPath,
            signal,
            video: {
              fileName: 'mse-merge-video.mp4',
              mimeType: 'video/mp4',
              streamType: 'video',
              url: mseMergeVideoUrl,
            },
          })
        },
      }))
      const mseMergeTransferredBytes = await Promise.race([
        waitForMseMergeFixtureBytes(() => mseMergeFixtureBytes),
        mseMergeOperation.then(
          () => { throw new Error('MSE merge completed before cancellation') },
          error => { throw error },
        ),
      ])
      const mseMergeCancelledTaskCount = await defaultProcessingTaskRegistry.cancel({
        kind: 'streaming-transfer',
        tabId: MSE_MERGE_TAB_ID,
      })
      if (mseMergeCancelledTaskCount !== 1) {
        throw new Error(`MSE merge cancellation matched ${mseMergeCancelledTaskCount} outer tasks`)
      }
      const mseMergeCancellationError = await withTimeout(
        mseMergeOperation.then(() => null, error => error),
        'MSE track merge cancellation',
      )
      await waitForRegistryRelease()
      if (!(mseMergeCancellationError instanceof Error) || mseMergeCancellationError.name !== 'AbortError') {
        throw new Error(`MSE merge cancellation returned an unexpected terminal: ${String(mseMergeCancellationError)}`)
      }
      const mseMergeTargetExists = await stat(mseMergeOutputPath).then(() => true).catch(() => false)
      const mseMergeLeaseEntries = await readdir(mseMergeLeaseRootPath).catch(() => [])
      if (mseMergeTargetExists || mseMergeLeaseEntries.length || mseMergeLeaseStore.getSnapshot().length) {
        throw new Error('MSE merge cancellation left target, partial lease, or in-memory lease state behind')
      }
      mseMergeCancellation = {
        audioBytesTransferred: mseMergeTransferredBytes.audio,
        partialCleanup: true,
        supported: true,
        taskCount: mseMergeCancelledTaskCount,
        videoBytesTransferred: mseMergeTransferredBytes.video,
      }
    }

    reportPhase('cancelling real native DownloadItem through task registry')
    await embeddedView.webContents.executeJavaScript(`document.querySelector('#cancel-download')?.click()`)
    const cancellationStart = await withTimeout(cancelStarted, 'native download cancellation start')
    const cancelledTaskCount = await defaultProcessingTaskRegistry.cancel({
      kind: 'native-download',
      tabId: DOWNLOAD_TAB_ID,
    })
    if (cancelledTaskCount !== 1) {
      throw new Error(`native download cancellation matched ${cancelledTaskCount} tasks`)
    }
    const cancellation = await withTimeout(cancelled, 'native download cancellation')
    await waitForRegistryRelease()
    if (!cancellationStart.tempPath || cancellation.tempPath !== cancellationStart.tempPath) {
      throw new Error('native download cancellation lost its staging path identity')
    }
    if (await stat(cancellation.tempPath).then(() => true).catch(() => false)) {
      throw new Error('native download cancellation left partial staging behind')
    }

    reportPhase('triggering native DownloadItem')
    await embeddedView.webContents.executeJavaScript(`document.querySelector('#download')?.click()`)
    const completion = await withTimeout(completed, 'native download completion')
    await handoffStore.flush()
    await waitForRegistryRelease()

    if (!completion.tempPath) {
      throw new Error('native download completed without a staging path')
    }
    await verifyFixtureFile(completion.tempPath, 'native download staging file')

    reportPhase('forcing renderer crash')
    const crashedWindow = activeWindow
    const renderGone = once(crashedWindow.webContents, 'render-process-gone')
    crashedWindow.webContents.forcefullyCrashRenderer()
    const [, crashDetails] = await withTimeout(renderGone, 'renderer crash observation')

    reportPhase('creating replacement renderer')
    activeWindow = await createSmokeWindow(pageUrl)
    windows.add(activeWindow)
    ownedWebContentsIds.delete(embeddedView.webContents.id)
    crashedWindow.contentView.removeChildView(embeddedView)
    if (!embeddedView.webContents.isDestroyed()) {
      embeddedView.webContents.close({ waitForBeforeUnload: false })
    }
    crashedWindow.destroy()
    windows.delete(crashedWindow)

    reportPhase('replaying main handoff after renderer crash')
    const restartedStore = new DownloadHandoffStore({
      cleanup: cleanupEmbeddedBrowserDownloadFile,
      journalPath,
      stagingRootPath,
    })
    const replayed = await restartedStore.list()
    if (replayed.length !== 1 || replayed[0]?.downloadId !== completion.downloadId) {
      throw new Error(`renderer restart did not replay exactly one completed output: ${replayed.length}`)
    }

    let saveDialogCancel = false
    let saveDialogConfirm = false
    if (verifySystemSaveDialog) {
      activeWindow.show()
      activeWindow.focus()
      app.focus({ steal: true })

      reportPhase('system save dialog: cancel the first dialog')
      const cancelledTargetPath = path.join(outputRootPath, 'cancelled-system-save-dialog.txt')
      const cancelledResult = await withTimeout(activeWindow.webContents.executeJavaScript(`
        window.hostSmoke.pickSavePath(${JSON.stringify(cancelledTargetPath)})
      `), 'system save dialog cancellation') as { canceled?: boolean; filePath?: string } | undefined
      if (!cancelledResult?.canceled || cancelledResult.filePath) {
        throw new Error('system save dialog cancellation returned an unexpected result')
      }
      saveDialogCancel = true

      reportPhase('system save dialog: confirm the second dialog')
      const confirmedTargetPath = path.join(outputRootPath, 'confirmed-system-save-dialog.txt')
      const confirmedResult = await withTimeout(activeWindow.webContents.executeJavaScript(`
        window.hostSmoke.pickSavePath(${JSON.stringify(confirmedTargetPath)})
      `), 'system save dialog confirmation') as { canceled?: boolean; filePath?: string } | undefined
      const confirmedDialogPath = path.resolve(String(confirmedResult?.filePath || ''))
      if (
        confirmedResult?.canceled
        || !confirmedResult?.filePath
        || await canonicalizePendingFilePath(confirmedDialogPath)
          !== await canonicalizePendingFilePath(confirmedTargetPath)
      ) {
        throw new Error('system save dialog confirmation returned an unexpected target')
      }
      const confirmedSavedPath = await activeWindow.webContents.executeJavaScript(`window.hostSmoke.saveStagedDownload(
        ${JSON.stringify(completion.tempPath)},
        ${JSON.stringify(confirmedDialogPath)}
      )`)
      if (
        await canonicalizePendingFilePath(path.resolve(String(confirmedSavedPath)))
        !== await canonicalizePendingFilePath(confirmedDialogPath)
      ) {
        throw new Error('confirmed system save dialog path was not used by the save IPC')
      }
      await verifyFixtureFile(confirmedDialogPath, 'system save dialog output')
      saveDialogConfirm = true
    }

    reportPhase('saving staged output through renderer IPC')
    const targetPath = path.join(outputRootPath, 'saved-after-renderer-restart.txt')
    const savedPath = await activeWindow.webContents.executeJavaScript(`window.hostSmoke.saveStagedDownload(
      ${JSON.stringify(completion.tempPath)},
      ${JSON.stringify(targetPath)}
    )`)
    if (path.resolve(String(savedPath)) !== path.resolve(targetPath)) {
      throw new Error('save-staged-download-file returned an unexpected target')
    }
    await verifyFixtureFile(targetPath, 'renderer restart save IPC output')

    if (!await cleanupEmbeddedBrowserDownloadFile(completion.tempPath)) {
      throw new Error('staging cleanup rejected the owned native download')
    }
    if (!await restartedStore.acknowledge(completion.downloadId)) {
      throw new Error('replayed handoff could not be acknowledged')
    }
    await restartedStore.flush()
    const stagingExists = await stat(completion.tempPath).then(() => true).catch(() => false)
    const journalExists = await stat(journalPath).then(() => true).catch(() => false)
    if (stagingExists || journalExists) {
      throw new Error('terminal delivery left staging or journal state behind')
    }

    reportPhase('all host checks passed')
    return {
      bytes: fixtureBytes,
      crashReason: String((crashDetails as { reason?: string } | undefined)?.reason || 'unknown'),
      electron: process.versions.electron,
      fixtureSha256,
      hlsProtocolCancellation: {
        bytesTransferred: hlsProtocolBytes,
        mergeSkipped: !hlsMergeCalled,
        partialCleanup: true,
        taskCount: hlsProtocolCancelledTaskCount,
      },
      ffmpegCancellation,
      handoffReplayCount: replayed.length,
      largeMedia: verifyLargeMedia,
      pageCapture: {
        authenticatedRequests: captureRequests.length,
        bytes: replayBytes.byteLength,
        credentialProjectionOpaque: true,
        cookieAuthorityReplay: true,
        mainAuthorityReplay: true,
      },
      pageProbe: {
        controlEvents: probeControlEvents.filter(Boolean),
        deepFetch: deepFetchResource.resourceType === 'deep-fetch',
        documentStart: documentStartProbeInstalled,
        inlineScript: inlineResource.resourceType === 'deep-inline-script',
        mseAppendBytes: pageProbeResult.mseCapturedBytes,
        mseMimeType: pageProbeResult.mseMimeType,
        textDecoder: textDecoderResource.resourceType === 'deep-text-decoder',
      },
      mseFileCancellation: {
        partialBytes: msePartialBytes,
        partialCleanup: true,
        taskCount: mseCancelledTaskCount,
      },
      mseMergeCancellation,
      platform: process.platform,
      dashProtocolCancellation: {
        bytesTransferred: dashProtocolBytes,
        mergeSkipped: !dashMergeCalled,
        partialCleanup: true,
        taskCount: dashProtocolCancelledTaskCount,
      },
      registryCancellation: {
        partialCleanup: true,
        state: cancellation.state,
        taskCount: cancelledTaskCount,
      },
      streamingCancellation: {
        partialBytes: streamingPartialBytes,
        partialCleanup: true,
        taskCount: streamingCancelledTaskCount,
      },
      saveDialogCancel,
      saveDialogConfirm,
      saveIpc: true,
      states,
      status: 'ok',
    }
  } finally {
    captureRuntime.dispose()
    await hlsSessionOwner.dispose().catch(() => undefined)
    await dashSessionOwner.dispose().catch(() => undefined)
    await hlsProtocolLeaseStore.dispose().catch(() => undefined)
    await dashProtocolLeaseStore.dispose().catch(() => undefined)
    await mseMergeLeaseStore.dispose().catch(() => undefined)
    await ffmpegLeaseStore.dispose().catch(() => undefined)
    await streamingLeaseStore.dispose().catch(() => undefined)
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.destroy()
      }
    }
    await defaultProcessingTaskRegistry.dispose().catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

void runHostSmoke().then(result => {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`, () => app.exit(0))
}).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`, () => app.exit(1))
  process.exitCode = 1
})
