import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createAgentToolBroker, normalizeAgentToolResult } from './agent-tool-broker';
import {
  createAgentToolRegistry,
  hashAgentToolInputForPreparation,
  type AgentMainCommitSettlement,
  type AgentTool,
  type AgentToolDispatchContext,
  type AgentToolExecutionContext,
} from './agent-tool-registry';
import type { AgentToolResult } from '../../../src/shared/agent/agent.types';
import { fileWriteTool } from './tools/file-write-tool';
import { filePatchTool } from './tools/file-patch-tool';
import { executeAgentFileWrite, type AgentFileWriteDependencies } from '../../../src/features/agent/services/agent-file-write';
import { executeAgentRendererTool } from '../../../src/features/agent/services/agent-tool-executor';
import { completeAgentToolExecution } from '../../../src/features/agent/services/agent.api';

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

function computerCommitReceipt(state: 'dispatched' | 'unknown', operation = 'computer.click'): AgentToolResult {
  return { ok: state === 'dispatched', message: state === 'dispatched' ? '已发送点击' : '请先观察，勿重复点击',
    data: { operation, operationId: '83fc584b-037d-4c82-8883-a609846ea0d4', dispatchState: state,
      mutationCommitState: state === 'dispatched' ? 'committed' : 'commit_unknown' } };
}

function computerBrokerContext(signal: AbortSignal, overrides: Partial<AgentTool> = {}, inherited?: AgentMainCommitSettlement): AgentToolDispatchContext {
  const name = overrides.name || 'computer.click';
  const registered = { name, registrationId: `builtin:${name}@1`, kind: 'business', risk: 'write', executor: 'main',
    prepareMain: vi.fn(async () => { throw new Error('Preparation already sealed before Broker execution'); }), ...overrides };
  return { appContext: prepareInput(signal).appContext, onProgress: vi.fn(), signal,
    ...(inherited ? { commitSettlement: inherited } : {}),
    runCapabilitySnapshot: { getTool: vi.fn(() => registered) },
  } as unknown as AgentToolDispatchContext;
}

function brokerDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('main-authorized renderer file no-op settlement', () => {
  const executionId = '6fb7d6e4-589d-4d53-8a28-f81d5c6c45f9';
  const revision = 'a'.repeat(64);
  const identity = { executionId, libraryId: 3, ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1' };
  const receipt = (): AgentToolResult => ({ ok: true, data: { operationId: executionId,
    revision, beforeRevision: revision, afterRevision: revision, changed: false, outcome: 'unchanged',
    writeCommitState: 'uncommitted', mutationCommitState: 'uncommitted' } });

  it.each(['abort', 'deadline'])('seals a missing no-op after the bounded %s settlement window', async cancellation => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const broker = createAgentToolBroker({ createId: () => executionId });
      const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), timeoutMs: 1_000,
        executionInput: { revision }, toolName: 'file.patch', fileNoopSettlement: { expectedRevision: revision } });
      const rejected = expect(prepared.outcome).rejects.toThrow(cancellation === 'abort' ? '取消' : '超时');
      if (cancellation === 'abort') controller.abort();
      else await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(() => broker.claimRendererCapability(77, { ...identity, capability: 'file.patch.unavailable' }, 'file.patch')).toThrow('取消');
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(() => broker.completeRendererExecution(77, { ...identity, result: receipt() })).toThrow('不存在或已经失效');
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each([
    { toolName: 'file.patch', executionInput: {}, config: revision },
    { toolName: 'file.patch', executionInput: { revision: 'invalid' }, config: revision },
    { toolName: 'file.patch', executionInput: { revision }, config: 'invalid' },
    { toolName: 'file.patch', executionInput: { revision }, config: 'b'.repeat(64) },
    { toolName: 'file.write', executionInput: { mode: 'create', revision }, config: revision },
    { toolName: 'file.delete', executionInput: { revision }, config: revision },
  ])('does not enable no-op settlement for an invalid main opt-in: $toolName $executionInput $config', async ({ toolName, executionInput, config }) => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => executionId });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), executionInput, toolName,
      fileNoopSettlement: { expectedRevision: config } });
    controller.abort();
    await expect(prepared.outcome).rejects.toThrow('取消');
    expect(() => broker.completeRendererExecution(77, { ...identity, result: receipt() })).toThrow('不存在或已经失效');
  });

  it('accepts a legacy expectedRevision request while freezing its main-owned no-op revision', async () => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => executionId });
    const config = { expectedRevision: revision };
    const executionInput = { expectedRevision: revision };
    const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), executionInput,
      toolName: 'file.patch', fileNoopSettlement: config });
    config.expectedRevision = 'b'.repeat(64);
    executionInput.expectedRevision = 'b'.repeat(64);
    controller.abort();
    broker.completeRendererExecution(77, { ...identity, result: receipt() });
    await expect(prepared.outcome).resolves.toMatchObject({ result: receipt() });
  });

  it('does not grant commit or access authority while retaining only a cancelled no-op settlement', async () => {
    const controller = new AbortController();
    const verifyAccess = vi.fn(async () => undefined);
    const broker = createAgentToolBroker({ createId: () => executionId });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), verifyAccess,
      executionInput: { revision }, toolName: 'file.patch', fileNoopSettlement: { expectedRevision: revision } });
    const capability = broker.claimRendererCapability(77, { ...identity, capability: 'file.patch.preparation' }, 'file.patch');
    controller.abort();
    expect(() => capability.beginCriticalSettlement()).toThrow('取消');
    expect(() => broker.claimRendererCapability(77, { ...identity, capability: 'file.patch.another' }, 'file.patch')).toThrow('取消');
    expect(() => broker.reportRendererProgress(77, { ...identity, phase: 'committing', progress: { message: '保存' } })).toThrow('取消');
    expect(() => broker.markRendererExecutionCommitted(77, { ...identity,
      result: { ok: true, data: { operationId: executionId, writeCommitState: 'committed', mutationCommitState: 'committed' } } })).toThrow('取消');
    await expect(broker.verifyRendererAccess(77, identity)).rejects.toThrow();
    expect(verifyAccess).not.toHaveBeenCalled();
    broker.completeRendererExecution(77, { ...identity, result: receipt() });
    await expect(prepared.outcome).resolves.toMatchObject({ result: receipt() });
  });

  it.each([
    { ok: false },
    { data: { operationId: 'c522be36-13dd-4ab3-adf3-59773ad25683' } },
    { data: { revision: 'b'.repeat(64), beforeRevision: 'b'.repeat(64), afterRevision: 'b'.repeat(64) } },
    { data: { changed: true } },
    { data: { writeCommitState: undefined } },
    { data: { deleteCommitState: 'committed' } },
  ])('rejects an ordinary or mismatched post-cancel result and ends the no-op wait immediately: %j', async patch => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const broker = createAgentToolBroker({ createId: () => executionId });
      const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), executionInput: { revision },
        toolName: 'file.patch', fileNoopSettlement: { expectedRevision: revision } });
      const rejected = expect(prepared.outcome).rejects.toThrow('取消');
      controller.abort();
      const valid = receipt();
      const result = { ...valid, ...patch, data: { ...(valid.data as Record<string, unknown>), ...patch.data } };
      expect(() => broker.completeRendererExecution(77, { ...identity, result })).toThrow('取消');
      await rejected;
      expect(() => broker.completeRendererExecution(77, { ...identity, result: receipt() })).toThrow('不存在或已经失效');
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each(['file.write', 'file.patch'].flatMap(toolName =>
    ['entry-abort', 'access-abort', 'access-rejected'].map(failure => ({ toolName, failure })),
  ))('settles $toolName through the renderer executor and API immediately after $failure', async ({ toolName, failure }) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    try {
      const startedAt = Date.now();
      const accessEntered = brokerDeferred<void>();
      const accessReleased = brokerDeferred<void>();
      const verifyAccess = vi.fn(async () => {
        accessEntered.resolve();
        await accessReleased.promise;
        if (failure === 'access-rejected') throw new Error('文件访问权限已失效');
      });
      const broker = createAgentToolBroker({ createId: () => executionId });
      const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), verifyAccess,
        executionInput: { libraryId: 3, revision, path: '/a.txt', ...(toolName === 'file.write'
          ? { content: 'old\n' } : { format: 'context-v1', patch: '@@\n-old\n+old\n' }) },
        toolName, fileNoopSettlement: { expectedRevision: revision } });
      const verifyToolAccess = vi.fn((input: typeof identity) => broker.verifyRendererAccess(77, input));
      const completeToolExecution = vi.fn(async (input: Parameters<typeof completeAgentToolExecution>[0]) =>
        broker.completeRendererExecution(77, input));
      vi.stubGlobal('window', { electronAgent: { verifyToolAccess, completeToolExecution } });
      const prepareMutation = vi.fn(), update = vi.fn(), readBytes = vi.fn(), onCommitted = vi.fn();
      const assertOwner = vi.fn(), resolvePath = vi.fn();
      const rejected = failure === 'access-rejected' ? undefined : expect(prepared.outcome).rejects.toThrow('取消');
      if (failure === 'entry-abort') controller.abort();
      const rendering = executeAgentRendererTool(prepared.request, {
        signal: controller.signal, assertOwner, prepareMutation, resolvePath, onCommitted,
        ...{ update, readBytes },
      });
      if (failure !== 'entry-abort') {
        await accessEntered.promise;
        if (failure === 'access-abort') controller.abort();
        accessReleased.resolve();
      }
      const renderer = await rendering;
      expect(renderer).toEqual({ committed: false, result: {
        ok: false, message: failure === 'access-rejected' ? '文件访问权限已失效' : '文件保存已取消，未提交。',
        data: { operationId: executionId, writeCommitState: 'uncommitted', mutationCommitState: 'uncommitted' },
      } });
      const completion = { ...identity, result: renderer.result };
      if (failure === 'access-rejected') {
        await expect(completeAgentToolExecution(completion)).resolves.toBe(true);
        await expect(prepared.outcome).resolves.toEqual({ result: renderer.result });
      } else {
        await expect(completeAgentToolExecution(completion)).rejects.toThrow('取消');
        await rejected;
      }
      expect(completeToolExecution).toHaveBeenCalledOnce();
      expect(completeToolExecution).toHaveBeenCalledWith(completion);
      if (failure === 'entry-abort') {
        expect(verifyToolAccess).not.toHaveBeenCalled();
        expect(verifyAccess).not.toHaveBeenCalled();
      } else {
        expect(verifyToolAccess).toHaveBeenCalledOnce();
        expect(verifyToolAccess).toHaveBeenCalledWith(identity);
        expect(verifyAccess).toHaveBeenCalledOnce();
      }
      for (const effect of [assertOwner, resolvePath, prepareMutation, update, readBytes, onCommitted]) expect(effect).not.toHaveBeenCalled();
      expect(Date.now()).toBe(startedAt);
      expect(vi.getTimerCount()).toBe(0);
    } finally { controller.abort(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});

