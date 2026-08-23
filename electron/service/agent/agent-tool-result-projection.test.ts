import { describe, expect, it } from 'vitest';

import { estimateAgentTextTokens } from './agent-context-projection';
import {
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS,
  projectAgentToolResultForProvider,
} from './agent-tool-result-projection';

describe('Agent Tool result provider projection', () => {
  it('keeps a complete structured result when it fits', () => {
    const projection = projectAgentToolResultForProvider({
      data: { entryCount: 1, entries: [{ id: 8, name: 'movie.mp4' }] },
      message: '目录读取完成',
      ok: true,
    }, 1_000);

    expect(projection.truncated).toBe(false);
    expect(JSON.parse(projection.content)).toEqual({
      data: { entryCount: 1, entries: [{ id: 8, name: 'movie.mp4' }] },
      message: '目录读取完成',
      ok: true,
    });
  });

  it('bounds nested data while preserving status and an explicit truncation marker', () => {
    const projection = projectAgentToolResultForProvider({
      data: {
        entries: Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          name: `very-long-file-${index}-${'x'.repeat(500)}`,
        })),
        entryCount: 100,
      },
      message: '读取完成',
      ok: true,
    }, 300);
    const payload = JSON.parse(projection.content);

    expect(projection.truncated).toBe(true);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(300);
    expect(estimateAgentTextTokens(projection.content)).toBeLessThanOrEqual(300);
    expect(payload.ok).toBe(true);
    expect(payload._omniflowProjection).toMatchObject({
      reason: 'provider_context_budget',
      truncated: true,
      version: 1,
    });
  });

  it('redacts nested credentials and signed URLs only in the provider projection', () => {
    const result = {
      data: {
        apiKey: 'sk-provider-secret-value',
        nested: {
          authorization: 'Bearer abcdefghijklmnop',
          sourceUrl: 'https://storage.example/file.mp4?X-Amz-Credential=user&X-Amz-Signature=signed-secret',
        },
        safe: 'visible',
      },
      message: '读取完成',
      ok: true,
    };

    const projection = projectAgentToolResultForProvider(result, 1_000);

    expect(projection.truncated).toBe(false);
    expect(projection.content).toContain('[REDACTED]');
    expect(projection.content).toContain('[SIGNED_QUERY_REDACTED]');
    expect(projection.content).toContain('visible');
    expect(projection.content).not.toContain('sk-provider-secret-value');
    expect(projection.content).not.toContain('abcdefghijklmnop');
    expect(projection.content).not.toContain('signed-secret');
    expect(result.data.apiKey).toBe('sk-provider-secret-value');
    expect(result.data.nested.authorization).toBe('Bearer abcdefghijklmnop');
  });

  it('exports the conservative minimum legal Tool result projection', () => {
    expect(estimateAgentTextTokens(MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT))
      .toBe(MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS);
    expect(() => projectAgentToolResultForProvider({
      data: { value: 'x'.repeat(10_000) },
      ok: true,
    }, MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS)).not.toThrow();
  });

  it('fails explicitly when even the minimal structured marker cannot fit', () => {
    expect(() => projectAgentToolResultForProvider({ ok: true }, 2))
      .toThrow('没有足够的模型上下文预算');
  });
});
