import type { AgentToolResult } from '@/shared/agent/agent.types';
import { estimateAgentTextTokens } from './agent-context-projection';
import {
  containsAgentSensitiveData,
  isAgentSensitiveFieldName,
  sanitizeAgentSensitiveText,
  sanitizeAgentSensitiveValue,
} from './agent-sensitive-data';

const PROVIDER_RESULT_PROJECTION_VERSION = 1;
const REDACTED_VALUE = '[REDACTED]';

interface ProjectionLimits {
  maxArrayItems: number;
  maxDepth: number;
  maxObjectProperties: number;
  maxStringCharacters: number;
}

interface ProjectionState {
  truncated: boolean;
  visited: WeakSet<object>;
}

export interface AgentProviderToolResultProjection {
  content: string;
  estimatedTokens: number;
  truncated: boolean;
}

const PROJECTION_TIERS: readonly ProjectionLimits[] = [
  { maxArrayItems: 32, maxDepth: 6, maxObjectProperties: 32, maxStringCharacters: 2_000 },
  { maxArrayItems: 16, maxDepth: 5, maxObjectProperties: 24, maxStringCharacters: 1_000 },
  { maxArrayItems: 8, maxDepth: 4, maxObjectProperties: 16, maxStringCharacters: 500 },
  { maxArrayItems: 4, maxDepth: 3, maxObjectProperties: 12, maxStringCharacters: 240 },
  { maxArrayItems: 2, maxDepth: 2, maxObjectProperties: 8, maxStringCharacters: 120 },
  { maxArrayItems: 1, maxDepth: 1, maxObjectProperties: 4, maxStringCharacters: 60 },
];

function truncateString(value: string, maxCharacters: number, state: ProjectionState): string {
  const sanitized = sanitizeAgentSensitiveText(value);
  const characters = [...sanitized];
  if (characters.length <= maxCharacters) return sanitized;
  state.truncated = true;
  if (maxCharacters <= 24) return '[truncated]';
  return `${characters.slice(0, maxCharacters - 16).join('')} [truncated]`;
}

function projectValue(
  value: unknown,
  limits: ProjectionLimits | undefined,
  state: ProjectionState,
  depth: number,
): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return limits
      ? truncateString(value, limits.maxStringCharacters, state)
      : sanitizeAgentSensitiveText(value);
  }
  if (typeof value !== 'object') {
    state.truncated = true;
    return String(value);
  }
  if (state.visited.has(value)) {
    state.truncated = true;
    return '[circular value omitted]';
  }
  if (limits && depth >= limits.maxDepth) {
    state.truncated = true;
    return Array.isArray(value) ? [] : {};
  }

  state.visited.add(value);
  try {
    if (Array.isArray(value)) {
      if (limits && value.length > limits.maxArrayItems) state.truncated = true;
      return (limits ? value.slice(0, limits.maxArrayItems) : value)
        .map(item => projectValue(item, limits, state, depth + 1));
    }

    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(value as Record<string, unknown>);
    } catch {
      state.truncated = true;
      return '[unreadable value omitted]';
    }
    if (limits && entries.length > limits.maxObjectProperties) state.truncated = true;
    return Object.fromEntries((limits ? entries.slice(0, limits.maxObjectProperties) : entries)
      .map(([key, item]) => {
        const projectedKey = limits
          ? truncateString(key, 120, state)
          : sanitizeAgentSensitiveText(key);
        const sensitiveKey = isAgentSensitiveFieldName(key)
          || containsAgentSensitiveData(`${key}=omniflow-sensitive-value`);
        return [
          projectedKey,
          sensitiveKey ? REDACTED_VALUE : projectValue(item, limits, state, depth + 1),
        ];
      }));
  } finally {
    state.visited.delete(value);
  }
}

function projectedPayload(result: AgentToolResult, limits?: ProjectionLimits): {
  payload: Record<string, unknown>;
  truncated: boolean;
} {
  const state: ProjectionState = { truncated: false, visited: new WeakSet() };
  const payload: Record<string, unknown> = {
    ok: result?.ok === true,
    ...(result?.message === undefined
      ? {}
      : { message: projectValue(String(result.message), limits, state, 0) }),
    ...(result?.data === undefined
      ? {}
      : { data: projectValue(result.data, limits, state, 0) }),
  };
  if (state.truncated) {
    payload._omniflowProjection = {
      reason: 'provider_context_budget',
      truncated: true,
      version: PROVIDER_RESULT_PROJECTION_VERSION,
    };
  }
  return { payload, truncated: state.truncated };
}

function serialize(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function minimalProviderToolResultContent(ok: boolean): string {
  return JSON.stringify({
    _omniflowProjection: {
      reason: 'provider_context_budget',
      truncated: true,
      version: PROVIDER_RESULT_PROJECTION_VERSION,
    },
    ok,
  });
}

const MINIMUM_RESULT_CANDIDATES = [
  minimalProviderToolResultContent(false),
  minimalProviderToolResultContent(true),
];

export const MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT = MINIMUM_RESULT_CANDIDATES.reduce(
  (largest, candidate) => (
    estimateAgentTextTokens(candidate) > estimateAgentTextTokens(largest) ? candidate : largest
  ),
);

export const MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS = estimateAgentTextTokens(
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
);

export function projectAgentToolResultForProvider(
  result: AgentToolResult,
  tokenBudget: number,
): AgentProviderToolResultProjection {
  const sanitized = sanitizeAgentSensitiveValue(result);
  const safeResult = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as AgentToolResult
    : { ok: false };
  const normalizedBudget = Math.max(1, Math.floor(Number(tokenBudget) || 0));
  const completeProjection = projectedPayload(safeResult);
  const complete = serialize(completeProjection.payload);
  if (
    complete
    && !completeProjection.truncated
    && estimateAgentTextTokens(complete) <= normalizedBudget
  ) {
    return {
      content: complete,
      estimatedTokens: estimateAgentTextTokens(complete),
      truncated: false,
    };
  }

  for (const limits of PROJECTION_TIERS) {
    const projected = projectedPayload(safeResult, limits);
    const content = serialize({
      ...projected.payload,
      ...(projected.truncated
        ? {}
        : {
            _omniflowProjection: {
              reason: 'provider_context_budget',
              truncated: true,
              version: PROVIDER_RESULT_PROJECTION_VERSION,
            },
          }),
    });
    if (!content) continue;
    const estimatedTokens = estimateAgentTextTokens(content);
    if (estimatedTokens <= normalizedBudget) {
      return { content, estimatedTokens, truncated: true };
    }
  }

  const minimal = minimalProviderToolResultContent(safeResult.ok === true);
  const estimatedTokens = estimateAgentTextTokens(minimal);
  if (estimatedTokens > normalizedBudget) {
    throw new Error(
      `Agent Tool 结果没有足够的模型上下文预算：至少需要 ${estimatedTokens} token，`
      + `当前仅剩 ${normalizedBudget} token`,
    );
  }
  return { content: minimal, estimatedTokens, truncated: true };
}
