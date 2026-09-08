export interface AgentModelBudgetOverride {
  contextWindowTokens?: number;
  outputReserveTokens?: number;
}

export interface AgentModelBudget extends Required<AgentModelBudgetOverride> {
  effectiveContextWindowPercent: number;
  maxContextWindowTokens?: number;
  source: 'provider' | 'catalog' | 'fallback';
}

export const MAX_AGENT_CONTEXT_TOKENS = 10_000_000;
export const MAX_AGENT_OUTPUT_TOKENS = 16_000;

export function normalizeAgentModelBudgetOverride(value: unknown): AgentModelBudgetOverride {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('模型预算格式无效');
  }
  const source = value as Record<string, unknown>;
  const result: AgentModelBudgetOverride = {};
  for (const key of Object.keys(source)) {
    if (key !== 'contextWindowTokens' && key !== 'outputReserveTokens') {
      throw new Error('模型预算包含未知字段');
    }
    const limit = key === 'contextWindowTokens' ? MAX_AGENT_CONTEXT_TOKENS : MAX_AGENT_OUTPUT_TOKENS;
    const minimum = key === 'contextWindowTokens' ? 4_096 : 256;
    const number = source[key];
    if (number === undefined) continue;
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < minimum || number > limit) {
      throw new Error(`${key} 必须是 ${minimum} 到 ${limit} 之间的整数`);
    }
    result[key] = number;
  }
  return result;
}
