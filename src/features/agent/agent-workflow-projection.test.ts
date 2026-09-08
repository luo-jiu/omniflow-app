import { describe, expect, it } from 'vitest';

import type {
  AgentMessage,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import {
  buildAgentWorkflowProjection,
  selectActiveAgentWorkflowProjection,
} from './agent-workflow-projection';

const BASE_TIME = '2026-08-23T00:00:00.000Z';

function run(
  status: AgentRunSnapshot['status'],
  overrides: Partial<AgentRunSnapshot> = {},
): AgentRunSnapshot {
  return {
    createdAt: BASE_TIME,
    id: 'run-1',
    model: 'model-a',
    profileId: 'profile-a',
    reasoningEffort: 'medium',
    revision: 1,
    sessionId: 'session-1',
    status,
    updatedAt: '2026-08-23T00:00:09.000Z',
    userPrompt: '整理当前目录',
    ...overrides,
  };
}

function plannedRun(status: AgentRunSnapshot['status']): AgentRunSnapshot {
  return run(status, {
    plan: {
      createdAt: '2026-08-23T00:00:00.500Z',
      steps: [
        { expectedToolName: 'file.stat', id: 'step-2', ordinal: 2, title: '检查文件' },
        { expectedToolName: 'file.list', id: 'step-1', ordinal: 1, title: '读取目录' },
        { expectedToolName: 'file.read', id: 'step-3', ordinal: 3, title: '读取内容' },
      ],
      title: '整理目录',
      version: 1,
    },
  });
}

function activity(
  id: string,
  ordinal: number,
  status: AgentToolActivitySnapshot['status'],
  options: {
    kind?: 'business' | 'control';
    planStepId?: string;
    toolName?: string;
  } = {},
): AgentToolActivitySnapshot {
  return {
    call: { id: `call-${id}`, input: {}, name: options.toolName || `tool.${id}` },
    createdAt: `2026-08-23T00:00:0${ordinal}.000Z`,
    id,
    ordinal,
    permissionBehavior: 'allow',
    ...(options.planStepId ? { planStepId: options.planStepId } : {}),
    progress: status === 'running' ? { message: `${id} 正在执行`, percent: 45 } : undefined,
    result: status === 'completed' ? { message: `${id} 完成`, ok: true } : undefined,
    revision: 1,
    runId: 'run-1',
    sessionId: 'session-1',
    status,
    toolMetadata: {
      groupKind: 'resource-read',
      kind: options.kind || 'business',
      operationKind: 'read',
      risk: 'read',
    },
  };
}

function assistantItem(
  id: string,
  phase: 'unknown' | 'commentary' | 'final',
  content: string,
  turnOrdinal: number,
  status: 'streaming' | 'completed' | 'failed' = 'completed',
): AgentMessage {
  const createdAt = `2026-08-23T00:00:0${turnOrdinal}.000Z`;
  return {
    assistantItem: {
      ...(status === 'completed' ? { finishedAt: createdAt } : {}),
      phase,
      revision: status === 'streaming' ? 1 : 2,
      status,
      turnOrdinal,
      updatedAt: createdAt,
    },
    content,
    createdAt,
    id,
    role: 'assistant',
    runId: 'run-1',
    sessionId: 'session-1',
  };
}

describe('Agent workflow projection', () => {
  it('uses main currentStep before the generic thinking fallback', () => {
    expect(buildAgentWorkflowProjection(run('running', {
      currentStep: '正在连接模型服务',
    }), [])).toMatchObject({
      active: true,
      primaryStatus: { kind: 'run', label: '正在连接模型服务' },
      steps: [],
    });
    expect(buildAgentWorkflowProjection(run('running'), [])?.primaryStatus)
      .toEqual({ kind: 'thinking', label: '正在思考' });
  });

  it('does not create historical workflow chrome for a completed run without a plan', () => {
    expect(buildAgentWorkflowProjection(run('completed'), [
      activity('read', 1, 'completed'),
    ])).toBeNull();
  });

  it('keeps factual terminal errors without inventing an active status', () => {
    expect(buildAgentWorkflowProjection(run('failed', {
      currentStep: '执行失败',
      error: '模型服务暂时不可用',
    }), [])).toMatchObject({
      active: false,
      primaryStatus: { kind: 'run', label: '模型服务暂时不可用' },
      status: 'failed',
    });
  });

  it('derives current and next only from explicit plan bindings', () => {
    const projection = buildAgentWorkflowProjection(plannedRun('running'), [
      activity('first', 1, 'completed', { planStepId: 'step-1', toolName: 'file.list' }),
      activity('second', 2, 'running', { planStepId: 'step-2', toolName: 'file.stat' }),
    ]);

    expect(projection).toMatchObject({
      currentPlanStep: { id: 'step-2', ordinal: 2, title: '检查文件' },
      nextPlanStep: { id: 'step-3', ordinal: 3, title: '读取内容' },
      primaryStatus: {
        activityId: 'second',
        kind: 'tool',
        label: 'second 正在执行',
      },
      settledStepCount: 1,
      totalStepCount: 3,
    });
    expect(projection?.steps.map(step => [step.id, step.status])).toEqual([
      ['step-1', 'completed'],
      ['step-2', 'running'],
      ['step-3', 'planned'],
    ]);
  });

  it('selects the first unstarted plan step when no plan step is active', () => {
    const projection = buildAgentWorkflowProjection(plannedRun('running'), [
      activity('first', 1, 'completed', { planStepId: 'step-1' }),
    ]);
    expect(projection).toMatchObject({
      nextPlanStep: { id: 'step-2', title: '检查文件' },
    });
    expect(projection?.currentPlanStep).toBeUndefined();
  });

  it('does not infer plan bindings from matching Tool names', () => {
    const projection = buildAgentWorkflowProjection(plannedRun('running'), [
      activity('same-name', 1, 'completed', { toolName: 'file.list' }),
    ]);

    expect(projection?.steps[0]).toMatchObject({ status: 'planned' });
    expect(projection?.steps[0].activityId).toBeUndefined();
    expect(projection?.offPlanActivityIds).toEqual(['same-name']);
  });

  it('marks only unbound business Tools as plan deviations', () => {
    const projection = buildAgentWorkflowProjection(plannedRun('running'), [
      activity('business', 1, 'completed'),
      activity('control', 2, 'completed', { kind: 'control' }),
      { ...activity('unknown', 3, 'completed'), toolMetadata: undefined },
    ]);

    expect(projection?.offPlanActivityIds).toEqual(['business']);
  });

  it('prioritizes waiting interaction and approval over active Tool progress', () => {
    const running = activity('running', 1, 'running');
    const approval = activity('approval', 2, 'awaiting_approval');
    const interaction = activity('interaction', 3, 'awaiting_interaction');

    expect(buildAgentWorkflowProjection(run('awaiting_interaction'), [
      running,
      approval,
      interaction,
    ])?.primaryStatus).toMatchObject({
      activityId: 'interaction',
      kind: 'awaiting_interaction',
    });
  });

  it('uses latest commentary only until a later Tool fact starts', () => {
    const commentary = assistantItem('commentary', 'commentary', '我先检查目录内容。', 1);
    expect(buildAgentWorkflowProjection(run('running'), [], [commentary])?.primaryStatus)
      .toEqual({
        assistantItemId: 'commentary',
        kind: 'commentary',
        label: '我先检查目录内容。',
      });

    expect(buildAgentWorkflowProjection(run('running', {
      currentStep: '根据工具结果继续处理',
    }), [activity('read', 2, 'completed')], [commentary])?.primaryStatus).toEqual({
      kind: 'run',
      label: '根据工具结果继续处理',
    });
  });

  it('does not resurrect commentary after a later assistant turn starts', () => {
    expect(buildAgentWorkflowProjection(run('running'), [], [
      assistantItem('commentary', 'commentary', '准备读取文件。', 1),
      assistantItem('next-turn', 'unknown', '', 2, 'streaming'),
    ])?.primaryStatus).toEqual({ kind: 'thinking', label: '正在思考' });
  });

  it.each([
    ['completed', undefined],
    ['cancelled', undefined],
    ['failed', { kind: 'run', label: '模型服务暂时不可用' }],
    ['interrupted', { kind: 'run', label: '模型服务暂时不可用' }],
  ] as const)(
    'does not reuse historical commentary after a Run becomes %s',
    (status, expectedPrimaryStatus) => {
      const terminalRun = {
        ...plannedRun(status),
        ...(status === 'failed' || status === 'interrupted'
          ? { error: '模型服务暂时不可用' }
          : {}),
      };
      const projection = buildAgentWorkflowProjection(
        terminalRun,
        [],
        [assistantItem('commentary', 'commentary', '继续分段读取中间章节。', 1)],
      );

      expect(projection?.primaryStatus).toEqual(expectedPrimaryStatus);
    },
  );

  it('does not expose a next step after a Run becomes terminal', () => {
    const projection = buildAgentWorkflowProjection(plannedRun('completed'), [
      activity('first', 1, 'completed', { planStepId: 'step-1' }),
    ]);
    expect(projection?.nextPlanStep).toBeUndefined();
    expect(projection?.steps.map(step => step.status)).toEqual([
      'completed',
      'not_run',
      'not_run',
    ]);
    expect(projection?.primaryStatus).toBeUndefined();
  });

  it('selects only the newest active Run for the dock and withdraws after terminal', () => {
    const older = run('running', { id: 'run-old', createdAt: '2026-08-23T00:00:00.000Z' });
    const newer = run('running', { id: 'run-new', createdAt: '2026-08-23T00:00:01.000Z' });
    expect(selectActiveAgentWorkflowProjection([], [older, newer], [])?.runId).toBe('run-new');
    expect(selectActiveAgentWorkflowProjection([], [
      { ...older, status: 'completed' },
      { ...newer, status: 'failed' },
    ], [])).toBeNull();
  });
});
