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

function computerActivity(id: string, ordinal: number, operation: 'observe' | 'click' = 'observe', version: 1 | 2 = 1): AgentToolActivitySnapshot {
  const target = version === 1 ? { version: 1 as const, libraryId: 3, displayId: '1', displayLabel: '内置屏幕' }
    : { version: 2 as const, libraryId: 3, targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
      applicationLabel: 'OmniFlow', windowLabel: 'win 的聊天窗口' };
  return {
    ...activity(id, ordinal),
    call: { id: `call-${id}`, input: {}, name: `computer.${operation}` },
    toolMetadata: { kind: 'business', risk: operation === 'observe' ? 'read' : 'write',
      ...(operation === 'observe' ? { groupKind: 'resource-read' } : {}), builtinComputerTool: operation },
    preparation: { preparedActionId: `prepared-${id}`, snapshotHash: 'a'.repeat(64), action: operation === 'observe'
      ? { ...target, kind: 'computer.observe' }
      : { ...target, kind: 'computer.click', observationId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
        screenshotWidth: 1024, screenshotHeight: 640, x: 20, y: 30, button: 'left', clickCount: 1 },
    },
  };
}

function computerInputActivity(id: string, ordinal: number, operation: 'setText' | 'scroll'): AgentToolActivitySnapshot {
  const target = { version: 1 as const, libraryId: 3, targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
    applicationLabel: 'OmniFlow', windowLabel: '测试窗口', observationId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
    elementId: 'b5de6d3f-b8ec-4e73-a6be-81b717adf7ba' };
  return {
    ...activity(id, ordinal), call: { id: `call-${id}`, input: {}, name: `computer.${operation}` },
    toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: operation },
    preparation: { preparedActionId: `prepared-${id}`, snapshotHash: 'a'.repeat(64), action: operation === 'setText'
      ? { ...target, kind: 'computer.setText', mode: 'replace', textLength: 2, textBytes: 6 }
      : { ...target, kind: 'computer.scroll', direction: 'down', unit: 'page' } },
  };
}

