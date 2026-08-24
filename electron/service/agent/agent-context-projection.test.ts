import { describe, expect, it } from 'vitest';

import type {
  AgentMessage,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import type { AgentConversationSummaryV1 } from './agent-conversation-summary';
import {
  createAgentContextProjection,
  estimateAgentTextTokens,
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
  return {
    content,
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    role,
    runId,
    sessionId: 'session-1',
  };
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

describe('Agent context projection', () => {
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
    expect(memory.recentExecutionFacts).toHaveLength(12);
    expect(serializedFacts).not.toContain('run-covered');
    expect(serializedFacts).not.toContain('run-active');
    expect(serializedFacts).toContain('run-recent-1');
    expect(serializedFacts).toContain('run-recent-12');
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
