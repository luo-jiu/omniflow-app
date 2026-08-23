import { describe, expect, it, vi } from 'vitest';

import type { AgentMemoryItem, AgentMemoryProposal } from '@/shared/agent/agent.types';
import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { memoryProposeTool } from './memory-propose-tool';

const proposal = {
  application: '后续所有回答',
  content: '默认使用简体中文并保持简洁',
  kind: 'preference' as const,
  reason: '用户明确说以后都这样',
  scope: 'global' as const,
  title: '回答语言与篇幅',
};

function context(
  saveMemoryProposal?: AgentToolExecutionContext['saveMemoryProposal'],
): AgentToolExecutionContext {
  return {
    appContext: { platform: 'darwin' as const, selectedNodeIds: [] },
    onProgress: vi.fn(),
    ...(saveMemoryProposal ? { saveMemoryProposal } : {}),
    signal: new AbortController().signal,
  };
}

describe('memory.propose Tool', () => {
  it('always requires the existing runtime approval path', () => {
    expect(memoryProposeTool.assess?.(proposal, context())).toMatchObject({
      behavior: 'ask',
      preview: {
        title: '保存这条长期记忆？',
      },
      risk: 'write',
    });
  });

  it('rejects sensitive proposals before approval or execution', () => {
    const secretProposal = { ...proposal, content: 'api_key=private-value' };
    expect(memoryProposeTool.validate?.(secretProposal, context())).toMatchObject({ ok: false });
    expect(() => memoryProposeTool.assess?.(secretProposal, context())).toThrow(
      '长期记忆不能保存',
    );
  });

  it('shows the complete bounded proposal across approval detail chunks', async () => {
    const content = Array.from({ length: 2_000 }, (_, index) => String(index % 10)).join('');
    const decision = await memoryProposeTool.assess?.({ ...proposal, content }, context());
    if (!decision || decision.behavior !== 'ask') throw new Error('expected approval preview');
    const displayedContent = (decision.preview.details || [])
      .filter(detail => detail.label.startsWith('记忆内容'))
      .map(detail => detail.value)
      .join('');

    expect(displayedContent).toBe(content);
  });

  it('persists only through the scoped callback after approval', async () => {
    const saveMemoryProposal = vi.fn(async (
      input: AgentMemoryProposal,
    ): Promise<AgentMemoryItem> => ({
      ...input,
      createdAt: '2026-08-23T10:00:00.000Z',
      id: 'memory-1',
      revision: 1,
      updatedAt: '2026-08-23T10:00:00.000Z',
    }));
    await expect(memoryProposeTool.execute?.(
      proposal,
      context(saveMemoryProposal),
    )).resolves.toMatchObject({
      data: { id: 'memory-1', revision: 1 },
      ok: true,
    });
    expect(saveMemoryProposal).toHaveBeenCalledWith(proposal, expect.any(AbortSignal));
  });
});
