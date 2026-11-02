import { describe, expect, it } from 'vitest';
import { resolveAgentContextBudget } from './agent-context-projection';
import { parseAgentModelMetadata, resolveAgentModelContextBudget } from './agent-model-context';
import codexModelWindows from '../../../src/shared/ai-model-catalog.json';

const listed = (model: string) => parseAgentModelMetadata({ data: [{ id: model }] }).get(model);

describe('resolveAgentModelContextBudget', () => {
  it('uses the synchronized Codex client default for gpt-6.1-sol, not its configurable maximum', () => {
    const model = 'gpt-6.1-sol';
    expect(resolveAgentModelContextBudget({ baseUrl: 'https://proxy.example/v1', model, providerType: 'openai', metadata: listed(model) }))
      .toMatchObject({ contextWindowTokens: 272_000, maxContextWindowTokens: 872_000, source: 'catalog' });
  });
  it.each(['gpt-6.1-sol-2026-10-23', 'gpt-6.1-sol-custom', 'GPT-6.1-SOL', 'gpt-5.4', 'gpt-6'])(
    'does not infer a snapshot window from the listed alias %s', model => {
      expect(resolveAgentModelContextBudget({ baseUrl: 'https://proxy.example/v1', model, providerType: 'openai', metadata: listed(model) }))
        .toMatchObject({ contextWindowTokens: 128_000, source: 'fallback' });
    },
  );
  it('requires the current connection to list the exact selected model before applying the snapshot', () => {
    const input = { baseUrl: 'https://proxy.example/v1', model: 'gpt-6.1-sol', providerType: 'openai' as const };
    for (const metadata of [undefined, {}, listed('gpt-5.5')]) {
      expect(resolveAgentModelContextBudget({ ...input, metadata }))
        .toMatchObject({ contextWindowTokens: 128_000, source: 'fallback' });
    }
    expect(resolveAgentModelContextBudget({ ...input, metadata: listed(input.model) }).source).toBe('catalog');
  });
  it('uses the known gpt-5.6-sol limits through the official endpoint', () => {
    expect(resolveAgentModelContextBudget({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      providerType: 'openai',
      metadata: listed('gpt-5.6-sol'),
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
      metadata: listed('gpt-5.6-sol'),
    })).toEqual({
      contextWindowTokens: 272_000,
      effectiveContextWindowPercent: 95,
      outputReserveTokens: 16_000,
      maxContextWindowTokens: 872_000,
      source: 'catalog',
    });
  });

  it('normalizes surrounding whitespace while matching model IDs case-sensitively', () => {
    expect(resolveAgentModelContextBudget({
      baseUrl: '  HTTPS://API.OPENAI.COM/v1///  ',
      model: '  gpt-5.6-sol  ',
      providerType: 'openai',
      metadata: listed('gpt-5.6-sol'),
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

    expect(resolveAgentModelContextBudget({ ...input, metadata: listed(input.model) })).toEqual({
      contextWindowTokens: fallback.contextWindowTokens,
      effectiveContextWindowPercent: 95,
      outputReserveTokens: fallback.outputReserveTokens,
      source: 'fallback',
    });
  });

  it.each(codexModelWindows.models)(
    'uses the copied default and maximum for exactly listed $slug', entry => {
      expect(resolveAgentModelContextBudget({ baseUrl: 'https://proxy.example/v1', model: entry.slug,
        providerType: 'openai', metadata: listed(entry.slug) }))
        .toMatchObject({ contextWindowTokens: entry.context_window, maxContextWindowTokens: entry.max_context_window, source: 'catalog' });
    },
  );
  it('ships only window identity, supported reasoning levels and service tiers from the recorded Codex source', () => {
    expect(codexModelWindows.source).toEqual({ repository: 'openai/codex', commit: 'd6817454d76885e9d0e118bbf82e507aed6f715a',
      path: 'codex-rs/models-manager/models.json' });
    expect(codexModelWindows.models).toHaveLength(11);
    expect(new Set(codexModelWindows.models.map(entry => entry.slug)).size).toBe(11);
    for (const entry of codexModelWindows.models) expect(Object.keys(entry).sort()).toEqual(['context_window', 'max_context_window', 'service_tiers', 'slug', 'supported_reasoning_levels']);
  });

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

  it('does not let a gateway 16K listing shrink a known gpt-5.5 window', () => {
    const metadata = parseAgentModelMetadata({ data: [{ id: 'gpt-5.5', context_window: 16_384, max_context_window: 16_384 }] }).get('gpt-5.5');
    expect(resolveAgentModelContextBudget({ baseUrl: 'https://proxy.example/v1', model: 'gpt-5.5', providerType: 'openai', metadata }))
      .toMatchObject({ contextWindowTokens: 272_000, source: 'catalog' });
  });
  it('keeps the snapshot maximum even when an endpoint advertises a larger configurable window', () => {
    const metadata = parseAgentModelMetadata({ data: [{ id: 'gpt-6.1-sol', max_context_window: 2_000_000 }] }).get('gpt-6.1-sol');
    expect(resolveAgentModelContextBudget({ baseUrl: 'https://proxy.example/v1', model: 'gpt-6.1-sol', providerType: 'openai', metadata,
      override: { contextWindowTokens: 2_000_000 } }))
      .toMatchObject({ contextWindowTokens: 872_000, maxContextWindowTokens: 872_000, source: 'catalog' });
  });
  it('preserves non-GPT provider metadata even when the listed name matches the Codex snapshot', () => {
    const metadata = parseAgentModelMetadata({ data: [{ id: 'gpt-6.1-sol', context_window: 32_000 }] }).get('gpt-6.1-sol');
    for (const providerType of ['local', 'claude'] as const) {
      expect(resolveAgentModelContextBudget({ baseUrl: 'https://proxy.example/v1', model: 'gpt-6.1-sol', providerType, metadata }))
        .toMatchObject({ contextWindowTokens: 32_000, source: 'provider' });
    }
  });

  it('allows configuring unknown model budgets and reducing catalog budgets', () => {
    const input = { baseUrl: 'https://proxy.example/v1', model: 'custom', providerType: 'openai' as const };
    expect(resolveAgentModelContextBudget({ ...input, override: { contextWindowTokens: 200_000, outputReserveTokens: 8_000 } }))
      .toMatchObject({ contextWindowTokens: 200_000, outputReserveTokens: 8_000, source: 'fallback' });
    expect(resolveAgentModelContextBudget({ ...input, model: 'gpt-5.5', metadata: listed('gpt-5.5'), override: { contextWindowTokens: 32_000 } }))
      .toMatchObject({ contextWindowTokens: 32_000 });
  });

  it('uses a 128K fallback for an unknown model instead of the obsolete 16K fallback', () => {
    expect(resolveAgentModelContextBudget({ baseUrl: 'https://proxy.example/v1', model: 'unknown-model', providerType: 'openai' }))
      .toMatchObject({ contextWindowTokens: 128_000, outputReserveTokens: 4_096, source: 'fallback' });
  });

  it('ignores invalid metadata and rejects invalid user overrides', () => {
    const metadata = parseAgentModelMetadata({ data: [{ id: 'a', context_window: -1 }, { id: 'b', context_length: '200000' }] });
    expect([...metadata.values()]).toEqual([{ listedModelId: 'a' }, { listedModelId: 'b' }]);
    for (const override of [{ contextWindowTokens: -1 }, { contextWindowTokens: Infinity }, { outputReserveTokens: 1_000_000 }]) {
      expect(() => resolveAgentModelContextBudget({ baseUrl: 'https://example.com', model: 'a', providerType: 'openai', override })).toThrow();
    }
  });
});
