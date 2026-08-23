import { describe, expect, it, vi } from 'vitest';

import { readBoundedAIServiceResponseText } from './aiServiceStreamLimits';

describe('AI service HTTP body limits', () => {
  it('cancels a declared oversized HTTP body before reading it', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode('not-read'));
      },
    }), {
      headers: { 'Content-Length': '1024' },
    });

    await expect(readBoundedAIServiceResponseText(response, 64, 'AI 错误响应'))
      .rejects.toThrow('AI 错误响应超过安全上限');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels an HTTP body as soon as streamed bytes exceed the limit', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode('1234'));
        controller.enqueue(new TextEncoder().encode('5678'));
      },
    }));

    await expect(readBoundedAIServiceResponseText(response, 6, 'AI 错误响应'))
      .rejects.toThrow('AI 错误响应超过安全上限');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
