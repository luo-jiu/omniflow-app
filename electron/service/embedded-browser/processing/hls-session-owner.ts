import { rm } from 'node:fs/promises'

import type {
  EmbeddedBrowserHlsTaskEventInput,
  EmbeddedBrowserHlsTaskEventPayload,
} from '../../embeddedBrowserMainTypes'

export type EmbeddedBrowserHlsRetrySessionBase = {
  requestId: string
  tabId: string
  workDirectoryPath: string
}

export type EmbeddedBrowserHlsLiveSessionBase = {
  recorder: {
    discard: () => Promise<void>
    getCurrentWorkDirectoryPath: () => string
  }
  requestId: string
  tabId: string
  workDirectoryPath?: string
}

type EmbeddedBrowserHlsSessionFilter = {
  all?: boolean
  requestId?: string
  tabId?: string
}

type EmbeddedBrowserHlsActiveTaskInput = {
  requestId?: string
  tabId: string
}

type EmbeddedBrowserHlsSessionOwnerOptions = {
  maxTaskSnapshots?: number
  removeWorkDirectory?: (workDirectoryPath: string) => Promise<void>
}

function matchesSession(
  session: { requestId?: string; tabId: string },
  filter: EmbeddedBrowserHlsSessionFilter,
) {
  if (filter.all) {
    return true
  }
  if (filter.requestId && session.requestId !== filter.requestId) {
    return false
  }
  if (filter.tabId && session.tabId !== filter.tabId) {
    return false
  }
  return Boolean(filter.requestId || filter.tabId)
}

function createSessionKey(tabId: string, requestId: string) {
  return `${tabId}\u0000${requestId}`
}

function createTaskSnapshotKey(event: EmbeddedBrowserHlsTaskEventInput) {
  const taskId = event.requestId
    || `anonymous\u0000${event.mode}\u0000${event.manifestUrl}`
  return createSessionKey(event.tabId, taskId)
}

function cloneTaskSnapshot(snapshot: EmbeddedBrowserHlsTaskEventPayload) {
  return {
    ...snapshot,
    failedFragments: snapshot.failedFragments ? [...snapshot.failedFragments] : undefined,
  }
}

function projectTaskEvent(
  previous: EmbeddedBrowserHlsTaskEventPayload | undefined,
  event: EmbeddedBrowserHlsTaskEventInput,
  revision: number,
): EmbeddedBrowserHlsTaskEventPayload {
  const running = event.status === 'running'
  const runningFfmpeg = running && event.stage === 'ffmpeg'
  const failedFragments = event.status === 'error'
    ? (event.failedFragments ?? previous?.failedFragments)
    : event.failedFragments
  return {
    ...event,
    bytesReceived: event.bytesReceived ?? (running ? previous?.bytesReceived : undefined),
    bytesTotal: event.bytesTotal ?? (running ? previous?.bytesTotal : undefined),
    completedFragments: event.completedFragments ?? previous?.completedFragments,
    durationSeconds: event.durationSeconds ?? previous?.durationSeconds,
    error: event.status === 'error' ? event.error : undefined,
    etaSeconds: event.etaSeconds ?? (running ? previous?.etaSeconds : undefined),
    failedFragments: failedFragments ? [...failedFragments] : undefined,
    ffmpegSpeedText: event.ffmpegSpeedText ?? (runningFfmpeg ? previous?.ffmpegSpeedText : undefined),
    message: event.message,
    outputPath: event.outputPath || previous?.outputPath,
    processedSeconds: event.processedSeconds ?? (runningFfmpeg ? previous?.processedSeconds : undefined),
    requestId: event.requestId || previous?.requestId,
    revision,
    speedBps: event.speedBps ?? (running ? previous?.speedBps : undefined),
    totalFragments: event.totalFragments ?? previous?.totalFragments,
    usingManualKey: event.usingManualKey ?? previous?.usingManualKey,
  }
}

function createHlsTaskAbortError() {
  const error = new Error('HLS task aborted')
  error.name = 'AbortError'
  return error
}

