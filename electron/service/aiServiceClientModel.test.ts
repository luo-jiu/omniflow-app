import { describe, expect, it } from 'vitest'
import {
  buildAIServiceCompletionRequest,
  buildAIServiceModelsRequest,
  extractAIServiceCompletionText,
  extractAIServiceErrorMessage,
  extractAIServiceModelIds,
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

  it('preserves provider error messages', () => {
    expect(extractAIServiceErrorMessage({ error: { message: 'invalid key' } }, 'fallback'))
      .toBe('invalid key')
  })
})
