import { describe, expect, it } from 'vitest';
import catalog from './ai-model-catalog.json';
import { findBundledAIModelCatalogEntry, getAIServiceModelReasoningEfforts, normalizeAIServiceReasoningEffort,
  resolveAIServiceModelReasoningEffort } from './ai-model-catalog';

describe('bundled model reasoning choices', () => {
  it('keeps the audited Fast tiers in the same versioned model catalog', () => {
    expect(catalog.source.commit).toBe('d6817454d76885e9d0e118bbf82e507aed6f715a');
    expect(catalog.models.filter(entry => entry.service_tiers.includes('priority')).map(entry => entry.slug)).toEqual([
      'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna',
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'codex-auto-review',
    ]);
    expect(findBundledAIModelCatalogEntry('openai', 'gpt-daybreak-blue-latest')?.service_tiers).toEqual([]);
    expect(findBundledAIModelCatalogEntry('openai', 'gpt-daybreak-red-latest')?.service_tiers).toEqual([]);
  });
  it.each(catalog.models)('offers the supported local choices for exact OpenAI $slug without ultra', entry => {
    expect(getAIServiceModelReasoningEfforts('openai', entry.slug)).toEqual(['auto', ...entry.supported_reasoning_levels]);
    expect(getAIServiceModelReasoningEfforts('openai', entry.slug)).not.toContain('ultra');
    expect(getAIServiceModelReasoningEfforts('openai', entry.slug)).toContain('xhigh');
    expect(getAIServiceModelReasoningEfforts('openai', entry.slug).includes('max')).toBe(entry.slug !== 'gpt-5.5');
  });
  it.each(['GPT-6.1-SOL', 'gpt-6.1-sol-2026-10-23', 'gpt-6.1-sol-custom', 'unknown'])(
    'keeps the original fallback choices for %s', model => {
      expect(getAIServiceModelReasoningEfforts('openai', model)).toEqual(['auto', 'low', 'medium', 'high']);
      expect(findBundledAIModelCatalogEntry('openai', model)).toBeUndefined();
    },
  );
  it.each(['local', 'claude', 'deepseek'] as const)('does not infer OpenAI effort choices for %s', provider => {
    expect(getAIServiceModelReasoningEfforts(provider, 'gpt-6.1-sol')).toEqual(['auto', 'low', 'medium', 'high']);
  });
  it('preserves auto as an unspecified Provider default and rejects unsupported or unimplemented effort', () => {
    expect(resolveAIServiceModelReasoningEffort('openai', 'gpt-6.1-sol', 'auto')).toBe('auto');
    expect(resolveAIServiceModelReasoningEffort('openai', 'gpt-5.5', 'max')).toBe('auto');
    expect(normalizeAIServiceReasoningEffort('xhigh')).toBe('xhigh');
    expect(normalizeAIServiceReasoningEffort('max')).toBe('max');
    for (const effort of ['ultra', 'none', 'minimal', 'HIGH', undefined, {}]) {
      expect(normalizeAIServiceReasoningEffort(effort)).toBe('auto');
    }
  });
});
