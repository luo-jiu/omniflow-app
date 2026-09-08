import type { AgentToolResult } from '@/shared/agent/agent.types';
import { estimateAgentTextTokens } from './agent-token-estimator';
import {
  containsAgentSensitiveData,
  isAgentSensitiveFieldName,
  sanitizeAgentSensitiveText,
  sanitizeAgentSensitiveValue,
} from './agent-sensitive-data';
import {
  projectAgentShellProviderOutput,
  type AgentShellProviderOutputV1,
  type AgentShellProviderStreamOutputV1,
} from './shell/agent-shell-output-projection';

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

interface AgentShellProviderVisibleStreamOutputV1 {
  readonly content?: string;
  readonly head?: string;
  readonly omittedBytes: number;
  readonly tail?: string;
  readonly totalBytes: number;
  readonly truncated: boolean;
}

interface AgentShellProviderVisibleOutputV1 {
  readonly stderr: AgentShellProviderVisibleStreamOutputV1;
  readonly stdout: AgentShellProviderVisibleStreamOutputV1;
  readonly version: 1;
}

export interface AgentProviderToolResultProjection {
  content: string;
  estimatedTokens: number;
  truncated: boolean;
}

export interface AgentProviderToolResultProjectionOptions {
  mode?: 'default' | 'shell';
}

const PROJECTION_TIERS: readonly ProjectionLimits[] = [
  { maxArrayItems: 32, maxDepth: 6, maxObjectProperties: 32, maxStringCharacters: 2_000 },
  { maxArrayItems: 16, maxDepth: 5, maxObjectProperties: 24, maxStringCharacters: 1_000 },
  { maxArrayItems: 8, maxDepth: 4, maxObjectProperties: 16, maxStringCharacters: 500 },
  { maxArrayItems: 4, maxDepth: 3, maxObjectProperties: 12, maxStringCharacters: 240 },
  { maxArrayItems: 2, maxDepth: 2, maxObjectProperties: 8, maxStringCharacters: 120 },
  { maxArrayItems: 1, maxDepth: 1, maxObjectProperties: 4, maxStringCharacters: 60 },
];

function truncateString(
  value: string,
  maxCharacters: number,
  state: ProjectionState,
): string {
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

function shellProviderResult(result: AgentToolResult): AgentToolResult {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result;
  const source = result.data as Record<string, unknown>;
  const data = { ...source };
  const providerOutput = data.providerOutput;
  delete data.executionId;
  delete data.logRef;
  delete data.providerOutput;
  delete data.stderrTail;
  delete data.stdoutTail;
  delete data.tailTruncated;
  delete data.previewTruncated;
  delete data.droppedOutputBytes;
  if (providerOutput !== undefined) data.output = providerOutput;
  return {
    data,
    ...(result.message === undefined ? {} : { message: result.message }),
    ok: result.ok,
  };
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAgentShellProviderStreamOutput(
  value: unknown,
): value is AgentShellProviderStreamOutputV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stream = value as Record<string, unknown>;
  return typeof stream.head === 'string'
    && typeof stream.tail === 'string'
    && typeof stream.truncated === 'boolean'
    && isNonNegativeSafeInteger(stream.omittedBytes)
    && isNonNegativeSafeInteger(stream.totalBytes);
}

function isAgentShellProviderOutput(value: unknown): value is AgentShellProviderOutputV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const output = value as Record<string, unknown>;
  return output.version === 1
    && isAgentShellProviderStreamOutput(output.stdout)
    && isAgentShellProviderStreamOutput(output.stderr);
}

function shellOutputFromResult(result: AgentToolResult): AgentShellProviderOutputV1 | null {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return null;
  const output = (result.data as Record<string, unknown>).output;
  return isAgentShellProviderOutput(output) ? output : null;
}

