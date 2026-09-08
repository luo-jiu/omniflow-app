import type { AIServiceProviderType } from '@/shared/ai-service-provider-types';
import { findAgentModelProfile } from './agent-model-profiles';
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
  supportsToolCalling?: boolean;
  supportsParallelToolCalls?: boolean;
  supportsShellTool?: boolean;
  reasoningEfforts?: readonly ('low' | 'medium' | 'high')[];
  contextWindowTokens?: number;
  maxContextWindowTokens?: number;
  outputReserveTokens?: number;
}

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
    const capabilities: AgentModelMetadata = {};
    if (typeof item.supports_tool_calling === 'boolean') capabilities.supportsToolCalling = item.supports_tool_calling;
    if (typeof item.supports_parallel_tool_calls === 'boolean') capabilities.supportsParallelToolCalls = item.supports_parallel_tool_calls;
    if (item.shell_type === 'disabled') capabilities.supportsShellTool = false;
    if (Array.isArray(item.supported_reasoning_levels) && item.supported_reasoning_levels.length <= 16) {
      const levels = item.supported_reasoning_levels.map(level => typeof level === 'string' ? level : record(level).effort);
      if (levels.every(level => typeof level === 'string' && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(level))) {
        capabilities.reasoningEfforts = Object.freeze(['low', 'medium', 'high'].filter(level => levels.includes(level)) as ('low' | 'medium' | 'high')[]);
      }
    }
    if (!contextWindowTokens && !maxContextWindowTokens && !outputReserveTokens && !Object.keys(capabilities).length) continue;
    result.set(id.trim(), Object.freeze({ contextWindowTokens, maxContextWindowTokens, outputReserveTokens, ...capabilities }));
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
  const catalog = validEndpoint ? findAgentModelProfile(input.providerType, input.model)?.context : undefined;
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
