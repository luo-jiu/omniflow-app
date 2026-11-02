import { describe, expect, it } from 'vitest';
import type { AIServiceProfile } from '@/features/ai-services/ai-service.types';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import { selectAgentContextUsageRun } from './agent-context-usage-presentation';

const profile = { id: 'profile', updatedAt: '2026-10-21T00:00:00Z' } as AIServiceProfile;
const run = { id: 'run', sessionId: 'session', profileId: profile.id, model: 'model', reasoningEffort: 'high',
  createdAt: '2026-10-22T00:00:00Z' } as AgentRunSnapshot;
const input = { runs: [run], sessionId: run.sessionId, model: run.model, reasoningEffort: run.reasoningEffort, profile };

describe('context usage run selection', () => {
  it('uses only the latest run in the selected session, even before its measurement exists', () => {
    expect(selectAgentContextUsageRun(input)).toBe(run);
    const later = { ...run, id: 'later', createdAt: '2026-10-23T00:00:00Z' };
    expect(selectAgentContextUsageRun({ ...input, runs: [later, run] })).toBe(later);
    expect(selectAgentContextUsageRun({ ...input, runs: [run, { ...later, sessionId: 'other' }] })).toBe(run);
    expect(selectAgentContextUsageRun({ ...input, runs: [run, { ...later, model: 'other' }] })).toBeUndefined();
  });

  it('invalidates statistics after model, effort, profile, configuration or session changes', () => {
    for (const change of [
      { model: 'other' }, { reasoningEffort: 'low' as const }, { sessionId: null }, { sessionId: 'other' },
      { profile: null }, { profile: { ...profile, id: 'other' } },
      { profile: { ...profile, updatedAt: '2026-10-23T00:00:00Z' } },
    ]) expect(selectAgentContextUsageRun({ ...input, ...change })).toBeUndefined();
  });

  it('matches requested effort when the backend normalized it and invalidates a real user change', () => {
    const normalized = { ...run, requestedReasoningEffort: 'high' as const, reasoningEffort: 'auto' as const };
    expect(selectAgentContextUsageRun({ ...input, runs: [normalized] })).toBe(normalized);
    expect(selectAgentContextUsageRun({ ...input, runs: [normalized], reasoningEffort: 'auto' })).toBeUndefined();
    expect(selectAgentContextUsageRun({ ...input, runs: [normalized], reasoningEffort: 'max' })).toBeUndefined();
    const automatic = { ...run, requestedReasoningEffort: 'auto' as const, reasoningEffort: 'high' as const };
    expect(selectAgentContextUsageRun({ ...input, runs: [automatic], reasoningEffort: 'auto' })).toBe(automatic);
    expect(selectAgentContextUsageRun({ ...input, runs: [automatic] })).toBeUndefined();
    expect(selectAgentContextUsageRun(input)).toBe(run);
  });
});
