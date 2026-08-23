import { describe, expect, it } from 'vitest';

import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import {
  mergeAgentToolActivity,
  reconcileCanonicalAgentRunActivities,
  upsertAgentToolActivity,
} from './agent-tool-activities';

function activity(
  id: string,
  runId: string,
  callId: string,
  status: AgentToolActivitySnapshot['status'],
): AgentToolActivitySnapshot {
  return {
    call: { id: callId, input: {}, name: 'file.list' },
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    ordinal: 1,
    permissionBehavior: 'allow',
    revision: 1,
    runId,
    sessionId: 'session-1',
    status,
  };
}

describe('Agent Tool activity reconciliation', () => {
  it('matches a temporary activity by run and call identity', () => {
    const temporary = activity('temporary', 'run-1', 'call-1', 'running');
    const canonical = activity('stored', 'run-1', 'call-1', 'completed');

    expect(upsertAgentToolActivity([temporary], canonical)).toEqual([canonical]);
  });

  it('does not let a late running event replace a terminal activity', () => {
    const completed = activity('stored', 'run-1', 'call-1', 'completed');
    completed.result = { message: '完成', ok: true };

    expect(mergeAgentToolActivity(
      completed,
      activity('stored', 'run-1', 'call-1', 'running'),
    )).toEqual(completed);
  });

  it('keeps newer progress when an older approval snapshot arrives later', () => {
    const withProgress = activity('stored', 'run-1', 'call-1', 'running');
    withProgress.progress = { message: '正在上传', percent: 70 };
    withProgress.progressUpdatedAt = '2026-08-23T00:00:02.000Z';
    const approved = activity('stored', 'run-1', 'call-1', 'running');
    approved.approval = {
      approvalId: 'approval-1',
      preview: { description: '执行操作', risk: 'write', title: '确认' },
      status: 'approved',
    };

    expect(mergeAgentToolActivity(withProgress, approved)).toMatchObject({
      approval: { status: 'approved' },
      progress: { message: '正在上传', percent: 70 },
    });
  });

  it('does not let a resolved interaction regress to pending', () => {
    const submitted = activity('stored', 'run-1', 'call-1', 'running');
    submitted.revision = 2;
    submitted.interaction = {
      interactionId: 'interaction-1',
      request: {
        kind: 'choice',
        options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        prompt: '请选择',
      },
      response: { kind: 'choice', selectedOptionIds: ['a'] },
      status: 'submitted',
    };
    const latePending = activity('stored', 'run-1', 'call-1', 'awaiting_interaction');
    latePending.interaction = {
      interactionId: 'interaction-1',
      request: submitted.interaction.request,
      status: 'pending',
    };

    expect(mergeAgentToolActivity(submitted, latePending)).toBe(submitted);
  });

  it('rejects every field from a stale activity revision', () => {
    const current = activity('stored', 'run-1', 'call-1', 'running');
    current.revision = 4;
    current.progress = { message: '已处理 80%', percent: 80 };
    current.approval = {
      approvalId: 'approval-1',
      preview: { description: '执行操作', risk: 'write', title: '确认' },
      status: 'approved',
    };
    const stale = activity('stored', 'run-1', 'call-1', 'awaiting_interaction');
    stale.revision = 3;
    stale.progress = { message: '刚刚开始', percent: 5 };
    stale.interaction = {
      interactionId: 'interaction-1',
      request: {
        kind: 'choice',
        options: [{ id: 'a', label: 'A' }],
        prompt: '请选择',
      },
      status: 'pending',
    };

    expect(mergeAgentToolActivity(current, stale)).toBe(current);
  });

  it('accepts a complete newer canonical activity revision', () => {
    const current = activity('temporary', 'run-1', 'call-1', 'running');
    current.revision = 0;
    const canonical = activity('stored', 'run-1', 'call-1', 'completed');
    canonical.revision = 2;
    canonical.result = { message: '完成', ok: true };

    expect(mergeAgentToolActivity(current, canonical)).toBe(canonical);
  });

  it('replaces one run with the canonical restored projection', () => {
    const previous = activity('previous', 'run-0', 'call-0', 'completed');
    const temporary = activity('temporary', 'run-1', 'call-1', 'running');
    const canonical = activity('stored', 'run-1', 'call-1', 'failed');

    expect(reconcileCanonicalAgentRunActivities(
      [previous, temporary],
      'run-1',
      [canonical],
    )).toEqual([previous, canonical]);
  });
});