type EmbeddedBrowserHlsActiveTask = EmbeddedBrowserHlsActiveTaskInput & {
  abortController: AbortController
  settled: Promise<void>
}

export class EmbeddedBrowserHlsSessionOwner<
  RetrySession extends EmbeddedBrowserHlsRetrySessionBase,
  LiveSession extends EmbeddedBrowserHlsLiveSessionBase,
> {
  private readonly activeTasks = new Map<number, EmbeddedBrowserHlsActiveTask>()

  private disposed = false

  private readonly liveSessions = new Map<string, LiveSession>()

  private readonly maxTaskSnapshots: number

  private nextActiveTaskId = 0

  private nextTaskRevision = 1

  private readonly pendingSessionCleanups = new Set<Promise<void>>()

  private readonly removeWorkDirectory: (workDirectoryPath: string) => Promise<void>

  private readonly retrySessions = new Map<string, RetrySession>()

  private readonly taskSnapshots = new Map<string, EmbeddedBrowserHlsTaskEventPayload>()

  constructor(options: EmbeddedBrowserHlsSessionOwnerOptions = {}) {
    this.maxTaskSnapshots = Math.max(1, Math.floor(options.maxTaskSnapshots || 32))
    this.removeWorkDirectory = options.removeWorkDirectory || (async (workDirectoryPath) => {
      await rm(workDirectoryPath, { force: true, recursive: true })
    })
  }

  upsertRetry(session: RetrySession) {
    if (this.disposed) {
      void this.trackSessionCleanup(this.cleanupRetrySession(session))
      return false
    }
    this.retrySessions.set(createSessionKey(session.tabId, session.requestId), session)
    return true
  }

  getRetry(requestId: string, tabId: string) {
    return this.retrySessions.get(createSessionKey(tabId, requestId))
  }

  takeRetry(requestId: string, tabId: string) {
    const sessionKey = createSessionKey(tabId, requestId)
    const session = this.retrySessions.get(sessionKey)
    this.retrySessions.delete(sessionKey)
    return session
  }

  upsertLive(session: LiveSession) {
    if (this.disposed) {
      void this.trackSessionCleanup(this.cleanupLiveSession(session))
      return false
    }
    this.liveSessions.set(createSessionKey(session.tabId, session.requestId), session)
    return true
  }

  getLive(requestId: string, tabId: string) {
    return this.liveSessions.get(createSessionKey(tabId, requestId))
  }

  findLiveByTab(tabId: string) {
    return Array.from(this.liveSessions.values()).find((session) => session.tabId === tabId)
  }

  takeLive(requestId: string, tabId: string) {
    const sessionKey = createSessionKey(tabId, requestId)
    const session = this.liveSessions.get(sessionKey)
    this.liveSessions.delete(sessionKey)
    return session
  }

  recordTaskEvent(event: EmbeddedBrowserHlsTaskEventInput) {
    if (this.disposed) {
      return null
    }
    const taskKey = createTaskSnapshotKey(event)
    const snapshot = projectTaskEvent(
      this.taskSnapshots.get(taskKey),
      event,
      this.nextTaskRevision,
    )
    this.nextTaskRevision += 1
    this.taskSnapshots.delete(taskKey)
    this.taskSnapshots.set(taskKey, snapshot)
    while (this.taskSnapshots.size > this.maxTaskSnapshots) {
      const oldestKey = this.taskSnapshots.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      this.taskSnapshots.delete(oldestKey)
    }
    return cloneTaskSnapshot(snapshot)
  }

  listTaskSnapshots(filter: EmbeddedBrowserHlsSessionFilter) {
    return Array.from(this.taskSnapshots.values())
      .filter((snapshot) => matchesSession(snapshot, filter))
      .map(cloneTaskSnapshot)
  }

  clearTaskSnapshots(filter: EmbeddedBrowserHlsSessionFilter) {
    for (const [taskKey, snapshot] of this.taskSnapshots) {
      if (matchesSession(snapshot, filter)) {
        this.taskSnapshots.delete(taskKey)
      }
    }
  }

  async runActiveTask<Result>(
    input: EmbeddedBrowserHlsActiveTaskInput,
    run: (signal: AbortSignal) => Promise<Result>,
  ) {
    const task = this.beginActiveTask(input)
    try {
      return await run(task.signal)
    } finally {
      task.complete()
    }
  }

  beginActiveTask(input: EmbeddedBrowserHlsActiveTaskInput) {
    if (this.disposed) {
      throw createHlsTaskAbortError()
    }
    const abortController = new AbortController()
    const activeTaskId = this.nextActiveTaskId
    this.nextActiveTaskId += 1
    let markSettled: () => void = () => {}
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve
    })
    this.activeTasks.set(activeTaskId, {
      abortController,
      requestId: input.requestId,
      settled,
      tabId: input.tabId,
    })
    let completed = false
    return {
      complete: () => {
        if (completed) {
          return
        }
        completed = true
        this.activeTasks.delete(activeTaskId)
        markSettled()
      },
      signal: abortController.signal,
    }
  }

  async clearActive(filter: EmbeddedBrowserHlsSessionFilter) {
    const tasks = Array.from(this.activeTasks.values()).filter((task) => matchesSession(task, filter))
    tasks.forEach((task) => {
      task.abortController.abort()
    })
    await Promise.all(tasks.map((task) => task.settled))
  }

  async clearRetry(filter: EmbeddedBrowserHlsSessionFilter) {
    const sessions = Array.from(this.retrySessions.values()).filter((session) => matchesSession(session, filter))
    sessions.forEach((session) => {
      this.retrySessions.delete(createSessionKey(session.tabId, session.requestId))
    })
    await this.trackSessionCleanup(
      Promise.all(sessions.map((session) => this.cleanupRetrySession(session))).then(() => undefined),
    )
  }

  async clearLive(filter: EmbeddedBrowserHlsSessionFilter) {
    const sessions = Array.from(this.liveSessions.values()).filter((session) => matchesSession(session, filter))
    sessions.forEach((session) => {
      this.liveSessions.delete(createSessionKey(session.tabId, session.requestId))
    })
    await this.trackSessionCleanup(
      Promise.all(sessions.map((session) => this.cleanupLiveSession(session))).then(() => undefined),
    )
  }

  async clear(filter: EmbeddedBrowserHlsSessionFilter) {
    await this.clearActive(filter)
    await Promise.all([
      this.clearRetry(filter),
      this.clearLive(filter),
    ])
    this.clearTaskSnapshots(filter)
  }

  async dispose() {
    this.disposed = true
    await this.clear({ all: true })
    while (this.pendingSessionCleanups.size) {
      await Promise.all(this.pendingSessionCleanups)
    }
  }

  private trackSessionCleanup(cleanup: Promise<void>) {
    this.pendingSessionCleanups.add(cleanup)
    void cleanup.finally(() => {
      this.pendingSessionCleanups.delete(cleanup)
    })
    return cleanup
  }

  private async cleanupRetrySession(session: RetrySession) {
    await this.removeWorkDirectory(session.workDirectoryPath).catch(() => undefined)
  }

  private async cleanupLiveSession(session: LiveSession) {
    await session.recorder.discard().catch(() => undefined)
    const workDirectoryPath = session.workDirectoryPath
      || session.recorder.getCurrentWorkDirectoryPath()
    if (workDirectoryPath) {
      await this.removeWorkDirectory(workDirectoryPath).catch(() => undefined)
    }
  }
}

export function createEmbeddedBrowserHlsHostLifecycle<
  RetrySession extends EmbeddedBrowserHlsRetrySessionBase,
  LiveSession extends EmbeddedBrowserHlsLiveSessionBase,
>(owner: EmbeddedBrowserHlsSessionOwner<RetrySession, LiveSession>) {
  const clearTab = (tabId: string) => owner.clear({ tabId })

  return {
    dispose: () => owner.dispose(),
    onDocumentNavigated: clearTab,
    onTabClosed: clearTab,
    onViewDestroyed: clearTab,
    onViewRenderProcessGone: clearTab,
  }
}
