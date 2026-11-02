import type { AIServiceModelMetadata as AgentModelMetadata } from '../aiServiceModelDiscoveryCache';
import type { AIServiceProviderType } from '@/shared/ai-service-provider-types';
import { findBundledAIModelCatalogEntry } from '../../../src/shared/ai-model-catalog';
import {
  MAX_AGENT_CONTEXT_TOKENS, MAX_AGENT_OUTPUT_TOKENS, normalizeAgentModelBudgetOverride,
  type AgentModelBudget, type AgentModelBudgetOverride,
} from '../../../src/shared/agent/agent-model-budget';

export type AgentModelContextBudget = Pick<
  AgentModelBudget,
  'contextWindowTokens' | 'effectiveContextWindowPercent' | 'outputReserveTokens'
>;

export interface AgentModelContextBudgetInput {
  baseUrl: string;
  model: string;
  providerType: AIServiceProviderType;
  metadata?: AgentModelMetadata;
  override?: AgentModelBudgetOverride;
}

export { parseAIServiceModelMetadata as parseAgentModelMetadata } from '../aiServiceModelDiscoveryCache';
export type { AIServiceModelMetadata as AgentModelMetadata } from '../aiServiceModelDiscoveryCache';

function positiveLimit(value: unknown, maximum = MAX_AGENT_CONTEXT_TOKENS): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? value : undefined;
}

export function resolveAgentModelContextBudget(
  input: AgentModelContextBudgetInput,
): AgentModelBudget {
  const override = normalizeAgentModelBudgetOverride(input.override);
  let validEndpoint = false;
  try {
    const url = new URL(input.baseUrl);
    validEndpoint = ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { /* Unknown endpoints cannot establish model identity. */ }
  const metadata = validEndpoint ? input.metadata : undefined;
  const modelId = input.model.trim();
  const catalog = metadata?.listedModelId === modelId
    ? findBundledAIModelCatalogEntry(input.providerType, modelId) : undefined;
  const remoteWindow = positiveLimit(metadata?.contextWindowTokens)
    ?? positiveLimit(metadata?.maxContextWindowTokens);
  // A gateway may report its own request cap instead of the underlying model window.
  // For known first-party models, keep the bundled catalog as the authoritative identity.
  const knownCatalogWindow = catalog?.context_window;
  const maxContextWindowTokens = knownCatalogWindow
    ? catalog?.max_context_window ?? knownCatalogWindow
    : positiveLimit(metadata?.maxContextWindowTokens) ?? remoteWindow;
  const contextWindowTokens = Math.min(
    override.contextWindowTokens ?? knownCatalogWindow ?? remoteWindow ?? 128_000,
    maxContextWindowTokens ?? MAX_AGENT_CONTEXT_TOKENS,
  );
  const remoteOutput = positiveLimit(metadata?.outputReserveTokens, 1_000_000);
  const outputReserveTokens = Math.min(
    override.outputReserveTokens ?? remoteOutput ?? (remoteWindow || catalog ? MAX_AGENT_OUTPUT_TOKENS : 4_096),
    remoteOutput ?? MAX_AGENT_OUTPUT_TOKENS,
    MAX_AGENT_OUTPUT_TOKENS,
    Math.floor(contextWindowTokens / 4),
  );
  return {
    contextWindowTokens,
    effectiveContextWindowPercent: 95,
    ...(maxContextWindowTokens ? { maxContextWindowTokens } : {}),
    outputReserveTokens,
    source: catalog ? 'catalog' : remoteWindow ? 'provider' : 'fallback',
  };
}
