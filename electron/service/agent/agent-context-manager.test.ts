import { describe, expect, it, vi } from 'vitest';

import type {
  AgentMessage,
  AgentRunSnapshot,
} from '@/shared/agent/agent.types';
import type { AIServiceRuntimeConnection } from '../aiServiceClientModel';
import { AGENT_CONVERSATION_SUMMARY_LIMITS } from './agent-conversation-summary';
import {
  createAgentContextManager,
  type PrepareAgentContextInput,
} from './agent-context-manager';
import type {
  AgentContextCheckpoint,
  AgentSessionStore,
} from './agent-session-store';

const OWNER_SCOPE = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
};

const CONNECTION: AIServiceRuntimeConnection = {
  apiKey: 'secret-key',
  baseUrl: 'https://ai.example.com/v1',
  providerType: 'openai',
};

const SUMMARY = JSON.stringify({
  constraintsAndPreferences: ['删除仍需重新确认。'],
  decisionsAndRationale: ['用户决定先检查视频目录。'],
  goalsAndIntent: ['整理资料库。'],
  taskContext: ['历史任务涉及视频目录。'],
  unresolvedAndNextSteps: ['继续处理当前请求。'],
  version: 1,
});

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
    userPrompt: id,
  };
}

function startedCheckpoint(id = 'checkpoint-1'): AgentContextCheckpoint {
  return {
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    model: 'model-a',
    profileId: 'profile-a',
    sessionId: 'session-1',
    status: 'started',
    throughMessageId: 'm2',
    throughSequence: 2,
  };
}

function input(
  store: AgentSessionStore,
  signal = new AbortController().signal,
): PrepareAgentContextInput {
  const oldText = `Authorization: Bearer super-secret-token\n${'old '.repeat(3_000)}`;
  return {
    fixedInputTokens: 500,
    libraryId: 3,
    messages: [
      message('m1', 'run-1', 'user', oldText),
      message('m2', 'run-1', 'assistant', oldText),
      message('m3', 'run-2', 'user', '最近一轮'),
      message('m4', 'run-2', 'assistant', '最近结果'),
      message('m5', 'run-3', 'user', '当前问题'),
    ],
    model: 'model-a',
    ownerScope: OWNER_SCOPE,
    profileId: 'profile-a',
    runs: [
      run('run-1', 'completed'),
      run('run-2', 'completed'),
      run('run-3', 'running'),
    ],
    runtimeConnection: CONNECTION,
    sessionId: 'session-1',
    signal,
    store,
    toolActivities: [],
  };
}

function storeWith(overrides: Partial<AgentSessionStore>): AgentSessionStore {
  return {
    ...overrides,
  } as AgentSessionStore;
}

function compactBudget() {
  return {
    contextWindowTokens: 6_000,
    outputReserveTokens: 1_000,
    recentHistoryTokens: 1_000,
    summaryReserveTokens: 500,
    toolLoopReserveTokens: 1_000,
  };
}

