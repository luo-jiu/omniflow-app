import TestRenderer from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import AgentContextUsage from './AgentContextUsage';

describe('context usage presentation', () => {
  it('does not invent usage for old runs and distinguishes historical estimates', () => {
    const empty = TestRenderer.create(<AgentContextUsage busy={false} />);
    expect(JSON.stringify(empty.toJSON())).toContain('上下文使用量未知');
    empty.unmount();
    const run = { contextUsage: { version: 1, windowTokens: 272000, windowSource: 'catalog', inputLimitTokens: 240000,
      outputReserveTokens: 16000, toolReserveTokens: 2000, localInputTokens: 10000, estimatedInputTokens: 12000,
      safetyInputTokens: 14000, remainingTokens: 226000, source: 'provider-plus-estimate', phase: 'after-response',
      responseCount: 1, compactionCount: 0, reportedTotalTokens: 900000, usageIncomplete: false,
      updatedAt: '2026-09-08T00:00:00Z' } } as AgentRunSnapshot;
    const view = TestRenderer.create(<AgentContextUsage run={run} busy={false} />);
    const result = JSON.stringify(view.toJSON());
    expect(result).toContain('上次运行快照');
    expect(result).toContain('4%');
    expect(result).not.toContain('900,000');
    expect(result).toContain('226,000');
    expect(result).toContain('实测基准 + 增量估算');
    expect(result).toContain('累计调用用量不是上下文占用');
    view.unmount();
  });

  it.each([
    { used: 0, window: 1000, expected: '0%' },
    { used: 1, window: 1000, expected: '<1%' },
    { used: 999, window: 1000, expected: '99%' },
    { used: 1000, window: 1000, expected: '100%' },
    { used: 1500, window: 1000, expected: '>100%' },
    { used: 0, window: 0, expected: '—' },
  ])('displays $used/$window without inventing capacity or wrapping the ring', ({ used, window, expected }) => {
    const run = { contextUsage: { version: 1, windowTokens: window, windowSource: 'fallback', inputLimitTokens: 900,
      outputReserveTokens: 100, toolReserveTokens: 0, localInputTokens: used, estimatedInputTokens: used,
      safetyInputTokens: used, remainingTokens: 0, source: 'estimate', phase: 'before-request',
      responseCount: 0, compactionCount: 0, reportedTotalTokens: 0, usageIncomplete: true,
      updatedAt: '2026-10-23T00:00:00Z' } } as AgentRunSnapshot;
    const view = TestRenderer.create(<AgentContextUsage run={run} busy />);
    expect(view.root.findAllByType('span').some(node => node.props['aria-hidden'] && node.children[0] === expected)).toBe(true);
    if (window) expect(JSON.stringify(view.toJSON())).toContain('模型实际上限未知');
    const progress = view.root.findAllByType('circle').find(node => node.props.pathLength === '100');
    expect(progress?.props.strokeDasharray).toBe(window ? `${Math.min(100, used / window * 100)} 100` : undefined);
    view.unmount();
  });
});
