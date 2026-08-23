import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch },
}));

import { streamAgentProviderTurn } from './agent-provider-client';

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
    expect(JSON.parse(String(mocks.fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      max_completion_tokens: 768,
    });
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
});
