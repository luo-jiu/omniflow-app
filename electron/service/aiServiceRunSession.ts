import crypto from 'node:crypto'

import type { AIServiceRunSessionHandle } from '@/features/ai-services/ai-service.types'
import type { AIServiceRuntimeConnection } from './aiServiceClientModel'

interface BeginAIServiceRunSessionInput {
  connection: AIServiceRuntimeConnection;
  ownerWebContentsId: number;
  profileId: string;
}

interface StoredAIServiceRunSession extends AIServiceRunSessionHandle {
  activeRequests: Set<AbortController>;
  connection: AIServiceRuntimeConnection;
  ownerWebContentsId: number;
}

interface AIServiceRunRequestHandle {
  connection: AIServiceRuntimeConnection;
  release: () => void;
  signal: AbortSignal;
}

function copyConnection(connection: AIServiceRuntimeConnection): AIServiceRuntimeConnection {
  return {
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    providerType: connection.providerType,
  }
}

export function createAIServiceRunSessionRegistry() {
  const sessions = new Map<string, StoredAIServiceRunSession>()

  function begin(
    input: BeginAIServiceRunSessionInput,
    generatedId: string = crypto.randomUUID(),
  ): AIServiceRunSessionHandle {
    const session: StoredAIServiceRunSession = {
      activeRequests: new Set(),
      connection: copyConnection(input.connection),
      id: generatedId,
      ownerWebContentsId: input.ownerWebContentsId,
      profileId: input.profileId,
    }
    sessions.set(session.id, session)
    return { id: session.id, profileId: session.profileId }
  }

  function acquireRequest(
    id: string,
    profileId: string,
    ownerWebContentsId: number,
  ): AIServiceRunRequestHandle {
    const session = sessions.get(String(id || ''))
    if (
      !session
      || session.profileId !== String(profileId || '')
      || session.ownerWebContentsId !== ownerWebContentsId
    ) {
      throw new Error('AI 服务任务会话无效或已结束')
    }
    const controller = new AbortController()
    session.activeRequests.add(controller)
    let released = false
    return {
      connection: copyConnection(session.connection),
      release: () => {
        if (released) return
        released = true
        session.activeRequests.delete(controller)
      },
      signal: controller.signal,
    }
  }

  function abortRequests(session: StoredAIServiceRunSession) {
    session.activeRequests.forEach((controller) => controller.abort())
    session.activeRequests.clear()
  }

  function end(id: string, ownerWebContentsId: number): boolean {
    const session = sessions.get(String(id || ''))
    if (!session) return false
    if (session.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('无权结束该 AI 服务任务会话')
    }
    abortRequests(session)
    return sessions.delete(session.id)
  }

  function releaseOwner(ownerWebContentsId: number) {
    sessions.forEach((session, id) => {
      if (session.ownerWebContentsId === ownerWebContentsId) {
        abortRequests(session)
        sessions.delete(id)
      }
    })
  }

  function assertProfileUnlocked(profileId: string) {
    const normalizedProfileId = String(profileId || '')
    if (Array.from(sessions.values()).some((session) => session.profileId === normalizedProfileId)) {
      throw new Error('该 AI 服务配置正在被任务使用，请先停止任务')
    }
  }

  return {
    acquireRequest,
    assertProfileUnlocked,
    begin,
    end,
    releaseOwner,
  }
}

export const aiServiceRunSessionRegistry = createAIServiceRunSessionRegistry()