function retainedShellOutputBytes(output: AgentShellProviderOutputV1): number {
  return Buffer.byteLength(output.stdout.head, 'utf8')
    + Buffer.byteLength(output.stdout.tail, 'utf8')
    + Buffer.byteLength(output.stderr.head, 'utf8')
    + Buffer.byteLength(output.stderr.tail, 'utf8');
}

function visibleShellProviderStream(
  stream: AgentShellProviderStreamOutputV1,
): AgentShellProviderVisibleStreamOutputV1 {
  if (!stream.truncated && stream.omittedBytes === 0) {
    return {
      content: `${stream.head}${stream.tail}`,
      omittedBytes: 0,
      totalBytes: stream.totalBytes,
      truncated: false,
    };
  }
  return {
    head: stream.head,
    omittedBytes: stream.omittedBytes,
    tail: stream.tail,
    totalBytes: stream.totalBytes,
    truncated: true,
  };
}

function withVisibleShellProviderOutput(
  result: AgentToolResult,
  output: AgentShellProviderOutputV1,
): AgentToolResult {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result;
  const visibleOutput: AgentShellProviderVisibleOutputV1 = {
    stderr: visibleShellProviderStream(output.stderr),
    stdout: visibleShellProviderStream(output.stdout),
    version: 1,
  };
  return {
    ...result,
    data: {
      ...(result.data as Record<string, unknown>),
      output: visibleOutput,
    },
  };
}

function withVisibleShellProviderOutputFromResult(result: AgentToolResult): AgentToolResult {
  const output = shellOutputFromResult(result);
  return output ? withVisibleShellProviderOutput(result, output) : result;
}

function providerContextProjectionPayload(result: AgentToolResult): Record<string, unknown> {
  return {
    _omniflowProjection: {
      reason: 'provider_context_budget',
      truncated: true,
      version: PROVIDER_RESULT_PROJECTION_VERSION,
    },
    ok: result.ok === true,
    ...(result.message === undefined ? {} : { message: result.message }),
    ...(result.data === undefined ? {} : { data: result.data }),
  };
}

function projectShellResultWithinTokenBudget(
  safeResult: AgentToolResult,
  normalizedBudget: number,
): AgentProviderToolResultProjection | null {
  const sourceOutput = shellOutputFromResult(safeResult);
  if (!sourceOutput) return null;

  let lowerBound = 1;
  let upperBound = Math.max(1, retainedShellOutputBytes(sourceOutput));
  let best: AgentProviderToolResultProjection | null = null;
  while (lowerBound <= upperBound) {
    const maximumBytes = Math.floor((lowerBound + upperBound) / 2);
    const output = projectAgentShellProviderOutput(sourceOutput, maximumBytes);
    const content = serialize(providerContextProjectionPayload(
      withVisibleShellProviderOutput(safeResult, output),
    ));
    if (!content) {
      upperBound = maximumBytes - 1;
      continue;
    }
    const estimatedTokens = estimateAgentTextTokens(content);
    if (estimatedTokens <= normalizedBudget) {
      best = { content, estimatedTokens, truncated: true };
      lowerBound = maximumBytes + 1;
    } else {
      upperBound = maximumBytes - 1;
    }
  }
  return best;
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
  options: AgentProviderToolResultProjectionOptions = {},
): AgentProviderToolResultProjection {
  const sourceResult = options.mode === 'shell'
    ? shellProviderResult(result)
    : result;
  const sanitized = sanitizeAgentSensitiveValue(sourceResult);
  const safeResult = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as AgentToolResult
    : { ok: false };
  const normalizedBudget = Math.max(1, Math.floor(Number(tokenBudget) || 0));
  const completeProjection = projectedPayload(
    options.mode === 'shell'
      ? withVisibleShellProviderOutputFromResult(safeResult)
      : safeResult,
  );
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

  if (options.mode === 'shell') {
    const shellProjection = projectShellResultWithinTokenBudget(
      safeResult,
      normalizedBudget,
    );
    if (shellProjection) return shellProjection;
  } else {
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
