import { describe, expect, it } from 'vitest';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import { formatAgentRunElapsed } from './agent-run-presentation';

const run: AgentRunSnapshot = {
  id: 'r1', sessionId: 's1', model: 'test', profileId: 'test', reasoningEffort: 'medium',
  revision: 1, status: 'running', userPrompt: 'test',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
};

describe('Agent run elapsed time', () => {
  it.each([
    [0, '0s'], [19, '19s'], [59, '59s'], [60, '1m'], [61, '1m 1s'],
    [3599, '59m 59s'], [3600, '1h'], [3601, '1h 1s'],
    [86399, '23h 59m 59s'], [86400, '1d'], [86401, '1d 1s'],
    [90060, '1d 1h 1m'], [172801, '2d 1s'],
  ])('omits zero units at %s seconds', (seconds, duration) => {
    const now = Date.parse(run.createdAt) + Number(seconds) * 1000;
    expect(formatAgentRunElapsed(run, now)).toBe(`用时 ${duration}`);
    expect(formatAgentRunElapsed({ ...run, status: 'cancelled', finishedAt: new Date(now).toISOString() }, now + 100000))
      .toBe(`你在 ${duration} 停止了任务`);
  });
  it('formats elapsed minutes and hours from the canonical start time', () => {
    expect(formatAgentRunElapsed(run, Date.parse('2026-09-09T00:05:02Z'))).toBe('用时 5m 2s');
    expect(formatAgentRunElapsed(run, Date.parse('2026-09-09T01:20:31Z'))).toBe('用时 1h 20m 31s');
  });
  it('freezes historical terminal runs and does not count time after completion', () => {
    expect(formatAgentRunElapsed({ ...run, status: 'completed', finishedAt: '2026-09-09T00:00:07Z' }, Date.now()))
      .toBe('用时 7s');
    expect(formatAgentRunElapsed({ ...run, status: 'interrupted', updatedAt: '2026-09-09T00:00:09Z' }, Date.now()))
      .toBe('用时 9s');
  });
  it('shows the frozen stopping time for cancelled tasks', () => {
    expect(formatAgentRunElapsed({ ...run, status: 'cancelled', finishedAt: '2026-09-09T01:32:21Z' }, Date.now()))
      .toBe('你在 1h 32m 21s 停止了任务');
    expect(formatAgentRunElapsed({ ...run, status: 'cancelled', finishedAt: '2026-09-09T00:01:28Z' }, Date.now()))
      .toBe('你在 1m 28s 停止了任务');
  });
  it('handles clock rollback and malformed timestamps without fabricating a duration', () => {
    expect(formatAgentRunElapsed(run, Date.parse('2026-09-08T00:00:00Z'))).toBe('用时 0s');
    expect(formatAgentRunElapsed({ ...run, createdAt: 'invalid' }, Date.now())).toBe('用时 --');
  });
});
