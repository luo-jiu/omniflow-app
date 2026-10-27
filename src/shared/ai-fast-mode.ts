import type { AIServiceProviderType } from './ai-service-provider-types';
import { findBundledAIModelCatalogEntry } from './ai-model-catalog';

export type AIServiceFastTier = 'priority' | 'fast';
export type AIServiceRequestTier = AIServiceFastTier | 'default';

export interface AIServiceModelCapabilities {
  profileId: string;
  profileUpdatedAt: string;
  model: string;
  fastMode: boolean;
}

export interface AIServiceFastModeMetadata {
  listedModelId?: string;
  serviceTiers?: readonly string[];
}

export function normalizeAIServiceFastMode(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error('Fast 模式必须是布尔值');
  return value;
}

export function resolveAIServiceFastTier(
  connection: { providerType: AIServiceProviderType; baseUrl: string },
  model: string,
  metadata?: AIServiceFastModeMetadata,
): AIServiceFastTier | undefined {
  if (connection.providerType !== 'openai') return undefined;
  const modelId = model.trim();
  // A valid explicit discovery overrides the bundled request capability, including
  // an empty list. ID-only discovery keeps the exact model's local fallback.
  const tiers = metadata?.listedModelId === modelId && metadata.serviceTiers !== undefined
    ? metadata.serviceTiers : findBundledAIModelCatalogEntry(connection.providerType, modelId)?.service_tiers;
  return tiers?.includes('priority') ? 'priority' : tiers?.includes('fast') ? 'fast' : undefined;
}
