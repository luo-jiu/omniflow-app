import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunSnapshot } from '@/shared/agent/agent.types';
import { buildConversationIndex, indexMilestone, parseIndexMarks, resolveIndexPreviewTop } from './agent-conversation-index';

const run: AgentRunSnapshot = {
  id: 'r1', sessionId: 's1', model: 'test', profileId: 'test', reasoningEffort: 'medium',
  revision: 1, status: 'running', userPrompt: 'test',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
};
const messages: AgentMessage[] = [{ id: 'm1', sessionId: 's1', runId: 'r1', role: 'user', content: '用户问题', createdAt: run.createdAt }];

describe('Conversation index projection', () => {
  it('lets the preview follow short rails and clamps only at workspace boundaries', () => {
    const bounds = { min: -300, max: 200 };
    expect([5, 15, 25, 35, 45, 55].map(center => resolveIndexPreviewTop(center, bounds)))
      .toEqual([-19, -9, 1, 11, 21, 31]);
    expect(resolveIndexPreviewTop(-500, bounds)).toBe(-300);
    expect(resolveIndexPreviewTop(500, bounds)).toBe(200);
    expect(resolveIndexPreviewTop(55 - 20, bounds)).toBe(11);
  });
  it('projects one tick per question and uses canonical recovery and terminal states', () => {
    expect(buildConversationIndex(messages, [run])[0]).toMatchObject({ ordinal: 1, tone: 'normal', active: true });
    expect(buildConversationIndex(messages, [{ ...run, currentStep: '正在重新连接 1/5' }])[0].tone).toBe('waiting');
    expect(buildConversationIndex(messages, [{ ...run, status: 'awaiting_approval' }])[0].tone).toBe('waiting');
    expect(buildConversationIndex(messages, [{ ...run, status: 'interrupted' }])[0]).toMatchObject({ tone: 'error', active: false });
    expect(buildConversationIndex(messages, [{ ...run, status: 'completed', currentStep: '正在重新连接 1/5' }])[0])
      .toMatchObject({ tone: 'normal', active: false });
  });
  it('keeps milestone numbering one-based beyond the first 70 rows', () => {
    expect([1, 5, 10, 70, 75, 80].map(indexMilestone)).toEqual(['none', 'minor', 'major', 'major', 'minor', 'major']);
    const many = Array.from({ length: 85 }, (_, i) => ({ ...messages[0], id: `m${i}` }));
    expect(buildConversationIndex(many, [run])).toHaveLength(85);
    expect(buildConversationIndex(many, [run])[84].ordinal).toBe(85);
  });
  it('accepts only bounded local label metadata, including empty bookmarks', () => {
    expect(parseIndexMarks('{"m1":"","m2":"重点"}')).toEqual({ m1: '', m2: '重点' });
    expect(parseIndexMarks('broken')).toEqual({});
    expect(parseIndexMarks('["not a map"]')).toEqual({});
    expect(parseIndexMarks(JSON.stringify({ m1: 3, m2: 'x'.repeat(33) }))).toEqual({});
  });
});