describe('Agent context manager', () => {
  it('does not create a checkpoint while history remains inside the budget', async () => {
    const beginContextCheckpoint = vi.fn();
    const summarize = vi.fn();
    const store = storeWith({
      beginContextCheckpoint,
      readContextCheckpointState: vi.fn(async () => ({ consecutiveFailureCount: 0 })),
    });
    const manager = createAgentContextManager({ summarize: summarize as never });

    const projection = await manager.prepare({
      ...input(store),
      fixedInputTokens: 100,
      messages: [message('m1', 'run-1', 'user', '当前问题')],
      runs: [run('run-1', 'running')],
    });

    expect(projection.messages.map(item => item.content)).toEqual(['当前问题']);
    expect(beginContextCheckpoint).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });

  it('publishes a validated summary checkpoint before using it in the projection', async () => {
    const beginContextCheckpoint = vi.fn(async () => startedCheckpoint());
    const completeContextCheckpoint = vi.fn(async (_id, summary) => ({
      ...startedCheckpoint(),
      finishedAt: '2026-08-23T00:00:01.000Z',
      status: 'completed' as const,
      summary,
    }));
    const summarize = vi.fn(async (summaryInput: {
      maxOutputTokens: number;
      messages: Array<{ content: string }>;
      systemPrompt: string;
    }) => {
      void summaryInput;
      return SUMMARY;
    });
    const store = storeWith({
      beginContextCheckpoint,
      completeContextCheckpoint,
      failContextCheckpoint: vi.fn(async () => ({
        ...startedCheckpoint(),
        finishedAt: '2026-08-23T00:00:01.000Z',
        status: 'failed' as const,
      })),
      readContextCheckpointState: vi.fn(async () => ({ consecutiveFailureCount: 0 })),
    });
    const manager = createAgentContextManager({
      budget: compactBudget(),
      createId: () => 'checkpoint-1',
      now: () => '2026-08-23T00:00:00.000Z',
      summarize: summarize as never,
    });

    const contextInput = input(store);
    contextInput.messages.splice(
      1,
      0,
      message('m-tool', 'run-1', 'tool', 'CANONICAL_TOOL_MESSAGE'),
    );
    contextInput.toolActivities = [{
      call: { id: 'call-1', input: {}, name: 'file.list' },
      createdAt: '2026-08-23T00:00:00.000Z',
      id: 'tool-1',
      ordinal: 1,
      permissionBehavior: 'allow',
      result: { message: 'CANONICAL_TOOL_FACT', ok: true },
      revision: 1,
      runId: 'run-1',
      sessionId: 'session-1',
      status: 'completed',
    }];
    const projection = await manager.prepare(contextInput);

    expect(beginContextCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      id: 'checkpoint-1',
      throughMessageId: 'm2',
    }));
    expect(completeContextCheckpoint).toHaveBeenCalledWith(
      'checkpoint-1',
      expect.objectContaining({ version: 1 }),
      '2026-08-23T00:00:00.000Z',
    );
    const summaryInput = summarize.mock.calls[0]?.[0];
    expect(summaryInput?.maxOutputTokens).toBe(1_000);
    expect(summaryInput?.systemPrompt).toContain('没有任何 Tool');
    expect(summaryInput?.messages[0].content).not.toContain('super-secret-token');
    expect(summaryInput?.messages[0].content).toContain('[REDACTED]');
    expect(summaryInput?.messages[0].content).not.toContain('CANONICAL_TOOL_FACT');
    expect(summaryInput?.messages[0].content).not.toContain('CANONICAL_TOOL_MESSAGE');
    expect(summarize.mock.calls[0]).toEqual([
      expect.objectContaining({
        model: 'model-a',
        profileId: 'profile-a',
      }),
      expect.any(Function),
      CONNECTION,
      contextInput.signal,
      {
        maxContentCharacters: AGENT_CONVERSATION_SUMMARY_LIMITS.modelOutputCharacters,
      },
    ]);
    expect(projection.messages[0].content).toContain('低权限历史上下文投影');
    expect(projection.messages.some(item => item.content.includes('整理资料库'))).toBe(true);
    expect(projection.messages.some(item => item.content.includes('super-secret-token'))).toBe(false);
  });

  it('does not start a checkpoint when the first complete Run exceeds four batches', async () => {
    const beginContextCheckpoint = vi.fn();
    const summarize = vi.fn();
    const store = storeWith({
      beginContextCheckpoint,
      readContextCheckpointState: vi.fn(async () => ({ consecutiveFailureCount: 0 })),
    });
    const manager = createAgentContextManager({
      budget: compactBudget(),
      summarize: summarize as never,
    });

    const projection = await manager.prepare({
      ...input(store),
      messages: [
        message('m1', 'run-1', 'user', 'a'.repeat(120_000)),
        message('m2', 'run-1', 'assistant', 'b'.repeat(120_000)),
        message('m3', 'run-2', 'user', '当前问题'),
      ],
      runs: [run('run-1', 'completed'), run('run-2', 'running')],
    });

    expect(beginContextCheckpoint).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
    expect(projection.messages.at(-1)?.content).toBe('当前问题');
  });

  it('limits one compaction to four rolling batches and publishes only a complete Run boundary', async () => {
    const beginContextCheckpoint = vi.fn(async input => ({
      ...startedCheckpoint(),
      id: input.id,
      throughMessageId: input.throughMessageId,
    }));
    const completeContextCheckpoint = vi.fn(async (_id, summary) => ({
      ...startedCheckpoint(),
      finishedAt: '2026-08-23T00:00:01.000Z',
      status: 'completed' as const,
      summary,
    }));
    const summarize = vi.fn(async () => SUMMARY);
    const store = storeWith({
      beginContextCheckpoint,
      completeContextCheckpoint,
      readContextCheckpointState: vi.fn(async () => ({ consecutiveFailureCount: 0 })),
    });
    const messages: AgentMessage[] = [];
    const runs: AgentRunSnapshot[] = [];
    for (let index = 1; index <= 8; index += 1) {
      const runId = `run-${index}`;
      messages.push(
        message(`m${(index * 2) - 1}`, runId, 'user', `${index}-user-${'x'.repeat(8_000)}`),
        message(`m${index * 2}`, runId, 'assistant', `${index}-assistant-${'x'.repeat(8_000)}`),
      );
      runs.push(run(runId, 'completed'));
    }
    messages.push(message('m17', 'run-9', 'user', '当前问题'));
    runs.push(run('run-9', 'running'));
    const manager = createAgentContextManager({
      budget: compactBudget(),
      createId: () => 'checkpoint-bounded',
      summarize: summarize as never,
    });

    await manager.prepare({
      ...input(store),
      messages,
      runs,
    });

    expect(summarize.mock.calls.length).toBeGreaterThan(1);
    expect(summarize.mock.calls.length).toBeLessThanOrEqual(4);
    const boundary = beginContextCheckpoint.mock.calls[0]?.[0].throughMessageId;
    expect(boundary).toMatch(/^m\d+$/);
    expect(Number(boundary.slice(1)) % 2).toBe(0);
    expect(boundary).not.toBe('m16');
    expect(completeContextCheckpoint).toHaveBeenCalledWith(
      'checkpoint-bounded',
      expect.objectContaining({ version: 1 }),
      expect.any(String),
    );
  });

  it('does not publish final coverage when a later rolling summary batch fails', async () => {
    const completeContextCheckpoint = vi.fn();
    const failContextCheckpoint = vi.fn(async () => ({
      ...startedCheckpoint(),
      finishedAt: '2026-08-23T00:00:01.000Z',
      status: 'failed' as const,
    }));
    const summarize = vi.fn()
      .mockResolvedValueOnce(SUMMARY)
      .mockRejectedValueOnce(new Error('second batch failed'));
    const store = storeWith({
      beginContextCheckpoint: vi.fn(async () => startedCheckpoint()),
      completeContextCheckpoint,
      failContextCheckpoint,
      readContextCheckpointState: vi.fn(async () => ({ consecutiveFailureCount: 0 })),
    });
    const manager = createAgentContextManager({
      budget: compactBudget(),
      summarize: summarize as never,
    });
    const longInput = input(store);
    longInput.messages[0].content = 'a'.repeat(18_000);
    longInput.messages[1].content = 'b'.repeat(18_000);

    await manager.prepare(longInput);

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(completeContextCheckpoint).not.toHaveBeenCalled();
    expect(failContextCheckpoint).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'failed',
    );
  });

  it('falls back to bounded recent history and records a failed summary attempt', async () => {
    const failContextCheckpoint = vi.fn(async () => ({
      ...startedCheckpoint(),
      finishedAt: '2026-08-23T00:00:01.000Z',
      status: 'failed' as const,
    }));
    const store = storeWith({
      beginContextCheckpoint: vi.fn(async () => startedCheckpoint()),
      failContextCheckpoint,
      readContextCheckpointState: vi.fn(async () => ({ consecutiveFailureCount: 0 })),
    });
    const manager = createAgentContextManager({
      budget: compactBudget(),
      createId: () => 'checkpoint-1',
      summarize: vi.fn(async () => { throw new Error('provider unavailable'); }) as never,
    });

    const projection = await manager.prepare(input(store));

    expect(failContextCheckpoint).toHaveBeenCalledWith(
      'checkpoint-1',
      expect.any(String),
      'failed',
    );
    expect(projection.messages.at(-1)?.content).toBe('当前问题');
    expect(projection.estimatedHistoryTokens).toBeLessThanOrEqual(
      projection.historyBudgetTokens,
    );
  });

  it('interrupts an unfinished checkpoint and propagates cancellation', async () => {
    const controller = new AbortController();
    const failContextCheckpoint = vi.fn(async () => ({
      ...startedCheckpoint(),
      finishedAt: '2026-08-23T00:00:01.000Z',
      status: 'interrupted' as const,
    }));
    const store = storeWith({
      beginContextCheckpoint: vi.fn(async () => startedCheckpoint()),
      failContextCheckpoint,
      readContextCheckpointState: vi.fn(async () => ({ consecutiveFailureCount: 0 })),
    });
    const manager = createAgentContextManager({
      budget: compactBudget(),
      createId: () => 'checkpoint-1',
      summarize: vi.fn(async () => {
        controller.abort();
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      }) as never,
    });

    await expect(manager.prepare(input(store, controller.signal))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(failContextCheckpoint).toHaveBeenCalledWith(
      'checkpoint-1',
      expect.any(String),
      'interrupted',
    );
  });

  it('opens a cooldown circuit after three consecutive summary failures', async () => {
    const beginContextCheckpoint = vi.fn(async () => startedCheckpoint());
    const summarize = vi.fn(async () => { throw new Error('provider unavailable'); });
    let failureCount = 2;
    const store = storeWith({
      beginContextCheckpoint,
      failContextCheckpoint: vi.fn(async () => {
        failureCount += 1;
        return {
          ...startedCheckpoint(),
          finishedAt: '2026-08-23T00:00:01.000Z',
          status: 'failed' as const,
        };
      }),
      readContextCheckpointState: vi.fn(async () => ({
        consecutiveFailureCount: failureCount,
      })),
    });
    const manager = createAgentContextManager({
      budget: compactBudget(),
      createId: () => `checkpoint-${failureCount + 1}`,
      nowMs: () => 1_000,
      summarize: summarize as never,
    });

    const firstProjection = await manager.prepare(input(store));
    const secondProjection = await manager.prepare(input(store));

    expect(beginContextCheckpoint).toHaveBeenCalledTimes(1);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(firstProjection.messages.at(-1)?.content).toBe('当前问题');
    expect(secondProjection.messages.at(-1)?.content).toBe('当前问题');
  });
});
