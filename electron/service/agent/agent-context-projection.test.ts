import { describe, expect, it } from 'vitest';

import type {
  AgentMessage,
  AgentRunSnapshot,
  AgentShellPreparedActionPublicV1,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import type { AgentConversationSummaryV1 } from './agent-conversation-summary';
import {
  createAgentContextProjection,
  estimateAgentTextTokens,
  getAgentProviderRequestTokenLimit,
  resolveAgentContextBudget,
} from './agent-context-projection';

const SUMMARY: AgentConversationSummaryV1 = {
  constraintsAndPreferences: ['删除文件仍需重新确认。'],
  decisionsAndRationale: ['用户决定先检查视频目录。'],
  goalsAndIntent: ['整理当前资料库。'],
  taskContext: ['历史目录名为视频。'],
  unresolvedAndNextSteps: ['继续确认目标文件。'],
  version: 1,
};

function message(
  id: string,
  runId: string,
  role: AgentMessage['role'],
  content: string,
): AgentMessage {
  const base = {
    content,
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    runId,
    sessionId: 'session-1',
  };
  if (role === 'assistant') {
    return {
      ...base,
      assistantItem: {
        finishedAt: '2026-08-23T00:00:00.000Z',
        phase: 'final',
        revision: 2,
        status: 'completed',
        turnOrdinal: 1,
        updatedAt: '2026-08-23T00:00:00.000Z',
      },
      role,
    };
  }
  return { ...base, role };
}

function run(id: string, status: AgentRunSnapshot['status']): AgentRunSnapshot {
  return {
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    model: 'model-a',
    profileId: 'profile-a',
    reasoningEffort: 'auto',
    revision: 1,
    sessionId: 'session-1',
    status,
    updatedAt: '2026-08-23T00:00:00.000Z',
    userPrompt: `prompt-${id}`,
  };
}

function toolActivity(runId: string): AgentToolActivitySnapshot {
  return {
    call: { id: `call-${runId}`, input: {}, name: 'file.list' },
    createdAt: '2026-08-23T00:00:00.000Z',
    id: `tool-${runId}`,
    ordinal: 1,
    permissionBehavior: 'allow',
    result: { message: `读取 ${runId} 完成`, ok: true },
    revision: 1,
    runId,
    sessionId: 'session-1',
    status: 'completed',
  };
}

function shellPreparedAction(command: string): AgentShellPreparedActionPublicV1 {
  return {
    aiDestination: {
      identityHash: `v1:${'a'.repeat(64)}`,
      profileLabel: 'Test profile',
      providerType: 'openai',
    },
    assessment: {
      facets: ['filesystem.read', 'process_launch'],
      operations: [{ argvPrefix: [], effects: ['filesystem.read'], executable: 'cat' }],
      persistentRuleEligible: false,
      risk: 'read',
      unresolved: [],
    },
    command,
    commandHash: `sha256:${'b'.repeat(64)}`,
    cwd: { kind: 'host', path: '/absolute' },
    dataScope: { stagedInputs: [], unresolvedWorkspaceRead: false },
    environment: [],
    kind: 'shell.run',
    provider: { dialect: 'zsh', id: 'system-zsh', version: '5.9' },
    timeoutMs: 10_000,
    version: 1,
  };
}

function shellToolActivity(
  runId: string,
  command: string,
  stdout: string,
  onProviderOutputRead?: () => void,
): AgentToolActivitySnapshot {
  const providerOutput = {
    stderr: { head: '', omittedBytes: 0, tail: '', totalBytes: 0, truncated: false },
    stdout: {
      head: stdout,
      omittedBytes: 0,
      tail: '',
      totalBytes: Buffer.byteLength(stdout, 'utf8'),
      truncated: false,
    },
    version: 1 as const,
  };
  const data: Record<string, unknown> = {};
  Object.defineProperty(data, 'providerOutput', {
    enumerable: true,
    get: () => {
      onProviderOutputRead?.();
      return providerOutput;
    },
  });
  return {
    ...toolActivity(runId),
    call: { id: `call-${runId}`, input: {}, name: 'shell.run' },
    preparation: {
      action: shellPreparedAction(command),
      preparedActionId: `prepared-${runId}`,
      snapshotHash: 'd'.repeat(64),
    },
    result: { data, ok: true },
  };
}

function assistantItem(
  id: string,
  runId: string,
  content: string,
  phase: 'unknown' | 'commentary' | 'final',
  status: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted',
): AgentMessage {
  const terminal = status !== 'streaming';
  return {
    assistantItem: {
      ...(terminal ? { finishedAt: '2026-08-23T00:00:01.000Z' } : {}),
      phase,
      revision: terminal ? 2 : 1,
      status,
      turnOrdinal: 1,
      updatedAt: '2026-08-23T00:00:01.000Z',
    },
    content,
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    role: 'assistant',
    runId,
    sessionId: 'session-1',
  };
}

describe('Agent context projection', () => {
  it('applies the effective context percentage after reserving model output', () => {
    const budget = resolveAgentContextBudget({
      contextWindowTokens: 1_050_000,
      effectiveContextWindowPercent: 95,
      outputReserveTokens: 128_000,
    });

    expect(getAgentProviderRequestTokenLimit(budget)).toBe(875_900);
  });

  it('estimates CJK text conservatively', () => {
    expect(estimateAgentTextTokens('测试文本')).toBeGreaterThan(
      estimateAgentTextTokens('test'),
    );
  });

  it('keeps the complete raw history while it remains inside the budget', () => {
    const messages = [
      message('m1', 'run-1', 'user', '查看目录'),
      message('m2', 'run-1', 'assistant', '目录为空'),
      message('m3', 'run-2', 'user', '继续'),
    ];
    const projection = createAgentContextProjection({
      fixedInputTokens: 100,
      messages,
      runs: [run('run-1', 'completed'), run('run-2', 'running')],
      toolActivities: [],
    });

    expect(projection.compaction).toBeUndefined();
    expect(projection.messages.map(item => item.content)).toEqual([
      '查看目录',
      '目录为空',
      '继续',
    ]);
    expect(projection.droppedMessageCount).toBe(0);
  });

  it('projects only completed final assistant items into future Provider history', () => {
    const projection = createAgentContextProjection({
      fixedInputTokens: 100,
      messages: [
        message('m1', 'run-1', 'user', '检查目录'),
        assistantItem('m2', 'run-1', '我先检查。', 'commentary', 'completed'),
        assistantItem('m3', 'run-1', '目录为空。', 'final', 'completed'),
        message('m4', 'run-2', 'user', '继续处理'),
        assistantItem('m5', 'run-2', '未完成的部分', 'unknown', 'failed'),
      ],
      runs: [run('run-1', 'completed'), run('run-2', 'failed')],
      toolActivities: [],
    });

    expect(projection.messages.map(item => item.content)).toEqual([
      '检查目录',
      '目录为空。',
      '继续处理',
    ]);
  });

  it('scrubs credentials from legacy messages before provider projection', () => {
    const projection = createAgentContextProjection({
      fixedInputTokens: 100,
      messages: [
        message('m1', 'run-1', 'user', 'Authorization: Bearer private-token'),
        message('m2', 'run-1', 'assistant', 'password=private-value'),
        message('m3', 'run-2', 'user', '继续'),
      ],
      runs: [run('run-1', 'completed'), run('run-2', 'running')],
      toolActivities: [],
    });
    const serialized = JSON.stringify(projection.messages);

    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('private-value');
  });

  it('compacts only a complete terminal Run and keeps the active Run intact', () => {
    const longText = 'old context '.repeat(900);
    const messages = [
      message('m1', 'run-1', 'user', longText),
      message('m2', 'run-1', 'assistant', longText),
      message('m3', 'run-2', 'user', '最近一轮'),
      message('m4', 'run-2', 'assistant', '最近结果'),
      message('m5', 'run-3', 'user', '当前问题'),
    ];
    const projection = createAgentContextProjection({
      budget: {
        contextWindowTokens: 6_000,
        outputReserveTokens: 1_000,
        recentHistoryTokens: 1_000,
        summaryReserveTokens: 500,
        toolLoopReserveTokens: 1_000,
      },
      fixedInputTokens: 500,
      messages,
      runs: [
        run('run-1', 'completed'),
        run('run-2', 'completed'),
        run('run-3', 'running'),
      ],
      toolActivities: [toolActivity('run-1')],
    });

    expect(projection.compaction).toMatchObject({
      sourceRunIds: ['run-1'],
      throughMessageId: 'm2',
    });
    expect(projection.compaction?.sourceMessages.map(item => item.id)).toEqual(['m1', 'm2']);
    expect(projection.messages.some(item => item.content === '当前问题')).toBe(true);
    expect(projection.messages.some(item => item.content === longText)).toBe(false);
  });

  it('projects a validated checkpoint as low-authority memory without replaying its prefix', () => {
    const messages = [
      message('m1', 'run-1', 'user', '旧问题'),
      message('m2', 'run-1', 'assistant', '旧回答'),
      message('m3', 'run-2', 'user', '新问题'),
    ];
    const projection = createAgentContextProjection({
      checkpoint: {
        id: 'checkpoint-1',
        summary: SUMMARY,
        throughMessageId: 'm2',
      },
      fixedInputTokens: 100,
      messages,
      runs: [run('run-1', 'completed'), run('run-2', 'running')],
      toolActivities: [],
    });

    expect(projection.messages[0].content).toContain('低权限历史上下文投影');
    expect(projection.messages[1].content).toContain('整理当前资料库');
    expect(projection.messages.map(item => item.content)).not.toContain('旧问题');
    expect(projection.messages.at(-1)?.content).toBe('新问题');
  });

  it('projects recent canonical ToolRun facts independently of the checkpoint tail', () => {
    const activities = [
      toolActivity('run-covered'),
      ...Array.from({ length: 12 }, (_, index) => toolActivity(`run-recent-${index + 1}`)),
      toolActivity('run-active'),
    ];
    const projection = createAgentContextProjection({
      checkpoint: {
        id: 'checkpoint-1',
        summary: SUMMARY,
        throughMessageId: 'm2',
      },
      fixedInputTokens: 100,
      messages: [
        message('m1', 'run-covered', 'user', '旧问题'),
        message('m2', 'run-covered', 'assistant', '旧回答'),
        message('m3', 'run-active', 'user', '继续处理'),
      ],
      runs: [
        run('run-covered', 'completed'),
        ...Array.from({ length: 12 }, (_, index) => run(`run-recent-${index + 1}`, 'completed')),
        run('run-active', 'running'),
      ],
      toolActivities: activities,
    });

    const memory = JSON.parse(projection.messages[1].content);
    const serializedFacts = JSON.stringify(memory.recentExecutionFacts);
    expect(memory.recentExecutionFacts).toHaveLength(13);
    expect(serializedFacts).toContain('run-covered');
    expect(serializedFacts).not.toContain('run-active');
    expect(serializedFacts).toContain('run-recent-1');
    expect(serializedFacts).toContain('run-recent-12');
  });

  it('keeps the latest complete Shell stdout available after a cancelled Run', () => {
    const document = [
      '# DOCUMENT_HEAD',
      '迁移前先确认页面职责、接口边界、验收标准和回退步骤。\n'.repeat(420),
      '## DOCUMENT_MIDDLE',
      '迁移过程中保持用户行为、状态所有权和错误语义稳定。\n'.repeat(220),
      '## DOCUMENT_TAIL',
      '完成后执行自动化、人工验收并更新维护文档。\n'.repeat(120),
    ].join('\n');
    expect(Buffer.byteLength(document, 'utf8')).toBeGreaterThan(27_496);
    const shellActivity: AgentToolActivitySnapshot = {
      ...toolActivity('run-shell'),
      call: {
        id: 'call-shell',
        input: { command: 'cat /absolute/document.md' },
        name: 'shell.run',
      },
      preparation: {
        action: shellPreparedAction('cat /absolute/document.md'),
        preparedActionId: 'prepared-shell',
        snapshotHash: 'c'.repeat(64),
      },
      result: {
        data: {
          durationMs: 13,
          executionId: 'private-execution-id',
          exitCode: 0,
          logRef: `log:v1:${'a'.repeat(64)}`,
          providerOutput: {
            stderr: {
              head: '',
              omittedBytes: 0,
              tail: '',
              totalBytes: 0,
              truncated: false,
            },
            stdout: {
              head: document,
              omittedBytes: 0,
              tail: '',
              totalBytes: Buffer.byteLength(document, 'utf8'),
              truncated: false,
            },
            version: 1,
          },
          status: 'completed',
          stdoutTail: 'renderer-only-preview',
        },
        message: 'Shell 命令执行完成',
        ok: true,
      },
    };
    const projection = createAgentContextProjection({
      budget: {
        contextWindowTokens: 1_050_000,
        effectiveContextWindowPercent: 95,
        outputReserveTokens: 128_000,
      },
      fixedInputTokens: 1_000,
      messages: [
        message('m1', 'run-shell', 'user', '总结这个文档'),
        message('m2', 'run-current', 'user', '刚才所说的截断是什么？'),
      ],
      runs: [run('run-shell', 'cancelled'), run('run-current', 'running')],
      toolActivities: [shellActivity],
    });
    const memory = JSON.parse(projection.messages[1].content);
    const fact = memory.recentExecutionFacts[0];

    expect(fact).toMatchObject({
      operation: { command: 'cat /absolute/document.md' },
      ordinal: 1,
      runId: 'run-shell',
      status: 'completed',
      toolName: 'shell.run',
    });
    expect(fact.result._omniflowProjection).toBeUndefined();
    expect(fact.result.data.output.stdout).toMatchObject({
      content: document,
      omittedBytes: 0,
      truncated: false,
    });
    expect(fact.result.data.output.stdout).not.toHaveProperty('head');
    expect(fact.result.data.output.stdout).not.toHaveProperty('tail');
    expect(JSON.stringify(fact)).not.toContain('private-execution-id');
    expect(JSON.stringify(fact)).not.toContain('renderer-only-preview');
  });

  it('shrinks the latest Shell fact to the real conservative history budget instead of dropping it', () => {
    const stdout = [
      'DOCUMENT_HEAD',
      '迁移前需要核对职责边界和验收标准。'.repeat(700),
      'DOCUMENT_TAIL',
    ].join('\n');
    const projection = createAgentContextProjection({
      fixedInputTokens: 100,
      messages: [message('m-current', 'run-current', 'user', '继续总结文档')],
      runs: [run('run-shell', 'cancelled'), run('run-current', 'running')],
      toolActivities: [shellToolActivity(
        'run-shell',
        'cat /absolute/long-document.md',
        stdout,
      )],
    });
    const memoryMessage = projection.messages.find(item => (
      item.content.includes('recentExecutionFacts')
    ));
    const memory = JSON.parse(memoryMessage?.content || '{}');
    const fact = memory.recentExecutionFacts?.[0];

    expect(fact).toMatchObject({ runId: 'run-shell', toolName: 'shell.run' });
    expect(fact.result._omniflowProjection).toMatchObject({ truncated: true });
    expect(fact.result.data.output.stdout).toMatchObject({ truncated: true });
    expect(JSON.stringify(fact)).toContain('DOCUMENT_HEAD');
    expect(JSON.stringify(fact)).toContain('DOCUMENT_TAIL');
    expect(projection.estimatedHistoryTokens).toBeLessThanOrEqual(projection.historyBudgetTokens);
  });

  it('bounds a long command association before allocating the latest Shell result budget', () => {
    const command = `printf ${'参'.repeat(7_500)}`;
    const stdout = `OUTPUT_HEAD\n${'正文'.repeat(25_000)}\nOUTPUT_TAIL`;
    const projection = createAgentContextProjection({
      budget: {
        contextWindowTokens: 1_050_000,
        effectiveContextWindowPercent: 95,
        outputReserveTokens: 128_000,
      },
      fixedInputTokens: 1_000,
      messages: [message('m-current', 'run-current', 'user', '继续')],
      runs: [run('run-shell', 'cancelled'), run('run-current', 'running')],
      toolActivities: [shellToolActivity('run-shell', command, stdout)],
    });
    const memoryMessage = projection.messages.find(item => (
      item.content.includes('recentExecutionFacts')
    ));
    const memory = JSON.parse(memoryMessage?.content || '{}');
    const fact = memory.recentExecutionFacts?.[0];

    expect(fact).toMatchObject({
      operation: { truncated: true },
      runId: 'run-shell',
      toolName: 'shell.run',
    });
    expect(fact.result.data.output.stdout).toBeTruthy();
    expect(JSON.stringify(fact)).toContain('OUTPUT_HEAD');
    expect(JSON.stringify(fact)).toContain('OUTPUT_TAIL');
  });

  it('stops projecting old large Shell results after the execution-fact budget is full', () => {
    let providerOutputReads = 0;
    const runIds = Array.from({ length: 250 }, (_, index) => `run-shell-${index}`);
    const stdout = `HEAD\n${'日志'.repeat(25_000)}\nTAIL`;
    const projection = createAgentContextProjection({
      budget: {
        contextWindowTokens: 1_050_000,
        effectiveContextWindowPercent: 95,
        outputReserveTokens: 128_000,
      },
      fixedInputTokens: 1_000,
      messages: [message('m-current', 'run-current', 'user', '继续')],
      runs: [...runIds.map(runId => run(runId, 'completed')), run('run-current', 'running')],
      toolActivities: runIds.map(runId => shellToolActivity(
        runId,
        `cat /absolute/${runId}.log`,
        stdout,
        () => { providerOutputReads += 1; },
      )),
    });
    const serialized = JSON.stringify(projection.messages);

    expect(serialized).toContain('run-shell-249');
    expect(providerOutputReads).toBeLessThan(10);
  });

  it('does not discard a complete Shell fact only because newer small Tool facts exist', () => {
    const shellRunId = 'run-shell-before-small-tools';
    const shell = {
      ...toolActivity(shellRunId),
      call: { id: 'call-shell', input: {}, name: 'shell.run' },
      preparation: {
        action: shellPreparedAction('cat /absolute/earlier.md'),
        preparedActionId: 'prepared-shell',
        snapshotHash: 'd'.repeat(64),
      },
      result: {
        data: {
          providerOutput: {
            stderr: { head: '', omittedBytes: 0, tail: '', totalBytes: 0, truncated: false },
            stdout: {
              head: 'EARLIER_DOCUMENT_CONTENT',
              omittedBytes: 0,
              tail: '',
              totalBytes: 24,
              truncated: false,
            },
            version: 1,
          },
        },
        ok: true,
      },
    } satisfies AgentToolActivitySnapshot;
    const laterRunIds = Array.from({ length: 12 }, (_, index) => `run-later-${index + 1}`);
    const projection = createAgentContextProjection({
      fixedInputTokens: 100,
      messages: [message('m-current', 'run-current', 'user', '继续总结第一份文档')],
      runs: [
        run(shellRunId, 'completed'),
        ...laterRunIds.map(runId => run(runId, 'completed')),
        run('run-current', 'running'),
      ],
      toolActivities: [shell, ...laterRunIds.map(toolActivity)],
    });
    const serialized = JSON.stringify(projection.messages);

    expect(serialized).toContain('EARLIER_DOCUMENT_CONTENT');
    expect(serialized).toContain('cat /absolute/earlier.md');
  });

  it('keeps only Skill activation identity in terminal history facts', () => {
    const activity: AgentToolActivitySnapshot = {
      ...toolActivity('run-skill'),
      call: {
        id: 'call-skill',
        input: { skillId: 'media-extract-audio' },
        name: 'skill.activate',
      },
      result: {
        data: {
          instructions: '完整流程正文不应再次进入历史上下文',
          instructionsHash: 'a'.repeat(64),
          skillId: 'media-extract-audio',
          toolAllowlist: ['file.list'],
          version: '1.0.0',
        },
        message: '已加载 Skill media-extract-audio（1.0.0）',
        ok: true,
      },
    };
    const projection = createAgentContextProjection({
      fixedInputTokens: 100,
      messages: [
        message('m1', 'run-skill', 'user', '提取音频'),
        message('m2', 'run-current', 'user', '继续'),
      ],
      runs: [run('run-skill', 'completed'), run('run-current', 'running')],
      toolActivities: [activity],
    });
    const serialized = JSON.stringify(projection.messages);

    expect(serialized).toContain('media-extract-audio');
    expect(serialized).toContain('a'.repeat(64));
    expect(serialized).not.toContain('完整流程正文');
    expect(serialized).not.toContain('toolAllowlist');
  });

  it('never projects private Skill fields from failed activation results', () => {
    const activity: AgentToolActivitySnapshot = {
      ...toolActivity('run-failed-skill'),
      call: { id: 'call-failed-skill', input: {}, name: 'skill.activate' },
      result: {
        data: {
          instructions: 'PRIVATE_SKILL_BODY',
          toolAllowlist: ['shell.run'],
        },
        message: 'Skill 激活失败',
        ok: false,
      },
      status: 'failed',
    };
    const projection = createAgentContextProjection({
      fixedInputTokens: 100,
      messages: [message('m-current', 'run-current', 'user', '继续')],
      runs: [run('run-failed-skill', 'failed'), run('run-current', 'running')],
      toolActivities: [activity],
    });
    const serialized = JSON.stringify(projection.messages);

    expect(serialized).toContain('Skill 激活失败');
    expect(serialized).not.toContain('PRIVATE_SKILL_BODY');
    expect(serialized).not.toContain('toolAllowlist');
  });

  it('rejects an oversized active Run instead of silently truncating it', () => {
    expect(() => createAgentContextProjection({
      budget: {
        contextWindowTokens: 5_000,
        outputReserveTokens: 1_000,
        recentHistoryTokens: 1_000,
        summaryReserveTokens: 500,
        toolLoopReserveTokens: 1_000,
      },
      fixedInputTokens: 500,
      messages: [message('m1', 'run-1', 'user', 'a'.repeat(30_000))],
      runs: [run('run-1', 'running')],
      toolActivities: [],
    })).toThrow('本次不会截断当前消息');
  });

  it('fails when fixed input and reserves leave no history budget', () => {
    expect(() => createAgentContextProjection({
      budget: {
        contextWindowTokens: 4_000,
        outputReserveTokens: 1_500,
        recentHistoryTokens: 1_000,
        summaryReserveTokens: 500,
        toolLoopReserveTokens: 1_500,
      },
      fixedInputTokens: 1_100,
      messages: [message('m1', 'run-1', 'user', '短请求')],
      runs: [run('run-1', 'running')],
      toolActivities: [],
    })).toThrow('固定输入和安全预留超过模型上下文窗口');
  });
});
