import type {
  AIServiceChatCompletionInput,
  AIServiceCompletionInput,
  AIServiceProviderType,
} from '@/features/ai-services/ai-service.types'

export interface AIServiceRuntimeConnection {
  apiKey: string
  baseUrl: string
  providerType: AIServiceProviderType
}

export interface AIServiceRequestSpec {
  body?: string
  headers: Record<string, string>
  method: 'GET' | 'POST'
  url: string
}

export const MAX_AI_SERVICE_OUTPUT_TOKENS = 1_000_000

export function resolveAIServiceOutputTokenLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > MAX_AI_SERVICE_OUTPUT_TOKENS
  ) {
    throw new Error(
      `AI 输出 token 上限必须是 1 到 ${MAX_AI_SERVICE_OUTPUT_TOKENS} 之间的整数`,
    )
  }
  return value
}

export function buildAIServiceOutputTokenFields(
  providerType: AIServiceProviderType,
  value: unknown,
): Record<string, number> {
  const limit = resolveAIServiceOutputTokenLimit(value)
  if (limit === undefined) return {}
  return providerType === 'openai'
    ? { max_completion_tokens: limit }
    : { max_tokens: limit }
}

function appendPath(baseUrl: string, path: string) {
  return `${String(baseUrl || '').trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function buildHeaders(connection: AIServiceRuntimeConnection) {
  const apiKey = String(connection.apiKey || '').trim()
  if (connection.providerType === 'claude') {
    return {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    }
  }
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

export function buildAIServiceModelsRequest(
  connection: AIServiceRuntimeConnection,
): AIServiceRequestSpec {
  return {
    headers: buildHeaders(connection),
    method: 'GET',
    url: appendPath(connection.baseUrl, 'models'),
  }
}

export function buildAIServiceCompletionRequest(
  connection: AIServiceRuntimeConnection,
  input: AIServiceCompletionInput,
): AIServiceRequestSpec {
  const reasoningEffort = input.reasoningEffort && input.reasoningEffort !== 'auto'
    ? input.reasoningEffort
    : null
  const common = {
    model: input.model,
    ...(!reasoningEffort && input.temperature !== undefined
      ? { temperature: input.temperature }
      : {}),
  }
  const body = connection.providerType === 'claude'
    ? {
        ...common,
        ...buildAIServiceOutputTokenFields(connection.providerType, 4096),
        messages: [{ role: 'user', content: input.userPrompt }],
        ...(reasoningEffort ? { output_config: { effort: reasoningEffort } } : {}),
        system: input.systemPrompt,
      }
    : {
        ...common,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userPrompt },
        ],
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }
  return {
    body: JSON.stringify(body),
    headers: buildHeaders(connection),
    method: 'POST',
    url: appendPath(connection.baseUrl, connection.providerType === 'claude' ? 'messages' : 'chat/completions'),
  }
}

function buildAIServiceChatBody(
  connection: AIServiceRuntimeConnection,
  input: AIServiceChatCompletionInput,
  stream: boolean,
): Record<string, unknown> {
  const reasoningEffort = input.reasoningEffort && input.reasoningEffort !== 'auto'
    ? input.reasoningEffort
    : null
  const common = {
    model: input.model,
    ...(stream ? { stream: true } : {}),
    ...(!reasoningEffort && input.temperature !== undefined
      ? { temperature: input.temperature }
      : {}),
  }
  const outputTokenFields = buildAIServiceOutputTokenFields(
    connection.providerType,
    input.maxOutputTokens ?? (connection.providerType === 'claude' ? 4096 : undefined),
  )
  if (connection.providerType === 'claude') {
    return {
      ...common,
      ...outputTokenFields,
      messages: input.messages,
      ...(reasoningEffort ? { output_config: { effort: reasoningEffort } } : {}),
      system: input.systemPrompt,
    }
  }
  return {
    ...common,
    ...outputTokenFields,
    messages: [
      { role: 'system', content: input.systemPrompt },
      ...input.messages,
    ],
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  }
}

export function buildAIServiceChatCompletionRequest(
  connection: AIServiceRuntimeConnection,
  input: AIServiceChatCompletionInput,
): AIServiceRequestSpec {
  return {
    body: JSON.stringify(buildAIServiceChatBody(connection, input, false)),
    headers: buildHeaders(connection),
    method: 'POST',
    url: appendPath(connection.baseUrl, connection.providerType === 'claude' ? 'messages' : 'chat/completions'),
  }
}

export function buildAIServiceStreamingChatRequest(
  connection: AIServiceRuntimeConnection,
  input: AIServiceChatCompletionInput,
): AIServiceRequestSpec {
  return {
    body: JSON.stringify(buildAIServiceChatBody(connection, input, true)),
    headers: buildHeaders(connection),
    method: 'POST',
    url: appendPath(connection.baseUrl, connection.providerType === 'claude' ? 'messages' : 'chat/completions'),
  }
}

export function extractAIServiceModelIds(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const payload = body as Record<string, unknown>
  const candidates = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : []
  const modelIds = candidates
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
      const record = item as Record<string, unknown>
      return String(record.id || record.name || '').trim()
    })
    .filter(Boolean)
  return Array.from(new Set(modelIds))
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

export function extractAIServiceCompletionText(
  providerType: AIServiceProviderType,
  body: unknown,
): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ''
  const payload = body as Record<string, any>
  const content = providerType === 'claude'
    ? payload.content
    : payload.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      return typeof item?.text === 'string' ? item.text : ''
    })
    .join('\n')
    .trim()
}

export function extractAIServiceStreamDelta(
  providerType: AIServiceProviderType,
  body: unknown,
): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ''
  const payload = body as Record<string, any>
  if (providerType === 'claude') {
    return payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta'
      ? String(payload.delta.text || '')
      : ''
  }
  const delta = payload.choices?.[0]?.delta
  if (!delta || typeof delta !== 'object') return ''
  if (typeof delta.content === 'string') return delta.content
  if (Array.isArray(delta.content)) {
    return delta.content
      .map((item: unknown) => (
        typeof item === 'string'
          ? item
          : typeof (item as { text?: unknown } | null)?.text === 'string'
            ? (item as { text: string }).text
            : ''
      ))
      .join('')
  }
  return ''
}

export function extractAIServiceErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body.trim()
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fallback
  const payload = body as Record<string, any>
  const message = payload.error?.message || payload.message || payload.error
  return typeof message === 'string' && message.trim() ? message.trim() : fallback
}
