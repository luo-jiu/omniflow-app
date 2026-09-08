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
    groupable?: boolean;
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
    ...(options.groupable === false ? {} : {
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

describe('Agent timeline projection', () => {
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
    ], [], [activity('activity-1', 1, { callId: 'call-1', groupable: false })]);

    expect(items.map(item => item.key)).toEqual([
      'message:user',
      'activity:activity-1',
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
    ], [run('running')], [activity('read', 2, { callId: 'call-1', groupable: false })]);
    const layers = splitAgentTimelineLayers(items);

    expect(items.map(item => item.type)).toEqual([
      'message',
      'assistant-work-item',
      'tool-activity',
      'message',
    ]);
    expect(layers.conversation.map(item => item.key)).toEqual(['message:user', 'message:final']);
    expect(layers.workJournal.map(item => item.key)).toEqual(['message:commentary']);
    expect(layers.executionFacts.map(item => item.key)).toEqual(['activity:read']);
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

  it('groups only consecutive successful read activities from the same Run and stage', () => {
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

  it.each([
    'commentary',
    'failure',
    'approval',
    'unknown',
  ] as const)('breaks a read group at a %s boundary', (boundary) => {
    const first = activity('first', 1, { callId: 'call-1' });
    const second = activity('second', 3, { callId: 'call-2' });
    const messages: AgentMessage[] = [
      toolMessage('tool-1', '2026-08-23T00:00:01.000Z', 'call-1'),
    ];
    const activities: AgentToolActivitySnapshot[] = [first];
    if (boundary === 'commentary') {
      messages.push(assistant('commentary', '2026-08-23T00:00:02.000Z', {
        content: '调整读取方向。',
        phase: 'commentary',
      }));
    } else if (boundary === 'failure') {
      const failed = activity('failed', 2, { callId: 'call-failed', status: 'failed' });
      messages.push(toolMessage('tool-failed', '2026-08-23T00:00:02.000Z', 'call-failed'));
      activities.push(failed);
    } else if (boundary === 'approval') {
      const approved = {
        ...activity('approved', 2, { callId: 'call-approved' }),
        approval: {
          approvalId: 'approval-1',
          decidedAt: '2026-08-23T00:00:02.000Z',
          preview: { description: '读取', risk: 'read' as const, title: '确认读取' },
          status: 'approved' as const,
        },
      };
      messages.push(toolMessage('tool-approved', '2026-08-23T00:00:02.000Z', 'call-approved'));
      activities.push(approved);
    } else {
      const unknown = activity('unknown', 2, { callId: 'call-unknown', groupable: false });
      messages.push(toolMessage('tool-unknown', '2026-08-23T00:00:02.000Z', 'call-unknown'));
      activities.push(unknown);
    }
    messages.push(toolMessage('tool-2', '2026-08-23T00:00:03.000Z', 'call-2'));
    activities.push(second);

    const items = buildAgentTimelineItems(messages, [], activities);
    const groups = items.filter(item => item.type === 'tool-group');
    expect(groups.some(group => (
      group.activities.some(item => item.id === 'first')
      && group.activities.some(item => item.id === 'second')
    ))).toBe(false);
    expect(groups.some(group => group.activities.some(item => item.id === 'first'))).toBe(true);
    expect(groups.some(group => group.activities.some(item => item.id === 'second'))).toBe(true);
  });

  it('keeps the group key derived from its first ToolRun when later reads append', () => {
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
    const activities = [activity('read', 1, { groupable: false })];
    const prepared = prepareAgentTimelineProjection(messages, runs, activities);

    expect(buildAgentTimelineItemsFromProjection(messages, prepared).map(item => item.key))
      .toEqual(['message:user', 'activity:read']);
  });
});
