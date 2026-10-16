import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunSnapshot, AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { buildAgentTimelineItems } from './agent-timeline';

const time = (second: number) => `2026-10-14T00:00:${String(second).padStart(2, '0')}.000Z`;

function message(id: string, second: number, phase: 'user' | 'commentary' | 'final' = 'commentary'): AgentMessage {
  const common = { id, content: id, createdAt: time(second), runId: 'run', sessionId: 'session' };
  return phase === 'user' ? { ...common, role: 'user' } : {
    ...common, role: 'assistant', assistantItem: {
      phase, status: 'completed', revision: 2, turnOrdinal: second + 1,
      updatedAt: time(second), finishedAt: time(second),
    },
  };
}

function tool(id: string, ordinal: number, second = ordinal, access = false): AgentToolActivitySnapshot {
  return {
    id, ordinal, createdAt: time(second), runId: 'run', sessionId: 'session', revision: 3,
    call: { id: `call-${id}`, name: access ? 'agent.access.request' : 'file.list', input: {} },
    status: access ? 'failed' : 'completed', permissionBehavior: access ? 'ask' : 'allow', result: { ok: !access },
    ...(access ? { approval: {
      approvalId: `approval-${id}`, status: 'denied' as const,
      preview: { title: '目录访问确认', description: '读取目录', risk: 'read' as const },
    } } : {}),
  };
}

function anchor(activity: AgentToolActivitySnapshot): AgentMessage {
  return { id: `anchor-${activity.id}`, content: '完成', createdAt: activity.createdAt,
    runId: activity.runId, sessionId: activity.sessionId, role: 'tool', toolCallId: activity.call.id };
}

function keys(messages: AgentMessage[], activities: AgentToolActivitySnapshot[]) {
  return buildAgentTimelineItems(messages, [], activities).flatMap(item => item.type === 'tool-group'
    ? item.activities.map(activity => `activity:${activity.id}`) : [item.key]);
}

function approvedAccess(id: string, ordinal: number): AgentToolActivitySnapshot {
  const source = tool(id, ordinal, ordinal, true);
  return { ...source, status: 'completed', result: { ok: true },
    approval: { ...source.approval!, status: 'approved' } };
}