describe('trusted file mutation main settlement', () => {
  const operationId = '83fc584b-037d-4c82-8883-a609846ea0d4';
  const receipt = (state: 'committed' | 'uncommitted' | 'commit_unknown'): AgentToolResult => ({
    ok: state === 'committed', data: { operationId, mutationCommitState: state, writeCommitState: state },
  });
  const toolInput = (name: string) => name === 'file.write' ? { path: '/a.txt', content: 'new' }
    : { path: '/a.txt', revision: 'a'.repeat(64), patch: '@@ -1 +1 @@\n-old\n+new\n' };
  const noopReceipt = (): AgentToolResult => ({ ok: true, data: { operationId, changed: false, outcome: 'unchanged',
    revision: 'a'.repeat(64), beforeRevision: 'a'.repeat(64), afterRevision: 'a'.repeat(64),
    writeCommitState: 'uncommitted', mutationCommitState: 'uncommitted' } });

  it.each(['file.write', 'file.patch'].flatMap(name => ['abort', 'deadline'].map(cancellation => ({ name, cancellation }))))('preserves an actual library $name no-op through both Brokers when $cancellation wins before main completion', async ({ name, cancellation }) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      try {
        const registry = createAgentToolRegistry([fileWriteTool, filePatchTool]); const snapshot = registry.createSnapshot();
        const broker = createAgentToolBroker({ toolRegistry: registry });
        const source = 'old\n', revision = createHash('sha256').update(source).digest('hex');
        const hooks = { operationId, prepare: vi.fn(async () => undefined), settle: vi.fn(async () => undefined) };
        const prepareMutation = vi.fn(async () => undefined), beforeCommit = vi.fn(async () => undefined);
        const update = vi.fn(), onCommitted = vi.fn(), onCancel = vi.fn();
        const context = { appContext: prepareInput(controller.signal).appContext, onProgress: vi.fn(), signal: controller.signal,
          fileMutation: hooks, runCapabilitySnapshot: { getTool: (requested: string) => snapshot.get(requested) },
          executeLibraryFileMutation: async (input: unknown, signal: AbortSignal) => {
            const execution = broker.prepareRendererExecution({ ...prepareInput(signal), toolName: name, onCancel,
              executionInput: { ...(input as Record<string, unknown>), libraryId: 3 },
              fileNoopSettlement: { expectedRevision: revision } });
            expect(execution.request).not.toHaveProperty('fileNoopSettlement');
            const renderer = await executeAgentFileWrite(execution.request, {
              signal, assertOwner: vi.fn(), prepareMutation, beforeCommit, update, onCommitted,
              resolvePath: async () => ({ id: 9, parentId: 10, libraryId: 3, type: 'file', name: 'a', ext: 'txt', path: '/a.txt' }),
              detail: async () => ({ id: 9, parentId: 10, libraryId: 3, type: 'file', name: 'a', ext: 'txt',
                storageKey: 'synthetic-binding', fileSize: source.length }) as Awaited<ReturnType<NonNullable<AgentFileWriteDependencies['detail']>>>,
              readBytes: async () => new TextEncoder().encode(source),
            });
            if (cancellation === 'abort') controller.abort();
            else await vi.advanceTimersByTimeAsync(10_000);
            broker.completeRendererExecution(77, { executionId: execution.request.executionId, libraryId: 3,
              ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1', result: renderer.result });
            const outcome = await execution.outcome;
            return { ...outcome.result, data: { ...(outcome.result.data as Record<string, unknown>), operationId } };
          } } as unknown as AgentToolDispatchContext;
        const input = { path: '/a.txt', revision, ...(name === 'file.patch'
          ? { format: 'context-v1', patch: '@@\n-old\n+old\n' } : { content: source }) };
        await expect(broker.executeMain(name, input, context, 10_000, snapshot, 35_000)).resolves.toMatchObject({
          ok: true, data: { operationId, changed: false, outcome: 'unchanged', revision, beforeRevision: revision, afterRevision: revision,
            writeCommitState: 'uncommitted', mutationCommitState: 'uncommitted' },
        });
        for (const effect of [hooks.prepare, hooks.settle, prepareMutation, beforeCommit, update, onCommitted]) expect(effect).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally { controller.abort(); vi.useRealTimers(); }
    });

  it('keeps ordinary, invalid and operation-mismatched uncommitted results subject to cancellation', async () => {
    const valid = noopReceipt(); const data = valid.data as Record<string, unknown>;
    const results: AgentToolResult[] = [
      { ok: false, data }, { ok: true, data: { operationId, mutationCommitState: 'uncommitted', writeCommitState: 'uncommitted' } },
      { ok: true, data: { ...data, changed: true } }, { ok: true, data: { ...data, outcome: 'written' } },
      { ok: true, data: { ...data, operationId: 'another-operation' } }, { ok: true, data: { ...data, revision: 'invalid' } },
      { ok: true, data: { ...data, revision: 'b'.repeat(64), beforeRevision: 'b'.repeat(64), afterRevision: 'b'.repeat(64) } },
      { ok: true, data: { ...data, beforeRevision: 'b'.repeat(64) } }, { ok: true, data: { ...data, afterRevision: undefined } },
      { ok: true, data: { ...data, writeCommitState: undefined } }, { ok: true, data: { ...data, deleteCommitState: 'committed' } },
    ];
    for (const result of results) {
      const controller = new AbortController();
      const registry = createAgentToolRegistry([filePatchTool]); const snapshot = registry.createSnapshot();
      const context = { appContext: prepareInput(controller.signal).appContext, onProgress: vi.fn(), signal: controller.signal,
        fileMutation: { operationId, prepare: vi.fn(), settle: vi.fn() },
        runCapabilitySnapshot: { getTool: (name: string) => snapshot.get(name) },
        executeLibraryFileMutation: async () => { controller.abort(); return result; } } as unknown as AgentToolDispatchContext;
      await expect(createAgentToolBroker({ toolRegistry: registry }).executeMain('file.patch', toolInput('file.patch'), context, 10_000, snapshot))
        .rejects.toThrow('取消');
    }
  });

  it.each([
    { input: {}, accepted: false },
    { input: { mode: 'create' }, accepted: false },
    { input: { mode: 'create', revision: 'a'.repeat(64) }, accepted: false },
    { input: { revision: 'invalid' }, accepted: false },
    { input: { revision: 'a'.repeat(64), expectedRevision: 'a'.repeat(64) }, accepted: false },
    { input: { expectedRevision: 'a'.repeat(64) }, accepted: true },
  ])('binds cancelled main no-op acceptance to the frozen request revision: $input', async ({ input, accepted }) => {
    const controller = new AbortController();
    const registry = createAgentToolRegistry([fileWriteTool]); const snapshot = registry.createSnapshot();
    const context = { appContext: prepareInput(controller.signal).appContext, onProgress: vi.fn(), signal: controller.signal,
      fileMutation: { operationId, prepare: vi.fn(), settle: vi.fn() },
      runCapabilitySnapshot: { getTool: (name: string) => snapshot.get(name) } } as unknown as AgentToolDispatchContext;
    const execute = vi.fn(async () => { controller.abort(); return noopReceipt(); });
    const running = createAgentToolBroker({ toolRegistry: { execute } }).executeMain('file.write', input, context);
    if (accepted) await expect(running).resolves.toMatchObject(noopReceipt());
    else await expect(running).rejects.toThrow('取消');
  });

  it('does not let an executor replace the frozen request revision before cancellation settlement', async () => {
    const controller = new AbortController();
    const registry = createAgentToolRegistry([filePatchTool]); const snapshot = registry.createSnapshot();
    const input = toolInput('file.patch');
    const context = { appContext: prepareInput(controller.signal).appContext, onProgress: vi.fn(), signal: controller.signal,
      fileMutation: { operationId, prepare: vi.fn(), settle: vi.fn() },
      runCapabilitySnapshot: { getTool: (name: string) => snapshot.get(name) },
      executeLibraryFileMutation: async () => {
        input.revision = 'b'.repeat(64);
        controller.abort();
        return { ok: true, data: { ...(noopReceipt().data as Record<string, unknown>),
          revision: 'b'.repeat(64), beforeRevision: 'b'.repeat(64), afterRevision: 'b'.repeat(64) } };
      } } as unknown as AgentToolDispatchContext;
    await expect(createAgentToolBroker({ toolRegistry: registry }).executeMain('file.patch', input, context, 10_000, snapshot)).rejects.toThrow('取消');
  });

  it('does not preserve a cancelled no-op from an untrusted file tool registration', async () => {
    const controller = new AbortController();
    const registry = createAgentToolRegistry([{ ...filePatchTool, registrationId: 'test:untrusted-file-patch@1' }]);
    const snapshot = registry.createSnapshot();
    const context = { appContext: prepareInput(controller.signal).appContext, onProgress: vi.fn(), signal: controller.signal,
      fileMutation: { operationId, prepare: vi.fn(), settle: vi.fn() },
      runCapabilitySnapshot: { getTool: (name: string) => snapshot.get(name) },
      executeLibraryFileMutation: async () => { controller.abort(); return noopReceipt(); } } as unknown as AgentToolDispatchContext;
    await expect(createAgentToolBroker({ toolRegistry: registry }).executeMain('file.patch', toolInput('file.patch'), context, 10_000, snapshot))
      .rejects.toThrow('取消');
  });

  it.each(['abort', 'deadline'])('does not replace a sealed %s with a late canonical no-op', async cancellation => {
    vi.useFakeTimers();
    const completion = brokerDeferred<AgentToolResult>();
    const started = brokerDeferred<void>();
    const controller = new AbortController();
    try {
      const registry = createAgentToolRegistry([filePatchTool]); const snapshot = registry.createSnapshot();
      const context = { appContext: prepareInput(controller.signal).appContext, onProgress: vi.fn(), signal: controller.signal,
        fileMutation: { operationId, prepare: vi.fn(), settle: vi.fn() },
        runCapabilitySnapshot: { getTool: (name: string) => snapshot.get(name) },
        executeLibraryFileMutation: async () => { started.resolve(); return completion.promise; } } as unknown as AgentToolDispatchContext;
      const running = createAgentToolBroker({ toolRegistry: registry }).executeMain('file.patch', toolInput('file.patch'), context, 1_000, snapshot, 50);
      const rejected = expect(running).rejects.toThrow(cancellation === 'deadline' ? '超时' : '取消');
      await started.promise;
      if (cancellation === 'abort') controller.abort();
      else await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      completion.resolve(noopReceipt());
      await Promise.resolve();
      await expect(running).rejects.toThrow(cancellation === 'deadline' ? '超时' : '取消');
      expect(vi.getTimerCount()).toBe(0);
    } finally { completion.resolve(noopReceipt()); vi.useRealTimers(); }
  });

  it.each(['committed', 'uncommitted', 'commit_unknown'] as const)('retains explicit %s independently of the result ok flag', async state => {
    const registry = createAgentToolRegistry([filePatchTool]); const snapshot = registry.createSnapshot();
    const actual = { ...receipt(state), ok: state !== 'committed' };
    const context = { appContext: prepareInput(new AbortController().signal).appContext, onProgress: vi.fn(), signal: new AbortController().signal,
      runCapabilitySnapshot: { getTool: (name: string) => snapshot.get(name) },
      executeLibraryFileMutation: async (_input: unknown, _signal: AbortSignal, commit?: AgentMainCommitSettlement) => {
        commit!.begin(receipt('commit_unknown')); commit!.settle(actual); return actual;
      } } as unknown as AgentToolDispatchContext;
    const broker = createAgentToolBroker({ toolRegistry: registry });
    await expect(broker.executeMain('file.patch', toolInput('file.patch'), context, 10_000, snapshot)).resolves.toEqual(actual);
  });

  it.each(['file.write', 'file.patch'])('injects main-owned settlement into actual registered %s and preserves post-cancel receipts', async name => {
    for (const state of ['committed', 'uncommitted', 'commit_unknown'] as const) {
      const registry = createAgentToolRegistry([fileWriteTool, filePatchTool]);
      const snapshot = registry.createSnapshot();
      const controller = new AbortController();
      const begun = brokerDeferred<AgentMainCommitSettlement>();
      const completion = brokerDeferred<AgentToolResult>();
      const executeLibraryFileMutation = vi.fn(async (_input: unknown, signal: AbortSignal, commit?: AgentMainCommitSettlement) => {
        expect(commit).toBeDefined();
        commit!.begin(receipt('commit_unknown'));
        begun.resolve(commit!);
        const actual = await completion.promise;
        expect(signal.aborted).toBe(true);
        commit!.settle(actual);
        return { ok: false, message: 'late cancellation must not replace actual commit state' };
      });
      const context = { appContext: prepareInput(controller.signal).appContext, onProgress: vi.fn(), signal: controller.signal,
        executeLibraryFileMutation, runCapabilitySnapshot: { getTool: (requested: string) => snapshot.get(requested) } } as unknown as AgentToolDispatchContext;
      const broker = createAgentToolBroker({ toolRegistry: registry });
      const running = broker.executeMain(name, toolInput(name), context, 10_000, snapshot);
      await begun.promise;
      controller.abort();
      completion.resolve(receipt(state));
      await expect(running).resolves.toEqual(receipt(state));
    }
  });

  it.each(['file.write', 'file.patch'])('retains %s unknown state when cancellation settlement times out and rejects late replacement', async name => {
    vi.useFakeTimers();
    const completion = brokerDeferred<AgentToolResult>();
    try {
      const registry = createAgentToolRegistry([fileWriteTool, filePatchTool]);
      const snapshot = registry.createSnapshot();
      const controller = new AbortController();
      const begun = brokerDeferred<AgentMainCommitSettlement>();
      const context = { appContext: prepareInput(controller.signal).appContext, onProgress: vi.fn(), signal: controller.signal,
        runCapabilitySnapshot: { getTool: (requested: string) => snapshot.get(requested) },
        executeLibraryFileMutation: async (_input: unknown, _signal: AbortSignal, commit?: AgentMainCommitSettlement) => {
          commit!.begin(receipt('commit_unknown')); begun.resolve(commit!); return completion.promise;
        } } as unknown as AgentToolDispatchContext;
      const broker = createAgentToolBroker({ toolRegistry: registry });
      const running = broker.executeMain(name, toolInput(name), context, 10_000, snapshot, 50);
      const commit = await begun.promise;
      controller.abort();
      await vi.advanceTimersByTimeAsync(50);
      await expect(running).resolves.toEqual(receipt('commit_unknown'));
      expect(() => commit.settle(receipt('committed'))).toThrow('已经结束');
    } finally { completion.resolve(receipt('uncommitted')); vi.useRealTimers(); }
  });

  it.each(['file.write', 'file.patch'])('does not grant %s settlement to forged versions, sources or inherited closures', async name => {
    for (const overrides of [
      { registrationId: 'spoof:file-mutation@1' }, { risk: 'read' }, { executor: 'renderer' }, { kind: 'control' },
      { pluginOperation: 'rename' }, { pluginOperation: 'file-output' },
      { pluginSource: { pluginId: 'spoof', registrationId: 'spoof@1' } },
    ]) {
      const inherited = { begin: vi.fn(), settle: vi.fn() };
      const registered = { name, registrationId: name === 'file.write' ? 'builtin:file.write@2' : 'builtin:file.patch@1',
        kind: 'business', risk: 'write', executor: 'main', ...overrides };
      const execute = vi.fn(async (_name: string, _input: unknown, context: AgentToolDispatchContext) => {
        expect(context.commitSettlement).toBeUndefined(); return { ok: false };
      });
      const context = { appContext: prepareInput(new AbortController().signal).appContext, onProgress: vi.fn(),
        signal: new AbortController().signal, commitSettlement: inherited,
        runCapabilitySnapshot: { getTool: () => registered } } as unknown as AgentToolDispatchContext;
      const broker = createAgentToolBroker({ toolRegistry: { execute } });
      await expect(broker.executeMain(name, {}, context)).resolves.toEqual({ ok: false });
      expect(inherited.begin).not.toHaveBeenCalled();
      expect(inherited.settle).not.toHaveBeenCalled();
    }
  });
});

describe('Agent tool broker', () => {
  it.each(['computer.setText', 'computer.scroll', 'computer.input', 'computer.menu'] as const)('preserves %s committed and unknown receipts after cancellation', async name => {
    for (const state of ['dispatched', 'unknown'] as const) {
      const controller = new AbortController();
      const begun = brokerDeferred<void>();
      const completion = brokerDeferred<AgentToolResult>();
      const execute = vi.fn(async (_name: string, _input: unknown, context: AgentToolDispatchContext) => {
        expect(context.commitSettlement).toBeDefined();
        context.commitSettlement!.begin(computerCommitReceipt('unknown', name));
        begun.resolve();
        const receipt = await completion.promise;
        context.commitSettlement!.settle(receipt);
        return { ok: false, message: 'late cancellation' };
      });
      const broker = createAgentToolBroker({ toolRegistry: { execute } });
      const running = broker.executeMain(name, {}, computerBrokerContext(controller.signal, { name }));
      await begun.promise;
      controller.abort();
      const receipt = computerCommitReceipt(state, name);
      completion.resolve(receipt);
      await expect(running).resolves.toEqual(receipt);
      expect(execute).toHaveBeenCalledWith(name, {}, expect.any(Object), `builtin:${name}@1`);
    }
  });

  it.each(['computer.setText', 'computer.scroll', 'computer.input', 'computer.menu'] as const)('does not grant %s a settlement through spoofed or plugin operation sources', async name => {
    for (const overrides of [{ kind: 'control' as const }, { name: 'file.rename' },
      { pluginOperation: 'rename' as const }, { pluginOperation: 'file-output' as const },
      { registrationId: `builtin:${name}@2` }, { prepareMain: undefined }]) {
      const execute = vi.fn(async (_name: string, _input: unknown, context: AgentToolDispatchContext) => {
        expect(context.commitSettlement).toBeUndefined();
        return { ok: false };
      });
      const broker = createAgentToolBroker({ toolRegistry: { execute } });
      await expect(broker.executeMain(name, {}, computerBrokerContext(new AbortController().signal, { name, ...overrides })))
        .resolves.toEqual({ ok: false });
    }
  });

  it('seals equal-length private text independently while keeping the same public action', () => {
    const name = 'computer.setText';
    const tool: AgentTool = { name, registrationId: `builtin:${name}@1`, executor: 'main', risk: 'write',
      description: name, inputSchema: { type: 'object' }, prepareMain: async () => { throw new Error('not used'); },
      execute: async () => ({ ok: true }) };
    const snapshot = createAgentToolRegistry([tool]).createSnapshot();
    const publicAction = { kind: 'computer.setText' as const, version: 1 as const, libraryId: 3,
      targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: 'QA',
      observationId: '83fc584b-037d-4c82-8883-a609846ea0d4', elementId: '805f4b48-ec6e-4f78-b45b-e01f10bb247e',
      mode: 'replace' as const, textLength: 5, textBytes: 5 };
    const identity = { aiDestinationIdentity: `v1:${'a'.repeat(64)}`, callId: 'call-1', libraryId: 3,
      ownerScope: OWNER_SCOPE, ownerWebContentsId: 17, preparedActionId: 'prepared-1', runCapabilityIdentity: `v3:${'b'.repeat(64)}`,
      runId: 'run-1', sessionId: 'session-1', toolInputHash: hashAgentToolInputForPreparation({ text: 'same input' }),
      toolName: name, toolRegistrationId: `builtin:${name}@1`, toolRunId: 'tool-run-1' };
    const first = snapshot.sealMainPreparedExecution(name, { approvalSemantics: { behavior: 'ask', risk: 'write' },
      binding: { text: 'hello' }, identity, publicAction });
    const second = snapshot.sealMainPreparedExecution(name, { approvalSemantics: { behavior: 'ask', risk: 'write' },
      binding: { text: 'world' }, identity, publicAction });
    expect(first.publicAction).toEqual(second.publicAction);
    expect(first.snapshotHash).not.toBe(second.snapshotHash);
    expect(first.stabilityHash).not.toBe(second.stabilityHash);
    expect(first.publicAction).not.toHaveProperty('text');
    expect(first.publicAction).not.toHaveProperty('textHash');
  });

  it.each(['dispatched', 'unknown'] as const)('keeps a built-in computer.click %s receipt when cancellation arrives after begin', async state => {
    const controller = new AbortController();
    const begun = brokerDeferred<AgentMainCommitSettlement>();
    const completion = brokerDeferred<AgentToolResult>();
    const execute = vi.fn(async (_name: string, _input: unknown, context: AgentToolDispatchContext) => {
      const settlement = context.commitSettlement;
      expect(settlement).toBeDefined();
      settlement!.begin(computerCommitReceipt('unknown'));
      begun.resolve(settlement!);
      const receipt = await completion.promise;
      settlement!.settle(receipt);
      return { ok: false, message: 'late executor cancellation must not replace the receipt' };
    });
    const broker = createAgentToolBroker({ toolRegistry: { execute } });
    const context = computerBrokerContext(controller.signal);
    const running = broker.executeMain('computer.click', {}, context);
    await begun.promise;
    controller.abort();
    const executionContext = execute.mock.calls[0][2];
    expect(executionContext.signal.aborted).toBe(true);
    const receipt = computerCommitReceipt(state);
    completion.resolve(receipt);
    await expect(running).resolves.toEqual(receipt);
    expect(execute).toHaveBeenCalledWith('computer.click', {}, expect.objectContaining({ commitSettlement: expect.any(Object) }), 'builtin:computer.click@1');
  });

  it.each(['computer.click', 'computer.input', 'computer.menu'])('retains the %s unknown input fallback when cancellation settlement expires without a helper receipt', async name => {
    vi.useFakeTimers();
    const completion = brokerDeferred<AgentToolResult>();
    try {
      const controller = new AbortController();
      const begun = brokerDeferred<AgentMainCommitSettlement>();
      const execute = vi.fn(async (_name: string, _input: unknown, context: AgentToolDispatchContext) => {
        context.commitSettlement!.begin(computerCommitReceipt('unknown', name));
        begun.resolve(context.commitSettlement!);
        return completion.promise;
      });
      const broker = createAgentToolBroker({ toolRegistry: { execute } });
      const running = broker.executeMain(name, {}, computerBrokerContext(controller.signal, { name }), 10_000, undefined, 50);
      const closure = await begun.promise;
      const settled = vi.fn();
      void running.then(settled);
      controller.abort();
      await vi.advanceTimersByTimeAsync(49);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(running).resolves.toEqual(computerCommitReceipt('unknown', name));
      expect(() => closure.settle(computerCommitReceipt('dispatched', name))).toThrow('已经结束');
    } finally {
      completion.resolve({ ok: false });
      vi.useRealTimers();
    }
  });

  it('does not begin or dispatch an input when cancellation wins during preflight', async () => {
    const controller = new AbortController();
    const entered = brokerDeferred<void>();
    const preflight = brokerDeferred<void>();
    const dispatch = vi.fn();
    const execute = vi.fn(async (_name: string, _input: unknown, context: AgentToolDispatchContext) => {
      expect(context.commitSettlement).toBeDefined();
      entered.resolve();
      await preflight.promise;
      expect(context.signal.aborted).toBe(true);
      context.commitSettlement!.begin(computerCommitReceipt('unknown'));
      dispatch();
      return computerCommitReceipt('dispatched');
    });
    const broker = createAgentToolBroker({ toolRegistry: { execute } });
    const running = broker.executeMain('computer.click', {}, computerBrokerContext(controller.signal));
    const failure = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    controller.abort();
    preflight.resolve();
    await failure;
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    { registrationId: 'other:computer.click@1' },
    { registrationId: 'builtin:computer.click@2' },
    { prepareMain: undefined },
    { risk: 'read' as const },
    { executor: 'renderer' as const },
    { pluginSource: { pluginId: 'spoof.click', pluginVersion: '1.0.0', packageFingerprint: 'a'.repeat(64), toolId: 'click', registrationId: 'spoof.click@1' } },
  ])('does not give a spoofed or unprepared click the host settlement closure: %j', async overrides => {
    const inherited = { begin: vi.fn(), settle: vi.fn() };
    const execute = vi.fn(async (_name: string, _input: unknown, context: AgentToolDispatchContext) => {
      expect(context.commitSettlement).toBeUndefined();
      return { ok: false, message: 'controlled dispatch unavailable' };
    });
    const broker = createAgentToolBroker({ toolRegistry: { execute } });
    await expect(broker.executeMain('computer.click', {}, computerBrokerContext(new AbortController().signal, overrides, inherited)))
      .resolves.toMatchObject({ ok: false });
    expect(inherited.begin).not.toHaveBeenCalled();
    expect(inherited.settle).not.toHaveBeenCalled();
  });

  it('binds commit authorization to the live execution owner and rechecks every time', async () => {
    const broker = createAgentToolBroker({ createId: () => 'access-check' });
    const verifyAccess = vi.fn(async () => undefined);
    const prepared = broker.prepareRendererExecution({ ...prepareInput(new AbortController().signal), verifyAccess });
    const input = { executionId: prepared.request.executionId, libraryId: 3, ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1' };
    expect(prepared.request.requireAccessCheck).toBe(true);
    await expect(broker.verifyRendererAccess(78, input)).rejects.toThrow('已失效');
    await expect(broker.verifyRendererAccess(77, { ...input, libraryId: 4 })).rejects.toThrow('已失效');
    expect(verifyAccess).not.toHaveBeenCalled();
    await expect(broker.verifyRendererAccess(77, input)).resolves.toBe(true);
    verifyAccess.mockRejectedValueOnce(new Error('Authorization changed'));
    await expect(broker.verifyRendererAccess(77, input)).rejects.toThrow('Authorization changed');
    broker.completeRendererExecution(77, { ...input, result: { ok: false, message: 'denied' } });
    await prepared.outcome;
    await expect(broker.verifyRendererAccess(77, input)).rejects.toThrow('已失效');
  });

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

  it.each([undefined, 20])('aborts a main-process tool when its %s execution timeout expires', async timeoutMs => {
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
      const running = broker.executeMain('media.inspect', {}, context, timeoutMs);
      const rejected = expect(running).rejects.toThrow('执行超时');
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync((timeoutMs ?? 30_000) + 6_000);

      await rejected;
      expect(executionSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the Run-frozen cancellation settlement budget before abandoning cleanup', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let settle!: (value: { ok: true }) => void;
      const execute = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
        settle = resolve;
      }));
      const broker = createAgentToolBroker({ toolRegistry: { execute } });
      const running = broker.executeMain('file.publish', {}, {
        appContext: prepareInput(controller.signal).appContext,
        onProgress: vi.fn(),
        signal: controller.signal,
      }, 30_000, undefined, 45_000);
      await Promise.resolve();
      controller.abort();
      await vi.advanceTimersByTimeAsync(6_001);

      let settled = false;
      void running.then(
        () => { settled = true; },
        () => { settled = true; },
      );
      await Promise.resolve();
      expect(settled).toBe(false);
      settle({ ok: true });
      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
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
  it.each(['directory.create', 'node.configure', 'file.rename', 'file.move', 'file.copy', 'recycle.restore', 'tag.update'])('settles uncertain %s commits after cancellation', async toolName => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => 'mutation' });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), toolName });
    const identity = { executionId: 'mutation', libraryId: 3, ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1' };
    broker.reportRendererProgress(77, { ...identity, phase: 'committing', progress: { message: '正在提交' } });
    controller.abort();
    const result = { ok: false, data: { mutationCommitState: 'commit_unknown' }, message: '请核对目标' };
    broker.completeRendererExecution(77, { ...identity, result });
    await expect(prepared.outcome).resolves.toMatchObject({ result });
  });
  it('preserves the authoritative deletion facts while reporting a late cleanup warning', async () => {
    const broker = createAgentToolBroker({ createId: () => 'delete-warning' });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(new AbortController().signal), toolName: 'file.delete' });
    const identity = { executionId: 'delete-warning', libraryId: 3, ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1' };
    const result = { ok: true, data: { deleteCommitState: 'committed', nodeId: 9 }, message: '已移入回收站' };
    broker.markRendererExecutionCommitted(77, { ...identity, result });
    broker.completeRendererExecution(77, { ...identity, result: { ok: true, data: { nodeId: 99 }, message: '已移入回收站，但预览清理失败' } });
    await expect(prepared.outcome).resolves.toEqual({ perception: undefined, result: { ...result, message: '已移入回收站，但预览清理失败' } });
  });
  it.each(['verified', 'changed'] as const)('retains the final %s configuration observation after the early commit receipt', async configVerification => {
    const broker = createAgentToolBroker({ createId: () => 'configure' });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(new AbortController().signal), toolName: 'node.configure' });
    const identity = { executionId: 'configure', libraryId: 3, ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1' };
    const committed = { ok: true, message: '已提交', data: { operation: 'node.configure', mutationCommitState: 'committed', operationId: 'configure',
      libraryId: 3, nodeId: 20, affectedParentIds: [10, 20], requestedConfig: { builtInType: 'COMIC', archiveMode: 1 }, configVerification: 'unavailable' } };
    broker.markRendererExecutionCommitted(77, { ...identity, result: committed });
    const node = { id: 20, libraryId: 3, parentId: 10, name: '作品', type: 'dir', builtInType: configVerification === 'verified' ? 'COMIC' : 'ASMR', archiveMode: 1 };
    broker.completeRendererExecution(77, { ...identity, result: { ok: true, message: configVerification, data: { ...committed.data,
      configVerification, node, requestedConfig: { builtInType: 'DEF', archiveMode: 0 } } } });
    await expect(prepared.outcome).resolves.toMatchObject({ result: { ok: true, message: configVerification, data: {
      mutationCommitState: 'committed', requestedConfig: { builtInType: 'COMIC', archiveMode: 1 }, node, configVerification } } });
  });
  it.each([{ nodeId: 21 }, { libraryId: 4 }, { operationId: 'other' }, { mutationCommitState: 'uncommitted' },
    { node: { id: 20, libraryId: 4, parentId: 10, name: 'foreign', type: 'dir' } }])('does not replace committed configuration identity or state with %j', async patch => {
    const broker = createAgentToolBroker({ createId: () => 'configure' });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(new AbortController().signal), toolName: 'node.configure' });
    const identity = { executionId: 'configure', libraryId: 3, ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1' };
    const committed = { ok: true, message: '已提交', data: { operation: 'node.configure', mutationCommitState: 'committed', operationId: 'configure',
      libraryId: 3, nodeId: 20, requestedConfig: { builtInType: 'COMIC', archiveMode: 1 }, configVerification: 'unavailable' } };
    broker.markRendererExecutionCommitted(77, { ...identity, result: committed });
    broker.completeRendererExecution(77, { ...identity, result: { ok: true, message: '不能采用', data: { ...committed.data, configVerification: 'verified',
      node: { id: 20, libraryId: 3, parentId: 10, name: '作品', type: 'dir', builtInType: 'COMIC', archiveMode: 1 }, ...patch } } });
    await expect(prepared.outcome).resolves.toMatchObject({ result: committed });
  });
  it.each(['file.write', 'file.delete'])('retains a %s commit that arrives just after cancellation', async toolName => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => 'direct-write' });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), toolName });
    broker.reportRendererProgress(77, {
      executionId: 'direct-write', libraryId: 3, ownerScope: OWNER_SCOPE,
      runId: 'run-1', sessionId: 'session-1', phase: 'committing', progress: { message: '正在保存文件' },
    });
    controller.abort();
    const result = { ok: true, data: { [toolName === 'file.delete' ? 'deleteCommitState' : 'writeCommitState']: 'committed' }, message: '已完成' };
    expect(broker.markRendererExecutionCommitted(77, {
      executionId: 'direct-write', libraryId: 3, ownerScope: OWNER_SCOPE,
      result, runId: 'run-1', sessionId: 'session-1',
    })).toBe(true);
    await expect(prepared.outcome).resolves.toEqual({ result });
  });
  it.each(['file.write', 'file.delete'])('cancels %s preparation immediately, without a settlement timer', async toolName => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => 'not-committing' });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), toolName });
    controller.abort();
    await expect(prepared.outcome).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each(['file.write', 'file.delete'])('settles cancelled %s waits with an explicit uncommitted result', async toolName => {
    const controller = new AbortController();
    const broker = createAgentToolBroker({ createId: () => 'no-commit' });
    const prepared = broker.prepareRendererExecution({ ...prepareInput(controller.signal), toolName });
    const identity = { executionId: 'no-commit', libraryId: 3, ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1' };
    broker.reportRendererProgress(77, { ...identity, phase: 'committing', progress: { message: '正在保存文件' } });
    controller.abort();
    const result = { ok: false, data: { [toolName === 'file.delete' ? 'deleteCommitState' : 'writeCommitState']: 'uncommitted' } };
    broker.completeRendererExecution(77, { ...identity, result });
    await expect(prepared.outcome).resolves.toEqual({ result });
  });
});
