import {
  type AIServiceProfile,
  type AIServiceProviderType,
  type AIServiceSaveInput,
  type AIServiceSnapshot,
} from '@/features/ai-services/ai-service.types'
import { AI_SERVICE_PROVIDER_TYPES } from '../../src/shared/ai-service-provider-types'

const LEGACY_PROVIDER_TYPES: Record<string, AIServiceProviderType> = {
  'openai-compatible': 'openai',
  ollama: 'local',
}

export interface StoredAIServiceProfile {
  baseUrl: string;
  createdAt: string;
  encryptedApiKey?: string;
  id: string;
  name: string;
  providerType: AIServiceProviderType;
  updatedAt: string;
}

export interface StoredAIServiceState {
  activeProfileId: string | null;
  profiles: StoredAIServiceProfile[];
  version: 2;
}

export const EMPTY_AI_SERVICE_STATE: StoredAIServiceState = {
  activeProfileId: null,
  profiles: [],
  version: 2,
}

function isProviderType(value: unknown): value is AIServiceProviderType {
  return typeof value === 'string'
    && (AI_SERVICE_PROVIDER_TYPES as readonly string[]).includes(value)
}

function normalizeProviderType(value: unknown): AIServiceProviderType | null {
  if (isProviderType(value)) return value
  return typeof value === 'string' ? LEGACY_PROVIDER_TYPES[value] || null : null
}

function normalizeStoredProfile(value: unknown): StoredAIServiceProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const id = String(raw.id || '').trim()
  const name = String(raw.name || '').trim()
  const baseUrl = String(raw.baseUrl || '').trim()
  const providerType = normalizeProviderType(raw.providerType)
  if (!id || !name || !baseUrl || !providerType) return null
  const createdAt = String(raw.createdAt || '')
  const updatedAt = String(raw.updatedAt || '')
  return {
    baseUrl,
    createdAt: createdAt || updatedAt,
    id,
    name,
    providerType,
    updatedAt: updatedAt || createdAt,
    ...(typeof raw.encryptedApiKey === 'string' && raw.encryptedApiKey
      ? { encryptedApiKey: raw.encryptedApiKey }
      : {}),
  }
}

export function normalizeAIServiceState(value: unknown): StoredAIServiceState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...EMPTY_AI_SERVICE_STATE, profiles: [] }
  }
  const raw = value as Record<string, unknown>
  const seen = new Set<string>()
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : [])
    .map(normalizeStoredProfile)
    .filter((profile): profile is StoredAIServiceProfile => {
      if (!profile || seen.has(profile.id)) return false
      seen.add(profile.id)
      return true
    })
  const requestedActiveId = typeof raw.activeProfileId === 'string'
    ? raw.activeProfileId
    : null
  const activeProfileId = profiles.some((profile) => profile.id === requestedActiveId)
    ? requestedActiveId
    : profiles[0]?.id ?? null
  return { activeProfileId, profiles, version: 2 }
}

export function validateAIServiceSaveInput(input: AIServiceSaveInput): AIServiceSaveInput {
  const name = String(input?.name || '').trim()
  const rawBaseUrl = String(input?.baseUrl || '').trim()
  if (!name) throw new Error('请输入配置名称')
  if (name.length > 60) throw new Error('配置名称不能超过 60 个字符')
  if (!isProviderType(input?.providerType)) throw new Error('请选择有效的服务类型')
  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawBaseUrl)
  } catch {
    throw new Error('请输入有效的 Base URL')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Base URL 仅支持 http 或 https')
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Base URL 不能包含用户名或密码')
  }
  const baseUrl = rawBaseUrl.replace(/\/+$/, '')
  return {
    baseUrl,
    id: input.id ? String(input.id).trim() : undefined,
    name,
    providerType: input.providerType,
    removeApiKey: Boolean(input.removeApiKey),
    ...(typeof input.apiKey === 'string' ? { apiKey: input.apiKey.trim() } : {}),
  }
}

