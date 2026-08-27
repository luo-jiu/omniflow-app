import { rm } from 'node:fs/promises'

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

type EmbeddedBrowserHlsSessionOwnerOptions = {
  removeWorkDirectory?: (workDirectoryPath: string) => Promise<void>
}

function matchesSession(
  session: { requestId: string; tabId: string },
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

export class EmbeddedBrowserHlsSessionOwner<
  RetrySession extends EmbeddedBrowserHlsRetrySessionBase,
  LiveSession extends EmbeddedBrowserHlsLiveSessionBase,
> {
  private readonly liveSessions = new Map<string, LiveSession>()

  private readonly removeWorkDirectory: (workDirectoryPath: string) => Promise<void>

  private readonly retrySessions = new Map<string, RetrySession>()

  constructor(options: EmbeddedBrowserHlsSessionOwnerOptions = {}) {
    this.removeWorkDirectory = options.removeWorkDirectory || (async (workDirectoryPath) => {
      await rm(workDirectoryPath, { force: true, recursive: true })
    })
  }

  upsertRetry(session: RetrySession) {
    this.retrySessions.set(createSessionKey(session.tabId, session.requestId), session)
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
    this.liveSessions.set(createSessionKey(session.tabId, session.requestId), session)
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

  async clearRetry(filter: EmbeddedBrowserHlsSessionFilter) {
    const sessions = Array.from(this.retrySessions.values()).filter((session) => matchesSession(session, filter))
    sessions.forEach((session) => {
      this.retrySessions.delete(createSessionKey(session.tabId, session.requestId))
    })
    await Promise.all(sessions.map(async (session) => {
      await this.removeWorkDirectory(session.workDirectoryPath).catch(() => undefined)
    }))
  }

  async clearLive(filter: EmbeddedBrowserHlsSessionFilter) {
    const sessions = Array.from(this.liveSessions.values()).filter((session) => matchesSession(session, filter))
    sessions.forEach((session) => {
      this.liveSessions.delete(createSessionKey(session.tabId, session.requestId))
    })
    await Promise.all(sessions.map(async (session) => {
      await session.recorder.discard().catch(() => undefined)
      const workDirectoryPath = session.workDirectoryPath
        || session.recorder.getCurrentWorkDirectoryPath()
      if (workDirectoryPath) {
        await this.removeWorkDirectory(workDirectoryPath).catch(() => undefined)
      }
    }))
  }

  async dispose() {
    await Promise.all([
      this.clearRetry({ all: true }),
      this.clearLive({ all: true }),
    ])
  }
}
