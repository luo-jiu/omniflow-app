import TestRenderer from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import AgentContextUsage from './AgentContextUsage';

describe('context usage presentation', () => {
  it('does not invent usage for old runs and distinguishes historical estimates', () => {
    const empty = TestRenderer.create(<AgentContextUsage busy={false} />);
    expect(JSON.stringify(empty.toJSON())).toContain('暂无统计');
    empty.unmount();
    const run = { contextUsage: { version: 1, windowTokens: 272000, windowSource: 'catalog', inputLimitTokens: 240000,
      outputReserveTokens: 16000, toolReserveTokens: 2000, localInputTokens: 10000, estimatedInputTokens: 12000,
      safetyInputTokens: 12000, remainingTokens: 226000, source: 'provider-plus-estimate', phase: 'after-response',
      responseCount: 1, compactionCount: 0, reportedTotalTokens: 13000, usageIncomplete: false,
      updatedAt: '2026-09-08T00:00:00Z' } } as AgentRunSnapshot;
    const view = TestRenderer.create(<AgentContextUsage run={run} busy={false} />);
    const result = JSON.stringify(view.toJSON());
    expect(result).toContain('上次上下文');
    expect(result).toContain('226,000');
    expect(result).toContain('实测基准 + 增量估算');
    expect(result).toContain('累计用量不是上下文占用');
    view.unmount();
  });
});