export function upsertAIServiceProfile(
  state: StoredAIServiceState,
  input: AIServiceSaveInput,
  options: { encryptedApiKey?: string; generatedId: string; now: string },
): StoredAIServiceState {
  const normalized = validateAIServiceSaveInput(input)
  const index = normalized.id
    ? state.profiles.findIndex((profile) => profile.id === normalized.id)
    : -1
  if (normalized.id && index < 0) throw new Error('AI 服务配置不存在')
  const existing = index >= 0 ? state.profiles[index] : null
  const encryptedApiKey = normalized.removeApiKey
    ? undefined
    : options.encryptedApiKey || existing?.encryptedApiKey
  const nextProfile: StoredAIServiceProfile = {
    baseUrl: normalized.baseUrl,
    createdAt: existing?.createdAt || options.now,
    id: existing?.id || options.generatedId,
    name: normalized.name,
    providerType: normalized.providerType,
    updatedAt: options.now,
    ...(encryptedApiKey ? { encryptedApiKey } : {}),
  }
  const profiles = [...state.profiles]
  if (index >= 0) profiles[index] = nextProfile
  else profiles.push(nextProfile)
  return {
    activeProfileId: state.activeProfileId || nextProfile.id,
    profiles,
    version: 2,
  }
}

export function duplicateAIServiceProfile(
  state: StoredAIServiceState,
  id: string,
  generatedId: string,
  now: string,
): StoredAIServiceState {
  const source = state.profiles.find((profile) => profile.id === id)
  if (!source) throw new Error('AI 服务配置不存在')
  const usedNames = new Set(state.profiles.map((profile) => profile.name))
  let name = `${source.name} 副本`
  let index = 2
  while (usedNames.has(name)) {
    name = `${source.name} 副本 ${index}`
    index += 1
  }
  return {
    ...state,
    profiles: [
      ...state.profiles,
      {
        ...source,
        createdAt: now,
        id: generatedId,
        name,
        updatedAt: now,
      },
    ],
  }
}

export function deleteAIServiceProfile(
  state: StoredAIServiceState,
  id: string,
): StoredAIServiceState {
  if (!state.profiles.some((profile) => profile.id === id)) {
    throw new Error('AI 服务配置不存在')
  }
  const profiles = state.profiles.filter((profile) => profile.id !== id)
  return {
    ...state,
    activeProfileId: state.activeProfileId === id
      ? profiles[0]?.id ?? null
      : state.activeProfileId,
    profiles,
  }
}

export function setActiveAIServiceProfile(
  state: StoredAIServiceState,
  id: string,
): StoredAIServiceState {
  if (!state.profiles.some((profile) => profile.id === id)) {
    throw new Error('AI 服务配置不存在')
  }
  return { ...state, activeProfileId: id }
}

export function reorderAIServiceProfiles(
  state: StoredAIServiceState,
  orderedIds: string[],
): StoredAIServiceState {
  if (!Array.isArray(orderedIds) || orderedIds.length !== state.profiles.length) {
    throw new Error('AI 服务排序数据不完整')
  }
  const profileById = new Map(state.profiles.map((profile) => [profile.id, profile]))
  const uniqueIds = new Set(orderedIds)
  if (uniqueIds.size !== orderedIds.length || orderedIds.some((id) => !profileById.has(id))) {
    throw new Error('AI 服务排序数据无效')
  }
  return {
    ...state,
    profiles: orderedIds.map((id) => profileById.get(id)!),
  }
}

function toPublicProfile(profile: StoredAIServiceProfile): AIServiceProfile {
  return {
    baseUrl: profile.baseUrl,
    createdAt: profile.createdAt,
    hasApiKey: Boolean(profile.encryptedApiKey),
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
    updatedAt: profile.updatedAt,
  }
}

export function projectAIServiceSnapshot(state: StoredAIServiceState): AIServiceSnapshot {
  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map(toPublicProfile),
  }
}
