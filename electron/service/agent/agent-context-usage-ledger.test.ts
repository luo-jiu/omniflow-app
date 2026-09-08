import { describe, expect, it } from 'vitest';
import { createAgentContextUsageLedger, type AgentContextRequest } from './agent-context-usage-ledger';
import { estimateAgentProviderTurnTokens, resolveAgentContextBudget } from './agent-context-projection';
import { normalizeAgentContextUsage } from '@/shared/agent/agent-context-usage';

const budget = resolveAgentContextBudget({ contextWindowTokens: 32000 });
const request: AgentContextRequest = { systemPrompt: 'rules', tools: [], messages: [{ role: 'user', content: 'hello' }] };
const now = '2026-09-08T00:00:00.000Z';
describe('context usage ledger', () => {
  it('uses measured input plus appended visible items, not completion or cached-token subtraction', () => {
    const ledger = createAgentContextUsageLedger(budget, 'catalog');
    const initial = ledger.snapshot(request, 'before-request', now);
    expect(initial.source).toBe('estimate');
    ledger.observe(request, { inputTokens: 200, cachedInputTokens: 150, outputTokens: 900, reasoningOutputTokens: 850, totalTokens: 1100 });
    expect(ledger.snapshot(request, 'after-response', now)).toMatchObject({ source: 'provider', estimatedInputTokens: 200 });
    const next: AgentContextRequest = { ...request, messages: [...request.messages, { role: 'assistant', content: 'done' },
      { role: 'tool', name: 'file.read', toolCallId: 'one', content: 'a file' }] };
    const snapshot = ledger.snapshot(next, 'after-tool', now);
    const delta = estimateAgentProviderTurnTokens(next) - estimateAgentProviderTurnTokens(request);
    expect(snapshot.estimatedInputTokens).toBe(200 + delta);
    expect(snapshot.reportedTotalTokens).toBe(1100);
    expect(snapshot.source).toBe('provider-plus-estimate');
    expect(snapshot.remainingTokens).toBe(Math.max(0, ledger.requestLimit() - snapshot.localInputTokens - budget.toolLoopReserveTokens));
    expect(normalizeAgentContextUsage(snapshot)).toEqual(snapshot);
  });
  it('invalidates anchors after edits, tool changes and compaction, retaining conservative calibration', () => {
    const ledger = createAgentContextUsageLedger(budget);
    ledger.observe(request, { inputTokens: 500, outputTokens: 1 });
    const limit = ledger.requestLimit();
    expect(ledger.snapshot({ ...request, systemPrompt: 'changed' }, 'before-request', now).source).toBe('estimate');
    expect(ledger.requestLimit()).toBe(limit);
    ledger.observe(request, { inputTokens: 500 });
    expect(ledger.snapshot({ ...request, messages: [{ role: 'user', content: 'replacement' }] }, 'before-request', now).source).toBe('estimate');
    ledger.observe(request, { inputTokens: 500 });
    ledger.compacted();
    expect(ledger.snapshot(request, 'before-request', now)).toMatchObject({ source: 'estimate', compactionCount: 1 });
    expect(createAgentContextUsageLedger(budget).snapshot(request, 'before-request', now).lastObservedInputTokens).toBeUndefined();
  });
  it('marks missing usage unknown and does not fabricate zero input', () => {
    const ledger = createAgentContextUsageLedger(budget);
    ledger.observe(request, { outputTokens: 8 });
    const snapshot = ledger.snapshot(request, 'after-response', now);
    expect(snapshot).toMatchObject({ source: 'estimate', usageIncomplete: true, reportedTotalTokens: 0 });
    expect(snapshot.lastObservedInputTokens).toBeUndefined();
    expect(snapshot.lastUsage).not.toHaveProperty('inputTokens');
  });
  it('keeps safety reserves and does not let low reported counts increase the request allowance', () => {
    const ledger = createAgentContextUsageLedger(budget);
    const limit = ledger.requestLimit();
    ledger.observe(request, { inputTokens: 1, outputTokens: 1 });
    const snapshot = ledger.snapshot(request, 'after-response', now);
    expect(snapshot.estimatedInputTokens).toBe(1);
    expect(snapshot.safetyInputTokens).toBe(snapshot.localInputTokens);
    expect(ledger.requestLimit()).toBe(limit);
  });
});
