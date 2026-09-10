import { describe, expect, it, vi } from 'vitest';
import { appendAgentActiveToolResult, compactAgentActiveContextToFit, type AgentActiveToolResultRecord } from './agent-active-context';
import type { AgentProviderMessage } from './agent-provider-model';
import { estimateAgentProviderMessagesTokens, estimateAgentTextTokens } from './agent-context-projection';
import { pruneAgentReadBodies } from './agent-context-pruning';

const summary = JSON.stringify({ version: 1, objective: ['按最新目标 B 工作，不覆盖'], verifiedFacts: [], completedActions: [], decisions: [], failures: [], pendingWork: [] });
function fixture(count = 12) {
  const messages: AgentProviderMessage[] = [{ role: 'user', content: '目标 A；禁止覆盖已有文件。' }];
  const toolResults: AgentActiveToolResultRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `read-${i}`;
    messages.push({ role: 'assistant', content: '', toolCalls: [{ id, name: 'file.read', input: { path: `/docs/${i}.txt` } }] });
    const content = JSON.stringify({ ok: true, message: `已读取 ${i}.txt`, data: {
      scope: 'library', path: `/docs/${i}.txt`, revision: 'a'.repeat(64), offset: 1, endLine: 1,
      hasMore: false, content: `${i}: ${'x'.repeat(28000)}`,
    } });
    const record = appendAgentActiveToolResult({ allowCompaction: true, messages, toolResults, toolCallId: id, toolName: 'file.read',
      projectedResult: { content, estimatedTokens: estimateAgentTextTokens(content), truncated: false } });
    record.consumed = true;
  }
  messages.push({ role: 'user', content: '最新目标改为 B，禁止覆盖仍然有效。' });
  return { messages, toolResults };
}

describe('OpenCode-inspired read-body pruning', () => {
  it('preserves attachment ID, page and revision while pruning recoverable document text', () => {
    const input = fixture();
    for (const record of input.toolResults) {
      record.toolName = 'attachment.read'; record.message.name = 'attachment.read';
      const result = JSON.parse(record.message.content);
      Object.assign(result.data, { scope: 'attachment', attachmentId: 'test-attachment', page: 2 });
      record.message.content = JSON.stringify(result);
    }
    const ids = pruneAgentReadBodies({ ...input, eligibleCallIds: new Set(input.toolResults.map(record => record.message.toolCallId)) });
    expect(ids.length).toBeGreaterThan(0);
    for (const record of input.toolResults.filter(record => ids.includes(record.message.toolCallId))) {
      expect(JSON.parse(record.message.content).data).toMatchObject({ attachmentId: 'test-attachment', page: 2, revision: 'a'.repeat(64), contentPruned: true });
    }
  });
  it('avoids a summary request under pressure, retaining recent results, constraints and source records', async () => {
    const input = fixture();
    const originalRecords = [...input.toolResults];
    const originalContents = originalRecords.map(record => record.message.content);
    const summarize = vi.fn(async () => summary);
    const onCompacted = vi.fn();
    const result = await compactAgentActiveContextToFit({ ...input, estimateTokens: estimateAgentProviderMessagesTokens,
      requestTokenLimit: 70000, summarize, onCompacted });
    expect(result.fits).toBe(true);
    expect(result.prunedToolCallIds!.length).toBeGreaterThan(0);
    expect(result.compactedToolCallIds).toEqual([]);
    expect(summarize).not.toHaveBeenCalled();
    expect(onCompacted).toHaveBeenCalledOnce();
    expect(input.messages[0].content).toContain('禁止覆盖');
    expect(input.messages.at(-1)?.content).toContain('最新目标改为 B');
    expect(originalRecords.map(record => record.message.content)).toEqual(originalContents);
    expect(input.toolResults.slice(-2).map(record => record.message.content)).toEqual(originalContents.slice(-2));
    for (const record of input.toolResults) {
      const data = JSON.parse(record.message.content).data;
      if (!data.contentPruned) continue;
      expect(data.path).toMatch(/^\/docs\//);
      expect(data.revision).toBe('a'.repeat(64));
      expect(data.sourceToolCallId).toBe(record.message.toolCallId);
      expect(data.content).toBeUndefined();
    }
    const baseline = fixture();
    const baselineSummary = vi.fn(async () => summary);
    const withoutPruning = await compactAgentActiveContextToFit({ ...baseline, pruneReadBodies: false,
      estimateTokens: estimateAgentProviderMessagesTokens, requestTokenLimit: 70000, summarize: baselineSummary });
    expect(withoutPruning.fits).toBe(true);
    expect(baselineSummary).toHaveBeenCalledOnce();
  });

  it('does not prune when already within budget or when savings are too small', async () => {
    const input = fixture();
    const before = JSON.stringify(input.messages);
    await compactAgentActiveContextToFit({ ...input, estimateTokens: estimateAgentProviderMessagesTokens,
      requestTokenLimit: 200000, summarize: async () => summary });
    expect(JSON.stringify(input.messages)).toBe(before);
    const tiny = fixture(2);
    expect(pruneAgentReadBodies({ ...tiny, eligibleCallIds: new Set(['read-0', 'read-1']) })).toEqual([]);
  });

  it('never prunes writes, failures, partial reads, Skills or unconsumed results', () => {
    const input = fixture(20);
    input.toolResults[0].toolName = 'file.upload';
    input.toolResults[1].message.content = JSON.stringify({ ...JSON.parse(input.toolResults[1].message.content), ok: false });
    const partial = JSON.parse(input.toolResults[2].message.content);
    partial.data.hasMore = true;
    input.toolResults[2].message.content = JSON.stringify(partial);
    input.toolResults[3].toolName = 'skill.activate';
    input.toolResults[4].consumed = false;
    input.toolResults[5].allowCompaction = false;
    const protectedContent = input.toolResults.slice(0, 6).map(record => record.message.content);
    const ids = pruneAgentReadBodies({ ...input, eligibleCallIds: new Set(input.toolResults.map(record => record.message.toolCallId)) });
    expect(ids.length).toBeGreaterThan(0);
    expect(input.toolResults.slice(0, 6).map(record => record.message.content)).toEqual(protectedContent);
  });

  it('does not commit staged pruning if later summarization fails', async () => {
    const input = fixture();
    const before = JSON.stringify(input.messages);
    const records = [...input.toolResults];
    const onCompacted = vi.fn();
    await expect(compactAgentActiveContextToFit({ ...input, estimateTokens: estimateAgentProviderMessagesTokens,
      requestTokenLimit: 1, onCompacted, summarize: async () => { throw new Error('summary unavailable'); } })).rejects.toThrow('summary unavailable');
    expect(JSON.stringify(input.messages)).toBe(before);
    expect(input.toolResults).toEqual(records);
    expect(onCompacted).not.toHaveBeenCalled();
  });

  it('does not repeatedly prune the same body', async () => {
    const input = fixture();
    const eligibleCallIds = new Set(input.toolResults.map(record => record.message.toolCallId));
    expect(pruneAgentReadBodies({ ...input, eligibleCallIds }).length).toBeGreaterThan(0);
    expect(pruneAgentReadBodies({ ...input, eligibleCallIds })).toEqual([]);
  });
});
