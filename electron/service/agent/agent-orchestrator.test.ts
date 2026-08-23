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

const OTHER_OWNER_SCOPE = {
  accountScope: 'user:8',
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

  it('dispatches read-only media inspection through one authorized renderer execution', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-media-inspect', input: {}, name: 'media.inspect' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)).toMatchObject({
          content: expect.stringContaining('已读取'),
          name: 'media.inspect',
          role: 'tool',
        });
        onDelta('这个文件包含视频流。');
        return { content: '这个文件包含视频流。', toolCalls: [] };
      });
    const inspectMediaSource = vi.fn(async () => ({
      data: { streamCount: 1 },
      message: '已读取“movie.mp4”的媒体信息：1 个媒体流',
      ok: true,
    }));
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      inspectMediaSource,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '检查当前视频',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-execution-requested' }),
      );
    });
    const execution = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-execution-requested').execution;
    expect(execution).toMatchObject({
      input: { fileName: 'movie.mp4', libraryId: 3, nodeId: 8 },
      ownerScope: OWNER_SCOPE,
      toolName: 'media.inspect',
    });
    expect(JSON.stringify(execution)).not.toContain('signed');

    const inspectionRequest = {
      executionId: execution.executionId,
      fileName: 'movie.mp4',
      libraryId: 3,
      nodeId: 8,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
      sourceUrl: 'https://storage.example/signed?secret=value',
    };
    const result = await orchestrator.inspectMedia(webContents.id, inspectionRequest);
    expect(inspectMediaSource).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 8,
      sourceUrl: inspectionRequest.sourceUrl,
    }), expect.any(AbortSignal));
    await expect(orchestrator.inspectMedia(webContents.id, inspectionRequest))
      .rejects.toThrow('已经使用');
    orchestrator.completeToolExecution(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result,
      runId: started.runId,
      sessionId: started.sessionId,
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '这个文件包含视频流。',
        type: 'completed',
      }));
    });
  });

  it('runs approved audio extraction through one exact renderer capability', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-extract-audio', input: {}, name: 'media.extractAudio' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)).toMatchObject({
          content: expect.stringContaining('已提取并上传'),
          name: 'media.extractAudio',
          role: 'tool',
        });
        onDelta('音频已经提取并放回当前目录。');
        return { content: '音频已经提取并放回当前目录。', toolCalls: [] };
      });
    const extractMediaAudio = vi.fn(async (
      _input: unknown,
      _signal: AbortSignal,
      onProgress: (progress: { message: string; percent?: number }) => void,
    ) => {
      onProgress({ message: '音频提取完成，准备上传', percent: 60 });
      return {
        artifactId: 'artifact-1',
        fileName: 'movie-audio.m4a',
        filePath: '/tmp/agent-media/movie-audio.m4a',
        mimeType: 'audio/mp4',
        sizeBytes: 512,
      };
    });
    const mediaArtifactStore = {
      release: vi.fn(async () => true),
      releaseOwner: vi.fn(async () => undefined),
      releaseRun: vi.fn(async () => undefined),
      touchExecution: vi.fn(() => true),
    };
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      extractMediaAudio: extractMediaAudio as never,
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      mediaArtifactStore,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '提取当前视频的音频',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;
    expect(approval.preview).toMatchObject({ risk: 'write', title: '提取音频' });

    const decision = await orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    if (!decision.approved || !decision.execution) throw new Error('expected renderer execution');
    const execution = decision.execution;
    expect(execution).toMatchObject({
      input: {
        conflictPolicy: 'auto_rename',
        libraryId: 3,
        nodeId: 8,
        outputFileName: 'movie-audio.m4a',
        outputFormat: 'm4a',
        parentId: 10,
        sourceFileName: 'movie.mp4',
      },
      toolName: 'media.extractAudio',
    });

    const extractionRequest = {
      executionId: execution.executionId,
      fileName: 'movie.mp4',
      libraryId: 3,
      nodeId: 8,
      outputFileName: 'movie-audio.m4a',
      outputFormat: 'm4a' as const,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
      sourceUrl: 'https://storage.example/signed?secret=value',
    };
    await expect(orchestrator.extractMediaAudio(88, extractionRequest))
      .rejects.toThrow('无权使用');
    const artifact = await orchestrator.extractMediaAudio(webContents.id, extractionRequest);
    expect(extractMediaAudio).toHaveBeenCalledWith(expect.objectContaining({
      outputFileName: 'movie-audio.m4a',
      sourceUrl: extractionRequest.sourceUrl,
    }), expect.any(AbortSignal), expect.any(Function));
    await expect(orchestrator.extractMediaAudio(webContents.id, extractionRequest))
      .rejects.toThrow('已经使用');
    expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
      progress: { message: '音频提取完成，准备上传', percent: 60 },
      type: 'tool-progress',
    }));
    expect(orchestrator.reportToolExecutionProgress(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      progress: { message: '正在上传提取后的音频', percent: 65 },
      runId: started.runId,
      sessionId: started.sessionId,
    })).toBe(true);
    expect(mediaArtifactStore.touchExecution).toHaveBeenCalledWith({
      executionId: execution.executionId,
      ownerWebContentsId: webContents.id,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    expect(orchestrator.markToolExecutionCommitted(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: {
        data: {
          createdNodeId: 32,
          format: 'm4a',
          name: 'movie-audio.m4a',
          parentId: 10,
          verified: false,
        },
        message: '已提取并上传“movie-audio.m4a”',
        ok: true,
      },
      runId: started.runId,
      sessionId: started.sessionId,
    })).toBe(true);

    await orchestrator.releaseMediaArtifact(webContents.id, {
      artifactId: artifact.artifactId,
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    expect(mediaArtifactStore.release).toHaveBeenCalledWith('artifact-1', {
      executionId: execution.executionId,
      ownerWebContentsId: webContents.id,
      runId: started.runId,
      sessionId: started.sessionId,
    });

    orchestrator.completeToolExecution(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: {
        data: {
          createdNodeId: 32,
          format: 'm4a',
          name: 'movie-audio.m4a',
          parentId: 10,
          verified: true,
        },
        message: '已提取并上传“movie-audio.m4a”',
        ok: true,
      },
      runId: started.runId,
      sessionId: started.sessionId,
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '音频已经提取并放回当前目录。',
        type: 'completed',
      }));
    });
    expect(JSON.stringify(webContents.send.mock.calls)).not.toContain('secret=value');
    expect(JSON.stringify(webContents.send.mock.calls)).not.toContain('/tmp/agent-media');
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
        expect(input.messages.at(-1)?.content).toContain('尚未配置受控执行策略');
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

  it('approves directory creation, accepts one renderer result and re-perceives the directory', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-create', input: { name: '测试' }, name: 'directory.create' }],
      })
      .mockImplementationOnce(async (_connection, input) => {
        expect(input.messages.at(-1)).toMatchObject({
          name: 'directory.create',
          role: 'tool',
        });
        return {
          content: '',
          toolCalls: [{ id: 'call-list-after-create', input: {}, name: 'file.list' }],
        };
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('测试');
        onDelta('文件夹“测试”已经创建。');
        return { content: '文件夹“测试”已经创建。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '在当前目录创建一个叫测试的文件夹',
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approvalEvent = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required');
    const approval = approvalEvent.approval;
    expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'awaiting_approval',
      pendingApprovals: [expect.objectContaining({ approvalId: approval.approvalId })],
    });
    await expect(orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OTHER_OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    })).rejects.toThrow('无权处理');

    const decision = await orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    expect(decision).toMatchObject({
      approved: true,
      execution: {
        input: {
          conflictPolicy: 'error',
          libraryId: 3,
          name: '测试',
          parentId: 10,
        },
        toolName: 'directory.create',
      },
    });
    if (!decision.approved) throw new Error('expected approval');
    const execution = decision.execution;
    if (!execution) throw new Error('expected renderer execution');
    expect(() => orchestrator.completeToolExecution(webContents.id, {
      executionId: execution.executionId,
      libraryId: 4,
      ownerScope: OWNER_SCOPE,
      result: { ok: true },
      runId: started.runId,
      sessionId: started.sessionId,
    })).toThrow('无权提交');
    orchestrator.completeToolExecution(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      perception: {
        collectedAt: '2026-08-23T00:00:01.000Z',
        currentDirectory: {
          entries: [
            { id: 8, name: 'movie.mp4', type: 'file' },
            { id: 22, name: '测试', type: 'dir' },
          ],
          entryCount: 2,
          id: 10,
          name: '视频',
        },
        selectedNodes: [],
      },
      result: {
        data: { createdNodeId: 22, name: '测试', parentId: 10, verified: true },
        message: '已创建文件夹“测试”',
        ok: true,
      },
      runId: started.runId,
      sessionId: started.sessionId,
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '文件夹“测试”已经创建。',
        runId: started.runId,
        type: 'completed',
      }));
    });
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.pendingApprovals).toEqual([]);
    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(3);
  });

  it('executes an approved main-process tool without creating a renderer request', async () => {
    const execute = vi.fn(async () => ({ message: 'main write completed', ok: true }));
    if (!agentToolRegistry.get('test.main-confirm')) {
      agentToolRegistry.register({
        assess: () => ({
          behavior: 'ask',
          preview: {
            description: '执行测试 main 操作',
            risk: 'write',
            title: '测试 main 操作',
          },
          risk: 'write',
        }),
        description: 'test confirmed main tool',
        execute,
        inputSchema: { type: 'object' },
        name: 'test.main-confirm',
        risk: 'write',
      });
    }
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-main-confirm', input: { value: 1 }, name: 'test.main-confirm' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('main write completed');
        onDelta('main 操作已完成。');
        return { content: 'main 操作已完成。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;

    await expect(orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    })).resolves.toEqual({ approved: true });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: 'main 操作已完成。',
        type: 'completed',
      }));
    });
    expect(execute).toHaveBeenCalledWith(
      { value: 1 },
      expect.objectContaining({ appContext: expect.objectContaining({ libraryId: 3 }) }),
    );
  });

  it('returns a denied directory action to the model without executing it', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-create-denied', input: { name: '测试' }, name: 'directory.create' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('用户取消了');
        onDelta('已取消创建文件夹。');
        return { content: '已取消创建文件夹。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;

    await expect(orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: false,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    })).resolves.toEqual({ approved: false });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '已取消创建文件夹。',
        type: 'completed',
      }));
    });
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.pendingApprovals).toEqual([]);
  });

  it('cancels and invalidates an action that is waiting for approval', async () => {
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 'call-create-stop', input: { name: '测试' }, name: 'directory.create' }],
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;

    expect(orchestrator.stop(started.sessionId, webContents.id)).toBe(true);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        runId: started.runId,
        type: 'cancelled',
      }));
    });
    await expect(orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    })).rejects.toThrow('不存在或已经失效');
  });

  it('expires an unanswered approval without leaving a resumable action behind', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-create-expired', input: { name: '测试' }, name: 'directory.create' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('用户确认已超时');
        onDelta('创建请求已超时，没有执行。');
        return { content: '创建请求已超时，没有执行。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      approvalTimeoutMs: 5,
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
    const started = await orchestrator.start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '创建请求已超时，没有执行。',
        type: 'completed',
      }));
    });
    expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'completed',
      pendingApprovals: [],
    });
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
