import { describe, expect, it } from 'vitest';
import type { AgentAssistantItemSnapshot, AgentRunSnapshot, AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { selectAgentLiveStatus } from './agent-live-status';

const run: AgentRunSnapshot = {
  id: 'r', sessionId: 's', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
  revision: 1, model: 'test', profileId: 'p', reasoningEffort: 'medium', status: 'running', userPrompt: 'test',
};
const tool: AgentToolActivitySnapshot = {
  id: 't', runId: 'r', sessionId: 's', revision: 1, ordinal: 1, createdAt: run.createdAt,
  status: 'running', permissionBehavior: 'allow', call: { id: 'c', name: 'file.read', input: { path: '/a.txt' } },
};
const message: AgentAssistantItemSnapshot = {
  id: 'm', runId: 'r', sessionId: 's', createdAt: run.createdAt, role: 'assistant', content: '读取后发现新版本。',
  assistantItem: { phase: 'commentary', status: 'streaming', revision: 1, turnOrdinal: 1, updatedAt: run.createdAt },
};

describe('Agent live status', () => {
  it('shows compaction from main state, even before an empty provider turn', () => {
    expect(selectAgentLiveStatus([{ ...run, currentStep: '整理当前任务上下文' }], [message], []))
      .toEqual({ runId: 'r', kind: 'compaction', label: '正在压缩上下文' });
  });
  it('does not duplicate active tools or streaming commentary/final text', () => {
    expect(selectAgentLiveStatus([run], [], [tool])).toBeNull();
    expect(selectAgentLiveStatus([run], [message], [])).toBeNull();
    expect(selectAgentLiveStatus([run], [{ ...message, assistantItem: { ...message.assistantItem, phase: 'final' } }], [])).toBeNull();
    expect(selectAgentLiveStatus([run], [{ ...message, content: '' }], [])?.label).toBe('正在处理');
  });
  it.each(['completed', 'failed', 'cancelled', 'interrupted', 'awaiting_approval', 'awaiting_interaction'] as const)(
    'does not animate a %s run', status => {
      expect(selectAgentLiveStatus([{ ...run, status, currentStep: '整理当前任务上下文' }], [], [])).toBeNull();
    },
  );
  it('gives pending user decisions priority and ignores other runs', () => {
    expect(selectAgentLiveStatus([{ ...run, currentStep: '整理当前任务上下文' }], [], [{ ...tool, status: 'awaiting_approval' }])).toBeNull();
    expect(selectAgentLiveStatus([run], [{ ...message, runId: 'other' }], [{ ...tool, runId: 'other' }])?.label).toBe('正在处理');
  });
});
