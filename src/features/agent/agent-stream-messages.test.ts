import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/shared/agent/agent.types';
import {
  appendBufferedAgentEvent,
  reconcileCanonicalAgentRunMessages,
} from './agent-stream-messages';

function message(id: string, runId: string, role: AgentMessage['role'], content: string): AgentMessage {
  return {
    content,
    createdAt: '2026-08-23T00:00:00.000Z',
    id,
    role,
    runId,
    sessionId: 'session-1',
  };
}

describe('Agent terminal message reconciliation', () => {
  it('coalesces consecutive deltas without truncating a long restore buffer', () => {
    const buffered = Array.from({ length: 180 }, (_, index) => index)
      .reduce((current, index) => appendBufferedAgentEvent(current, {
        delta: String(index % 10),
        runId: 'run-current',
        sessionId: 'session-1',
        type: 'delta',
      }), [] as Parameters<typeof appendBufferedAgentEvent>[0]);

    expect(buffered).toHaveLength(1);
    expect(buffered[0]).toMatchObject({
      delta: Array.from({ length: 180 }, (_, index) => String(index % 10)).join(''),
      type: 'delta',
    });
  });

  it('preserves event ordering across tool boundaries', () => {
    const firstDelta = {
      delta: '先读取',
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'delta' as const,
    };
    const toolStarted = {
      call: { id: 'call-1', input: {}, name: 'file.list' },
      runId: 'run-current',
      sessionId: 'session-1',
      type: 'tool-started' as const,
    };
    const secondDelta = { ...firstDelta, delta: '再回答' };

    const buffered = [firstDelta, toolStarted, secondDelta]
      .reduce(appendBufferedAgentEvent, []);

    expect(buffered).toEqual([firstDelta, toolStarted, secondDelta]);
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
