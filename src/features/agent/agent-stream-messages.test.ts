import { describe, expect, it } from 'vitest';

import type {
  AgentAssistantItemSnapshot,
  AgentMessage,
  AgentRunSnapshot,
} from '@/shared/agent/agent.types';
import {
  appendBufferedAgentEvent,
  mergeAgentAssistantStreamEvent,
  reconcileCanonicalAgentRunMessages,
} from './agent-stream-messages';

function assistantItem(
  content = '',
  status: AgentAssistantItemSnapshot['assistantItem']['status'] = 'streaming',
  revision = status === 'streaming' ? 1 : 2,
): AgentAssistantItemSnapshot {
  return {
    assistantItem: {
      ...(status === 'streaming' ? {} : { finishedAt: '2026-08-23T00:00:02.000Z' }),
      phase: status === 'completed' ? 'final' : 'unknown',
      revision,
      status,
      turnOrdinal: 1,
      updatedAt: '2026-08-23T00:00:02.000Z',
    },
    content,
    createdAt: '2026-08-23T00:00:00.000Z',
    id: 'assistant-1',
    role: 'assistant',
    runId: 'run-current',
    sessionId: 'session-1',
  };
}

function message(id: string, runId: string, role: AgentMessage['role'], content: string): AgentMessage {
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

function run(revision: number, updatedAt: string): AgentRunSnapshot {
  return {
    createdAt: '2026-08-23T00:00:00.000Z',
    id: 'run-current',
    model: 'model-a',
    profileId: 'profile-a',
    reasoningEffort: 'medium',
    revision,
    sessionId: 'session-1',
    status: 'running',
    updatedAt,
    userPrompt: '读取目录',
  };
}

describe('Agent terminal message reconciliation', () => {
  it('coalesces consecutive deltas without truncating a long restore buffer', () => {
    const buffered = Array.from({ length: 180 }, (_, index) => index)
      .reduce((current, index) => appendBufferedAgentEvent(current, {
        delta: String(index % 10),
        itemId: 'assistant-1',
        offset: index,
        runId: 'run-current',
        sessionId: 'session-1',
        type: 'assistant-item-delta',
      }), [] as Parameters<typeof appendBufferedAgentEvent>[0]);

    expect(buffered).toHaveLength(1);
    expect(buffered[0]).toMatchObject({
      delta: Array.from({ length: 180 }, (_, index) => String(index % 10)).join(''),
      itemId: 'assistant-1',
      offset: 0,
      type: 'assistant-item-delta',
    });
  });

  it('preserves event ordering across tool boundaries', () => {
    const firstDelta = {
      delta: '先读取',
      itemId: 'assistant-1',
      offset: 0,
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'assistant-item-delta' as const,
    };
    const toolStarted = {
      call: { id: 'call-1', input: {}, name: 'file.list' },
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'tool-started' as const,
    };
    const secondDelta = {
      ...firstDelta,
      delta: '再回答',
      itemId: 'assistant-2',
      offset: 0,
    };

    const buffered = [firstDelta, toolStarted, secondDelta]
      .reduce(appendBufferedAgentEvent, []);

    expect(buffered).toEqual([firstDelta, toolStarted, secondDelta]);
  });

  it('merges duplicate and overlapping item deltas by absolute offset', () => {
    const started = {
      item: assistantItem(),
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'assistant-item-started' as const,
    };
    const first = mergeAgentAssistantStreamEvent([], started);
    const appended = mergeAgentAssistantStreamEvent(first.messages, {
      delta: '开始工作',
      itemId: 'assistant-1',
      offset: 0,
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'assistant-item-delta',
    });
    const overlapping = mergeAgentAssistantStreamEvent(appended.messages, {
      delta: '工作并完成',
      itemId: 'assistant-1',
      offset: 2,
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'assistant-item-delta',
    });

    expect(overlapping.issue).toBeUndefined();
    expect(overlapping.messages.at(-1)?.content).toBe('开始工作并完成');
    expect(mergeAgentAssistantStreamEvent(overlapping.messages, {
      delta: '开始工作',
      itemId: 'assistant-1',
      offset: 0,
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'assistant-item-delta',
    }).messages).toBe(overlapping.messages);
  });

  it('pauses a gapped or conflicting item until a canonical terminal snapshot arrives', () => {
    const started = assistantItem('已有');
    const current: AgentMessage[] = [started];
    const gap = mergeAgentAssistantStreamEvent(current, {
      delta: '缺口',
      itemId: started.id,
      offset: 4,
      runId: started.runId,
      sessionId: started.sessionId,
      type: 'assistant-item-delta',
    });
    const conflict = mergeAgentAssistantStreamEvent(current, {
      delta: '不同',
      itemId: started.id,
      offset: 0,
      runId: started.runId,
      sessionId: started.sessionId,
      type: 'assistant-item-delta',
    });
    const finishedItem = assistantItem('规范终态', 'completed');
    const finished = mergeAgentAssistantStreamEvent(current, {
      item: finishedItem,
      runId: started.runId,
      sessionId: started.sessionId,
      type: 'assistant-item-finished',
    });
    const late = mergeAgentAssistantStreamEvent(finished.messages, {
      delta: '迟到',
      itemId: started.id,
      offset: finishedItem.content.length,
      runId: started.runId,
      sessionId: started.sessionId,
      type: 'assistant-item-delta',
    });

    expect(gap.issue).toEqual({ itemId: started.id, kind: 'gap' });
    expect(conflict.issue).toEqual({ itemId: started.id, kind: 'conflict' });
    expect(finished.messages).toEqual([finishedItem]);
    expect(late.messages).toBe(finished.messages);
  });

  it('keeps a live suffix when an active main snapshot is replayed during restore', () => {
    const live = assistantItem('已经流式展示');
    const snapshot = assistantItem('已经流式');
    const merged = mergeAgentAssistantStreamEvent([live], {
      item: snapshot,
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      type: 'assistant-item-started',
    });

    expect(merged.issue).toBeUndefined();
    expect(merged.messages[0]).toMatchObject({ content: '已经流式展示' });
  });

  it('keeps only the newest consecutive canonical Run update while restoring', () => {
    const older = {
      run: run(1, '2026-08-23T00:00:02.000Z'),
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'run-updated' as const,
    };
    const newer = {
      ...older,
      run: run(2, '2026-08-23T00:00:01.000Z'),
    };

    expect([older, newer].reduce(appendBufferedAgentEvent, [])).toEqual([newer]);
  });

  it('does not let a delayed active update replace a buffered terminal Run', () => {
    const completed = {
      run: { ...run(2, '2026-08-23T00:00:02.000Z'), status: 'completed' as const },
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'run-updated' as const,
    };
    const delayed = {
      ...completed,
      run: run(3, '2026-08-23T00:00:03.000Z'),
    };

    expect([completed, delayed].reduce(appendBufferedAgentEvent, [])).toEqual([completed]);
  });

  it('replaces incomplete streamed messages with the canonical tool-ordered run projection', () => {
    const previous = message('previous', 'run-previous', 'assistant', '上一轮');
    const optimisticUser = message('optimistic-user', 'run-current', 'user', '读取目录');
    const incomplete = message('stream', 'run-current', 'assistant', '开头和结尾');
    const canonical = [
      message('stored-user', 'run-current', 'user', '读取目录'),
      message('stored-assistant-1', 'run-current', 'assistant', '开头'),
      message('stored-tool', 'run-current', 'tool', '已读取目录'),
      message('stored-assistant-2', 'run-current', 'assistant', '中间和结尾'),
    ];

    expect(reconcileCanonicalAgentRunMessages(
      [previous, optimisticUser, incomplete],
      'run-current',
      canonical,
    )).toEqual([previous, ...canonical]);
  });
});
