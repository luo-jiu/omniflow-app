import type {
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
        max_tokens: 4096,
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

export function extractAIServiceErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body.trim()
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fallback
  const payload = body as Record<string, any>
  const message = payload.error?.message || payload.message || payload.error
  return typeof message === 'string' && message.trim() ? message.trim() : fallback
}
