import { describe, expect, it, vi } from 'vitest';

import {
  createAgentShellStorageRuntimeCloser,
  createAgentShellStorageRuntimeManager,
  type AgentShellStorageRuntime,
} from './agent-shell-storage-runtime';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createRuntime(close: () => Promise<void>): AgentShellStorageRuntime {
  return {
    close,
    quotaManager: {} as AgentShellStorageRuntime['quotaManager'],
    workspaceStore: {} as AgentShellStorageRuntime['workspaceStore'],
  };
}

describe('Agent Shell storage runtime lifecycle', () => {
  it('does not create a new generation until the previous runtime finishes closing', async () => {
    const oldCloseEntered = createDeferred();
    const oldCloseMayFinish = createDeferred();
    const oldClose = vi.fn(async () => {
      oldCloseEntered.resolve();
      await oldCloseMayFinish.promise;
    });
    const nextClose = vi.fn(async () => undefined);
    const runtimes = [createRuntime(oldClose), createRuntime(nextClose)];
    const createRuntimeGeneration = vi.fn(async () => {
      const runtime = runtimes.shift();
      if (!runtime) throw new Error('unexpected runtime generation');
      return runtime;
    });
    const manager = createAgentShellStorageRuntimeManager({
      createRuntime: createRuntimeGeneration,
    });

    await manager.get();
    const disposingOldGeneration = manager.dispose();
    await oldCloseEntered.promise;

    const nextGeneration = manager.get();
    let nextGenerationSettled = false;
    void nextGeneration.finally(() => {
      nextGenerationSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(createRuntimeGeneration).toHaveBeenCalledTimes(1);
    expect(nextGenerationSettled).toBe(false);

    oldCloseMayFinish.resolve();
    await disposingOldGeneration;
    await expect(nextGeneration).resolves.toBeDefined();
    expect(createRuntimeGeneration).toHaveBeenCalledTimes(2);
    expect(oldClose).toHaveBeenCalledOnce();

    await manager.dispose();
    expect(nextClose).toHaveBeenCalledOnce();
  });

  it('fails the waiting generation closed when the previous close fails', async () => {
    const oldCloseEntered = createDeferred();
    const oldCloseMayFail = createDeferred();
    const closeError = new Error('old runtime close failed');
    const oldClose = vi.fn(async () => {
      oldCloseEntered.resolve();
      await oldCloseMayFail.promise;
      throw closeError;
    });
    const createRuntimeGeneration = vi.fn(async () => createRuntime(oldClose));
    const manager = createAgentShellStorageRuntimeManager({
      createRuntime: createRuntimeGeneration,
    });

    await manager.get();
    const disposingOldGeneration = manager.dispose();
    const disposeFailure = expect(disposingOldGeneration).rejects.toBe(closeError);
    await oldCloseEntered.promise;
    const waitingGeneration = manager.get();
    const generationFailure = expect(waitingGeneration).rejects.toThrow(
      '上一次关闭未完整收口',
    );
    const disposingWaitingGeneration = manager.dispose();
    const waitingDisposeFailure = expect(disposingWaitingGeneration).rejects.toBe(closeError);

    oldCloseMayFail.resolve();
    await Promise.all([disposeFailure, generationFailure, waitingDisposeFailure]);
    expect(createRuntimeGeneration).toHaveBeenCalledOnce();
  });

  it('closes quota even when workspace disposal fails and shares one close promise', async () => {
    const workspaceError = new Error('workspace close failed');
    const workspaceDispose = vi.fn(async () => {
      throw workspaceError;
    });
    const quotaClose = vi.fn(async () => undefined);
    const close = createAgentShellStorageRuntimeCloser(
      { dispose: workspaceDispose },
      { close: quotaClose },
    );

    const firstClose = close();
    const secondClose = close();
    expect(secondClose).toBe(firstClose);
    const error = await firstClose.then(
      () => null,
      reason => reason as Error & { causes?: unknown[] },
    );

    expect(error).toMatchObject({
      causes: [workspaceError],
      message: 'Agent Shell 存储资源关闭失败',
    });
    expect(workspaceDispose).toHaveBeenCalledOnce();
    expect(quotaClose).toHaveBeenCalledOnce();
  });

  it('attempts both closes and preserves both failures in order', async () => {
    const workspaceError = new Error('workspace close failed');
    const quotaError = new Error('quota close failed');
    const workspaceDispose = vi.fn(async () => {
      throw workspaceError;
    });
    const quotaClose = vi.fn(async () => {
      throw quotaError;
    });
    const close = createAgentShellStorageRuntimeCloser(
      { dispose: workspaceDispose },
      { close: quotaClose },
    );

    const error = await close().then(
      () => null,
      reason => reason as Error & { causes?: unknown[] },
    );

    expect(error).toMatchObject({
      causes: [workspaceError, quotaError],
      message: 'Agent Shell 存储资源关闭失败',
    });
    expect(workspaceDispose).toHaveBeenCalledOnce();
    expect(quotaClose).toHaveBeenCalledOnce();
  });
});
