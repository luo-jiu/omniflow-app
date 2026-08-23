import { describe, expect, it } from 'vitest'
import {
  MAX_AI_SERVICE_OUTPUT_TOKENS,
  buildAIServiceStreamingChatRequest,
  buildAIServiceCompletionRequest,
  extractAIServiceStreamDelta,
  buildAIServiceModelsRequest,
  extractAIServiceCompletionText,
  extractAIServiceErrorMessage,
  extractAIServiceModelIds,
  resolveAIServiceOutputTokenLimit,
} from './aiServiceClientModel'

describe('aiServiceClientModel', () => {
  it('builds an OpenAI-compatible model request from the active connection', () => {
    expect(buildAIServiceModelsRequest({
      apiKey: 'secret',
      baseUrl: 'https://api.deepseek.com/',
      providerType: 'deepseek',
    })).toEqual({
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
      method: 'GET',
      url: 'https://api.deepseek.com/models',
    })
  })

  it('uses Anthropic authentication and messages protocol for Claude', () => {
    const request = buildAIServiceCompletionRequest({
      apiKey: 'claude-secret',
      baseUrl: 'https://api.anthropic.com/v1',
      providerType: 'claude',
    }, {
      model: 'claude-sonnet-4-5',
      profileId: 'claude-profile',
      reasoningEffort: 'high',
      systemPrompt: 'system',
      userPrompt: 'user',
    })

    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'claude-secret',
    })
    expect(JSON.parse(request.body || '')).toMatchObject({
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'user' }],
      model: 'claude-sonnet-4-5',
      output_config: { effort: 'high' },
      system: 'system',
    })
    expect(JSON.parse(request.body || '')).not.toHaveProperty('temperature')
  })

  it('only sends OpenAI reasoning effort when explicitly selected', () => {
    const connection = {
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai' as const,
    }
    const automatic = JSON.parse(buildAIServiceCompletionRequest(connection, {
      model: 'gpt-5',
      profileId: 'openai-profile',
      reasoningEffort: 'auto',
      systemPrompt: 'system',
      userPrompt: 'user',
    }).body || '')
    const medium = JSON.parse(buildAIServiceCompletionRequest(connection, {
      model: 'gpt-5',
      profileId: 'openai-profile',
      reasoningEffort: 'medium',
      systemPrompt: 'system',
      userPrompt: 'user',
    }).body || '')

    expect(automatic).not.toHaveProperty('reasoning_effort')
    expect(automatic).not.toHaveProperty('temperature')
    expect(medium.reasoning_effort).toBe('medium')
    expect(medium).not.toHaveProperty('temperature')
  })

  it('only sends temperature when a caller explicitly provides it without reasoning effort', () => {
    const request = buildAIServiceCompletionRequest({
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      providerType: 'local',
    }, {
      model: 'qwen3:8b',
      profileId: 'local-profile',
      reasoningEffort: 'auto',
      systemPrompt: 'system',
      temperature: 0.2,
      userPrompt: 'user',
    })

    expect(JSON.parse(request.body || '').temperature).toBe(0.2)
  })

  it('supports standard and local model list response shapes', () => {
    expect(extractAIServiceModelIds({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4o' }] }))
      .toEqual(['gpt-4.1', 'gpt-4o'])
    expect(extractAIServiceModelIds({ models: [{ name: 'qwen3:8b' }] }))
      .toEqual(['qwen3:8b'])
  })

  it('extracts completion text from OpenAI and Claude responses', () => {
    expect(extractAIServiceCompletionText('openai', {
      choices: [{ message: { content: ' translated ' } }],
    })).toBe('translated')
    expect(extractAIServiceCompletionText('claude', {
      content: [{ type: 'text', text: ' translated ' }],
    })).toBe('translated')
  })

  it('builds streaming chat requests and extracts provider deltas', () => {
    const request = buildAIServiceStreamingChatRequest({
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai',
    }, {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-5-mini',
      profileId: 'profile-1',
      systemPrompt: 'system',
    })
    expect(JSON.parse(request.body || '')).toMatchObject({
      messages: [
        { content: 'system', role: 'system' },
        { content: 'hello', role: 'user' },
      ],
      model: 'gpt-5-mini',
      stream: true,
    })
    expect(JSON.parse(request.body || '')).not.toHaveProperty('max_completion_tokens')
    expect(JSON.parse(request.body || '')).not.toHaveProperty('max_tokens')
    expect(extractAIServiceStreamDelta('openai', {
      choices: [{ delta: { content: ' world' } }],
    })).toBe(' world')
    expect(extractAIServiceStreamDelta('claude', {
      delta: { text: ' there', type: 'text_delta' },
      type: 'content_block_delta',
    })).toBe(' there')
  })

  it.each([
    ['openai', 'max_completion_tokens', 'max_tokens'],
    ['deepseek', 'max_tokens', 'max_completion_tokens'],
    ['local', 'max_tokens', 'max_completion_tokens'],
    ['claude', 'max_tokens', 'max_completion_tokens'],
  ] as const)(
    'maps an explicit output budget for %s without sending competing fields',
    (providerType, expectedField, excludedField) => {
      const request = buildAIServiceStreamingChatRequest({
        apiKey: 'secret',
        baseUrl: 'https://api.example/v1',
        providerType,
      }, {
        maxOutputTokens: 2_048,
        messages: [{ content: 'hello', role: 'user' }],
        model: 'test-model',
        profileId: 'profile-1',
        systemPrompt: 'system',
      })
      const body = JSON.parse(request.body || '')

      expect(body[expectedField]).toBe(2_048)
      expect(body).not.toHaveProperty(excludedField)
    },
  )

  it('preserves the default Claude streaming output limit without an explicit budget', () => {
    const request = buildAIServiceStreamingChatRequest({
      apiKey: 'secret',
      baseUrl: 'https://api.anthropic.com/v1',
      providerType: 'claude',
    }, {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'claude-sonnet-4-5',
      profileId: 'profile-1',
      systemPrompt: 'system',
    })
    const body = JSON.parse(request.body || '')

    expect(body.max_tokens).toBe(4_096)
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('rejects non-integer or unreasonably large output token limits', () => {
    expect(resolveAIServiceOutputTokenLimit(1)).toBe(1)
    for (const value of [0, -1, 1.5, MAX_AI_SERVICE_OUTPUT_TOKENS + 1, '2048', null]) {
      expect(() => resolveAIServiceOutputTokenLimit(value)).toThrow(
        'AI 输出 token 上限必须是',
      )
    }
  })

  it('preserves provider error messages', () => {
    expect(extractAIServiceErrorMessage({ error: { message: 'invalid key' } }, 'fallback'))
      .toBe('invalid key')
  })
})
