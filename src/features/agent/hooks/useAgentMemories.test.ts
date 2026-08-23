import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentMemoryCursor,
  AgentMemoryItem,
  AgentOwnerScope,
} from '@/shared/agent/agent.types';
import { useAgentMemories } from './useAgentMemories';

const apiMocks = vi.hoisted(() => ({
  deleteAgentMemory: vi.fn(),
  listAgentMemories: vi.fn(),
  updateAgentMemory: vi.fn(),
}));

vi.mock('../services/agent.api', () => apiMocks);

const OWNER_SCOPE_A: AgentOwnerScope = {
  accountScope: 'user:7',
  backendScope: 'http://127.0.0.1:8850/api',
};

const OWNER_SCOPE_B: AgentOwnerScope = {
  accountScope: 'user:8',
  backendScope: 'http://127.0.0.1:8850/api',
};

interface HookProps {
  active: boolean;
  libraryId: number;
  ownerScope?: AgentOwnerScope | null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function memory(id: string, overrides: Partial<AgentMemoryItem> = {}): AgentMemoryItem {
  return {
    application: 'OmniFlow',
    content: `记忆内容 ${id}`,
    createdAt: '2026-08-24T00:00:00.000Z',
    id,
    kind: 'preference',
    reason: '用户明确要求记住',
    revision: 1,
    scope: 'global',
    title: `记忆 ${id}`,
    updatedAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function renderMemoriesHook(initialProps: HookProps) {
  let current: ReturnType<typeof useAgentMemories> | null = null;

  function Harness(props: HookProps) {
    current = useAgentMemories(props);
    return null;
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, initialProps));
  });

  return {
    get current() {
      if (!current) throw new Error('Agent memories hook was not rendered');
      return current;
    },
    rerender: (props: HookProps) => act(() => {
      renderer.update(React.createElement(Harness, props));
    }),
    unmount: () => act(() => renderer.unmount()),
  };
}

async function advanceInitialLoad() {
  await act(async () => {
    vi.advanceTimersByTime(160);
    await Promise.resolve();
  });
}

