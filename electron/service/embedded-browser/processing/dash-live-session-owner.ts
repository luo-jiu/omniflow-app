import { rm } from 'node:fs/promises'

import type {
  EmbeddedBrowserDashTaskEventInput,
  EmbeddedBrowserDashTaskEventPayload,
} from '../../embeddedBrowserMainTypes'

export type EmbeddedBrowserDashLiveSessionBase = {
  recorder: {
    discard: () => Promise<void>
    getCurrentWorkDirectoryPath: () => string
  }
  requestId: string
  tabId: string
  workDirectoryPath?: string
}

type EmbeddedBrowserDashLiveSessionFilter = {
  all?: boolean
  requestId?: string
  tabId?: string
}

type EmbeddedBrowserDashActiveTaskInput = {
  requestId?: string
  tabId: string
}

type EmbeddedBrowserDashSessionOwnerOptions = {
  maxTaskSnapshots?: number
  removeWorkDirectory?: (workDirectoryPath: string) => Promise<void>
}

function matchesSession(
  session: { requestId?: string; tabId: string },
  filter: EmbeddedBrowserDashLiveSessionFilter,
) {
  if (filter.all) return true
  if (filter.requestId && session.requestId !== filter.requestId) return false
  if (filter.tabId && session.tabId !== filter.tabId) return false
  return Boolean(filter.requestId || filter.tabId)
}

function createSessionKey(tabId: string, requestId: string) {
  return `${tabId}\u0000${requestId}`
}

function cloneTaskSnapshot(snapshot: EmbeddedBrowserDashTaskEventPayload) {
  return {
    ...snapshot,
    unsupportedReasons: snapshot.unsupportedReasons ? [...snapshot.unsupportedReasons] : undefined,
  }
}

function projectTaskEvent(
  previous: EmbeddedBrowserDashTaskEventPayload | undefined,
  event: EmbeddedBrowserDashTaskEventInput,
  revision: number,
): EmbeddedBrowserDashTaskEventPayload {
  const running = event.status === 'running'
  return {
    ...event,
    bytesReceived: event.bytesReceived ?? (running ? previous?.bytesReceived : undefined),
    completedSegments: event.completedSegments ?? previous?.completedSegments,
    durationSeconds: event.durationSeconds ?? previous?.durationSeconds,
    error: event.status === 'error' ? event.error : undefined,
    message: event.message,
    outputPath: event.outputPath || previous?.outputPath,
    requestId: event.requestId || previous?.requestId,
    revision,
    totalSegments: event.totalSegments ?? previous?.totalSegments,
    unsupportedReasons: event.unsupportedReasons
      ? [...event.unsupportedReasons]
      : previous?.unsupportedReasons,
  }
}

function createDashLiveAbortError() {
  const error = new Error('DASH live task aborted')
  error.name = 'AbortError'
  return error
}

type EmbeddedBrowserDashActiveTask = EmbeddedBrowserDashActiveTaskInput & {
  abortController: AbortController
  settled: Promise<void>
}

export class EmbeddedBrowserDashLiveSessionOwner<
  LiveSession extends EmbeddedBrowserDashLiveSessionBase,
