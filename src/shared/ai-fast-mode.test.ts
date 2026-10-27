import { describe, expect, it } from 'vitest';
import { normalizeAIServiceFastMode, resolveAIServiceFastTier } from './ai-fast-mode';

describe('Fast capability identity', () => {
  const official = { providerType: 'openai' as const, baseUrl: 'https://api.openai.com/v1' };
  it.each(['https://api.openai.com/v1', 'https://gateway.example/openai/v1', 'http://localhost:8000/v1'])(
    'uses exact bundled OpenAI model capabilities at %s without requiring discovery', baseUrl => {
    const connection = { ...official, baseUrl };
    expect(resolveAIServiceFastTier(connection, 'gpt-6-astra')).toBe('priority');
    expect(resolveAIServiceFastTier(connection, 'gpt-6.1-sol')).toBe('priority');
    for (const model of ['GPT-6.1-SOL', 'gpt-6.1-sol-custom', 'gpt-daybreak-blue-latest', 'unknown']) {
      expect(resolveAIServiceFastTier(connection, model)).toBeUndefined();
    }
  });
  it('lets explicit exact discovery override local tiers while ID-only and unrelated metadata keep the fallback', () => {
    const proxy = { ...official, baseUrl: 'https://proxy.example/v1' };
    expect(resolveAIServiceFastTier(proxy, 'gpt-6.1-sol', { listedModelId: 'gpt-6.1-sol' })).toBe('priority');
    expect(resolveAIServiceFastTier(proxy, 'gpt-6.1-sol', { listedModelId: 'different', serviceTiers: [] })).toBe('priority');
    expect(resolveAIServiceFastTier(proxy, 'gpt-6.1-sol', { listedModelId: 'gpt-6.1-sol', serviceTiers: ['fast'] })).toBe('fast');
    for (const serviceTiers of [[], ['default'], ['flex']]) {
      expect(resolveAIServiceFastTier(proxy, 'gpt-6.1-sol', { listedModelId: 'gpt-6.1-sol', serviceTiers })).toBeUndefined();
    }
  });
  it('requires explicit exact metadata for unknown models and prefers priority when both Fast aliases are declared', () => {
    const proxy = { ...official, baseUrl: 'https://proxy.example/v1' };
    expect(resolveAIServiceFastTier(proxy, 'custom', { listedModelId: 'custom' })).toBeUndefined();
    expect(resolveAIServiceFastTier(proxy, 'custom', { listedModelId: 'custom', serviceTiers: ['fast'] })).toBe('fast');
    expect(resolveAIServiceFastTier(proxy, 'custom', { listedModelId: 'custom', serviceTiers: ['fast', 'priority'] })).toBe('priority');
    expect(resolveAIServiceFastTier(proxy, 'custom', { listedModelId: 'different', serviceTiers: ['priority'] })).toBeUndefined();
  });
  it.each(['local', 'claude', 'deepseek'] as const)('does not infer OpenAI tiers for %s', providerType => {
    const connection = { ...official, providerType };
    expect(resolveAIServiceFastTier(connection, 'gpt-6.1-sol')).toBeUndefined();
    expect(resolveAIServiceFastTier(connection, 'gpt-6.1-sol', { listedModelId: 'gpt-6.1-sol', serviceTiers: ['priority'] })).toBeUndefined();
  });
  it('does not coerce untrusted values into an opt-in', () => {
    expect(normalizeAIServiceFastMode(undefined)).toBeUndefined();
    expect(normalizeAIServiceFastMode(false)).toBe(false);
    for (const value of ['true', 1, null, {}]) expect(() => normalizeAIServiceFastMode(value)).toThrow('布尔值');
  });
});
