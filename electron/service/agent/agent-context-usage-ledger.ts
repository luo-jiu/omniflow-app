import crypto from 'node:crypto';
import type { AgentContextUsageSnapshot, AgentReportedTokenUsage } from '../../../src/shared/agent/agent-context-usage';
import { estimateAgentProviderTurnTokens, getAgentProviderRequestTokenLimit, type AgentContextBudget } from './agent-context-projection';
import type { AgentProviderMessage } from './agent-provider-model';

export interface AgentContextRequest { systemPrompt: string; tools: readonly unknown[]; messages: readonly AgentProviderMessage[] }
const fingerprint = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function createAgentContextUsageLedger(budget: AgentContextBudget, windowSource: AgentContextUsageSnapshot['windowSource'] = 'fallback') {
  let anchor: { fixed: string; messages: string[]; estimated: number; observed: number; response: number } | undefined;
  let correction = 0, responses = 0, reportedTotal = 0, compactions = 0;
  let incomplete = false;
  let lastUsage: AgentReportedTokenUsage | undefined;
  let lastObserved: { tokens: number; response: number } | undefined;
  const inputLimit = getAgentProviderRequestTokenLimit(budget);
  const fixedHash = (request: AgentContextRequest) => fingerprint([request.systemPrompt, request.tools]);
  function observe(request: AgentContextRequest, usage?: AgentReportedTokenUsage) {
    responses += 1;
    lastUsage = usage ? { ...usage } : undefined;
    const total = count(usage?.totalTokens) ? usage.totalTokens
      : count(usage?.inputTokens) && count(usage?.outputTokens) ? usage.inputTokens + usage.outputTokens : undefined;
    if (count(total)) reportedTotal = Math.min(Number.MAX_SAFE_INTEGER, reportedTotal + total);
    else incomplete = true;
    if (!count(usage?.inputTokens)) return;
    const estimated = estimateAgentProviderTurnTokens(request);
    correction = Math.max(correction, usage.inputTokens - estimated, 0);
    anchor = { fixed: fixedHash(request), messages: request.messages.map(fingerprint), estimated,
      observed: usage.inputTokens, response: responses };
    lastObserved = { tokens: usage.inputTokens, response: responses };
  }
  function snapshot(request: AgentContextRequest, phase: AgentContextUsageSnapshot['phase'], updatedAt: string): AgentContextUsageSnapshot {
    const local = estimateAgentProviderTurnTokens(request);
    const compatible = anchor && anchor.fixed === fixedHash(request) && request.messages.length >= anchor.messages.length
      && anchor.messages.every((hash, index) => hash === fingerprint(request.messages[index]));
    if (!compatible) anchor = undefined;
    const delta = anchor ? Math.max(0, local - anchor.estimated) : 0;
    const estimated = anchor ? Math.min(Number.MAX_SAFE_INTEGER, anchor.observed + delta) : local;
    const safety = Math.min(Number.MAX_SAFE_INTEGER, Math.max(estimated, local + correction));
    return {
      version: 1, windowTokens: budget.contextWindowTokens, windowSource,
      inputLimitTokens: inputLimit, outputReserveTokens: budget.outputReserveTokens,
      toolReserveTokens: budget.toolLoopReserveTokens, localInputTokens: local,
      estimatedInputTokens: estimated, safetyInputTokens: safety,
      remainingTokens: Math.max(0, inputLimit - safety - budget.toolLoopReserveTokens),
      source: anchor ? delta ? 'provider-plus-estimate' : 'provider' : 'estimate',
      phase, responseCount: responses, compactionCount: compactions,
      reportedTotalTokens: reportedTotal, usageIncomplete: incomplete,
      ...(lastObserved ? { lastObservedInputTokens: lastObserved.tokens, lastObservedResponse: lastObserved.response } : {}),
      ...(lastUsage ? { lastUsage } : {}), updatedAt,
    };
  }
  return { observe, snapshot,
    requestLimit: () => Math.max(1, inputLimit - correction),
    compacted: () => { anchor = undefined; compactions += 1; },
  };
}
