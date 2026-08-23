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

import { createAgentOrchestrator } from './agent-orchestrator';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';
import { agentToolRegistry } from './agent-tool-registry';
import { createAIServiceRunSessionRegistry } from '../aiServiceRunSession';

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
      selectedNodeIds: [8],
    },
    model: 'test-model',
    ownerScope: OWNER_SCOPE,
    perception: {
      collectedAt: new Date().toISOString(),
      currentDirectory: {
        entries: [{ id: 8, name: 'movie.mp4', type: 'file' as const }],
        entryCount: 1,
        id: 10,
        name: '视频',
      },
      selectedNodes: [{ id: 8, name: 'movie.mp4', type: 'file' as const }],
    },
    profileId: 'profile-1',
    reasoningEffort: 'high' as const,
    userPrompt: '当前目录有什么？',
  };
}

describe('Agent orchestrator', () => {
  let store: AgentSessionStore;

  beforeEach(async () => {
    mocks.streamAgentProviderTurn.mockReset();
    mocks.streamAIServiceProfile.mockReset();
    store = await createSQLiteAgentSessionStore(':memory:');
  });

  afterEach(async () => {
    await store.close();
  });

  function createOrchestrator() {
    return createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
  }

  it('executes a read tool and persists the complete run', async () => {
    mocks.streamAgentProviderTurn
      .mockImplementationOnce(async (_profileId, input, onDelta) => {
        expect(input.systemPrompt).toContain('调用提供的 Tool');
        expect(input.systemPrompt).not.toContain('movie.mp4');
        expect(input.reasoningEffort).toBe('high');
        onDelta('我先查看目录。');
        return {
          content: '我先查看目录。',
          toolCalls: [{ id: 'call-1', input: {}, name: 'file.list' }],
        };
      })
      .mockImplementationOnce(async (_profileId, input, onDelta) => {
        expect(input.messages.at(-1)).toMatchObject({
          name: 'file.list',
          role: 'tool',
        });
        onDelta('当前目录有一个视频。');
        return { content: '当前目录有一个视频。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '我先查看目录。当前目录有一个视频。',
        runId: started.runId,
        sessionId: started.sessionId,
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot).toMatchObject({
      id: started.sessionId,
      lastRunStatus: 'completed',
      messageCount: 4,
    });
    expect(snapshot?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(snapshot?.messages.map(message => message.content)).toEqual([
      '当前目录有什么？',
      '我先查看目录。',
      '已读取 1 个直属条目',
      '当前目录有一个视频。',
    ]);
    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(2);
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).toContain('tool-started');
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).toContain('tool-completed');
    expect(mocks.streamAIServiceProfile).not.toHaveBeenCalled();
  });

  it('does not automatically execute a non-read tool', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    if (!agentToolRegistry.get('test.write')) {
      agentToolRegistry.register({
        description: 'test write',
        execute,
        inputSchema: { type: 'object' },
        name: 'test.write',
        risk: 'write',
      });
    }
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-write', input: {}, name: 'test.write' }],
      })
      .mockImplementationOnce(async (_profileId, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('需要用户确认');
        onDelta('当前不能自动执行写操作。');
        return { content: '当前不能自动执行写操作。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '当前不能自动执行写操作。',
        runId: started.runId,
        sessionId: started.sessionId,
        type: 'completed',
      }));
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('falls back to the bounded snapshot when a local model rejects tool calling', async () => {
    mocks.streamAgentProviderTurn.mockRejectedValueOnce(new Error('model does not support tools'));
    mocks.streamAIServiceProfile.mockImplementationOnce(async (input, onDelta) => {
      expect(input.systemPrompt).toContain('movie.mp4');
      expect(input.systemPrompt).toContain('当前模型不支持 Tool Calling');
      expect(input.reasoningEffort).toBe('high');
      onDelta('当前目录有 movie.mp4。');
      return '当前目录有 movie.mp4。';
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '当前目录有 movie.mp4。',
        runId: started.runId,
        sessionId: started.sessionId,
        type: 'completed',
      }));
    });

    expect(mocks.streamAIServiceProfile).toHaveBeenCalledTimes(1);
  });

  it('continues an existing session with a new run', async () => {
    mocks.streamAgentProviderTurn
      .mockImplementationOnce(async (_profileId, _input, onDelta) => {
        onDelta('第一轮完成。');
        return { content: '第一轮完成。', toolCalls: [] };
      })
      .mockImplementationOnce(async (_profileId, input, onDelta) => {
        expect(input.messages.map((message: { content: string }) => message.content)).toEqual([
          '当前目录有什么？',
          '第一轮完成。',
          '继续',
        ]);
        onDelta('第二轮完成。');
        return { content: '第二轮完成。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const first = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: first.runId, type: 'completed' }),
      );
    });

    const second = await orchestrator.start(webContents as never, {
      ...request(),
      sessionId: first.sessionId,
      userPrompt: '继续',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: second.runId, type: 'completed' }),
      );
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.runId).not.toBe(first.runId);
    expect((await store.getSession(first.sessionId, OWNER_SCOPE, 3))?.messages).toHaveLength(4);
  });

  it('freezes the AI service connection and locks its profile for the entire run', async () => {
    const sourceConnection = {
      apiKey: 'secret-a',
      baseUrl: 'https://ai-a.example.com/v1',
      providerType: 'openai' as const,
    };
    const registry = createAIServiceRunSessionRegistry();
    const getRuntimeProfile = vi.fn(() => sourceConnection);
    let finishTurn: () => void = () => undefined;
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (connection, _input, onDelta) => {
      expect(connection).toEqual(sourceConnection);
      await new Promise<void>((resolve) => {
        finishTurn = resolve;
      });
      onDelta('已完成。');
      return { content: '已完成。', toolCalls: [] };
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile,
      getSessionStore: async () => store,
      runSessionRegistry: registry,
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => expect(mocks.streamAgentProviderTurn).toHaveBeenCalled());
    sourceConnection.apiKey = 'secret-b';
    sourceConnection.baseUrl = 'https://ai-b.example.com/v1';
    expect(mocks.streamAgentProviderTurn.mock.calls[0][0]).toMatchObject({
      apiKey: 'secret-a',
      baseUrl: 'https://ai-a.example.com/v1',
    });
    expect(() => registry.assertProfileUnlocked('profile-1')).toThrow('正在被任务使用');
    finishTurn();

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'completed' }),
      );
    });
    expect(getRuntimeProfile).toHaveBeenCalledTimes(1);
    expect(() => registry.assertProfileUnlocked('profile-1')).not.toThrow();
  });

  it('includes persisted partial content in provider error events', async () => {
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, _input, onDelta) => {
      onDelta('已经生成的部分内容');
      throw new Error('provider disconnected');
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '已经生成的部分内容',
        message: 'provider disconnected',
        messages: expect.arrayContaining([
          expect.objectContaining({ content: '已经生成的部分内容', role: 'assistant' }),
        ]),
        runId: started.runId,
        sessionId: started.sessionId,
        type: 'error',
      }));
    });
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.messages.at(-1)?.content)
      .toBe('已经生成的部分内容');
  });

  it('aborts an owner run without allowing the same session to restart before cleanup', async () => {
    const runControl: {
      confirmAbort?: () => void;
      rejectTurn?: () => void;
    } = {};
    const abortObserved = new Promise<void>((resolve) => {
      runControl.confirmAbort = resolve;
    });
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (
      _connection,
      _input,
      _onDelta,
      signal,
    ) => new Promise((_resolve, reject) => {
      const handleAbort = () => {
        runControl.confirmAbort?.();
        runControl.rejectTurn = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
      };
      if (signal.aborted) handleAbort();
      else signal.addEventListener('abort', handleAbort, { once: true });
    }));
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());

    orchestrator.releaseOwner(webContents.id);
    await abortObserved;
    await expect(orchestrator.start(webContents as never, {
      ...request(),
      sessionId: started.sessionId,
      userPrompt: '不应并行启动',
    })).rejects.toThrow('正在处理上一条消息');

    runControl.rejectTurn?.();
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'cancelled' }),
      );
    });
  });

  it('cancels a start that is still waiting for the session store', async () => {
    const startControl: {
      resolveStore?: (value: AgentSessionStore) => void;
    } = {};
    const delayedStore = new Promise<AgentSessionStore>((resolve) => {
      startControl.resolveStore = resolve;
    });
    const registry = createAIServiceRunSessionRegistry();
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: () => delayedStore,
      runSessionRegistry: registry,
    });

    const startPromise = orchestrator.start(webContents as never, request());
    orchestrator.releaseOwner(webContents.id);
    startControl.resolveStore?.(store);

    await expect(startPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.streamAgentProviderTurn).not.toHaveBeenCalled();
    expect(() => registry.assertProfileUnlocked('profile-1')).not.toThrow();
    expect((await store.listSessions(OWNER_SCOPE, 3)).total).toBe(0);
  });
});
