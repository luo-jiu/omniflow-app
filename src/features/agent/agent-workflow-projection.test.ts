import { describe, expect, it } from 'vitest';

import type {
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import { buildAgentWorkflowProjection } from './agent-workflow-projection';

function run(status: AgentRunSnapshot['status']): AgentRunSnapshot {
  return {
    createdAt: '2026-08-23T00:00:00.000Z',
    currentStep: status === 'running' ? '根据工具结果继续思考' : '已完成',
    id: 'run-1',
    model: 'model-a',
    profileId: 'profile-a',
    reasoningEffort: 'medium',
    revision: 1,
    sessionId: 'session-1',
    status,
    updatedAt: '2026-08-23T00:00:03.000Z',
    userPrompt: '整理当前目录',
  };
}

function activity(
  id: string,
  ordinal: number,
  status: AgentToolActivitySnapshot['status'],
  planStepId?: string,
): AgentToolActivitySnapshot {
  return {
    call: { id: `call-${id}`, input: {}, name: `tool.${id}` },
    createdAt: `2026-08-23T00:00:0${ordinal}.000Z`,
    id,
    ordinal,
    permissionBehavior: 'allow',
    ...(planStepId ? { planStepId } : {}),
    revision: 1,
    result: status === 'completed' ? { message: `${id} 完成`, ok: true } : undefined,
    runId: 'run-1',
    sessionId: 'session-1',
    status,
  };
}

function plannedRun(status: AgentRunSnapshot['status']): AgentRunSnapshot {
  return {
    ...run(status),
    plan: {
      createdAt: '2026-08-23T00:00:00.500Z',
      steps: [
        {
          expectedToolName: 'file.stat',
          id: 'plan-second',
          ordinal: 2,
          title: '检查文件信息',
        },
        {
          expectedToolName: 'file.list',
          id: 'plan-first',
          ordinal: 1,
          title: '读取目标目录',
        },
      ],
      title: '整理目录内容',
      version: 1,
    },
  };
}

describe('Agent workflow projection', () => {
  it('shows an active run before its first tool call', () => {
    expect(buildAgentWorkflowProjection(run('running'), [])).toMatchObject({
      currentStep: '根据工具结果继续思考',
      status: 'running',
      steps: [],
    });
  });

  it('does not add a task card to a completed plain conversation', () => {
    expect(buildAgentWorkflowProjection(run('completed'), [])).toBeNull();
  });

  it.each([
    ['failed', '模型服务暂时不可用'],
    ['cancelled', '用户已取消任务'],
    ['interrupted', '应用退出导致任务中断'],
  ] as const)('keeps a Tool-free %s Run visible', (status, detail) => {
    expect(buildAgentWorkflowProjection({
      ...run(status),
      currentStep: detail,
      ...(status === 'failed' || status === 'interrupted' ? { error: detail } : {}),
    }, [])).toMatchObject({
      currentStep: detail,
      status,
      steps: [],
    });
  });

  it('orders actual tool facts by ordinal and derives their summaries', () => {
    const projection = buildAgentWorkflowProjection(run('completed'), [
      activity('second', 2, 'failed'),
      activity('first', 1, 'completed'),
    ]);

    expect(projection).toMatchObject({
      settledStepCount: 2,
      totalStepCount: 2,
    });
    expect(projection?.steps).toEqual([
      expect.objectContaining({
        detail: 'first 完成',
        key: 'activity:first',
        toolName: 'tool.first',
      }),
      expect.objectContaining({
        detail: '执行失败',
        key: 'activity:second',
        toolName: 'tool.second',
      }),
    ]);
  });

  it('counts a failed Tool as settled when its Run completed', () => {
    expect(buildAgentWorkflowProjection(run('completed'), [
      activity('failed', 1, 'failed'),
    ])).toMatchObject({
      settledStepCount: 1,
      status: 'completed',
      totalStepCount: 1,
    });
  });

  it('projects an active plan in plan ordinal order without inventing Tool facts', () => {
    const projection = buildAgentWorkflowProjection(plannedRun('running'), []);

    expect(projection).toMatchObject({
      settledStepCount: 0,
      title: '整理目录内容',
      totalStepCount: 2,
    });
    expect(projection?.steps).toEqual([
      {
        detail: '等待执行',
        key: 'plan-step:plan-first',
        ordinal: 1,
        status: 'planned',
        title: '读取目标目录',
        toolName: 'file.list',
      },
      {
        detail: '等待执行',
        key: 'plan-step:plan-second',
        ordinal: 2,
        status: 'planned',
        title: '检查文件信息',
        toolName: 'file.stat',
      },
    ]);
  });

  it.each([
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ] as const)('marks unexecuted plan steps as not_run for a terminal %s Run', (status) => {
    const projection = buildAgentWorkflowProjection(plannedRun(status), []);

    expect(projection).not.toBeNull();
    expect(projection?.steps.map(step => step.status)).toEqual(['not_run', 'not_run']);
    expect(projection).toMatchObject({ settledStepCount: 0, totalStepCount: 2 });
  });

  it('keeps plan titles and order while deriving linked status and detail from actual Tools', () => {
    const first = {
      ...activity('first-tool', 8, 'completed', 'plan-first'),
      call: { id: 'call-first-tool', input: {}, name: 'file.list' },
    };
    const second = {
      ...activity('second-tool', 3, 'running', 'plan-second'),
      call: { id: 'call-second-tool', input: {}, name: 'file.stat' },
      progress: { message: '正在读取元数据', percent: 45 },
    };
    const projection = buildAgentWorkflowProjection(plannedRun('running'), [first, second]);

    expect(projection?.steps).toEqual([
      expect.objectContaining({
        activityId: 'first-tool',
        detail: 'first-tool 完成',
        ordinal: 1,
        status: 'completed',
        title: '读取目标目录',
      }),
      expect.objectContaining({
        activityId: 'second-tool',
        detail: '正在读取元数据',
        ordinal: 2,
        status: 'running',
        title: '检查文件信息',
      }),
    ]);
    expect(projection).toMatchObject({ settledStepCount: 1, totalStepCount: 2 });
  });

  it('appends unmatched and duplicate real Tools after the plan without dropping them', () => {
    const linked = activity('linked', 5, 'completed', 'plan-first');
    const duplicate = activity('duplicate', 6, 'failed', 'plan-first');
    const unknown = activity('unknown', 1, 'completed', 'missing-plan-step');
    const projection = buildAgentWorkflowProjection(plannedRun('completed'), [
      duplicate,
      linked,
      unknown,
    ]);

    expect(projection?.steps.map(step => step.activityId || step.key)).toEqual([
      'linked',
      'plan-step:plan-second',
      'unknown',
      'duplicate',
    ]);
    expect(projection?.steps.slice(2)).toEqual([
      expect.objectContaining({
        key: 'activity:unknown',
        status: 'completed',
        toolName: 'tool.unknown',
      }),
      expect.objectContaining({
        key: 'activity:duplicate',
        status: 'failed',
        toolName: 'tool.duplicate',
      }),
    ]);
    expect(projection).toMatchObject({ settledStepCount: 3, totalStepCount: 4 });
  });

  it('does not infer a plan link from a matching Tool name', () => {
    const sameToolWithoutLink = {
      ...activity('same-tool', 1, 'completed'),
      call: { id: 'call-same-tool', input: {}, name: 'file.list' },
    };
    const projection = buildAgentWorkflowProjection(
      plannedRun('running'),
      [sameToolWithoutLink],
    );

    expect(projection?.steps.map(step => ({
      activityId: step.activityId,
      key: step.key,
      status: step.status,
    }))).toEqual([
      { activityId: undefined, key: 'plan-step:plan-first', status: 'planned' },
      { activityId: undefined, key: 'plan-step:plan-second', status: 'planned' },
      { activityId: 'same-tool', key: 'activity:same-tool', status: 'completed' },
    ]);
  });

  it('keeps an unlinked retry visible after the linked plan attempt failed', () => {
    const failedAttempt = {
      ...activity('failed-attempt', 1, 'failed', 'plan-first'),
      call: { id: 'call-failed-attempt', input: {}, name: 'file.list' },
    };
    const retry = {
      ...activity('retry', 2, 'completed'),
      call: { id: 'call-retry', input: {}, name: 'file.list' },
    };
    const projection = buildAgentWorkflowProjection(
      plannedRun('completed'),
      [retry, failedAttempt],
    );

    expect(projection?.steps).toEqual([
      expect.objectContaining({
        activityId: 'failed-attempt',
        status: 'failed',
        title: '读取目标目录',
      }),
      expect.objectContaining({
        key: 'plan-step:plan-second',
        status: 'not_run',
        title: '检查文件信息',
      }),
      expect.objectContaining({
        activityId: 'retry',
        key: 'activity:retry',
        status: 'completed',
        toolName: 'file.list',
      }),
    ]);
    expect(projection).toMatchObject({ settledStepCount: 2, totalStepCount: 3 });
  });

  it('ignores Tools from another Run before linking plan steps', () => {
    const foreign = {
      ...activity('foreign', 1, 'completed', 'plan-first'),
      runId: 'run-other',
    };

    expect(buildAgentWorkflowProjection(plannedRun('running'), [foreign])?.steps)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'plan-step:plan-first', status: 'planned' }),
      ]));
  });
});