describe('Agent timeline projection', () => {
  it('groups directed input with adjacent approved observations while preserving pending and unknown boundaries', () => {
    const first = computerActivity('before', 1, 'observe', 2);
    const input: AgentToolActivitySnapshot = { ...activity('input', 2),
      call: { id: 'call-input', name: 'computer.input', input: {} },
      toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: 'input' },
      preparation: { preparedActionId: 'input-action', snapshotHash: 'a'.repeat(64), action: {
        kind: 'computer.input', version: 1, libraryId: 3, targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
        applicationLabel: 'OmniFlow', windowLabel: '测试窗口', observationId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
        operation: 'doubleClick', point: { x: 10, y: 20 },
      } } };
    const last = computerActivity('after', 3, 'observe', 2);
    const joined = buildAgentTimelineItems([], [], [first, input, last]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ type: 'tool-group', groupKind: 'computer-use', activities: [first, input, last] });
    const initial = { ...input, status: 'preparing' as const, preparation: undefined, result: undefined, finishedAt: undefined };
    expect(buildAgentTimelineItems([], [], [first, initial, last])).toHaveLength(1);
    const boundaries = [
      { ...input, status: 'awaiting_approval' as const, permissionBehavior: 'ask' as const,
        approval: { approvalId: 'approval', status: 'pending' as const, preview: { title: '待确认', description: '确认窗口输入', risk: 'write' as const } } },
      { ...input, status: 'failed' as const, result: { ok: false, data: { dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } } },
      { ...input, toolMetadata: undefined },
    ];
    for (const boundary of boundaries) {
      const separated = buildAgentTimelineItems([], [], [first, boundary, last]);
      expect(separated).toHaveLength(3);
      expect(separated[1]).toMatchObject({ type: 'tool-activity', activity: boundary });
    }
  });
  it('groups AX-only observations and semantic clicks without image coordinates', () => {
    const before = computerActivity('before', 1, 'observe', 2);
    before.preparation!.action = { ...before.preparation!.action, mode: 'ax' } as never;
    const click = computerActivity('click', 2, 'click', 2);
    click.preparation!.action = { kind: 'computer.click', version: 3, libraryId: 3,
      targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a', applicationLabel: 'OmniFlow', windowLabel: 'win 的聊天窗口',
      observationId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', elementId: 'b5de6d3f-b8ec-4e73-a6be-81b717adf7ba',
      button: 'left', clickCount: 1 };
    const after = { ...before, id: 'after', ordinal: 3, call: { ...before.call, id: 'call-after' } };
    const activities = [before, click, after];
    const items = buildAgentTimelineItems(activities.map(value => toolMessage(`tool-${value.id}`, value.createdAt, value.call.id)), [], activities);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'tool-group', groupKind: 'computer-use', activities });
    click.result = { ok: false, data: { dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } };
    const uncertain = buildAgentTimelineItems(activities.map(value => toolMessage(`tool-${value.id}`, value.createdAt, value.call.id)), [], activities);
    expect(uncertain).toHaveLength(3);
    expect(uncertain[1]).toMatchObject({ type: 'tool-activity', activity: click });
  });

  it.each(['observe', 'click', 'setText', 'scroll'] as const)(
    'keeps an initial preparing %s in the same computer entry before its action is available', operation => {
      const first = computerActivity('first', 1, 'observe', 2);
      const next = operation === 'observe' || operation === 'click'
        ? computerActivity('next', 2, operation, 2) : computerInputActivity('next', 2, operation);
      const preparing: AgentToolActivitySnapshot = { ...next, preparation: undefined, result: undefined,
        status: 'preparing', permissionBehavior: operation === 'observe' ? 'allow' : 'ask' };
      const messages = [toolMessage('tool-first', first.createdAt, first.call.id)];
      const initial = buildAgentTimelineItems(messages, [], [first]);
      messages.push(toolMessage('tool-next', preparing.createdAt, preparing.call.id));
      const stages = [preparing, { ...next, status: 'running' as const, result: undefined }, next];
      for (const stage of stages) {
        const items = buildAgentTimelineItems(messages, [], [first, stage]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ type: 'tool-group', groupKind: 'computer-use', key: initial[0].key });
        expect(items[0].type === 'tool-group' && items[0].activities).toEqual([first, stage]);
      }
      expect(preparing.preparation).toBeUndefined();
      expect(preparing.approval).toBeUndefined();
      expect(preparing.result).toBeUndefined();
      expect(preparing.permissionBehavior).toBe(operation === 'observe' ? 'allow' : 'ask');
    },
  );

  it.each(['pending', 'interaction', 'unknown', 'missing-marker', 'plugin', 'deny', 'running', 'completed', 'partial-preparation', 'finished', 'wrong-risk'] as const)(
    'keeps an initial %s computer record outside the preparing display group', boundary => {
      let middle: AgentToolActivitySnapshot = { ...computerInputActivity('middle', 2, 'scroll'),
        status: 'preparing', permissionBehavior: 'ask', preparation: undefined, result: undefined };
      if (boundary === 'pending') {
        middle.approval = { approvalId: 'pending', status: 'pending',
          preview: { title: '确认窗口操作', description: '待确认', risk: 'write' } };
      } else if (boundary === 'interaction') {
        middle.interaction = { interactionId: 'input', status: 'pending',
          request: { kind: 'choice', prompt: '选择', options: [{ id: 'continue', label: '继续' }] } };
      } else if (boundary === 'unknown') {
        middle.result = { ok: false, message: '结果未知', data: { dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } };
      } else if (boundary === 'missing-marker') {
        middle.toolMetadata = { kind: 'business', risk: 'write' };
      } else if (boundary === 'plugin') {
        middle = { ...middle, pluginSource: { pluginId: 'fake', pluginVersion: '1', packageFingerprint: 'a'.repeat(64),
          toolId: 'scroll', registrationId: 'plugin-tool:fake' } };
      } else if (boundary === 'deny') {
        middle.permissionBehavior = 'deny';
      } else if (boundary === 'partial-preparation') {
        middle.preparation = { preparedActionId: 'partial' } as AgentToolActivitySnapshot['preparation'];
      } else if (boundary === 'finished') {
        middle.finishedAt = middle.createdAt;
      } else if (boundary === 'wrong-risk') {
        middle.toolMetadata = { ...middle.toolMetadata!, risk: 'read' };
      } else {
        middle.status = boundary;
      }
      const items = buildAgentTimelineItems([], [], [computerActivity('first', 1, 'observe', 2), middle,
        computerActivity('last', 3, 'observe', 2)]);
      expect(items.map(item => item.type)).toEqual(['tool-group', 'tool-activity', 'tool-group']);
      expect(items[1]).toMatchObject({ activity: middle });
    },
  );

  it('keeps observed text input and scrolling in the approved computer group with their original order', () => {
    const first = computerActivity('first', 1, 'observe', 2);
    first.permissionBehavior = 'ask';
    first.approval = { approvalId: 'share-approval', status: 'approved',
      preview: { title: '共享窗口', description: '允许点击、文本输入、滚动', risk: 'write' } };
    const sequence = [first, computerInputActivity('text', 2, 'setText'), computerActivity('after-text', 3, 'observe', 2),
      computerInputActivity('scroll', 4, 'scroll'), computerActivity('after-scroll', 5, 'observe', 2)];
    const items = buildAgentTimelineItems([], [], sequence);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'tool-group', groupKind: 'computer-use' });
    expect(items[0].type === 'tool-group' && items[0].activities.map(item => item.id))
      .toEqual(sequence.map(item => item.id));
  });

  it.each((['setText', 'scroll'] as const).flatMap(operation => (
    ['pending', 'unknown', 'plugin', 'missing-marker', 'malformed-action'] as const
  ).map(boundary => [operation, boundary] as const)))(
    'keeps %s %s visible outside the computer group', (operation, boundary) => {
      let middle = computerInputActivity('middle', 2, operation);
      if (boundary === 'pending') {
        middle.permissionBehavior = 'ask'; middle.status = 'awaiting_approval';
        middle.approval = { approvalId: 'pending', status: 'pending',
          preview: { title: '确认窗口操作', description: '待确认', risk: 'write' } };
      } else if (boundary === 'unknown') {
        middle.status = 'failed'; middle.result = { ok: false, message: '结果未知',
          data: { dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } };
      } else if (boundary === 'plugin') {
        middle = { ...middle, pluginSource: { pluginId: 'fake', pluginVersion: '1', packageFingerprint: 'a'.repeat(64),
          toolId: operation, registrationId: 'plugin-tool:fake' } };
      } else if (boundary === 'missing-marker') {
        middle.toolMetadata = { kind: 'business', risk: 'write' };
      } else {
        middle.preparation!.action = { ...middle.preparation!.action, text: 'not public' } as never;
      }
      const items = buildAgentTimelineItems([], [], [computerActivity('first', 1, 'observe', 2), middle,
        computerActivity('last', 3, 'observe', 2)]);
      expect(items.map(item => item.type)).toEqual(['tool-group', 'tool-activity', 'tool-group']);
      expect(items[1]).toMatchObject({ activity: middle });
    },
  );

  it.each(['setText', 'scroll'] as const)('retains a definite failed %s operation in the computer group for manual audit', operation => {
    const failed = computerInputActivity('failed', 2, operation);
    failed.status = 'failed'; failed.result = { ok: false, message: '控件不支持该操作，未发送',
      data: { dispatchState: 'not_dispatched', mutationCommitState: 'uncommitted' } };
    const items = buildAgentTimelineItems([], [], [computerActivity('first', 1, 'observe', 2), failed]);
    expect(items).toHaveLength(1);
    expect(items[0].type === 'tool-group' && items[0].activities[1]).toEqual(failed);
  });

  it.each([1, 2] as const)('keeps V%s approved observation, click and follow-up observation in one stable computer group', version => {
    const first = computerActivity('observe-first', 1, 'observe', version);
    first.permissionBehavior = 'ask';
    first.approval = { approvalId: 'share-approval', status: 'approved',
      preview: { title: '共享屏幕', description: '本次任务查看屏幕', risk: 'read' } };
    const click = computerActivity('click', 2, 'click', version);
    const last = computerActivity('observe-last', 3, 'observe', version);
    const initial = buildAgentTimelineItems([], [], [first]);
    const items = buildAgentTimelineItems([], [], [first, click, last]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'tool-group', groupKind: 'computer-use', key: initial[0].key });
    expect(items[0].type === 'tool-group' && items[0].activities.map(item => item.id))
      .toEqual(['observe-first', 'click', 'observe-last']);
  });

  it.each(['commentary', 'assistant', 'user', 'other-tool', 'other-run'] as const)(
    'does not merge computer operations across a %s boundary', boundary => {
      const first = computerActivity('first', 1);
      const last = computerActivity('last', 3);
      const messages: AgentMessage[] = [toolMessage('tool-first', first.createdAt, first.call.id)];
      const activities = [first, last];
      if (boundary === 'other-tool') {
        const other = activity('read', 2);
        activities.splice(1, 0, other);
        messages.push(toolMessage('tool-other', other.createdAt, other.call.id));
      } else if (boundary === 'other-run') {
        last.runId = 'run-2';
      } else {
        messages.push(boundary === 'user' ? user('next-user', '2026-08-23T00:00:02.000Z')
          : assistant('process-message', '2026-08-23T00:00:02.000Z', {
            phase: boundary === 'commentary' ? 'commentary' : 'final', content: '过程说明',
          }));
      }
      messages.push(toolMessage('tool-last', last.createdAt, last.call.id, last.runId));
      const items = buildAgentTimelineItems(messages, [], activities);
      const computerGroups = items.filter(item => item.type === 'tool-group' && item.groupKind === 'computer-use');
      expect(computerGroups).toHaveLength(2);
      expect(computerGroups.every(item => item.type === 'tool-group' && item.activities.length === 1)).toBe(true);
    },
  );

  it.each(['pending', 'unknown', 'missing-marker', 'malformed-action', 'plugin'] as const)(
    'keeps %s computer activity visible outside the computer group', boundary => {
      let middle = computerActivity('middle', 2, 'click');
      if (boundary === 'pending') {
        middle.permissionBehavior = 'ask'; middle.status = 'awaiting_approval';
        middle.approval = { approvalId: 'pending-share', status: 'pending',
          preview: { title: '共享屏幕', description: '待确认', risk: 'read' } };
      } else if (boundary === 'unknown') {
        middle.status = 'failed';
        middle.result = { ok: false, message: '点击结果未知', data: { dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } };
      } else if (boundary === 'missing-marker') {
        middle.toolMetadata = { kind: 'business', risk: 'write' };
      } else if (boundary === 'malformed-action') {
        middle.preparation = { ...middle.preparation!, action: { ...middle.preparation!.action, unexpected: true } as never };
      } else {
        middle = { ...middle, pluginSource: { pluginId: 'fake', pluginVersion: '1.0.0',
          packageFingerprint: 'b'.repeat(64), toolId: 'click', registrationId: 'fake-registration' } };
      }
      const items = buildAgentTimelineItems([], [], [computerActivity('first', 1), middle, computerActivity('last', 3)]);
      expect(items.map(item => item.type)).toEqual(['tool-group', 'tool-activity', 'tool-group']);
      expect(items[1]).toMatchObject({ activity: middle });
    },
  );

  it('groups consecutive completed internal operations in one run', () => {
    const base = {
      createdAt: '2026-09-12T00:00:00.000Z', id: 'run-internal', ordinal: 1,
      permissionBehavior: 'allow' as const, revision: 1, runId: 'run-internal', sessionId: 'session-internal',
      status: 'completed' as const,
    };
    const activities: AgentToolActivitySnapshot[] = [
      { ...base, id: 'move-1', call: { id: 'move-1', name: 'file.move', input: {} }, toolMetadata: { kind: 'business', risk: 'write' } },
      { ...base, id: 'move-2', ordinal: 2, call: { id: 'move-2', name: 'file.move', input: {} }, toolMetadata: { kind: 'business', risk: 'write' } },
      { ...base, id: 'delete-1', ordinal: 3, call: { id: 'delete-1', name: 'file.delete', input: {} }, toolMetadata: { kind: 'business', risk: 'destructive' } },
    ];
    const items = buildAgentTimelineItemsFromProjection([], prepareAgentTimelineProjection([], [], activities));
    const groups = items.filter(item => item.type === 'tool-group');
    expect(groups).toHaveLength(1);
    expect(groups[0].type === 'tool-group' && groups[0].groupKind).toBe('internal-operation');
    expect(groups[0].type === 'tool-group' && groups[0].activities.map(item => item.id)).toEqual(['move-1', 'move-2', 'delete-1']);
  });

  it.each(['allow', 'ask', 'deny'] as const)(
    'keeps consecutive failed internal operations in the group after an %s decision', permissionBehavior => {
      const activities: AgentToolActivitySnapshot[] = [
        activity('first', 1),
        activity('failed', 2, { status: 'failed', permissionBehavior }),
        activity('failed-again', 3, { status: 'failed', permissionBehavior }),
        activity('last', 4),
      ].map(item => ({
        ...item,
        call: { ...item.call, name: 'file.delete' },
        toolMetadata: { kind: 'business', risk: 'write' },
        ...(item.status === 'failed' ? {
          result: { ok: false, message: '目标节点不存在' },
          ...(permissionBehavior === 'ask' ? {
            approval: {
              approvalId: `approval-${item.id}`,
              preview: { title: '移入回收站', description: '删除选中文件', risk: 'write' as const },
              status: 'approved' as const,
            },
          } : {}),
        } : {}),
      }));

      const items = buildAgentTimelineItems([], [], activities);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'tool-group',
        groupKind: 'internal-operation',
        key: 'activity-group:first',
        activities,
      });
    },
  );

  it('keeps a failed read between successful reads in the same group', () => {
    const failed = {
      ...activity('failed', 2, { status: 'failed', permissionBehavior: 'deny' }),
      result: { ok: false, message: '无法读取文件' },
    };
    const activities = [activity('first', 1), failed, activity('last', 3)];

    expect(buildAgentTimelineItems([], [], activities)).toMatchObject([{
      type: 'tool-group',
      groupKind: 'resource-read',
      key: 'activity-group:first',
      activities,
    }]);
  });

  it.each(['approval', 'interaction'] as const)(
    'keeps a pending %s outside the group even when a failed snapshot arrives', pendingKind => {
      const pending: AgentToolActivitySnapshot = {
        ...activity('pending', 2, { status: 'failed', permissionBehavior: 'deny' }),
        result: { ok: false, message: '执行失败' },
        ...(pendingKind === 'approval' ? {
          approval: {
            approvalId: 'approval-pending',
            preview: { title: '读取文件', description: '确认读取', risk: 'read' as const },
            status: 'pending' as const,
          },
        } : {
          interaction: {
            interactionId: 'interaction-pending',
            request: { kind: 'choice' as const, prompt: '选择文件', options: [{ id: 'file', label: '文件' }] },
            status: 'pending' as const,
          },
        }),
      };

      const items = buildAgentTimelineItems([], [], [activity('first', 1), pending, activity('last', 3)]);

      expect(items.map(item => item.type)).toEqual(['tool-group', 'tool-activity', 'tool-group']);
      expect(items[1]).toMatchObject({ activity: pending });
    },
  );
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
