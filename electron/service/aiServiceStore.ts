import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { AIServiceSaveInput, AIServiceSnapshot } from '@/features/ai-services/ai-service.types'
import { runtimeLogger } from '../runtimeLogger'
import { aiServiceRunSessionRegistry } from './aiServiceRunSession'
import {
  deleteAIServiceProfile,
  duplicateAIServiceProfile,
  normalizeAIServiceState,
  projectAIServiceSnapshot,
  reorderAIServiceProfiles,
  setActiveAIServiceProfile,
  type StoredAIServiceState,
  upsertAIServiceProfile,
} from './aiServiceStoreModel'

const STORE_FILE_NAME = 'ai-services.json'
let cachedState: StoredAIServiceState | null = null

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE_NAME)
}

function loadState(): StoredAIServiceState {
  if (cachedState) return cachedState
  const filePath = getStorePath()
  if (!existsSync(filePath)) {
    cachedState = normalizeAIServiceState(null)
    return cachedState
  }
  try {
    cachedState = normalizeAIServiceState(JSON.parse(readFileSync(filePath, 'utf-8')))
  } catch (error) {
    runtimeLogger.warn('AI service store load failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    cachedState = normalizeAIServiceState(null)
  }
  return cachedState
}

function persistState(state: StoredAIServiceState) {
  const filePath = getStorePath()
  const directory = path.dirname(filePath)
  const tempPath = `${filePath}.${process.pid}.tmp`
  mkdirSync(directory, { recursive: true })
  try {
    writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: 'utf-8', mode: 0o600 })
    renameSync(tempPath, filePath)
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true })
  }
  cachedState = state
}

function snapshot(state = loadState()): AIServiceSnapshot {
  return projectAIServiceSnapshot(state)
}

export function listAIServiceProfiles(): AIServiceSnapshot {
  return snapshot()
}

export function getAIServiceRuntimeProfile(id: string) {
  const state = loadState()
  const profile = state.profiles.find((item) => item.id === String(id || ''))
  if (!profile) {
    throw new Error('AI 服务配置不存在或已被删除')
  }

  let apiKey = ''
  if (profile.encryptedApiKey) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密服务不可用，无法读取 API Key')
    }
    try {
      apiKey = safeStorage.decryptString(Buffer.from(profile.encryptedApiKey, 'base64'))
    } catch {
      throw new Error('API Key 解密失败，请重新保存 AI 服务配置')
    }
  }

  return {
    baseUrl: profile.baseUrl,
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
    apiKey,
  }
}

export function getActiveAIServiceRuntimeProfile() {
  const state = loadState()
  if (!state.activeProfileId) {
    throw new Error('请先在 AI 服务配置中启用一个服务')
  }
  return getAIServiceRuntimeProfile(state.activeProfileId)
}

export function revealAIServiceProfileApiKey(id: string) {
  return getAIServiceRuntimeProfile(String(id || '')).apiKey
}

export function saveAIServiceProfile(input: AIServiceSaveInput): AIServiceSnapshot {
  if (input.id) {
    aiServiceRunSessionRegistry.assertProfileUnlocked(String(input.id))
  }
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  let encryptedApiKey: string | undefined
  if (apiKey && !input.removeApiKey) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密服务不可用，无法保存 API Key')
    }
    encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64')
  }
  const next = upsertAIServiceProfile(loadState(), input, {
    encryptedApiKey,
    generatedId: crypto.randomUUID(),
    now: new Date().toISOString(),
  })
  persistState(next)
  return snapshot(next)
}

export function activateAIServiceProfile(id: string): AIServiceSnapshot {
  const next = setActiveAIServiceProfile(loadState(), String(id || ''))
  persistState(next)
  return snapshot(next)
}

export function reorderAIServiceProfileList(orderedIds: string[]): AIServiceSnapshot {
  const next = reorderAIServiceProfiles(loadState(), orderedIds)
  persistState(next)
  return snapshot(next)
}

export function copyAIServiceProfile(id: string): AIServiceSnapshot {
  const next = duplicateAIServiceProfile(
    loadState(),
    String(id || ''),
    crypto.randomUUID(),
    new Date().toISOString(),
  )
  persistState(next)
  return snapshot(next)
}

export function removeAIServiceProfile(id: string): AIServiceSnapshot {
  aiServiceRunSessionRegistry.assertProfileUnlocked(String(id || ''))
  const next = deleteAIServiceProfile(loadState(), String(id || ''))
  persistState(next)
  return snapshot(next)
}
