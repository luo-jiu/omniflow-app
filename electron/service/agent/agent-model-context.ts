import type { AIServiceProviderType } from '@/shared/ai-service-provider-types';
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

export interface AgentModelMetadata {
  contextWindowTokens?: number;
  maxContextWindowTokens?: number;
  outputReserveTokens?: number;
}

// Codex models-manager/models.json at a9519cbcdd2d. Client defaults do not
// establish a compatible gateway's actual serving limits.
const CODEX_MODEL_CONTEXTS: Readonly<Record<string, readonly [number, number]>> = {
  'gpt-5.6-sol': [272_000, 872_000],
  'gpt-5.6-terra': [272_000, 872_000],
  'gpt-5.6-luna': [272_000, 872_000],
  'gpt-daybreak-blue-latest': [272_000, 872_000],
  'gpt-daybreak-red-latest': [372_000, 372_000],
  'gpt-5.5': [272_000, 272_000],
  'gpt-5.4': [272_000, 1_000_000],
  'gpt-5.4-mini': [272_000, 272_000],
  'gpt-5.2': [272_000, 272_000],
  'codex-auto-review': [272_000, 872_000],
};

function positiveLimit(value: unknown, maximum = MAX_AGENT_CONTEXT_TOKENS): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function parseAgentModelMetadata(body: unknown): Map<string, AgentModelMetadata> {
  const root = record(body);
  const items = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : [];
  const result = new Map<string, AgentModelMetadata>();
  for (const value of items.slice(0, 10_000)) {
    const item = record(value);
    const id = item.id ?? item.slug ?? item.name;
    if (typeof id !== 'string' || !id.trim() || id.length > 200) continue;
    const contextWindowTokens = positiveLimit(item.context_window ?? item.context_length);
    const maxContextWindowTokens = positiveLimit(item.max_context_window);
    const outputReserveTokens = positiveLimit(
      item.max_output_tokens ?? record(item.top_provider).max_completion_tokens, 1_000_000,
    );
    if (!contextWindowTokens && !maxContextWindowTokens && !outputReserveTokens) continue;
    result.set(id.trim(), { contextWindowTokens, maxContextWindowTokens, outputReserveTokens });
  }
  return result;
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
  const model = input.model.trim().toLowerCase();
  const catalogId = Object.keys(CODEX_MODEL_CONTEXTS).find(id => model === id)
    || Object.keys(CODEX_MODEL_CONTEXTS).find(id => (
      model.startsWith(`${id}-`) && /^\d{4}-\d{2}-\d{2}$/.test(model.slice(id.length + 1))
    ));
  const catalog = validEndpoint && input.providerType === 'openai' && catalogId
    ? CODEX_MODEL_CONTEXTS[catalogId] : undefined;
  const metadata = validEndpoint ? input.metadata : undefined;
  const remoteWindow = positiveLimit(metadata?.contextWindowTokens)
    ?? positiveLimit(metadata?.maxContextWindowTokens);
  const maxContextWindowTokens = positiveLimit(metadata?.maxContextWindowTokens) ?? remoteWindow ?? catalog?.[1];
  const contextWindowTokens = Math.min(
    override.contextWindowTokens ?? remoteWindow ?? catalog?.[0] ?? 16_384,
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
    source: remoteWindow ? 'provider' : catalog ? 'catalog' : 'fallback',
  };
}
