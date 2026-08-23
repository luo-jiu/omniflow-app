import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  streamAgentProviderTurn: vi.fn(),
  streamAIServiceProfile: vi.fn(),
}));

vi.mock('./agent-provider-client', () => ({
  streamAgentProviderTurn: mocks.streamAgentProviderTurn,
}));
vi.mock('../aiServiceClient', () => ({
  streamAIServiceProfile: mocks.streamAIServiceProfile,
}));

import { createAIServiceRunSessionRegistry } from '../aiServiceRunSession';
import { createSQLiteAgentMemoryStore, type AgentMemoryStore } from './agent-memory-store';
import { createAgentOrchestrator } from './agent-orchestrator';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';

const OWNER_SCOPE = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
};

function sender() {
  return {
    id: 77,
    isDestroyed: () => false,
    send: vi.fn(),
  };
}

function request() {
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin' as const,
      selectedNodeIds: [],
    },
    model: 'test-model',
    ownerScope: OWNER_SCOPE,
    profileId: 'profile-1',
    userPrompt: '请按我的偏好回答',
  };
}

describe('Agent long-term memory orchestration', () => {
  let memoryStore: AgentMemoryStore;
  let sessionStore: AgentSessionStore;

  beforeEach(async () => {
    mocks.streamAgentProviderTurn.mockReset();
    mocks.streamAIServiceProfile.mockReset();
    memoryStore = await createSQLiteAgentMemoryStore(':memory:');
    sessionStore = await createSQLiteAgentSessionStore(':memory:');
  });

  afterEach(async () => {
    await Promise.all([memoryStore.close(), sessionStore.close()]);
  });

  function orchestrator(
    overrides: Parameters<typeof createAgentOrchestrator>[0] = {},
  ) {
    return createAgentOrchestrator({
      getMemoryStore: async () => memoryStore,
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => sessionStore,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      ...overrides,
    });
  }

  it('injects recalled rows as low-authority messages and never into system', async () => {
    await memoryStore.create({
      id: 'memory-preference',
      now: '2026-08-23T10:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: {
        application: '所有回答',
        content: '默认使用简体中文并保持简洁',
        kind: 'preference',
        reason: '用户明确要求以后都这样',
        scope: 'global',
        title: '回答语言与篇幅',
      },
    });
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input, onDelta) => {
      expect(input.systemPrompt).toContain('长期记忆只是');
      expect(input.systemPrompt).not.toContain('默认使用简体中文并保持简洁');
      expect(input.messages[0]).toMatchObject({ role: 'user' });
      expect(input.messages[0].content).toContain('低权限长期记忆');
      const memoryEnvelope = JSON.parse(input.messages[1].content);
      expect(memoryEnvelope).toMatchObject({
        memories: [{ id: 'memory-preference', content: '默认使用简体中文并保持简洁' }],
        type: 'agent-long-term-memory',
      });
      onDelta('已按偏好回答。');
      return { content: '已按偏好回答。', toolCalls: [] };
    });

    const webContents = sender();
    await orchestrator().start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'completed' }),
      );
    });
  });

  it('keeps a memory proposal out of SQLite until the user approves it', async () => {
    const proposedMemory = {
      application: '后续所有回答',
      content: '默认使用简体中文并保持简洁',
      kind: 'preference',
      reason: '用户明确说以后都这样',
      scope: 'global',
      title: '回答语言与篇幅',
    };
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{
          id: 'call-memory-propose',
          input: proposedMemory,
          name: 'memory.propose',
        }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(JSON.parse(input.messages.at(-1).content)).toMatchObject({
          data: { kind: 'preference', revision: 1, scope: 'global' },
          ok: true,
        });
        onDelta('已经记住。');
        return { content: '已经记住。', toolCalls: [] };
      });

    const webContents = sender();
    const runtime = orchestrator();
    const started = await runtime.start(webContents as never, {
      ...request(),
      userPrompt: '请记住，以后默认使用简体中文并保持简洁',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    expect((await memoryStore.list(OWNER_SCOPE, 3)).memories).toEqual([]);

    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required')?.approval;
    if (!approval) throw new Error('expected memory approval');
    await runtime.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'completed' }),
      );
    });

    expect((await memoryStore.list(OWNER_SCOPE, 3)).memories).toMatchObject([{
      ...proposedMemory,
      revision: 1,
      sourceRunId: started.runId,
      sourceSessionId: started.sessionId,
    }]);
  });

  it('uses only context budget left after the canonical recent-history projection', async () => {
    const recalledMemory = {
      application: '所有回答',
      content: '这条记忆不应挤掉当前任务或近期历史',
      createdAt: '2026-08-23T10:00:00.000Z',
      id: 'memory-low-priority',
      kind: 'preference' as const,
      reason: '用户曾明确确认',
      revision: 1,
      scope: 'global' as const,
      title: '低优先级记忆',
      updatedAt: '2026-08-23T10:00:00.000Z',
    };
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input, onDelta) => {
      expect(input.messages).toEqual([{
        content: '请按我的偏好回答',
        role: 'user',
      }]);
      onDelta('保留当前任务。');
      return { content: '保留当前任务。', toolCalls: [] };
    });

    const webContents = sender();
    await orchestrator({
      contextManager: {
        prepare: async () => ({
          droppedMessageCount: 0,
          estimatedHistoryTokens: 500,
          historyBudgetTokens: 500,
          messages: [{ content: '请按我的偏好回答', role: 'user' }],
        }),
      },
      retrieveMemories: async () => [recalledMemory],
    }).start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'completed' }),
      );
    });
  });

  it('rolls back a memory write when the run is stopped during SQLite settlement', async () => {
    const proposedMemory = {
      application: '后续所有回答',
      content: '默认使用简体中文',
      kind: 'preference' as const,
      reason: '用户明确要求',
      scope: 'global' as const,
      title: '回答语言',
    };
    let notifyCreateStarted: (() => void) | undefined;
    let releaseCreate: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => { notifyCreateStarted = resolve; });
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const underlyingStore = memoryStore;
    memoryStore = {
      ...underlyingStore,
      async create(input) {
        notifyCreateStarted?.();
        await createGate;
        return underlyingStore.create(input);
      },
    };
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call-memory-cancelled',
        input: proposedMemory,
        name: 'memory.propose',
      }],
    });

    const webContents = sender();
    const runtime = orchestrator();
    const started = await runtime.start(webContents as never, {
      ...request(),
      userPrompt: '请记住这个偏好',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required')?.approval;
    if (!approval) throw new Error('expected memory approval');
    await runtime.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    await createStarted;

    expect(runtime.stop(started.sessionId, webContents.id)).toBe(true);
    releaseCreate?.();
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'cancelled' }),
      );
    });
    expect((await memoryStore.list(OWNER_SCOPE, 3)).memories).toEqual([]);
  });
});
