import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiServiceModelDiscoveryCache, parseAIServiceModelMetadata } from './aiServiceModelDiscoveryCache';
import { createFrozenAIServiceRequestTierResolver, resolveAIServiceRequestTier } from './aiServiceFastMode';
import { createAIServiceRunSessionRegistry } from './aiServiceRunSession';
import { buildAIServiceCompletionRequest } from './aiServiceClientModel';

afterEach(() => vi.useRealTimers());

describe('main Fast capability resolution', () => {
  it('uses bundled tiers with absent or ID-only discovery and expires explicit remote overrides', () => {
    vi.useFakeTimers();
    const connection = { providerType: 'openai' as const, apiKey: 'bundled-key', baseUrl: 'https://bundled-fast.example/v1' };
    const model = 'gpt-6-astra';
    expect(resolveAIServiceRequestTier(connection, model, true)).toBe('priority');
    expect(resolveAIServiceRequestTier(connection, model, false)).toBe('default');
    expect(resolveAIServiceRequestTier(connection, model, undefined)).toBeUndefined();
    for (const item of [{ id: model }, { id: model, service_tiers: ['priority', {}] }]) {
      aiServiceModelDiscoveryCache.publish(aiServiceModelDiscoveryCache.begin(connection), { data: [item] });
      expect(resolveAIServiceRequestTier(connection, model, true)).toBe('priority');
    }
    aiServiceModelDiscoveryCache.publish(aiServiceModelDiscoveryCache.begin(connection), { data: [{ id: model, service_tiers: ['fast'] }] });
    expect(resolveAIServiceRequestTier(connection, model, true)).toBe('fast');
    for (const service_tiers of [[], ['default']]) {
      aiServiceModelDiscoveryCache.publish(aiServiceModelDiscoveryCache.begin(connection), { data: [{ id: model, service_tiers }] });
      expect(() => resolveAIServiceRequestTier(connection, model, true)).toThrow('尚未确认');
    }
    const frozenDenied = createFrozenAIServiceRequestTierResolver(connection);
    vi.advanceTimersByTime(300_001);
    expect(resolveAIServiceRequestTier(connection, model, true)).toBe('priority');
    expect(() => frozenDenied(model, true)).toThrow('尚未确认');
  });
  it('keeps a bundled batch tier frozen when later discovery explicitly disables Fast', () => {
    const connection = { providerType: 'openai' as const, apiKey: 'bundled-freeze-key', baseUrl: 'https://bundled-freeze.example/v1' };
    const frozen = createFrozenAIServiceRequestTierResolver(connection);
    aiServiceModelDiscoveryCache.publish(aiServiceModelDiscoveryCache.begin(connection),
      { data: [{ id: 'gpt-6-astra', service_tiers: [] }] });
    expect(() => resolveAIServiceRequestTier(connection, 'gpt-6-astra', true)).toThrow('尚未确认');
    expect(frozen('gpt-6-astra', true)).toBe('priority');
    expect(frozen('gpt-6-astra', false)).toBe('default');
  });
  it('accepts only validated service-tier arrays', () => {
    const metadata = parseAIServiceModelMetadata({ data: [
      { id: 'valid', service_tiers: [{ id: 'priority', name: 'Fast' }] },
      { id: 'alias', service_tiers: ['fast'] },
      { id: 'wrong', service_tiers: [{ name: 'Fast' }] },
      { id: 'long', service_tiers: Array(17).fill('priority') },
      { id: 'injected', service_tiers: ['priority', {}] },
    ] });
    expect(metadata.get('valid')?.serviceTiers).toEqual(['priority']);
    expect(metadata.get('alias')?.serviceTiers).toEqual(['fast']);
    for (const model of ['wrong', 'long', 'injected']) expect(metadata.get(model)).not.toHaveProperty('serviceTiers');
  });
  it('isolates credentials, expires proxy support and freezes a batch capability at its existing Run owner', () => {
    vi.useFakeTimers();
    const connection = { providerType: 'openai' as const, apiKey: 'fast-isolation-key', baseUrl: 'https://fast-test.example/v1' };
    aiServiceModelDiscoveryCache.publish(aiServiceModelDiscoveryCache.begin(connection), { data: [{ id: 'custom', service_tiers: ['fast'] }] });
    expect(resolveAIServiceRequestTier(connection, 'custom', true)).toBe('fast');
    expect(resolveAIServiceRequestTier(connection, 'custom', false)).toBe('default');
    expect(() => resolveAIServiceRequestTier({ ...connection, apiKey: 'other' }, 'custom', true)).toThrow('尚未确认');
    const registry = createAIServiceRunSessionRegistry();
    const run = registry.begin({ connection, ownerWebContentsId: 7, profileId: 'profile' });
    vi.advanceTimersByTime(300_001);
    expect(() => resolveAIServiceRequestTier(connection, 'custom', true)).toThrow('尚未确认');
    const request = registry.acquireRequest(run.id, 'profile', 7);
    const body = JSON.parse(buildAIServiceCompletionRequest(request.connection,
      { model: 'custom', profileId: 'profile', fastMode: true, systemPrompt: 'rules', userPrompt: 'line' },
      { serviceTier: request.resolveRequestTier('custom', true) }).body!);
    expect(body.service_tier).toBe('fast');
    registry.end(run.id, 7);
    expect(request.signal.aborted).toBe(true);
  });
  it('never lets late metadata enlarge an already started batch', () => {
    const connection = { providerType: 'openai' as const, apiKey: 'frozen-key', baseUrl: 'https://late-fast-test.example/v1' };
    const frozen = createFrozenAIServiceRequestTierResolver(connection);
    aiServiceModelDiscoveryCache.publish(aiServiceModelDiscoveryCache.begin(connection), { data: [{ id: 'custom', service_tiers: ['priority'] }] });
    expect(() => frozen('custom', true)).toThrow('尚未确认');
    expect(resolveAIServiceRequestTier(connection, 'custom', true)).toBe('priority');
  });
});
