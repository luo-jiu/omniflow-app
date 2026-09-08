import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch },
}));

import {
  AgentProviderError,
  isAgentProviderContextWindowExceeded,
  streamAgentProviderTurn,
} from './agent-provider-client';

const providerTurnInput = {
  maxOutputTokens: 512,
  messages: [{ content: '检查媒体', role: 'user' as const }],
  model: 'gpt-test',
  systemPrompt: 'system',
  tools: [],
};

function splitUtf8Inside(text: string, target: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const targetBytes = new TextEncoder().encode(target);
  const targetStart = bytes.findIndex((value, index) => (
    value === targetBytes[0]
    && targetBytes.every((targetValue, offset) => bytes[index + offset] === targetValue)
  ));
  if (targetStart < 0 || targetBytes.length < 2) throw new Error('测试文本中缺少目标字符');
  const splitAt = targetStart + 1;
  return [bytes.slice(0, splitAt), bytes.slice(splitAt)];
}

describe('Agent provider client', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
  });

  it('preserves Chinese text when UTF-8 code points cross response chunks', async () => {
    const event = `data: ${JSON.stringify({
      choices: [{ delta: { content: '编码档次：LC' } }],
    })}\n\ndata: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { completion_tokens: 8, prompt_tokens: 32, total_tokens: 40 },
    })}\n\n`;
    const chunks = splitUtf8Inside(event, '档');
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(chunk));
        controller.close();
      },
    }), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      status: 200,
    }));
    const deltas: string[] = [];

    const result = await streamAgentProviderTurn({
      apiKey: 'secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'openai',
    }, {
      maxOutputTokens: 768,
      messages: [{ content: '检查媒体', role: 'user' }],
      model: 'gpt-test',
      systemPrompt: 'system',
      tools: [],
    }, delta => deltas.push(delta), new AbortController().signal);

    expect(deltas.join('')).toBe('编码档次：LC');
    expect(result.content).toBe('编码档次：LC');
    expect(result.usage).toEqual({
      inputTokens: 32,
      outputTokens: 8,
      totalTokens: 40,
    });
    expect(JSON.parse(String(mocks.fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      max_completion_tokens: 768,
      stream_options: { include_usage: true },
    });
  });

  it.each([undefined, 'length', 'content_filter'])('rejects incomplete or abnormal completion: %s', async reason => {
    const event = `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial answer' }, finish_reason: reason }] })}\n\n`;
    mocks.fetch.mockResolvedValueOnce(new Response(event, { status: 200 }));
    await expect(streamAgentProviderTurn({ apiKey: '', baseUrl: 'https://example.com', providerType: 'openai' },
      providerTurnInput, vi.fn(), new AbortController().signal, undefined, { retryDelayMs: 0 }))
      .rejects.toBeInstanceOf(AgentProviderError);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('requires Claude message_stop and rejects token-limited Claude completion', async () => {
    const stream = (reason: string, completed: boolean) => [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } },
      { type: 'message_delta', delta: { stop_reason: reason } },
      ...(completed ? [{ type: 'message_stop' }] : []),
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    const profile = { apiKey: '', baseUrl: 'https://example.com', providerType: 'claude' as const };
    mocks.fetch.mockResolvedValueOnce(new Response(stream('end_turn', true)));
    await expect(streamAgentProviderTurn(profile, providerTurnInput, vi.fn(), new AbortController().signal)).resolves.toMatchObject({ content: 'answer' });
    for (const [reason, completed] of [['end_turn', false], ['max_tokens', true]] as const) {
      mocks.fetch.mockResolvedValueOnce(new Response(stream(reason, completed)));
      await expect(streamAgentProviderTurn(profile, providerTurnInput, vi.fn(), new AbortController().signal)).rejects.toBeInstanceOf(AgentProviderError);
    }
  });

  it('retries transient HTTP errors before text but never replays displayed text', async () => {
    const profile = { apiKey: '', baseUrl: 'https://example.com', providerType: 'openai' as const };
    const success = `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`;
    mocks.fetch.mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(success));
    await expect(streamAgentProviderTurn(profile, providerTurnInput, vi.fn(), new AbortController().signal, undefined, { retryDelayMs: 0 }))
      .resolves.toMatchObject({ content: 'ok' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds idle waits and permits cancellation during retry backoff', async () => {
    const profile = { apiKey: '', baseUrl: 'https://example.com', providerType: 'openai' as const };
    mocks.fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(streamAgentProviderTurn(profile, providerTurnInput, vi.fn(), new AbortController().signal, undefined, { idleTimeoutMs: 10, maxRetries: 0 }))
      .rejects.toMatchObject({ code: 'request_timeout' });
    const controller = new AbortController();
    mocks.fetch.mockResolvedValueOnce(new Response('busy', { status: 503 }));
    const pending = streamAgentProviderTurn(profile, providerTurnInput, vi.fn(), controller.signal, undefined, { retryDelayMs: 1_000 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    await assertion;
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('cancels a stream whose pending SSE event exceeds the configured limit', async () => {
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

    await expect(streamAgentProviderTurn({
      apiKey: 'secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'openai',
    }, {
      maxOutputTokens: 512,
      messages: [{ content: '检查媒体', role: 'user' }],
      model: 'gpt-test',
      systemPrompt: 'system',
      tools: [],
    }, vi.fn(), new AbortController().signal, {
      maxEventBufferCharacters: 32,
    })).rejects.toThrow('Agent Provider 流式事件超过安全上限');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('preserves a structured OpenAI context-window error from an HTTP response', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: 'context_length_exceeded',
        message: 'Your input exceeds the context window of this model.',
        type: 'invalid_request_error',
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    }));

    const error = await streamAgentProviderTurn({
      apiKey: 'secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'openai',
    }, providerTurnInput, vi.fn(), new AbortController().signal).catch(value => value);

    expect(error).toBeInstanceOf(AgentProviderError);
    expect(error).toMatchObject({
      code: 'context_length_exceeded',
      kind: 'context_window_exceeded',
      message: 'Your input exceeds the context window of this model.',
      status: 400,
      type: 'invalid_request_error',
    });
    expect(isAgentProviderContextWindowExceeded(error)).toBe(true);
  });

  it('preserves and classifies an OpenAI context-window error from an SSE event', async () => {
    const event = `data: ${JSON.stringify({
      error: {
        code: 'context_length_exceeded',
        message: 'Maximum context length exceeded.',
        type: 'invalid_request_error',
      },
    })}\n\n`;
    mocks.fetch.mockResolvedValueOnce(new Response(event, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      status: 200,
    }));

    const error = await streamAgentProviderTurn({
      apiKey: 'secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'deepseek',
    }, providerTurnInput, vi.fn(), new AbortController().signal).catch(value => value);

    expect(error).toMatchObject({
      code: 'context_length_exceeded',
      kind: 'context_window_exceeded',
      status: 200,
      type: 'invalid_request_error',
    });
    expect(isAgentProviderContextWindowExceeded(error)).toBe(true);
  });

  it('classifies Claude prompt-too-long errors only for invalid_request_error', async () => {
    const event = `data: ${JSON.stringify({
      error: {
        message: 'prompt is too long: 210000 tokens > 200000 maximum',
        type: 'invalid_request_error',
      },
      type: 'error',
    })}\n\n`;
    mocks.fetch.mockResolvedValueOnce(new Response(event, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      status: 200,
    }));

    const error = await streamAgentProviderTurn({
      apiKey: 'secret',
      baseUrl: 'https://api.anthropic.com/v1',
      providerType: 'claude',
    }, providerTurnInput, vi.fn(), new AbortController().signal).catch(value => value);

    expect(error).toMatchObject({
      kind: 'context_window_exceeded',
      message: 'prompt is too long: 210000 tokens > 200000 maximum',
      status: 200,
      type: 'invalid_request_error',
    });
    expect(isAgentProviderContextWindowExceeded(error)).toBe(true);
  });

  it('does not misclassify authentication or ordinary Claude validation errors', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 'invalid_api_key',
          message: 'Incorrect API key provided.',
          type: 'invalid_request_error',
        },
      }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: 'temperature must be between 0 and 1',
          type: 'invalid_request_error',
        },
        type: 'error',
      }), { status: 400 }));

    const authenticationError = await streamAgentProviderTurn({
      apiKey: 'bad-secret',
      baseUrl: 'https://api.example/v1',
      providerType: 'openai',
    }, providerTurnInput, vi.fn(), new AbortController().signal).catch(value => value);
    const validationError = await streamAgentProviderTurn({
      apiKey: 'secret',
      baseUrl: 'https://api.anthropic.com/v1',
      providerType: 'claude',
    }, providerTurnInput, vi.fn(), new AbortController().signal).catch(value => value);

    expect(authenticationError).toMatchObject({
      code: 'invalid_api_key',
      kind: 'provider_error',
      status: 401,
      type: 'invalid_request_error',
    });
    expect(validationError).toMatchObject({
      kind: 'provider_error',
      status: 400,
      type: 'invalid_request_error',
    });
    expect(isAgentProviderContextWindowExceeded(authenticationError)).toBe(false);
    expect(isAgentProviderContextWindowExceeded(validationError)).toBe(false);
  });
});
