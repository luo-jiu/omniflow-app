import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch },
}));

vi.mock('./aiServiceStore', () => ({
  getActiveAIServiceRuntimeProfile: vi.fn(),
  getAIServiceRuntimeProfile: vi.fn(),
}));

import { completeWithAIServiceProfile, streamAIServiceProfile, getActiveAIServiceModelCapabilities } from './aiServiceClient';
import { getActiveAIServiceRuntimeProfile } from './aiServiceStore';

describe('AI service client streaming limits', () => {
  it('returns a safe current profile identity without fetching when querying Fast capability', () => {
    vi.mocked(getActiveAIServiceRuntimeProfile).mockReturnValue({ id: 'fast-profile', configurationRevision: 'revision', name: 'test',
      apiKey: 'secret', baseUrl: 'https://custom-fast.example/v1', providerType: 'openai' });
    expect(getActiveAIServiceModelCapabilities('gpt-6.1-sol')).toEqual({ model: 'gpt-6.1-sol', profileId: 'fast-profile',
      profileUpdatedAt: 'revision', fastMode: true });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])('sends the selected Fast=%s tier through completion and streaming without proxy metadata', async fastMode => {
    const connection = { apiKey: 'key', baseUrl: 'https://custom-fast.example/v1', providerType: 'openai' as const };
    const input = { model: 'gpt-6.1-sol', profileId: 'profile', fastMode, systemPrompt: 'rules' };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    await completeWithAIServiceProfile({ ...input, userPrompt: 'line' }, connection);
    await streamAIServiceProfile({ ...input, messages: [{ role: 'user', content: 'line' }] }, vi.fn(), connection);
    for (const [, request] of mocks.fetch.mock.calls) expect(JSON.parse(request.body).service_tier).toBe(fastMode ? 'priority' : 'default');
  });

  it('rejects unconfirmed or malformed Fast before sending and preserves absent legacy settings', async () => {
    const connection = { apiKey: 'key', baseUrl: 'https://unknown-fast.example/v1', providerType: 'openai' as const };
    const input = { model: 'unknown-model', profileId: 'profile', systemPrompt: 'rules', userPrompt: 'line' };
    await expect(completeWithAIServiceProfile({ ...input, fastMode: true }, connection)).rejects.toThrow('尚未确认');
    await expect(completeWithAIServiceProfile({ ...input, fastMode: 'true' as never }, connection)).rejects.toThrow('布尔值');
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    await completeWithAIServiceProfile(input, connection);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty('service_tier');
  });
  beforeEach(() => {
    mocks.fetch.mockReset();
  });

  it.each(['xhigh', 'max'] as const)('preserves %s through both actual client request paths', async effort => {
    const connection = { apiKey: 'test-key', baseUrl: 'https://example.test/v1', providerType: 'openai' as const };
    const input = { model: 'gpt-6.1-sol', profileId: 'profile-1', reasoningEffort: effort, systemPrompt: 'system' };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    expect(await completeWithAIServiceProfile({ ...input, userPrompt: 'hello' }, connection)).toBe('ok');
    expect(await streamAIServiceProfile({ ...input, messages: [{ role: 'user', content: 'hello' }] }, vi.fn(), connection)).toBe('ok');
    for (const [, request] of mocks.fetch.mock.calls) {
      expect(JSON.parse(request.body)).toMatchObject({ reasoning_effort: effort, model: input.model });
    }
  });

  it('rejects an invalid output token limit before sending a request', async () => {
    await expect(streamAIServiceProfile({
      maxOutputTokens: 0,
      messages: [{ content: 'summarize', role: 'user' }],
      model: 'gpt-test',
      profileId: 'profile-1',
      reasoningEffort: 'auto',
      systemPrompt: 'system',
    }, vi.fn(), {
      apiKey: 'secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'openai',
    })).rejects.toThrow('AI 输出 token 上限必须是');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('cancels the response before an oversized content delta is emitted', async () => {
    const cancel = vi.fn();
    const event = `data: ${JSON.stringify({
      choices: [{ delta: { content: '123456' } }],
    })}\n\n`;
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode(event));
      },
    }), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      status: 200,
    }));
    const onDelta = vi.fn();

    await expect(streamAIServiceProfile({
      messages: [{ content: 'summarize', role: 'user' }],
      model: 'gpt-test',
      profileId: 'profile-1',
      reasoningEffort: 'auto',
      systemPrompt: 'system',
    }, onDelta, {
      apiKey: 'secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'openai',
    }, new AbortController().signal, {
      maxContentCharacters: 5,
    })).rejects.toThrow('AI 流式响应内容超过安全上限');
    expect(onDelta).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a stream whose pending SSE event never reaches a newline', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(64)));
      },
    }), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      status: 200,
    }));

    await expect(streamAIServiceProfile({
      messages: [{ content: 'summarize', role: 'user' }],
      model: 'gpt-test',
      profileId: 'profile-1',
      reasoningEffort: 'auto',
      systemPrompt: 'system',
    }, vi.fn(), {
      apiKey: 'secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'openai',
    }, new AbortController().signal, {
      maxEventBufferCharacters: 32,
    })).rejects.toThrow('AI 流式响应事件超过安全上限');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('flushes a final SSE event even when the response does not end with a newline', async () => {
    const event = `data: ${JSON.stringify({
      choices: [{ delta: { content: '完成' } }],
    })}`;
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(event.slice(0, 12)));
        controller.enqueue(new TextEncoder().encode(event.slice(12)));
        controller.close();
      },
    }), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      status: 200,
    }));
    const onDelta = vi.fn();

    await expect(streamAIServiceProfile({
      messages: [{ content: 'summarize', role: 'user' }],
      model: 'gpt-test',
      profileId: 'profile-1',
      reasoningEffort: 'auto',
      systemPrompt: 'system',
    }, onDelta, {
      apiKey: 'secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'openai',
    }, new AbortController().signal)).resolves.toBe('完成');
    expect(onDelta).toHaveBeenCalledOnce();
  });
});
