import { describe, expect, it } from 'vitest';

import type {
  AgentAssistantItemSnapshot,
  AgentMessage,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import {
  buildAgentTimelineItems,
  buildAgentTimelineItemsFromProjection,
  prepareAgentTimelineProjection,
  splitAgentTimelineLayers,
} from './agent-timeline';

function user(id: string, createdAt: string, runId = 'run-1'): AgentMessage {
  return {
    content: id,
    createdAt,
    id,
    role: 'user',
    runId,
    sessionId: 'session-1',
  };
}

function assistant(
  id: string,
  createdAt: string,
  options: {
    content?: string;
    phase?: AgentAssistantItemSnapshot['assistantItem']['phase'];
    runId?: string;
    status?: AgentAssistantItemSnapshot['assistantItem']['status'];
    turnOrdinal?: number;
  } = {},
): AgentAssistantItemSnapshot {
  const status = options.status || 'completed';
  return {
    assistantItem: {
      ...(status === 'streaming' ? {} : { finishedAt: createdAt }),
      phase: options.phase || 'final',
      revision: status === 'streaming' ? 1 : 2,
      status,
      turnOrdinal: options.turnOrdinal || 1,
      updatedAt: createdAt,
    },
    content: options.content ?? id,
    createdAt,
    id,
    role: 'assistant',
    runId: options.runId || 'run-1',
    sessionId: 'session-1',
  };
}

function toolMessage(
  id: string,
  createdAt: string,
  callId: string,
  runId = 'run-1',
): AgentMessage {
  return {
    content: id,
    createdAt,
    id,
    role: 'tool',
    runId,
    sessionId: 'session-1',
    toolCallId: callId,
    toolName: 'file.list',
  };
}

function activity(
  id: string,
  ordinal: number,
  options: {
    callId?: string;
    metadata?: boolean;
    permissionBehavior?: AgentToolActivitySnapshot['permissionBehavior'];
    runId?: string;
    status?: AgentToolActivitySnapshot['status'];
  } = {},
): AgentToolActivitySnapshot {
  const runId = options.runId || 'run-1';
  const status = options.status || 'completed';
  return {
    call: { id: options.callId || `call-${id}`, input: {}, name: 'file.list' },
    createdAt: `2026-08-23T00:00:0${ordinal}.000Z`,
    id,
    ordinal,
    permissionBehavior: options.permissionBehavior || 'allow',
    result: status === 'completed' ? { message: `${id} 完成`, ok: true } : undefined,
    revision: 1,
    runId,
    sessionId: 'session-1',
    status,
    ...(options.metadata === false ? {} : {
      toolMetadata: {
        groupKind: 'resource-read' as const,
        kind: 'business' as const,
        operationKind: 'list' as const,
        risk: 'read' as const,
      },
    }),
  };
}

function run(
  status: AgentRunSnapshot['status'] = 'completed',
  options: { id?: string; plan?: boolean } = {},
): AgentRunSnapshot {
  const id = options.id || 'run-1';
  return {
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    model: 'model-a',
    ...(options.plan ? {
      plan: {
        createdAt: '2026-08-23T00:00:00.500Z',
        steps: [{ expectedToolName: 'file.list', id: 'step-1', ordinal: 1, title: '读取目录' }],
        version: 1 as const,
      },
    } : {}),
    profileId: 'profile-a',
    reasoningEffort: 'medium',
    revision: 1,
    sessionId: 'session-1',
    status,
    updatedAt: '2026-08-23T00:00:09.000Z',
    userPrompt: '读取目录',
  };
}

function computerActivity(id: string, ordinal: number, operation: 'observe' | 'click' | 'windows' = 'observe'): AgentToolActivitySnapshot {
  return {
    ...activity(id, ordinal),
    call: { id: `call-${id}`, input: {}, name: `computer.${operation}` },
    toolMetadata: {
      kind: 'business', risk: operation === 'click' ? 'write' : 'read', builtinComputerTool: operation,
    },
  };
}

function anchoredActivities(activities: AgentToolActivitySnapshot[]): AgentMessage[] {
  return activities.map(value => ({
    ...toolMessage(`tool-${value.id}`, value.createdAt, value.call.id, value.runId),
    sessionId: value.sessionId,
    toolName: value.call.name,
  }));
}

describe('Agent timeline projection', () => {
  it('groups consecutive reads, writes, computer input, Shell and plugin tools without changing execution facts', () => {
    const read = activity('read', 1);
    const write: AgentToolActivitySnapshot = {
      ...activity('write', 2), call: { id: 'call-write', name: 'file.move', input: {} },
      permissionBehavior: 'ask',
      approval: { approvalId: 'approve-write', status: 'approved',
        preview: { title: '移动文件', description: '确认移动', risk: 'write' } },
      toolMetadata: { kind: 'business', risk: 'write' },
    };
    const click = computerActivity('click', 3, 'click');
    const shell: AgentToolActivitySnapshot = {
      ...activity('shell', 4), call: { id: 'call-shell', name: 'shell.run', input: { cmd: 'pwd' } },
      toolMetadata: { kind: 'business', risk: 'external' },
    };
    const plugin: AgentToolActivitySnapshot = {
      ...activity('plugin', 5), call: { id: 'call-plugin', name: 'plugin.example', input: {} },
      pluginSource: { pluginId: 'example', pluginVersion: '1', packageFingerprint: 'a'.repeat(64),
        toolId: 'example', registrationId: 'plugin:example' },
      toolMetadata: undefined,
    };
    const unknown: AgentToolActivitySnapshot = {
      ...activity('unknown', 6, { metadata: false, status: 'failed', permissionBehavior: 'deny' }),
      call: { id: 'call-unknown', name: 'unknown.operation', input: {} },
      result: { ok: false, message: '结果未确认', data: { dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } },
    };
    const activities = [read, write, click, shell, plugin, unknown];
    const items = buildAgentTimelineItems(anchoredActivities(activities), [], [...activities].reverse());

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'tool-group', groupKind: 'tool-sequence', key: 'activity-group:read', activities,
    });
    if (items[0].type !== 'tool-group') throw new Error('Expected a tool sequence');
    items[0].activities.forEach((value, index) => expect(value).toBe(activities[index]));
    expect(items[0].activities.at(-1)?.result).toBe(unknown.result);
    expect(items[0].activities[1].approval?.status).toBe('approved');
  });

  it('keeps window discovery, observation and clicking in the same consecutive sequence', () => {
    const activities = [
      computerActivity('windows', 1, 'windows'), computerActivity('observe', 2),
      computerActivity('click', 3, 'click'), activity('read', 4),
    ];
    const items = buildAgentTimelineItems(anchoredActivities(activities), [], activities);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'tool-group', groupKind: 'tool-sequence', activities });
  });

  it.each(['preparing', 'running', 'completed', 'failed', 'cancelled', 'interrupted'] as const)(
    'retains a %s execution in its sequence without inferring authorization or success', status => {
      const first = activity('first', 1);
      const middle = activity('middle', 2, { status, permissionBehavior: 'ask', metadata: false });
      if (status === 'failed') middle.result = { ok: false, message: '执行失败' };
      const last = activity('last', 3);
      const activities = [first, middle, last];
      const items = buildAgentTimelineItems(anchoredActivities(activities), [], activities);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: 'tool-group', groupKind: 'tool-sequence', activities });
      expect(items[0].type === 'tool-group' && items[0].activities[1]).toBe(middle);
      expect(middle.approval).toBeUndefined();
      expect(middle.preparation).toBeUndefined();
      expect(middle.status).toBe(status);
    },
  );

  it.each(['allow', 'ask', 'deny'] as const)(
    'preserves failed execution details after an %s decision within the same sequence', permissionBehavior => {
      const failed: AgentToolActivitySnapshot = {
        ...activity('failed', 2, { status: 'failed', permissionBehavior }),
        result: { ok: false, message: '无法读取文件', data: { dispatchState: 'unknown' } },
      };
      const activities = [activity('first', 1), failed, activity('last', 3)];
      const items = buildAgentTimelineItems(anchoredActivities(activities), [], activities);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: 'tool-group', groupKind: 'tool-sequence', activities });
      expect(items[0].type === 'tool-group' && items[0].activities[1]).toBe(failed);
    },
  );

  it.each(['pending-approval', 'awaiting-approval', 'awaiting-interaction'] as const)(
    'keeps %s as a separate visible entry between execution sequences', boundary => {
      const middle = activity('middle', 2, { status: boundary === 'pending-approval' ? 'failed'
        : boundary === 'awaiting-approval' ? 'awaiting_approval' : 'awaiting_interaction' });
      if (boundary === 'pending-approval') middle.approval = {
        approvalId: 'approval-pending', status: 'pending',
        preview: { title: '确认操作', description: '待用户确认', risk: 'write' },
      };
      const activities = [activity('first', 1), middle, activity('last', 3)];
      const items = buildAgentTimelineItems(anchoredActivities(activities), [], activities);

      expect(items.map(item => item.type)).toEqual(['tool-group', 'tool-activity', 'tool-group']);
      expect(items[1]).toMatchObject({ key: 'activity:middle', activity: middle });
    },
  );

  it.each(['pending', 'submitted', 'expired', 'cancelled', 'interrupted'] as const)(
    'retains a %s user interaction outside the surrounding tool sequences', status => {
      const interaction: AgentToolActivitySnapshot = {
        ...activity('interaction', 2),
        interaction: {
          interactionId: 'interaction-1', status,
          request: { kind: 'choice', prompt: '选择文件', options: [{ id: 'file', label: '文件' }] },
          ...(status === 'submitted' ? { response: { kind: 'choice' as const, selectedOptionIds: ['file'] } } : {}),
        },
      };
      const activities = [activity('first', 1), interaction, activity('last', 3)];
      const items = buildAgentTimelineItems(anchoredActivities(activities), [], activities);

      expect(items.map(item => item.type)).toEqual(['tool-group', 'tool-activity', 'tool-group']);
      expect(items[1]).toMatchObject({ key: 'activity:interaction', activity: interaction });
      expect(items[1].type === 'tool-activity' && items[1].activity.interaction).toBe(interaction.interaction);
    },
  );

  it.each(['commentary', 'assistant', 'user', 'streaming-placeholder'] as const)(
    'starts a new sequence after a visible %s message', boundary => {
      const first = activity('first', 1);
      const last = computerActivity('last', 3, 'click');
      const divider = boundary === 'user'
        ? user('divider', '2026-08-23T00:00:02.000Z')
        : assistant('divider', '2026-08-23T00:00:02.000Z', {
          phase: boundary === 'commentary' ? 'commentary' : boundary === 'assistant' ? 'final' : 'unknown',
          ...(boundary === 'streaming-placeholder' ? { content: '', status: 'streaming' } : { content: '过程说明' }),
        });
      const items = buildAgentTimelineItems([
        ...anchoredActivities([first]), divider, ...anchoredActivities([last]),
      ], [], [first, last]);

      expect(items.map(item => item.key)).toEqual([
        'activity-group:first', 'message:divider', 'activity-group:last',
      ]);
      expect(items.filter(item => item.type === 'tool-group')).toHaveLength(2);
    },
  );

  it('does not let invisible empty commentary split otherwise consecutive tools', () => {
    const activities = [activity('first', 1), activity('last', 3)];
    const items = buildAgentTimelineItems([
      ...anchoredActivities([activities[0]]),
      assistant('empty-commentary', '2026-08-23T00:00:02.000Z', { phase: 'commentary', content: '' }),
      ...anchoredActivities([activities[1]]),
    ], [], activities);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'tool-group', groupKind: 'tool-sequence', activities });
  });

  it.each(['run', 'session'] as const)('does not merge consecutive tools across a %s boundary', boundary => {
    const first = activity('first', 1);
    const last = { ...activity('last', 2), ...(boundary === 'run' ? { runId: 'run-2' } : { sessionId: 'session-2' }) };
    const items = buildAgentTimelineItems(anchoredActivities([first, last]), [], [first, last]);

    expect(items.map(item => item.key)).toEqual(['activity-group:first', 'activity-group:last']);
    expect(items.every(item => item.type === 'tool-group' && item.activities.length === 1)).toBe(true);
  });

  it('keeps the first sequence key when a later pending business approval is resolved and execution continues', () => {
    const first = activity('first', 1);
    const pending: AgentToolActivitySnapshot = {
      ...activity('write', 2, { status: 'awaiting_approval', permissionBehavior: 'ask' }),
      call: { id: 'call-write', name: 'file.move', input: {} },
      approval: { approvalId: 'approve-write', status: 'pending',
        preview: { title: '移动文件', description: '确认移动', risk: 'write' } },
    };
    const last = activity('last', 3);
    const messages = anchoredActivities([first, pending, last]);
    const initial = buildAgentTimelineItems(messages, [], [first, pending, last]);
    const approved: AgentToolActivitySnapshot = {
      ...pending, status: 'running', revision: pending.revision + 1,
      approval: { ...pending.approval!, status: 'approved' },
    };
    const resolved = buildAgentTimelineItems(messages, [], [first, approved, last]);

    expect(initial.map(item => item.key)).toEqual(['activity-group:first', 'activity:write', 'activity-group:last']);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      type: 'tool-group', groupKind: 'tool-sequence', key: initial[0].key, activities: [first, approved, last],
    });
    expect(resolved[0].type === 'tool-group' && resolved[0].activities[1].approval?.status).toBe('approved');
  });

  it('retains an empty failed run after restoring canonical history', () => {
    const items = buildAgentTimelineItems([
      user('question', '2026-09-07T00:00:00Z'),
      assistant('empty', '2026-09-07T00:00:01Z', { content: '', status: 'failed', phase: 'unknown' }),
    ], [{ ...run('failed'), error: 'Provider unavailable' }], []);
    expect(items.map(item => item.type)).toEqual(['message', 'run-status']);
    expect(items[1]).toMatchObject({ run: { error: 'Provider unavailable' } });
  });
  it('replaces persisted Tool text with its canonical activity', () => {
    const items = buildAgentTimelineItems([
      user('user', '2026-08-23T00:00:00.000Z'),
      toolMessage('tool', '2026-08-23T00:00:01.000Z', 'call-1'),
      assistant('answer', '2026-08-23T00:00:02.000Z'),
    ], [], [activity('activity-1', 1, { callId: 'call-1', metadata: false })]);

    expect(items.map(item => item.key)).toEqual([
      'message:user',
      'activity-group:activity-1',
      'message:answer',
    ]);
  });

  it('does not render unmatched raw Tool or system messages as conversation text', () => {
    const items = buildAgentTimelineItems([
      toolMessage('unmatched', '2026-08-23T00:00:00.000Z', 'missing'),
      {
        content: 'system',
        createdAt: '2026-08-23T00:00:01.000Z',
        id: 'system',
        role: 'system',
        sessionId: 'session-1',
      },
    ], [], []);

    expect(items).toEqual([]);
  });

  it('splits conversation, work journal, and execution facts without changing item order', () => {
    const items = buildAgentTimelineItems([
      user('user', '2026-08-23T00:00:00.000Z'),
      assistant('commentary', '2026-08-23T00:00:01.000Z', {
        content: '先检查目录。',
        phase: 'commentary',
      }),
      toolMessage('tool', '2026-08-23T00:00:02.000Z', 'call-1'),
      assistant('final', '2026-08-23T00:00:03.000Z'),
    ], [run('running')], [activity('read', 2, { callId: 'call-1', metadata: false })]);
    const layers = splitAgentTimelineLayers(items);

    expect(items.map(item => item.type)).toEqual([
      'message',
      'assistant-work-item',
      'tool-group',
      'message',
    ]);
    expect(layers.conversation.map(item => item.key)).toEqual(['message:user', 'message:final']);
    expect(layers.workJournal.map(item => item.key)).toEqual(['message:commentary']);
    expect(layers.executionFacts.map(item => item.key)).toEqual(['activity-group:read']);
  });

  it('keeps a stable message identity while assistant phase and revision change', () => {
    const streaming = buildAgentTimelineItems([
      assistant('item-1', '2026-08-23T00:00:01.000Z', {
        content: '正在整理',
        phase: 'unknown',
        status: 'streaming',
      }),
    ], [], []);
    const completed = buildAgentTimelineItems([
      assistant('item-1', '2026-08-23T00:00:01.000Z', {
        content: '整理完成',
        phase: 'final',
        status: 'completed',
      }),
    ], [], []);

    expect(streaming[0].key).toBe('message:item-1');
    expect(completed[0].key).toBe('message:item-1');
  });

  it('suppresses empty commentary and empty terminal incomplete items', () => {
    const emptyStates: AgentAssistantItemSnapshot['assistantItem']['status'][] = [
      'failed',
      'cancelled',
      'interrupted',
    ];
    const messages = [
      assistant('commentary', '2026-08-23T00:00:01.000Z', {
        content: '   ',
        phase: 'commentary',
      }),
      ...emptyStates.map((status, index) => assistant(
        `empty-${status}`,
        `2026-08-23T00:00:0${index + 2}.000Z`,
        { content: '', phase: 'unknown', status },
      )),
    ];

    expect(buildAgentTimelineItems(messages, [], [])).toEqual([]);
  });

  it('does not add standalone workflow chrome for a planned Run', () => {
    const items = buildAgentTimelineItems([
      user('user', '2026-08-23T00:00:00.000Z'),
      assistant('answer', '2026-08-23T00:00:03.000Z'),
    ], [run('running', { plan: true })], []);

    expect(items.map(item => item.key)).toEqual([
      'message:user',
      'message:answer',
    ]);
  });

  it('keeps terminal commentary without adding standalone workflow chrome', () => {
    const items = buildAgentTimelineItems([
      user('user', '2026-08-23T00:00:00.000Z'),
      assistant('later-commentary', '2026-08-23T00:00:03.000Z', {
        content: '中段输出仍被截断；改为提取章节要点。',
        phase: 'commentary',
      }),
    ], [{ ...run('cancelled'), currentStep: '已取消' }], []);

    expect(items.map(item => item.key)).toEqual([
      'message:user',
      'message:later-commentary',
      'run-status:run-1',
    ]);
  });

  it('does not add workflow chrome to a completed Tool-free plain conversation', () => {
    const items = buildAgentTimelineItems([
      user('user', '2026-08-23T00:00:00.000Z'),
      assistant('answer', '2026-08-23T00:00:01.000Z'),
    ], [run('completed')], []);
    expect(items.map(item => item.type)).toEqual(['message', 'message']);
  });

  it('groups consecutive tools from the same Session and Run', () => {
    const activities = [
      activity('first', 1, { callId: 'call-1' }),
      activity('second', 2, { callId: 'call-2' }),
    ];
    const items = buildAgentTimelineItems([
      toolMessage('tool-1', '2026-08-23T00:00:01.000Z', 'call-1'),
      toolMessage('tool-2', '2026-08-23T00:00:02.000Z', 'call-2'),
    ], [], activities);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'activity-group:first',
      type: 'tool-group',
    });
    if (items[0].type === 'tool-group') {
      expect(items[0].activities.map(item => item.id)).toEqual(['first', 'second']);
    }
  });

  it('keeps the group key derived from its first ToolRun when later tools append', () => {
    const firstMessages = [toolMessage('tool-1', '2026-08-23T00:00:01.000Z', 'call-1')];
    const firstActivities = [activity('first', 1, { callId: 'call-1' })];
    const initial = buildAgentTimelineItems(firstMessages, [], firstActivities);
    const appended = buildAgentTimelineItems([
      ...firstMessages,
      toolMessage('tool-2', '2026-08-23T00:00:02.000Z', 'call-2'),
    ], [], [
      ...firstActivities,
      activity('second', 2, { callId: 'call-2' }),
    ]);

    expect(initial[0].key).toBe('activity-group:first');
    expect(appended[0].key).toBe(initial[0].key);
  });

  it('prepares indexes once and reuses them for the final projection', () => {
    const messages = [user('user', '2026-08-23T00:00:00.000Z')];
    const runs = [run('running')];
    const activities = [activity('read', 1, { metadata: false })];
    const prepared = prepareAgentTimelineProjection(messages, runs, activities);

    expect(buildAgentTimelineItemsFromProjection(messages, prepared).map(item => item.key))
      .toEqual(['message:user', 'activity-group:read']);
  });
});
