import { describe, expect, it, vi } from 'vitest';

import { createAgentToolBroker, normalizeAgentToolResult } from './agent-tool-broker';
import {
  createAgentToolRegistry,
  type AgentToolExecutionContext,
} from './agent-tool-registry';

const OWNER_SCOPE = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
};

function prepareInput(signal: AbortSignal) {
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin' as const,
      selectedNodeIds: [],
    },
    executionInput: { name: '测试' },
    ownerScope: OWNER_SCOPE,
    ownerWebContentsId: 77,
    onCancel: vi.fn(),
    onProgress: vi.fn(),
    runId: 'run-1',
    sessionId: 'session-1',
    signal,
    timeoutMs: 30_000,
    toolName: 'directory.create',
  };
}

describe('Agent tool broker', () => {
  it('removes credentials from canonical Tool results before persistence or events', () => {
    const input = {
      data: {
        authorization: 'Bearer private-token',
        nested: { url: 'https://example.com/file?X-Amz-Signature=private' },
      },
      message: 'password=private-value',
      ok: true,
    };

    expect(normalizeAgentToolResult(input)).toEqual({
      data: {
        authorization: '[REDACTED]',
        nested: { url: 'https://example.com/file?[SIGNED_QUERY_REDACTED]' },
      },
      message: 'password=[REDACTED]',
      ok: true,
    });
    expect(input.data.authorization).toBe('Bearer private-token');
  });

  it('dispatches main-process tools through the registry', async () => {
    const execute = vi.fn(async () => ({ message: 'done', ok: true }));
    const broker = createAgentToolBroker({ toolRegistry: { execute } });
    const context = {
      appContext: prepareInput(new AbortController().signal).appContext,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    };

    await expect(broker.executeMain('file.list', {}, context)).resolves.toEqual({
      message: 'done',
      ok: true,
    });
    expect(execute).toHaveBeenCalledWith('file.list', {}, expect.objectContaining({
      appContext: context.appContext,
      onProgress: expect.any(Function),
      signal: expect.any(AbortSignal),
    }));
  });

  it('prefers the Run-frozen registry and forwards its expected registration identity', async () => {
    const liveExecute = vi.fn(async () => ({ message: 'live', ok: true }));
    const runExecute = vi.fn(async () => ({ message: 'snapshot', ok: true }));
    const broker = createAgentToolBroker({ toolRegistry: { execute: liveExecute } });
    const signal = new AbortController().signal;
    const context = {
      appContext: prepareInput(signal).appContext,
      onProgress: vi.fn(),
      runCapabilitySnapshot: {
        getTool: () => ({ registrationId: 'file.list@run' }),
      },
      signal,
    } as unknown as AgentToolExecutionContext;

    await expect(broker.executeMain(
      'file.list',
      {},
      context,
      30_000,
      { execute: runExecute },
    )).resolves.toEqual({ message: 'snapshot', ok: true });
    expect(liveExecute).not.toHaveBeenCalled();
    expect(runExecute).toHaveBeenCalledWith(
      'file.list',
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'file.list@run',
    );
  });

  it('does not dispatch invalid input to a main-process Tool executor', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const toolRegistry = createAgentToolRegistry([{
      description: 'Strict tool',
      execute,
      inputSchema: {
        additionalProperties: false,
        properties: { nodeId: { type: 'integer' } },
        required: ['nodeId'],
        type: 'object',
      },
      name: 'file.strict-stat',
      risk: 'read',
    }]);
    const broker = createAgentToolBroker({ toolRegistry });
    const context = {
      appContext: prepareInput(new AbortController().signal).appContext,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    };

    await expect(broker.executeMain('file.strict-stat', { nodeId: '8' }, context))
      .rejects.toThrow('Agent Tool 参数不符合输入约束');
    expect(execute).not.toHaveBeenCalled();
  });

  it('aborts a main-process tool when its execution timeout expires', async () => {
    vi.useFakeTimers();
    try {
      let executionSignal: AbortSignal | undefined;
      const execute = vi.fn((
        _name: string,
        _input: unknown,
        context: AgentToolExecutionContext,
      ) => {
        executionSignal = context.signal;
        return new Promise<never>(() => undefined);
      });
      const broker = createAgentToolBroker({ toolRegistry: { execute } });
      const context = {
        appContext: prepareInput(new AbortController().signal).appContext,
        onProgress: vi.fn(),
        signal: new AbortController().signal,
      };
      const running = broker.executeMain('media.inspect', {}, context, 20);
      const rejected = expect(running).rejects.toThrow('执行超时');
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(20 + 6_000);

      await rejected;
      expect(executionSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts one authorized renderer result and normalizes its projection', async () => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({
      createId: () => 'execution-1',
      normalizePerception: input => input as never,
    });
    const prepared = broker.prepareRendererExecution(prepareInput(controller.signal));

    expect(prepared.request).toMatchObject({
      executionId: 'execution-1',
      input: { name: '测试' },
      toolName: 'directory.create',
    });
    expect(() => broker.completeRendererExecution(88, {
      executionId: 'execution-1',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: { ok: true },
      runId: 'run-1',
      sessionId: 'session-1',
    })).toThrow('无权提交');

    expect(broker.completeRendererExecution(77, {
      executionId: 'execution-1',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      perception: { collectedAt: 'now', selectedNodes: [] },
      result: { data: { value: 1 }, message: 'done', ok: true },
      runId: 'run-1',
      sessionId: 'session-1',
    })).toBe(true);
    await expect(prepared.outcome).resolves.toEqual({
      perception: { collectedAt: 'now', selectedNodes: [] },
      result: { data: { value: 1 }, message: 'done', ok: true },
    });
    expect(() => broker.completeRendererExecution(77, {
      executionId: 'execution-1',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: { ok: true },
      runId: 'run-1',
      sessionId: 'session-1',
    })).toThrow('不存在或已经失效');
  });

  it('authorizes one tool-specific renderer capability and prevents replay', () => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => 'execution-capability' });
    const prepared = broker.prepareRendererExecution({
      ...prepareInput(controller.signal),
      executionInput: { fileName: 'movie.mp4', libraryId: 3, nodeId: 8 },
      toolName: 'media.inspect',
    });
    const claim = {
      capability: 'media.inspect.source',
      executionId: prepared.request.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: 'run-1',
      sessionId: 'session-1',
    };

    const capability = broker.claimRendererCapability(77, claim, 'media.inspect');
    expect(capability).toMatchObject({
      executionInput: { fileName: 'movie.mp4', libraryId: 3, nodeId: 8 },
      signal: expect.any(AbortSignal),
    });
    expect(capability.signal).not.toBe(controller.signal);
    expect(capability.signal.aborted).toBe(false);
    expect(() => broker.claimRendererCapability(77, claim, 'media.inspect'))
      .toThrow('已经使用');
    expect(() => broker.claimRendererCapability(88, {
      ...claim,
      capability: 'another-capability',
    }, 'media.inspect')).toThrow('无权使用');
    controller.abort();
    void prepared.outcome.catch(() => undefined);
  });

  it('aborts a claimed capability when the renderer completes the execution early', async () => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => 'execution-early-complete' });
    const prepared = broker.prepareRendererExecution({
      ...prepareInput(controller.signal),
      toolName: 'media.inspect',
    });
    const capability = broker.claimRendererCapability(77, {
      capability: 'media.inspect.source',
      executionId: 'execution-early-complete',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: 'run-1',
      sessionId: 'session-1',
    }, 'media.inspect');

    expect(capability.signal.aborted).toBe(false);
    expect(broker.completeRendererExecution(77, {
      executionId: 'execution-early-complete',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: { message: 'done', ok: true },
      runId: 'run-1',
      sessionId: 'session-1',
    })).toBe(true);

    expect(capability.signal.aborted).toBe(true);
    await expect(prepared.outcome).resolves.toEqual({
      result: { message: 'done', ok: true },
    });
  });

  it('accepts progress only from the authorized renderer execution', async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    const broker = createAgentToolBroker({ createId: () => 'execution-progress' });
    const prepared = broker.prepareRendererExecution({
      ...prepareInput(controller.signal),
      onProgress,
    });
    const progress = {
      executionId: prepared.request.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      progress: { message: '正在上传', percent: 120 },
      runId: 'run-1',
      sessionId: 'session-1',
    };

    expect(() => broker.reportRendererProgress(88, progress)).toThrow('无权提交');
    expect(broker.reportRendererProgress(77, progress)).toBe(true);
    expect(onProgress).toHaveBeenCalledWith({ message: '正在上传', percent: 100 });

    controller.abort();
    await expect(prepared.outcome).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('invalidates pending renderer execution when its run is aborted', async () => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => 'execution-aborted' });
    const onCancel = vi.fn();
    const prepared = broker.prepareRendererExecution({
      ...prepareInput(controller.signal),
      onCancel,
    });

    controller.abort();

    await expect(prepared.outcome).rejects.toMatchObject({ name: 'AbortError' });
    expect(onCancel).toHaveBeenCalledWith('execution-aborted');
    expect(() => broker.completeRendererExecution(77, {
      executionId: 'execution-aborted',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: { ok: true },
      runId: 'run-1',
      sessionId: 'session-1',
    })).toThrow('不存在或已经失效');
  });

  it('invalidates a renderer execution after its bounded timeout', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const broker = createAgentToolBroker({ createId: () => 'execution-timeout' });
      const onCancel = vi.fn();
      const prepared = broker.prepareRendererExecution({
        ...prepareInput(controller.signal),
        onCancel,
        timeoutMs: 1,
      });
      const capability = broker.claimRendererCapability(77, {
        capability: 'media.extractAudio.save-local',
        executionId: 'execution-timeout',
        libraryId: 3,
        ownerScope: OWNER_SCOPE,
        runId: 'run-1',
        sessionId: 'session-1',
      }, 'directory.create');
      const rejected = expect(prepared.outcome).rejects.toThrow('执行超时');

      await vi.advanceTimersByTimeAsync(1_000);

      await rejected;
      expect(capability.signal.aborted).toBe(true);
      expect(onCancel).toHaveBeenCalledWith('execution-timeout');
      expect(() => broker.completeRendererExecution(77, {
        executionId: 'execution-timeout',
        libraryId: 3,
        ownerScope: OWNER_SCOPE,
        result: { ok: true },
        runId: 'run-1',
        sessionId: 'session-1',
      })).toThrow('不存在或已经失效');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves an authoritative committed result when the run is cancelled during settlement', async () => {
    const controller = new AbortController();
    const onCancel = vi.fn();
    const broker = createAgentToolBroker({ createId: () => 'execution-committed' });
    const prepared = broker.prepareRendererExecution({
      ...prepareInput(controller.signal),
      onCancel,
    });
    const committedResult = {
      data: { createdNodeId: 22, name: '测试', verified: false },
      message: '已创建文件夹“测试”',
      ok: true,
    };
    const capability = broker.claimRendererCapability(77, {
      capability: 'directory.create.committed-settlement',
      executionId: 'execution-committed',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: 'run-1',
      sessionId: 'session-1',
    }, 'directory.create');

    expect(broker.markRendererExecutionCommitted(77, {
      executionId: 'execution-committed',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: committedResult,
      runId: 'run-1',
      sessionId: 'session-1',
    })).toBe(true);
    expect(capability.signal.aborted).toBe(false);
    controller.abort();

    await expect(prepared.outcome).resolves.toEqual({ result: committedResult });
    expect(capability.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledWith('execution-committed');
  });

  it('keeps a critical renderer settlement alive when cancellation wins before commit receipt', async () => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => 'execution-critical' });
    const prepared = broker.prepareRendererExecution({
      ...prepareInput(controller.signal),
      toolName: 'media.extractAudio',
    });
    const capability = broker.claimRendererCapability(77, {
      capability: 'media.extractAudio.upload',
      executionId: 'execution-critical',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: 'run-1',
      sessionId: 'session-1',
    }, 'media.extractAudio');
    capability.beginCriticalSettlement();

    controller.abort();
    expect(capability.signal.aborted).toBe(true);

    const committedResult = {
      data: { createdNodeId: 42, uploadCommitState: 'committed' },
      message: '已上传媒体产物',
      ok: true,
    };
    expect(broker.markRendererExecutionCommitted(77, {
      executionId: 'execution-critical',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: committedResult,
      runId: 'run-1',
      sessionId: 'session-1',
    })).toBe(true);

    await expect(prepared.outcome).resolves.toEqual({ result: committedResult });
  });

  it('ends a cancelled critical settlement when no commit receipt arrives', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const broker = createAgentToolBroker({ createId: () => 'execution-critical-timeout' });
      const prepared = broker.prepareRendererExecution({
        ...prepareInput(controller.signal),
        toolName: 'media.extractAudio',
      });
      const capability = broker.claimRendererCapability(77, {
        capability: 'media.extractAudio.upload',
        executionId: 'execution-critical-timeout',
        libraryId: 3,
        ownerScope: OWNER_SCOPE,
        runId: 'run-1',
        sessionId: 'session-1',
      }, 'media.extractAudio');
      capability.beginCriticalSettlement();

      controller.abort();
      const rejected = expect(prepared.outcome).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(30_000);

      await rejected;
      expect(() => broker.markRendererExecutionCommitted(77, {
        executionId: 'execution-critical-timeout',
        libraryId: 3,
        ownerScope: OWNER_SCOPE,
        result: { ok: true },
        runId: 'run-1',
        sessionId: 'session-1',
      })).toThrow('不存在或已经失效');
    } finally {
      vi.useRealTimers();
    }
  });
});