> {
  private readonly activeTasks = new Map<number, EmbeddedBrowserDashActiveTask>()

  private disposed = false

  private readonly liveSessions = new Map<string, LiveSession>()

  private readonly maxTaskSnapshots: number

  private nextActiveTaskId = 0

  private nextTaskRevision = 1

  private readonly pendingSessionCleanups = new Set<Promise<void>>()

  private readonly removeWorkDirectory: (workDirectoryPath: string) => Promise<void>

  private readonly taskSnapshots = new Map<string, EmbeddedBrowserDashTaskEventPayload>()

  constructor(options: EmbeddedBrowserDashSessionOwnerOptions = {}) {
    this.maxTaskSnapshots = Math.max(1, Math.floor(options.maxTaskSnapshots || 32))
    this.removeWorkDirectory = options.removeWorkDirectory || (async (workDirectoryPath) => {
      await rm(workDirectoryPath, { force: true, recursive: true })
    })
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
    return Array.from(this.liveSessions.values()).find(session => session.tabId === tabId)
  }

  takeLive(requestId: string, tabId: string) {
    const key = createSessionKey(tabId, requestId)
    const session = this.liveSessions.get(key)
    this.liveSessions.delete(key)
    return session
  }

  recordTaskEvent(event: EmbeddedBrowserDashTaskEventInput) {
    if (this.disposed) return null
    const taskKey = createSessionKey(event.tabId, event.requestId || event.manifestUrl)
    const snapshot = projectTaskEvent(this.taskSnapshots.get(taskKey), event, this.nextTaskRevision)
    this.nextTaskRevision += 1
    this.taskSnapshots.delete(taskKey)
    this.taskSnapshots.set(taskKey, snapshot)
    while (this.taskSnapshots.size > this.maxTaskSnapshots) {
      const oldestKey = this.taskSnapshots.keys().next().value
      if (oldestKey === undefined) break
      this.taskSnapshots.delete(oldestKey)
    }
    return cloneTaskSnapshot(snapshot)
  }

  listTaskSnapshots(filter: EmbeddedBrowserDashLiveSessionFilter) {
    return Array.from(this.taskSnapshots.values())
      .filter(snapshot => matchesSession(snapshot, filter))
      .map(cloneTaskSnapshot)
  }

  clearTaskSnapshots(filter: EmbeddedBrowserDashLiveSessionFilter) {
    for (const [key, snapshot] of this.taskSnapshots) {
      if (matchesSession(snapshot, filter)) this.taskSnapshots.delete(key)
    }
  }

  beginActiveTask(input: EmbeddedBrowserDashActiveTaskInput) {
    if (this.disposed) throw createDashLiveAbortError()
    const abortController = new AbortController()
    const activeTaskId = this.nextActiveTaskId
    this.nextActiveTaskId += 1
    let markSettled: () => void = () => {}
    const settled = new Promise<void>(resolve => { markSettled = resolve })
    this.activeTasks.set(activeTaskId, {
      abortController,
      requestId: input.requestId,
      settled,
      tabId: input.tabId,
    })
    let completed = false
    return {
      complete: () => {
        if (completed) return
        completed = true
        this.activeTasks.delete(activeTaskId)
        markSettled()
      },
      signal: abortController.signal,
    }
  }

  async clearActive(filter: EmbeddedBrowserDashLiveSessionFilter) {
    const tasks = Array.from(this.activeTasks.values()).filter(task => matchesSession(task, filter))
    tasks.forEach(task => task.abortController.abort())
    await Promise.all(tasks.map(task => task.settled))
  }

  async clearLive(filter: EmbeddedBrowserDashLiveSessionFilter) {
    const sessions = Array.from(this.liveSessions.values()).filter(session => matchesSession(session, filter))
    sessions.forEach(session => this.liveSessions.delete(createSessionKey(session.tabId, session.requestId)))
    await this.trackSessionCleanup(
      Promise.all(sessions.map(session => this.cleanupLiveSession(session))).then(() => undefined),
    )
  }

  async clear(filter: EmbeddedBrowserDashLiveSessionFilter) {
    await this.clearActive(filter)
    await this.clearLive(filter)
    this.clearTaskSnapshots(filter)
  }

  async dispose() {
    this.disposed = true
    await this.clear({ all: true })
    while (this.pendingSessionCleanups.size) await Promise.all(this.pendingSessionCleanups)
  }

  private trackSessionCleanup(cleanup: Promise<void>) {
    this.pendingSessionCleanups.add(cleanup)
    void cleanup.finally(() => this.pendingSessionCleanups.delete(cleanup))
    return cleanup
  }

  private async cleanupLiveSession(session: LiveSession) {
    await session.recorder.discard().catch(() => undefined)
    const workDirectoryPath = session.workDirectoryPath || session.recorder.getCurrentWorkDirectoryPath()
    if (workDirectoryPath) await this.removeWorkDirectory(workDirectoryPath).catch(() => undefined)
  }
}

export function createEmbeddedBrowserDashHostLifecycle<LiveSession extends EmbeddedBrowserDashLiveSessionBase>(
  owner: EmbeddedBrowserDashLiveSessionOwner<LiveSession>,
) {
  const clearTab = (tabId: string) => owner.clear({ tabId })
  return {
    dispose: () => owner.dispose(),
    onDocumentNavigated: clearTab,
    onTabClosed: clearTab,
    onViewDestroyed: clearTab,
    onViewRenderProcessGone: clearTab,
  }
}
