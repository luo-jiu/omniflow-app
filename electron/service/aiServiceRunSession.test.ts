import { describe, expect, it } from 'vitest'

import { createAIServiceRunSessionRegistry } from './aiServiceRunSession'

describe('AI service run session registry', () => {
  it('freezes the runtime connection and locks its profile until the session ends', () => {
    const registry = createAIServiceRunSessionRegistry()
    const connection = {
      apiKey: 'secret-a',
      baseUrl: 'https://api.example.com/v1',
      providerType: 'openai' as const,
    }
    const session = registry.begin({
      connection,
      ownerWebContentsId: 7,
      profileId: 'profile-1',
    }, 'run-1')

    connection.apiKey = 'secret-b'
    const request = registry.acquireRequest('run-1', 'profile-1', 7)
    expect(session).toEqual({ id: 'run-1', profileId: 'profile-1' })
    expect(request.connection).toEqual({
      apiKey: 'secret-a',
      baseUrl: 'https://api.example.com/v1',
      providerType: 'openai',
    })
    expect(() => registry.assertProfileUnlocked('profile-1'))
      .toThrow('该 AI 服务配置正在被任务使用')

    expect(request.signal.aborted).toBe(false)
    expect(registry.end('run-1', 7)).toBe(true)
    expect(request.signal.aborted).toBe(true)
    request.release()
    expect(() => registry.assertProfileUnlocked('profile-1')).not.toThrow()
  })

  it('binds sessions to both the profile and renderer owner', () => {
    const registry = createAIServiceRunSessionRegistry()
    registry.begin({
      connection: {
        apiKey: '',
        baseUrl: 'http://localhost:11434/v1',
        providerType: 'local',
      },
      ownerWebContentsId: 7,
      profileId: 'profile-1',
    }, 'run-1')

    expect(() => registry.acquireRequest('run-1', 'profile-2', 7)).toThrow('任务会话无效')
    expect(() => registry.acquireRequest('run-1', 'profile-1', 8)).toThrow('任务会话无效')
    expect(() => registry.end('run-1', 8)).toThrow('无权结束')

    registry.releaseOwner(7)
    expect(() => registry.acquireRequest('run-1', 'profile-1', 7)).toThrow('任务会话无效')
  })
})
