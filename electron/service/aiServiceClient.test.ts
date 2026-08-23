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

import { streamAIServiceProfile } from './aiServiceClient';

describe('AI service client streaming limits', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
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
