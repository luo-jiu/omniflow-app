import { net } from 'electron'
import type {
  AIServiceChatCompletionInput,
  AIServiceCompletionInput,
} from '@/features/ai-services/ai-service.types'
import {
  getActiveAIServiceRuntimeProfile,
  getAIServiceRuntimeProfile,
} from './aiServiceStore'
import {
  buildAIServiceCompletionRequest,
  buildAIServiceStreamingChatRequest,
  buildAIServiceModelsRequest,
  extractAIServiceCompletionText,
  extractAIServiceErrorMessage,
  extractAIServiceModelIds,
  extractAIServiceStreamDelta,
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

function normalizeChatInput(input: AIServiceChatCompletionInput): AIServiceChatCompletionInput {
  return {
    messages: Array.isArray(input?.messages)
      ? input.messages
        .filter(message => message?.role === 'user' || message?.role === 'assistant')
        .map(message => ({
          content: String(message.content || ''),
          role: message.role,
        }))
        .filter(message => message.content.trim().length > 0)
      : [],
    model: String(input?.model || '').trim(),
    profileId: String(input?.profileId || '').trim(),
    reasoningEffort: normalizeReasoningEffort(input?.reasoningEffort),
    systemPrompt: String(input?.systemPrompt || ''),
    temperature: normalizeTemperature(input?.temperature),
  }
}

function validateChatInput(input: AIServiceChatCompletionInput): void {
  if (!input.model) throw new Error('请先选择模型')
  if (!input.profileId) throw new Error('请先启用 AI 服务配置')
  if (input.messages.length === 0) throw new Error('请求内容不能为空')
  if (input.model.length > 200) throw new Error('模型名称过长')
  const messageLength = input.messages.reduce((total, message) => total + message.content.length, 0)
  if (input.systemPrompt.length + messageLength > 1_000_000) {
    throw new Error('请求内容过长')
  }
}

function parseStreamData(
  providerType: AIServiceRuntimeConnection['providerType'],
  rawData: string,
  onDelta: (delta: string) => void,
  state: { content: string },
): void {
  const data = rawData.trim()
  if (!data || data === '[DONE]') return
  let body: unknown
  try {
    body = JSON.parse(data)
  } catch {
    return
  }
  const delta = extractAIServiceStreamDelta(providerType, body)
  if (!delta) return
  state.content += delta
  onDelta(delta)
}

export async function streamAIServiceProfile(
  input: AIServiceChatCompletionInput,
  onDelta: (delta: string) => void,
  runtimeConnection?: AIServiceRuntimeConnection,
  signal?: AbortSignal,
): Promise<string> {
  const normalized = normalizeChatInput(input)
  validateChatInput(normalized)
  const profile = runtimeConnection || getAIServiceRuntimeProfile(normalized.profileId)
  const request = buildAIServiceStreamingChatRequest(profile, normalized)
  const response = await net.fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method,
    signal,
  })
  if (!response.ok) {
    const text = await response.text()
    let body: unknown = text
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    throw new Error(extractAIServiceErrorMessage(body, 'AI 请求失败'))
  }
  if (!response.body) {
    throw new Error('AI 服务未返回流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const state = { content: '' }
  let buffer = ''

  const consumeBuffer = (flush = false) => {
    const lines = buffer.split(/\r?\n/)
    if (!flush) {
      buffer = lines.pop() || ''
    } else {
      buffer = ''
    }
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      parseStreamData(profile.providerType, line.slice(5), onDelta, state)
    }
  }

  try {
    let streamDone = false
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) {
        streamDone = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      consumeBuffer()
    }
    buffer += decoder.decode()
    consumeBuffer(true)
  } finally {
    reader.releaseLock()
  }

  if (!state.content.trim()) {
    throw new Error('模型未返回可用内容')
  }
  return state.content
}
