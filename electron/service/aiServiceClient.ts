import { net } from 'electron'
import type { AIServiceCompletionInput } from '@/features/ai-services/ai-service.types'
import {
  getActiveAIServiceRuntimeProfile,
  getAIServiceRuntimeProfile,
} from './aiServiceStore'
import {
  buildAIServiceCompletionRequest,
  buildAIServiceModelsRequest,
  extractAIServiceCompletionText,
  extractAIServiceErrorMessage,
  extractAIServiceModelIds,
  type AIServiceRequestSpec,
  type AIServiceRuntimeConnection,
} from './aiServiceClientModel'

async function requestJson(
  spec: AIServiceRequestSpec,
  fallbackError: string,
  signal?: AbortSignal,
) {
  const response = await net.fetch(spec.url, {
    body: spec.body,
    headers: spec.headers,
    method: spec.method,
    signal,
  })
  const text = await response.text()
  let body: unknown = text
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    throw new Error(extractAIServiceErrorMessage(body, fallbackError))
  }
  return body
}

function normalizeReasoningEffort(value: unknown): AIServiceCompletionInput['reasoningEffort'] {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'auto'
}

function normalizeTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.min(2, parsed))
}

export async function listActiveAIServiceModels(): Promise<string[]> {
  const profile = getActiveAIServiceRuntimeProfile()
  const body = await requestJson(buildAIServiceModelsRequest(profile), '获取模型列表失败')
  return extractAIServiceModelIds(body)
}

export async function completeWithAIServiceProfile(
  input: AIServiceCompletionInput,
  runtimeConnection?: AIServiceRuntimeConnection,
  signal?: AbortSignal,
): Promise<string> {
  const normalized: AIServiceCompletionInput = {
    model: String(input?.model || '').trim(),
    profileId: String(input?.profileId || '').trim(),
    reasoningEffort: normalizeReasoningEffort(input?.reasoningEffort),
    systemPrompt: String(input?.systemPrompt || ''),
    temperature: normalizeTemperature(input?.temperature),
    userPrompt: String(input?.userPrompt || ''),
  }
  if (!normalized.model) throw new Error('请先选择模型')
  if (!normalized.profileId) throw new Error('请先启用 AI 服务配置')
  if (!normalized.userPrompt.trim()) throw new Error('请求内容不能为空')
  if (normalized.model.length > 200) throw new Error('模型名称过长')
  if (normalized.systemPrompt.length + normalized.userPrompt.length > 1_000_000) {
    throw new Error('请求内容过长')
  }

  const profile = runtimeConnection || getAIServiceRuntimeProfile(normalized.profileId)
  const body = await requestJson(
    buildAIServiceCompletionRequest(profile, normalized),
    'AI 请求失败',
    signal,
  )
  const content = extractAIServiceCompletionText(profile.providerType, body)
  if (!content) throw new Error('模型未返回可用内容')
  return content
}
