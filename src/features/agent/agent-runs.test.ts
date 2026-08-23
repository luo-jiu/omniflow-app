import { describe, expect, it } from 'vitest';

import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import { mergeAgentRun, upsertAgentRun } from './agent-runs';

function run(
  id: string,
  status: AgentRunSnapshot['status'],
  revision: number,
  updatedAt = '2026-08-23T00:00:00.000Z',
): AgentRunSnapshot {
  return {
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    model: 'model-a',
    profileId: 'profile-a',
    reasoningEffort: 'medium',
    revision,
    sessionId: 'session-1',
    status,
    updatedAt,
    userPrompt: '处理当前文件',
  };
}

describe('Agent run projection merge', () => {
  it('rejects an older update', () => {
    const current = run('run-1', 'running', 2, '2026-08-23T00:00:01.000Z');
    const older = run('run-1', 'awaiting_approval', 1, '2026-08-23T00:00:02.000Z');

    expect(mergeAgentRun(current, older)).toBe(current);
  });

  it('does not let a delayed active snapshot replace a terminal run', () => {
    const completed = run('run-1', 'completed', 2);
    const delayed = run('run-1', 'running', 3);

    expect(mergeAgentRun(completed, delayed)).toBe(completed);
  });

  it('inserts runs in stable creation order', () => {
    const second = { ...run('run-2', 'running', 1), createdAt: '2026-08-23T00:00:02.000Z' };
    const first = { ...run('run-1', 'completed', 1), createdAt: '2026-08-23T00:00:01.000Z' };

    expect(upsertAgentRun([second], first).map(item => item.id)).toEqual(['run-1', 'run-2']);
  });

  it('accepts a newer revision even when its display clock moved backwards', () => {
    const current = run('run-1', 'running', 2, '2026-08-23T00:00:02.000Z');
    const newer = run('run-1', 'awaiting_approval', 3, '2026-08-23T00:00:01.000Z');

    expect(mergeAgentRun(current, newer)).toBe(newer);
  });

  it('keeps the current snapshot when duplicate revisions arrive out of order', () => {
    const current = run('run-1', 'awaiting_approval', 2);
    const duplicate = run('run-1', 'running', 2);

    expect(mergeAgentRun(current, duplicate)).toBe(current);
  });

  it('keeps a declared plan when a stale Run snapshot arrives later', () => {
    const planned = {
      ...run('run-1', 'running', 3),
      plan: {
        createdAt: '2026-08-23T00:00:00.000Z',
        steps: [
          { expectedToolName: 'file.list', id: 'step-1', ordinal: 1, title: '读取目录' },
          { expectedToolName: 'file.stat', id: 'step-2', ordinal: 2, title: '检查文件' },
        ],
        version: 1 as const,
      },
    };
    const staleWithoutPlan = run('run-1', 'running', 2, '2026-08-23T00:00:01.000Z');

    expect(mergeAgentRun(planned, staleWithoutPlan)).toBe(planned);
  });

  it('accepts a declared plan only when it arrives on a newer Run revision', () => {
    const current = run('run-1', 'running', 2);
    const planned = {
      ...run('run-1', 'running', 3),
      plan: {
        createdAt: '2026-08-23T00:00:00.000Z',
        steps: [
          { expectedToolName: 'file.list', id: 'step-1', ordinal: 1, title: '读取目录' },
          { expectedToolName: 'file.stat', id: 'step-2', ordinal: 2, title: '检查文件' },
        ],
        version: 1 as const,
      },
    };

    expect(mergeAgentRun(current, planned)).toBe(planned);
  });
});
