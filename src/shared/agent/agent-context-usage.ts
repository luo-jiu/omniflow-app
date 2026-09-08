export interface AgentReportedTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface AgentContextUsageSnapshot {
  version: 1;
  windowTokens: number;
  windowSource: 'provider' | 'catalog' | 'fallback' | 'internal';
  inputLimitTokens: number;
  outputReserveTokens: number;
  toolReserveTokens: number;
  localInputTokens: number;
  estimatedInputTokens: number;
  safetyInputTokens: number;
  remainingTokens: number;
  source: 'estimate' | 'provider' | 'provider-plus-estimate';
  phase: 'before-request' | 'after-response' | 'after-tool';
  responseCount: number;
  compactionCount: number;
  reportedTotalTokens: number;
  usageIncomplete: boolean;
  lastObservedInputTokens?: number;
  lastObservedResponse?: number;
  lastUsage?: AgentReportedTokenUsage;
  updatedAt: string;
}

const numericFields = ['windowTokens', 'inputLimitTokens', 'outputReserveTokens', 'toolReserveTokens',
  'localInputTokens', 'estimatedInputTokens', 'safetyInputTokens', 'remainingTokens', 'responseCount',
  'compactionCount', 'reportedTotalTokens'] as const;
const usageFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningOutputTokens'] as const;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function normalizeAgentContextUsage(value: unknown): AgentContextUsageSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || !numericFields.every(field => isCount(data[field]))
    || typeof data.windowSource !== 'string' || !['provider', 'catalog', 'fallback', 'internal'].includes(data.windowSource)
    || typeof data.source !== 'string' || !['estimate', 'provider', 'provider-plus-estimate'].includes(data.source)
    || typeof data.phase !== 'string' || !['before-request', 'after-response', 'after-tool'].includes(data.phase)
    || typeof data.updatedAt !== 'string' || data.updatedAt.length > 100 || !Number.isFinite(Date.parse(data.updatedAt))
    || typeof data.usageIncomplete !== 'boolean') return undefined;
  const result = { version: 1, windowSource: data.windowSource, source: data.source, phase: data.phase,
    updatedAt: data.updatedAt, usageIncomplete: data.usageIncomplete,
    ...Object.fromEntries(numericFields.map(field => [field, data[field]])) } as AgentContextUsageSnapshot;
  for (const field of ['lastObservedInputTokens', 'lastObservedResponse'] as const) {
    if (data[field] !== undefined) {
      if (!isCount(data[field])) return undefined;
      result[field] = data[field];
    }
  }
  if (data.lastUsage !== undefined) {
    if (!data.lastUsage || typeof data.lastUsage !== 'object' || Array.isArray(data.lastUsage)) return undefined;
    const usage = data.lastUsage as Record<string, unknown>;
    result.lastUsage = {};
    for (const field of usageFields) {
      if (usage[field] === undefined) continue;
      if (!isCount(usage[field])) return undefined;
      result.lastUsage[field] = usage[field];
    }
  }
  return result;
}