describe('useAgentMemories', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not let a late response from scope A overwrite scope B', async () => {
    const scopeARequest = deferred<{
      memories: AgentMemoryItem[];
      total: number;
    }>();
    const scopeBRequest = deferred<{
      memories: AgentMemoryItem[];
      total: number;
    }>();
    apiMocks.listAgentMemories
      .mockReturnValueOnce(scopeARequest.promise)
      .mockReturnValueOnce(scopeBRequest.promise);

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();
    expect(apiMocks.listAgentMemories).toHaveBeenCalledWith(
      OWNER_SCOPE_A,
      3,
      '',
      undefined,
    );

    hook.rerender({
      active: true,
      libraryId: 4,
      ownerScope: OWNER_SCOPE_B,
    });
    await advanceInitialLoad();

    const scopeBMemory = memory('scope-b', { libraryId: 4, scope: 'library' });
    await act(async () => {
      scopeBRequest.resolve({ memories: [scopeBMemory], total: 1 });
      await scopeBRequest.promise;
    });
    expect(hook.current.memories).toEqual([scopeBMemory]);

    await act(async () => {
      scopeARequest.resolve({ memories: [memory('scope-a')], total: 1 });
      await scopeARequest.promise;
    });

    expect(hook.current.memories).toEqual([scopeBMemory]);
    expect(hook.current.total).toBe(1);
    expect(hook.current.error).toBeNull();
    hook.unmount();
  });

  it('does not reuse an old scope A request after switching A to B to A', async () => {
    const firstScopeARequest = deferred<{ memories: AgentMemoryItem[]; total: number }>();
    const scopeBRequest = deferred<{ memories: AgentMemoryItem[]; total: number }>();
    const secondScopeARequest = deferred<{ memories: AgentMemoryItem[]; total: number }>();
    apiMocks.listAgentMemories
      .mockReturnValueOnce(firstScopeARequest.promise)
      .mockReturnValueOnce(scopeBRequest.promise)
      .mockReturnValueOnce(secondScopeARequest.promise);

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();
    hook.rerender({ active: true, libraryId: 4, ownerScope: OWNER_SCOPE_B });
    await advanceInitialLoad();
    hook.rerender({ active: true, libraryId: 3, ownerScope: OWNER_SCOPE_A });
    await advanceInitialLoad();

    const currentMemory = memory('current-scope-a');
    await act(async () => {
      secondScopeARequest.resolve({ memories: [currentMemory], total: 1 });
      await secondScopeARequest.promise;
    });
    await act(async () => {
      firstScopeARequest.resolve({ memories: [memory('stale-scope-a')], total: 1 });
      scopeBRequest.resolve({ memories: [memory('stale-scope-b')], total: 1 });
      await Promise.all([firstScopeARequest.promise, scopeBRequest.promise]);
    });

    expect(hook.current.memories).toEqual([currentMemory]);
    hook.unmount();
  });

  it('uses the authoritative update snapshot without reloading the list', async () => {
    const original = memory('memory-1');
    const updated = memory('memory-1', {
      content: '修改后的内容',
      revision: 2,
      title: '修改后的标题',
      updatedAt: '2026-08-24T00:01:00.000Z',
    });
    apiMocks.listAgentMemories.mockResolvedValueOnce({ memories: [original], total: 1 });
    apiMocks.updateAgentMemory.mockResolvedValue(updated);

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();

    let outcome: Awaited<ReturnType<typeof hook.current.update>> | undefined;
    await act(async () => {
      outcome = await hook.current.update({
        application: updated.application,
        content: updated.content,
        id: updated.id,
        reason: updated.reason,
        revision: original.revision,
        title: updated.title,
      });
      await Promise.resolve();
    });

    expect(outcome).toEqual({ ok: true });
    expect(apiMocks.listAgentMemories).toHaveBeenCalledTimes(1);
    expect(hook.current.memories).toEqual([updated]);
    expect(hook.current.error).toBeNull();
    hook.unmount();
  });

  it('keeps loaded pages and their cursor after updating a later-page memory', async () => {
    const firstCursor: AgentMemoryCursor = {
      id: 'memory-2',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const secondCursor: AgentMemoryCursor = {
      id: 'memory-4',
      updatedAt: '2026-08-23T23:59:00.000Z',
    };
    const pageOne = [memory('memory-1'), memory('memory-2')];
    const pageTwo = [memory('memory-3'), memory('memory-4')];
    const updated = memory('memory-4', {
      revision: 2,
      updatedAt: '2026-08-24T00:02:00.000Z',
    });
    apiMocks.listAgentMemories
      .mockResolvedValueOnce({ memories: pageOne, nextCursor: firstCursor, total: 5 })
      .mockResolvedValueOnce({ memories: pageTwo, nextCursor: secondCursor, total: 5 });
    apiMocks.updateAgentMemory.mockResolvedValue(updated);

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();
    await act(async () => {
      await hook.current.loadMore();
      await hook.current.update({
        application: updated.application,
        content: updated.content,
        id: updated.id,
        reason: updated.reason,
        revision: 1,
        title: updated.title,
      });
    });

    expect(apiMocks.listAgentMemories).toHaveBeenCalledTimes(2);
    expect(hook.current.memories.map(item => item.id)).toEqual([
      'memory-4',
      'memory-1',
      'memory-2',
      'memory-3',
    ]);
    expect(hook.current.hasMore).toBe(true);
    expect(hook.current.total).toBe(5);
    hook.unmount();
  });

  it('removes an updated memory that no longer matches the active query', async () => {
    const original = memory('matching', { content: 'contains needle' });
    const updated = memory('matching', { content: 'no longer matches', revision: 2 });
    apiMocks.listAgentMemories.mockResolvedValueOnce({ memories: [original], total: 1 });
    apiMocks.updateAgentMemory.mockResolvedValue(updated);

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    act(() => {
      hook.current.setQuery('needle');
    });
    await advanceInitialLoad();
    await act(async () => {
      await hook.current.update({
        application: updated.application,
        content: updated.content,
        id: updated.id,
        reason: updated.reason,
        revision: 1,
        title: updated.title,
      });
    });

    expect(hook.current.memories).toEqual([]);
    expect(hook.current.total).toBe(0);
    expect(apiMocks.listAgentMemories).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('refreshes the latest query when an update settles after the query changes', async () => {
    const original = memory('memory-1');
    const updated = memory('memory-1', {
      content: '修改后的内容',
      revision: 2,
    });
    const currentQueryMemory = memory('current-query');
    const updateRequest = deferred<AgentMemoryItem>();
    apiMocks.listAgentMemories
      .mockResolvedValueOnce({ memories: [original], total: 1 })
      .mockResolvedValue({ memories: [currentQueryMemory], total: 1 });
    apiMocks.updateAgentMemory.mockReturnValue(updateRequest.promise);

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();

    let updatePromise!: ReturnType<typeof hook.current.update>;
    act(() => {
      updatePromise = hook.current.update({
        application: updated.application,
        content: updated.content,
        id: updated.id,
        reason: updated.reason,
        revision: original.revision,
        title: updated.title,
      });
      hook.current.setQuery('current');
    });

    await act(async () => {
      updateRequest.resolve(updated);
      await updatePromise;
      await Promise.resolve();
    });
    await advanceInitialLoad();

    expect(apiMocks.listAgentMemories.mock.calls.slice(1).every(call => (
      call[2] === 'current'
    ))).toBe(true);
    expect(hook.current.query).toBe('current');
    expect(hook.current.memories).toEqual([currentQueryMemory]);
    hook.unmount();
  });

  it('keeps loaded pages and their cursor after deleting a later-page memory', async () => {
    const firstCursor: AgentMemoryCursor = {
      id: 'memory-2',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const secondCursor: AgentMemoryCursor = {
      id: 'memory-4',
      updatedAt: '2026-08-23T23:59:00.000Z',
    };
    apiMocks.listAgentMemories
      .mockResolvedValueOnce({
        memories: [memory('memory-1'), memory('memory-2')],
        nextCursor: firstCursor,
        total: 5,
      })
      .mockResolvedValueOnce({
        memories: [memory('memory-3'), memory('memory-4')],
        nextCursor: secondCursor,
        total: 5,
      });
    apiMocks.deleteAgentMemory.mockResolvedValue(true);

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();
    await act(async () => {
      await hook.current.loadMore();
      await hook.current.remove({ id: 'memory-4', revision: 1 });
    });

    expect(apiMocks.listAgentMemories).toHaveBeenCalledTimes(2);
    expect(hook.current.memories.map(item => item.id)).toEqual([
      'memory-1',
      'memory-2',
      'memory-3',
    ]);
    expect(hook.current.hasMore).toBe(true);
    expect(hook.current.total).toBe(4);
    hook.unmount();
  });

  it('refreshes the latest query when a deletion settles after the query changes', async () => {
    const deleteRequest = deferred<boolean>();
    const currentQueryMemory = memory('current-query');
    apiMocks.listAgentMemories
      .mockResolvedValueOnce({ memories: [memory('deleted')], total: 1 })
      .mockResolvedValue({ memories: [currentQueryMemory], total: 1 });
    apiMocks.deleteAgentMemory.mockReturnValue(deleteRequest.promise);

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();

    let deletePromise!: ReturnType<typeof hook.current.remove>;
    act(() => {
      deletePromise = hook.current.remove({ id: 'deleted', revision: 1 });
      hook.current.setQuery('current');
    });
    await act(async () => {
      deleteRequest.resolve(true);
      await deletePromise;
      await Promise.resolve();
    });
    await advanceInitialLoad();

    expect(apiMocks.listAgentMemories.mock.calls.slice(1).every(call => (
      call[2] === 'current'
    ))).toBe(true);
    expect(hook.current.memories).toEqual([currentQueryMemory]);
    expect(hook.current.total).toBe(1);
    hook.unmount();
  });

  it('surfaces an initial load error and recovers when retried', async () => {
    apiMocks.listAgentMemories
      .mockRejectedValueOnce(new Error('首次加载失败'))
      .mockResolvedValueOnce({ memories: [memory('recovered')], total: 1 });

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();

    expect(hook.current.error).toBe('首次加载失败');
    expect(hook.current.memories).toEqual([]);
    expect(hook.current.loading).toBe(false);

    let retried = false;
    await act(async () => {
      retried = await hook.current.retry();
    });

    expect(retried).toBe(true);
    expect(hook.current.error).toBeNull();
    expect(hook.current.memories.map(item => item.id)).toEqual(['recovered']);
    expect(hook.current.total).toBe(1);
    hook.unmount();
  });

  it('appends a next page without duplicating memories already in the list', async () => {
    const cursor: AgentMemoryCursor = {
      id: 'memory-2',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const firstMemory = memory('memory-1');
    const secondMemory = memory('memory-2');
    const duplicateSecondMemory = memory('memory-2', { title: '重复返回的标题' });
    const thirdMemory = memory('memory-3');
    apiMocks.listAgentMemories
      .mockResolvedValueOnce({
        memories: [firstMemory, secondMemory],
        nextCursor: cursor,
        total: 3,
      })
      .mockResolvedValueOnce({
        memories: [duplicateSecondMemory, thirdMemory],
        total: 3,
      });

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();

    let loaded = false;
    await act(async () => {
      loaded = await hook.current.loadMore();
    });

    expect(loaded).toBe(true);
    expect(apiMocks.listAgentMemories).toHaveBeenLastCalledWith(
      OWNER_SCOPE_A,
      3,
      '',
      cursor,
    );
    expect(hook.current.memories).toEqual([firstMemory, secondMemory, thirdMemory]);
    expect(hook.current.hasMore).toBe(false);
    expect(hook.current.total).toBe(3);
    hook.unmount();
  });

  it('keeps loaded memories when loading more fails and exposes a separate error', async () => {
    const cursor: AgentMemoryCursor = {
      id: 'memory-1',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const firstMemory = memory('memory-1');
    apiMocks.listAgentMemories
      .mockResolvedValueOnce({
        memories: [firstMemory],
        nextCursor: cursor,
        total: 2,
      })
      .mockRejectedValueOnce(new Error('下一页网络失败'));

    const hook = renderMemoriesHook({
      active: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE_A,
    });
    await advanceInitialLoad();

    let loaded = true;
    await act(async () => {
      loaded = await hook.current.loadMore();
    });

    expect(loaded).toBe(false);
    expect(hook.current.memories).toEqual([firstMemory]);
    expect(hook.current.error).toBeNull();
    expect(hook.current.loadMoreError).toBe('下一页网络失败');
    expect(hook.current.loadingMore).toBe(false);

    act(() => {
      hook.current.clearLoadMoreError();
    });
    expect(hook.current.loadMoreError).toBeNull();
    hook.unmount();
  });
});
