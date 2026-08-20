import { describe, expect, it } from 'vitest'
import {
  deleteAIServiceProfile,
  duplicateAIServiceProfile,
  normalizeAIServiceState,
  projectAIServiceSnapshot,
  reorderAIServiceProfiles,
  upsertAIServiceProfile,
  validateAIServiceSaveInput,
} from './aiServiceStoreModel'

const NOW = '2026-08-19T00:00:00.000Z'

function createState() {
  return normalizeAIServiceState({
    activeProfileId: 'profile-1',
    profiles: [{
      baseUrl: 'http://localhost:11434/v1',
      createdAt: NOW,
      encryptedApiKey: 'encrypted-secret',
      id: 'profile-1',
      name: '本地 Ollama',
      providerType: 'local',
      updatedAt: NOW,
    }],
  })
}

describe('AI service store model', () => {
  it('normalizes invalid active profile to the first valid profile', () => {
    const state = normalizeAIServiceState({
      activeProfileId: 'missing',
      profiles: [
        { id: '', name: 'invalid' },
        {
          baseUrl: 'https://api.example.com/v1',
          createdAt: NOW,
          id: 'profile-1',
          name: 'Example',
          providerType: 'openai',
          updatedAt: NOW,
        },
      ],
    })
    expect(state.activeProfileId).toBe('profile-1')
    expect(state.profiles).toHaveLength(1)
  })

  it('rejects empty names and unsupported URLs', () => {
    expect(() => validateAIServiceSaveInput({
      baseUrl: 'https://api.example.com/v1',
      name: ' ',
      providerType: 'openai',
    })).toThrow('请输入配置名称')
    expect(() => validateAIServiceSaveInput({
      baseUrl: 'file:///tmp/models',
      name: 'Bad URL',
      providerType: 'openai',
    })).toThrow('Base URL 仅支持 http 或 https')
  })

  it.each(['deepseek', 'openai', 'claude', 'local'] as const)(
    'accepts the supported %s provider',
    (providerType) => {
      expect(validateAIServiceSaveInput({
        baseUrl: 'https://api.example.com/v1',
        name: providerType,
        providerType,
      }).providerType).toBe(providerType)
    },
  )

  it('retains the stored key when an edit leaves API Key blank', () => {
    const next = upsertAIServiceProfile(createState(), {
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1/',
      id: 'profile-1',
      name: '更新名称',
      providerType: 'local',
    }, {
      generatedId: 'unused',
      now: '2026-08-19T01:00:00.000Z',
    })
    expect(next.profiles[0]).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      encryptedApiKey: 'encrypted-secret',
      name: '更新名称',
    })
  })

  it('duplicates a profile and selects a deterministic fallback after deleting the active one', () => {
    const duplicated = duplicateAIServiceProfile(
      createState(),
      'profile-1',
      'profile-2',
      '2026-08-19T02:00:00.000Z',
    )
    expect(duplicated.profiles[1]).toMatchObject({
      encryptedApiKey: 'encrypted-secret',
      id: 'profile-2',
      name: '本地 Ollama 副本',
    })
    const afterDelete = deleteAIServiceProfile(duplicated, 'profile-1')
    expect(afterDelete.activeProfileId).toBe('profile-2')
  })

  it('reorders profiles without changing the active profile or encrypted keys', () => {
    const duplicated = duplicateAIServiceProfile(
      createState(),
      'profile-1',
      'profile-2',
      '2026-08-19T02:00:00.000Z',
    )
    const reordered = reorderAIServiceProfiles(duplicated, ['profile-2', 'profile-1'])
    expect(reordered.activeProfileId).toBe('profile-1')
    expect(reordered.profiles.map((profile) => profile.id)).toEqual(['profile-2', 'profile-1'])
    expect(reordered.profiles[1].encryptedApiKey).toBe('encrypted-secret')
  })

  it('rejects incomplete, duplicate, and unknown profile orders', () => {
    const duplicated = duplicateAIServiceProfile(
      createState(),
      'profile-1',
      'profile-2',
      '2026-08-19T02:00:00.000Z',
    )
    expect(() => reorderAIServiceProfiles(duplicated, ['profile-1'])).toThrow('排序数据不完整')
    expect(() => reorderAIServiceProfiles(duplicated, ['profile-1', 'profile-1'])).toThrow('排序数据无效')
    expect(() => reorderAIServiceProfiles(duplicated, ['profile-1', 'missing'])).toThrow('排序数据无效')
  })

  it('never exposes encrypted secret material in renderer projections', () => {
    const snapshot = projectAIServiceSnapshot(createState())
    expect(snapshot.profiles[0].hasApiKey).toBe(true)
    expect(snapshot.profiles[0]).not.toHaveProperty('encryptedApiKey')
    expect(JSON.stringify(snapshot)).not.toContain('encrypted-secret')
  })

  it('migrates legacy provider types without discarding profiles or encrypted keys', () => {
    const state = normalizeAIServiceState({
      activeProfileId: 'legacy-ollama',
      profiles: [
        {
          baseUrl: 'http://localhost:11434/v1',
          createdAt: NOW,
          encryptedApiKey: 'local-secret',
          id: 'legacy-ollama',
          name: 'Legacy Ollama',
          providerType: 'ollama',
          updatedAt: NOW,
        },
        {
          baseUrl: 'https://api.example.com/v1',
          createdAt: NOW,
          id: 'legacy-compatible',
          name: 'Legacy Compatible',
          providerType: 'openai-compatible',
          updatedAt: NOW,
        },
      ],
      version: 1,
    })

    expect(state.version).toBe(2)
    expect(state.profiles).toMatchObject([
      { encryptedApiKey: 'local-secret', providerType: 'local' },
      { providerType: 'openai' },
    ])
  })
})
