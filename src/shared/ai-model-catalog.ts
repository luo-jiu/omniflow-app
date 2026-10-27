import catalog from './ai-model-catalog.json';
import type { AIServiceProviderType } from './ai-service-provider-types';

export const AI_SERVICE_EXPLICIT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AIServiceExplicitReasoningEffort = typeof AI_SERVICE_EXPLICIT_REASONING_EFFORTS[number];
export type AIServiceReasoningEffort = 'auto' | AIServiceExplicitReasoningEffort;

const fallbackEfforts: readonly AIServiceReasoningEffort[] = Object.freeze(['auto', 'low', 'medium', 'high']);
const modelEfforts = new Map(catalog.models.map(entry => [entry.slug, Object.freeze([
  'auto' as const,
  ...AI_SERVICE_EXPLICIT_REASONING_EFFORTS.filter(effort => entry.supported_reasoning_levels.includes(effort)),
])]));

export function isAIServiceReasoningEffort(value: unknown): value is AIServiceReasoningEffort {
  return value === 'auto' || AI_SERVICE_EXPLICIT_REASONING_EFFORTS.some(effort => effort === value);
}

export function normalizeAIServiceReasoningEffort(value: unknown): AIServiceReasoningEffort {
  return isAIServiceReasoningEffort(value) ? value : 'auto';
}

/** Bundled model facts apply to exact OpenAI IDs, including configured compatible endpoints. */
export function findBundledAIModelCatalogEntry(providerType: AIServiceProviderType, model: string) {
  return providerType === 'openai' ? catalog.models.find(entry => entry.slug === model.trim()) : undefined;
}

/** Static display/parameter choices; this does not establish endpoint availability or window identity. */
export function getAIServiceModelReasoningEfforts(providerType: AIServiceProviderType, model: string): readonly AIServiceReasoningEffort[] {
  const entry = findBundledAIModelCatalogEntry(providerType, model);
  return entry ? modelEfforts.get(entry.slug)! : fallbackEfforts;
}

export function resolveAIServiceModelReasoningEffort(providerType: AIServiceProviderType, model: string, value: unknown): AIServiceReasoningEffort {
  const effort = normalizeAIServiceReasoningEffort(value);
  return getAIServiceModelReasoningEfforts(providerType, model).includes(effort) ? effort : 'auto';
}
