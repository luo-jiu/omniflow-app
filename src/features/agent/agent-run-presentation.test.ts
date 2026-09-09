import { describe, expect, it } from 'vitest';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import { formatAgentRunElapsed } from './agent-run-presentation';

const run: AgentRunSnapshot = {
  id: 'r1', sessionId: 's1', model: 'test', profileId: 'test', reasoningEffort: 'medium',
  revision: 1, status: 'running', userPrompt: 'test',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
};

describe('Agent run elapsed time', () => {
  it('formats elapsed minutes and hours from the canonical start time', () => {
    expect(formatAgentRunElapsed(run, Date.parse('2026-09-09T00:05:02Z'))).toBe('用时 5m 2s');
    expect(formatAgentRunElapsed(run, Date.parse('2026-09-09T01:20:31Z'))).toBe('用时 1h 20m 31s');
  });
  it('freezes historical terminal runs and does not count time after completion', () => {
    expect(formatAgentRunElapsed({ ...run, status: 'completed', finishedAt: '2026-09-09T00:00:07Z' }, Date.now()))
      .toBe('用时 0m 7s');
    expect(formatAgentRunElapsed({ ...run, status: 'interrupted', updatedAt: '2026-09-09T00:00:09Z' }, Date.now()))
      .toBe('用时 0m 9s');
  });
  it('shows the frozen stopping time for cancelled tasks', () => {
    expect(formatAgentRunElapsed({ ...run, status: 'cancelled', finishedAt: '2026-09-09T01:32:21Z' }, Date.now()))
      .toBe('你在 1h 32m 21s 停止了任务');
    expect(formatAgentRunElapsed({ ...run, status: 'cancelled', finishedAt: '2026-09-09T00:01:28Z' }, Date.now()))
      .toBe('你在 1m 28s 停止了任务');
  });
  it('handles clock rollback and malformed timestamps without fabricating a duration', () => {
    expect(formatAgentRunElapsed(run, Date.parse('2026-09-08T00:00:00Z'))).toBe('用时 0m 0s');
    expect(formatAgentRunElapsed({ ...run, createdAt: 'invalid' }, Date.now())).toBe('用时 --');
  });
});
