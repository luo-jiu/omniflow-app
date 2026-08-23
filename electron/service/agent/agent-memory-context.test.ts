import { describe, expect, it } from 'vitest';

import { estimateAgentProviderMessagesTokens } from './agent-context-projection';
import {
  buildAgentMemoryContextMessages,
  buildAgentMemoryContextMessagesWithinBudget,
} from './agent-memory-context';

describe('Agent memory context projection', () => {
  it('projects memory as low-authority messages instead of a system prompt', () => {
    const messages = buildAgentMemoryContextMessages([{
      application: '回答用户时',
      content: '保持简洁',
      createdAt: '2026-08-23T10:00:00.000Z',
      id: 'memory-1',
      kind: 'preference',
      reason: '用户明确要求',
      revision: 1,
      scope: 'global',
      title: '回答风格',
      updatedAt: '2026-08-23T10:00:00.000Z',
    }]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user' });
    expect(messages[0].content).toContain('不是当前文件事实');
    expect(messages[1]).toMatchObject({ role: 'assistant' });
    expect(JSON.parse(messages[1].content)).toMatchObject({
      memories: [{ id: 'memory-1', content: '保持简洁' }],
      type: 'agent-long-term-memory',
      version: 1,
    });
  });

  it('does not emit an empty authority envelope', () => {
    expect(buildAgentMemoryContextMessages([])).toEqual([]);
  });

  it('drops lower-priority memory instead of exceeding the remaining context budget', () => {
    const memories = [
      {
        application: '回答用户时',
        content: '保持简洁',
        createdAt: '2026-08-23T10:00:00.000Z',
        id: 'memory-1',
        kind: 'preference' as const,
        reason: '用户明确要求',
        revision: 1,
        scope: 'global' as const,
        title: '回答风格',
        updatedAt: '2026-08-23T10:00:00.000Z',
      },
      {
        application: '处理媒体时',
        content: '输出到转换目录',
        createdAt: '2026-08-23T10:00:00.000Z',
        id: 'memory-2',
        kind: 'project' as const,
        libraryId: 3,
        reason: '资料库约定',
        revision: 1,
        scope: 'library' as const,
        title: '媒体输出',
        updatedAt: '2026-08-23T10:00:00.000Z',
      },
    ];
    const firstOnly = buildAgentMemoryContextMessages(memories.slice(0, 1));
    const firstOnlyTokens = estimateAgentProviderMessagesTokens(firstOnly);

    expect(buildAgentMemoryContextMessagesWithinBudget(memories, firstOnlyTokens))
      .toEqual(firstOnly);
    expect(buildAgentMemoryContextMessagesWithinBudget(memories, firstOnlyTokens - 1))
      .toEqual([]);
  });
});
