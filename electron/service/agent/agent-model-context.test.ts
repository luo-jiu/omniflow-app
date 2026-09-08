import { describe, expect, it } from 'vitest';
import { resolveAgentContextBudget } from './agent-context-projection';
import { parseAgentModelMetadata, resolveAgentModelContextBudget } from './agent-model-context';

describe('resolveAgentModelContextBudget', () => {
  it('uses the known gpt-5.6-sol limits through the official endpoint', () => {
    expect(resolveAgentModelContextBudget({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      providerType: 'openai',
    })).toEqual({
      contextWindowTokens: 272_000,
      effectiveContextWindowPercent: 95,
      outputReserveTokens: 16_000,
      maxContextWindowTokens: 872_000,
      source: 'catalog',
    });
  });

  it.each([
    'https://proxy.example.com/v1',
    'https://proxy.example.com/openai/v1/',
    'http://127.0.0.1:8080/v1',
  ])('keeps the known gpt-5.6-sol limits through %s', (baseUrl) => {
    expect(resolveAgentModelContextBudget({
      baseUrl,
      model: 'gpt-5.6-sol',
      providerType: 'openai',
    })).toEqual({
      contextWindowTokens: 272_000,
      effectiveContextWindowPercent: 95,
      outputReserveTokens: 16_000,
      maxContextWindowTokens: 872_000,
      source: 'catalog',
    });
  });

  it('normalizes harmless model id casing and surrounding whitespace', () => {
    expect(resolveAgentModelContextBudget({
      baseUrl: '  HTTPS://API.OPENAI.COM/v1///  ',
      model: '  GPT-5.6-SOL  ',
      providerType: 'openai',
    })).toEqual({
      contextWindowTokens: 272_000,
      effectiveContextWindowPercent: 95,
      outputReserveTokens: 16_000,
      maxContextWindowTokens: 872_000,
      source: 'catalog',
    });
  });

  it.each([
    {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      providerType: 'local' as const,
    },
    {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol-preview',
      providerType: 'openai' as const,
    },
    {
      baseUrl: 'https://api.openai.com/v1',
      model: 'unknown-model',
      providerType: 'openai' as const,
    },
    {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      providerType: 'claude' as const,
    },
    {
      baseUrl: 'https://user:password@api.openai.com/v1',
      model: 'gpt-5.6-sol',
      providerType: 'openai' as const,
    },
    {
      baseUrl: 'https://api.openai.com/v1?route=proxy',
      model: 'gpt-5.6-sol',
      providerType: 'openai' as const,
    },
    {
      baseUrl: 'https://api.openai.com/v1#fragment',
      model: 'gpt-5.6-sol',
      providerType: 'openai' as const,
    },
    {
      baseUrl: 'not-a-url',
      model: 'gpt-5.6-sol',
      providerType: 'openai' as const,
    },
  ])('keeps $providerType/$model at $baseUrl on the conservative fallback', (input) => {
    const fallback = resolveAgentContextBudget(undefined);

    expect(resolveAgentModelContextBudget(input)).toEqual({
      contextWindowTokens: fallback.contextWindowTokens,
      effectiveContextWindowPercent: 95,
      outputReserveTokens: fallback.outputReserveTokens,
      source: 'fallback',
    });
  });

  it.each(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4-2026-03-05'])(
    'resolves catalog metadata for %s rather than privileging one model', model => {
      expect(resolveAgentModelContextBudget({ baseUrl: 'https://proxy.example/v1', model, providerType: 'openai' }))
        .toMatchObject({ contextWindowTokens: 272_000, source: 'catalog' });
    },
  );

  it('uses provider metadata for arbitrary models and clamps explicit overrides to the advertised maximum', () => {
    const metadata = parseAgentModelMetadata({ data: [{
      id: 'private-model', context_window: 128_000, max_context_window: 256_000, max_output_tokens: 8_192,
    }] }).get('private-model');
    expect(resolveAgentModelContextBudget({
      baseUrl: 'http://localhost:8080/v1', model: 'private-model', providerType: 'local', metadata,
      override: { contextWindowTokens: 1_000_000, outputReserveTokens: 16_000 },
    })).toEqual({
      contextWindowTokens: 256_000, maxContextWindowTokens: 256_000,
      outputReserveTokens: 8_192, effectiveContextWindowPercent: 95, source: 'provider',
    });
  });

  it('allows configuring unknown model budgets and reducing catalog budgets', () => {
    const input = { baseUrl: 'https://proxy.example/v1', model: 'custom', providerType: 'openai' as const };
    expect(resolveAgentModelContextBudget({ ...input, override: { contextWindowTokens: 200_000, outputReserveTokens: 8_000 } }))
      .toMatchObject({ contextWindowTokens: 200_000, outputReserveTokens: 8_000, source: 'fallback' });
    expect(resolveAgentModelContextBudget({ ...input, model: 'gpt-5.4', override: { contextWindowTokens: 32_000 } }))
      .toMatchObject({ contextWindowTokens: 32_000 });
  });

  it('ignores invalid metadata and rejects invalid user overrides', () => {
    expect(parseAgentModelMetadata({ data: [{ id: 'a', context_window: -1 }, { id: 'b', context_length: '200000' }] }).size).toBe(0);
    for (const override of [{ contextWindowTokens: -1 }, { contextWindowTokens: Infinity }, { outputReserveTokens: 1_000_000 }]) {
      expect(() => resolveAgentModelContextBudget({ baseUrl: 'https://example.com', model: 'a', providerType: 'openai', override })).toThrow();
    }
  });
});