describe('Agent approval timeline recovery', () => {
  it('interleaves denied directory approvals with their steps before the final answer on restore', () => {
    const activities = Array.from({ length: 4 }, (_, index) => [
      tool(`access-${index}`, index * 2 + 1, index * 3 + 1, true),
      tool(`read-${index}`, index * 2 + 2, index * 3 + 2),
    ]).flat();
    const messages = [message('question', 0, 'user'), ...Array.from({ length: 4 }, (_, index) => [
      message(`comment-${index}`, index * 3), anchor(activities[index * 2 + 1]),
    ]).flat(), message('answer', 15, 'final'),
    { ...message('next-question', 16, 'user'), runId: 'next-run' }];

    expect(keys(messages, [...activities].reverse())).toEqual([
      'message:question', ...Array.from({ length: 4 }, (_, index) => [
        `message:comment-${index}`, `activity:access-${index}`, `activity:read-${index}`,
      ]).flat(), 'message:answer', 'message:next-question',
    ]);
  });

  it.each(['same-millisecond', 'clock-rollback'] as const)('uses tool ordinal boundaries with %s timestamps', mode => {
    const approval1 = tool('access-1', 1, mode === 'clock-rollback' ? 9 : 1, true);
    const read1 = tool('read-1', 2, 1);
    const approval2 = tool('access-2', 3, mode === 'clock-rollback' ? 0 : 1, true);
    const read2 = tool('read-2', 4, 1);
    const messages = [message('question', 1, 'user'), message('before', 1), anchor(read1),
      message('between', 1), anchor(read2), message('answer', 1, 'final')];

    expect(keys(messages, [approval2, read2, read1, approval1])).toEqual([
      'message:question', 'message:before', 'activity:access-1', 'activity:read-1',
      ...(mode === 'clock-rollback' ? ['activity:access-2', 'message:between'] : ['message:between', 'activity:access-2']),
      'activity:read-2', 'message:answer',
    ]);
  });

  it('retains nested access after its already-started parent and before later commentary', () => {
    const parent = tool('plugin-parent', 1, 1);
    const access = tool('nested-access', 2, 3, true);
    expect(keys([message('question', 0, 'user'), anchor(parent), message('after', 4),
      message('answer', 5, 'final')], [access, parent])).toEqual([
      'message:question', 'activity:plugin-parent', 'activity:nested-access', 'message:after', 'message:answer',
    ]);
  });

  it('keeps unanchored execution facts before a completed final despite a clock rollback', () => {
    const access = tool('access', 1, 9, true);
    expect(keys([message('question', 0, 'user'), message('before', 1), message('answer', 2, 'final')], [access]))
      .toEqual(['message:question', 'message:before', 'activity:access', 'message:answer']);
  });

  it('does not duplicate an approval that already has a live or canonical anchor', () => {
    const access = tool('access', 1, 2, true);
    expect(keys([message('question', 0, 'user'), message('before', 1), anchor(access),
      anchor(access), message('answer', 3, 'final')], [access]))
      .toEqual(['message:question', 'message:before', 'activity:access', 'message:answer']);
  });

  it('keeps multiple unanchored approvals in ordinal order within a single commentary gap', () => {
    const first = tool('first-access', 1, 5, true);
    const second = tool('second-access', 2, 1, true);
    const read = tool('read', 3, 7);
    expect(keys([message('question', 0, 'user'), message('before', 0), message('middle', 4),
      message('after', 6), anchor(read), message('answer', 8, 'final')], [second, read, first]))
      .toEqual(['message:question', 'message:before', 'message:middle', 'activity:first-access',
        'activity:second-access', 'message:after', 'activity:read', 'message:answer']);
  });

  it.each(['failed', 'cancelled'] as const)('keeps the %s run marker after recovered approvals without a final answer', status => {
    const access = tool('access', 1, 2, true);
    access.status = status;
    access.approval!.status = status === 'cancelled' ? 'cancelled' : 'denied';
    const run: AgentRunSnapshot = {
      id: 'run', sessionId: 'session', createdAt: time(0), updatedAt: time(3), finishedAt: time(3),
      revision: 3, status, model: 'test', profileId: 'test', reasoningEffort: 'medium', userPrompt: '读取目录',
    };
    const items = buildAgentTimelineItems([message('question', 0, 'user'), message('before', 1)], [run], [access]);
    expect(items.map(item => item.key)).toEqual([
      'message:question', 'message:before', 'activity:access', 'run-status:run',
    ]);
  });

  it.each(['live-anchor', 'restored-without-anchor'] as const)('omits successful permission-only records in %s while keeping real tool order', mode => {
    const first = tool('read', 1);
    const access = approvedAccess('approved-access', 2);
    const last = { ...tool('write', 3), call: { id: 'call-write', name: 'file.write', input: {} },
      permissionBehavior: 'ask' as const, approval: { ...access.approval!, approvalId: 'write-approval' } };
    const messages = [message('question', 0, 'user'), anchor(first),
      ...(mode === 'live-anchor' ? [anchor(access), anchor(access)] : []), anchor(last), message('answer', 4, 'final')];
    const source = [last, access, first];
    const items = buildAgentTimelineItems(messages, [], source);
    expect(items.map(item => item.key)).toEqual(['message:question', 'activity-group:read', 'message:answer']);
    expect(items[1]).toMatchObject({ type: 'tool-group', groupKind: 'tool-sequence', activities: [first, last] });
    expect(source).toHaveLength(3);
    expect(access.approval?.status).toBe('approved');
    expect(messages.filter(item => item.toolCallId === access.call.id)).toHaveLength(mode === 'live-anchor' ? 2 : 0);
  });

  it('keeps a pending permission reachable, then removes its row and joins the adjacent steps after approval', () => {
    const first = tool('read', 1);
    const access = approvedAccess('access', 2);
    const pending = { ...access, status: 'awaiting_approval' as const, result: undefined,
      approval: { ...access.approval!, status: 'pending' as const } };
    const last = tool('write', 3);
    const initial = buildAgentTimelineItems([], [], [first, pending, last]);
    expect(initial.map(item => item.type)).toEqual(['tool-group', 'tool-activity', 'tool-group']);
    expect(initial[1]).toMatchObject({ activity: pending });
    const completed = buildAgentTimelineItems([], [], [first, access, last]);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ key: initial[0].key, activities: [first, last] });
  });

  it.each(['denied', 'expired', 'cancelled', 'interrupted'] as const)('retains %s permission outcomes', status => {
    const access = approvedAccess('access', 1);
    access.approval = { ...access.approval!, status };
    access.status = status === 'cancelled' || status === 'interrupted' ? status : 'failed';
    access.result = { ok: false };
    expect(buildAgentTimelineItems([], [], [access])).toMatchObject([{ type: 'tool-activity', activity: access }]);
  });

  it('does not hide incomplete success, plugin impersonation or a record carrying a business preparation', () => {
    const access = approvedAccess('access', 1);
    for (const source of [{ ...access, result: undefined }, { ...access, result: { ok: false } },
      { ...access, status: 'running' as const },
      { ...access, pluginSource: { pluginId: 'plugin', pluginVersion: '1', packageFingerprint: 'a'.repeat(64),
        toolId: 'access', registrationId: 'plugin-tool:access' } },
      { ...access, preparation: { preparedActionId: 'prepared', snapshotHash: 'hash',
        action: { kind: 'computer.windows' as const, version: 1 as const, libraryId: 3 } } }]) {
      expect(buildAgentTimelineItems([], [], [source])).toMatchObject([{ type: 'tool-activity', activity: source }]);
    }
  });
});
