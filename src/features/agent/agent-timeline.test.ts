import { describe, expect, it } from 'vitest';

import type {
  AgentMessage,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import {
  buildAgentTimelineItems,
  buildAgentTimelineItemsFromProjection,
  prepareAgentTimelineProjection,
} from './agent-timeline';

function message(
  id: string,
  role: AgentMessage['role'],
  createdAt: string,
  toolCallId?: string,
  runId = 'run-1',
): AgentMessage {
  return {
    content: id,
    createdAt,
    id,
    role,
    runId,
    sessionId: 'session-1',
    ...(toolCallId ? { toolCallId, toolName: 'file.list' } : {}),
  };
}

function activity(
  createdAt: string,
  runId = 'run-1',
  callId = 'call-1',
  ordinal = 1,
): AgentToolActivitySnapshot {
  return {
    call: { id: callId, input: {}, name: 'file.list' },
    createdAt,
    id: `activity-${runId}-${callId}`,
    ordinal,
    permissionBehavior: 'allow',
    result: { message: '读取完成', ok: true },
    revision: 1,
    runId,
    sessionId: 'session-1',
    status: 'completed',
  };
}

function run(
  status: AgentRunSnapshot['status'] = 'completed',
  id = 'run-1',
  createdAt = '2026-08-23T00:00:00.000Z',
): AgentRunSnapshot {
  return {
    createdAt,
    currentStep: status === 'completed' ? '已完成' : '请求 AI 服务',
    id,
    model: 'model-a',
    profileId: 'profile-a',
    reasoningEffort: 'medium',
    revision: 1,
    sessionId: 'session-1',
    status,
    updatedAt: createdAt,
    userPrompt: '读取目录',
  };
}

function withPlan(snapshot: AgentRunSnapshot): AgentRunSnapshot {
  return {
    ...snapshot,
    plan: {
      createdAt: '2026-08-23T00:00:00.500Z',
      steps: [
        {
          expectedToolName: 'file.list',
          id: 'step-1',
          ordinal: 1,
          title: '读取目录',
        },
        {
          expectedToolName: 'file.stat',
          id: 'step-2',
          ordinal: 2,
          title: '检查文件',
        },
      ],
      version: 1,
    },
  };
}

describe('Agent timeline projection', () => {
  it('replaces a persisted Tool text message with its canonical activity', () => {
    const items = buildAgentTimelineItems([
      message('before', 'assistant', '2026-08-23T00:00:00.000Z'),
      message('legacy-tool', 'tool', '2026-08-23T00:00:02.000Z', 'call-1'),
      message('after', 'assistant', '2026-08-23T00:00:03.000Z'),
    ], [], [activity('2026-08-23T00:00:01.000Z')]);

    expect(items.map(item => item.type === 'message'
      ? item.message.id
      : item.type === 'tool-activity'
        ? item.activity.id
        : item.workflow.runId))
      .toEqual(['before', 'activity-run-1-call-1', 'after']);
  });

  it('keeps unmatched legacy Tool messages as a fallback', () => {
    const items = buildAgentTimelineItems([
      message('legacy-tool', 'tool', '2026-08-23T00:00:00.000Z', 'old-call'),
    ], [], []);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('message');
  });

  it('places an unanchored activity after the last message of the same Run despite its timestamp', () => {
    const items = buildAgentTimelineItems([
      message('before', 'assistant', '2026-08-23T00:00:00.000Z'),
      message('after', 'assistant', '2026-08-23T00:00:03.000Z'),
    ], [], [activity('2026-08-23T00:00:01.000Z')]);

    expect(items.map(item => item.type === 'message'
      ? item.message.id
      : item.type === 'tool-activity'
        ? item.activity.id
        : item.workflow.runId))
      .toEqual(['before', 'after', 'activity-run-1-call-1']);
  });

  it('anchors a task projection directly after its user message', () => {
    const items = buildAgentTimelineItems([
      message('user', 'user', '2026-08-23T00:00:00.000Z'),
      message('answer', 'assistant', '2026-08-23T00:00:03.000Z'),
    ], [run()], [activity('2026-08-23T00:00:01.000Z')]);

    expect(items.map(item => item.type)).toEqual([
      'message',
      'workflow',
      'message',
      'tool-activity',
    ]);
  });

  it('shows an active task before its first Tool call', () => {
    const items = buildAgentTimelineItems([
      message('user', 'user', '2026-08-23T00:00:00.000Z'),
    ], [run('running')], []);

    expect(items.map(item => item.type)).toEqual(['message', 'workflow']);
  });

  it('does not add a workflow item for a completed Tool-free plain conversation', () => {
    const items = buildAgentTimelineItems([
      message('user', 'user', '2026-08-23T00:00:00.000Z'),
      message('answer', 'assistant', '2026-08-23T00:00:01.000Z'),
    ], [run('completed')], []);

    expect(items.map(item => item.type)).toEqual(['message', 'message']);
  });

  it('keeps a completed Tool-free plan so its unexecuted steps remain visible', () => {
    const plannedRun = withPlan(run('completed'));
    const items = buildAgentTimelineItems([
      message('user', 'user', '2026-08-23T00:00:00.000Z'),
    ], [plannedRun], []);

    expect(items.map(item => item.type)).toEqual(['message', 'workflow']);
    expect(items[1]).toMatchObject({
      type: 'workflow',
      workflow: {
        settledStepCount: 0,
        steps: [{ status: 'not_run' }, { status: 'not_run' }],
        totalStepCount: 2,
      },
    });
  });

  it('anchors at most one workflow card when the same Run has repeated user anchors', () => {
    const items = buildAgentTimelineItems([
      message('user-first', 'user', '2026-08-23T00:00:00.000Z'),
      message('assistant', 'assistant', '2026-08-23T00:00:01.000Z'),
      message('user-duplicate', 'user', '2026-08-23T00:00:02.000Z'),
    ], [withPlan(run('running'))], []);

    expect(items.filter(item => item.type === 'workflow')).toHaveLength(1);
    expect(items.map(item => item.key)).toEqual([
      'message:user-first',
      'workflow:run-1',
      'message:assistant',
      'message:user-duplicate',
    ]);
  });

  it('keeps workflow and Tool positions stable after canonical message restoration', () => {
    const runSnapshot = withPlan(run('running'));
    const toolActivity = {
      ...activity('2026-08-23T00:00:02.000Z'),
      planStepId: 'step-1',
    };
    const liveItems = buildAgentTimelineItems([
      message('live-user', 'user', '2026-08-23T00:00:00.000Z'),
      message('live-before', 'assistant', '2026-08-23T00:00:01.000Z'),
      message('live-tool-anchor', 'tool', '2026-08-23T00:00:02.000Z', 'call-1'),
      message('live-after', 'assistant', '2026-08-23T00:00:03.000Z'),
    ], [runSnapshot], [toolActivity]);
    const restoredItems = buildAgentTimelineItems([
      message('stored-user', 'user', '2026-08-23T00:00:00.000Z'),
      message('stored-before', 'assistant', '2026-08-23T00:00:01.000Z'),
      message('stored-tool', 'tool', '2026-08-23T00:00:02.000Z', 'call-1'),
      message('stored-after', 'assistant', '2026-08-23T00:00:03.000Z'),
    ], [runSnapshot], [toolActivity]);
    const shape = (items: ReturnType<typeof buildAgentTimelineItems>) => items.map(item => (
      item.type === 'workflow'
        ? `workflow:${item.workflow.runId}`
        : item.type === 'tool-activity'
          ? `tool:${item.activity.call.id}`
          : `message:${item.message.role}`
    ));

    expect(shape(liveItems)).toEqual([
      'message:user',
      'workflow:run-1',
      'message:assistant',
      'tool:call-1',
      'message:assistant',
    ]);
    expect(shape(restoredItems)).toEqual(shape(liveItems));
  });

  it('keeps the current same-millisecond fallback order without inventing a timestamp tie-break', () => {
    const timestamp = '2026-08-23T00:00:01.000Z';
    const items = buildAgentTimelineItems([
      message('user', 'user', timestamp),
      message('legacy-tool', 'tool', timestamp, 'matched'),
      message('answer', 'assistant', timestamp),
    ], [run('completed', 'run-1', timestamp)], [
      activity(timestamp, 'run-1', 'matched', 1),
      activity(timestamp, 'run-1', 'fallback-first', 2),
      activity(timestamp, 'run-1', 'fallback-second', 3),
    ]);

    expect(items.map(item => item.key)).toEqual([
      'message:user',
      'workflow:run-1',
      'activity:activity-run-1-matched',
      'message:answer',
      'activity:activity-run-1-fallback-first',
      'activity:activity-run-1-fallback-second',
    ]);
  });

  it('keeps deterministic order for a long mixed conversation', () => {
    const messages: AgentMessage[] = [];
    const runs: AgentRunSnapshot[] = [];
    const activities: AgentToolActivitySnapshot[] = [];
    const expected: string[] = [];
    const start = Date.parse('2026-08-23T00:00:00.000Z');

    for (let index = 0; index < 160; index += 1) {
      const runId = `run-${index}`;
      const base = start + index * 10_000;
      const at = (offset: number) => new Date(base + offset).toISOString();
      messages.push(
        message(`user-${index}`, 'user', at(0), undefined, runId),
        message(`legacy-tool-${index}`, 'tool', at(2_000), 'matched', runId),
        message(`answer-${index}`, 'assistant', at(4_000), undefined, runId),
      );
      runs.push(run('completed', runId, at(0)));
      activities.push(
        activity(at(1_000), runId, 'matched', 1),
        activity(at(3_000), runId, 'fallback', 2),
      );
      expected.push(
        `message:user-${index}`,
        `workflow:${runId}`,
        `activity:activity-${runId}-matched`,
        `message:answer-${index}`,
        `activity:activity-${runId}-fallback`,
      );
    }

    expect(buildAgentTimelineItems(messages, runs, activities).map(item => item.key))
      .toEqual(expected);
  });

  it('indexes run identities with linear access counts instead of rescanning cross products', () => {
    const runCount = 120;
    const activityCount = 240;
    let activityRunIdReads = 0;
    let messageRunIdReads = 0;
    let runIdReads = 0;
    const runs = Array.from({ length: runCount }, (_, index) => {
      const runId = `run-${index}`;
      const value = run('running', runId, new Date(index * 10_000).toISOString());
      Object.defineProperty(value, 'id', {
        configurable: true,
        enumerable: true,
        get: () => {
          runIdReads += 1;
          return runId;
        },
      });
      return value;
    });
    const activities = Array.from({ length: activityCount }, (_, index) => {
      const runId = `run-${index % runCount}`;
      const value = activity(
        new Date(index * 4_000 + 1_000).toISOString(),
        runId,
        `call-${index}`,
        Math.floor(index / runCount) + 1,
      );
      Object.defineProperty(value, 'runId', {
        configurable: true,
        enumerable: true,
        get: () => {
          activityRunIdReads += 1;
          return runId;
        },
      });
      return value;
    });
    const messages = runs.map((_, index) => {
      const runId = `run-${index}`;
      const value = message(
        `user-${index}`,
        'user',
        new Date(index * 10_000).toISOString(),
        undefined,
        runId,
      );
      Object.defineProperty(value, 'runId', {
        configurable: true,
        enumerable: true,
        get: () => {
          messageRunIdReads += 1;
          return runId;
        },
      });
      return value;
    });

    const prepared = prepareAgentTimelineProjection(runs, activities);
    buildAgentTimelineItemsFromProjection(messages, prepared);

    expect(activityRunIdReads).toBeLessThanOrEqual(activityCount);
    expect(messageRunIdReads).toBeLessThanOrEqual(messages.length);
    expect(runIdReads).toBeLessThanOrEqual(runs.length * 2);
  });
});
