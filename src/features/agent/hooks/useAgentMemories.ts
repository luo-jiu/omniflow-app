import React from 'react';

import type {
  AgentMemoryCursor,
  AgentMemoryDeleteRequest,
  AgentMemoryItem,
  AgentMemoryUpdateRequest,
  AgentOwnerScope,
} from '@/shared/agent/agent.types';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import {
  agentMemoryFieldMatchesQuery,
  normalizeAgentMemoryQuery,
} from '@/shared/agent/agent-memory-query';
import {
  deleteAgentMemory,
  listAgentMemories,
  updateAgentMemory,
} from '../services/agent.api';

type MemoryUpdateInput = Omit<AgentMemoryUpdateRequest, 'libraryId' | 'ownerScope'>;
type MemoryDeleteInput = Omit<AgentMemoryDeleteRequest, 'libraryId' | 'ownerScope'>;

export interface AgentMemoryMutationOutcome {
  error?: string;
  ok: boolean;
}

interface UseAgentMemoriesInput {
  active: boolean;
  libraryId: number;
  ownerScope?: AgentOwnerScope | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function memoryMatchesQuery(memory: AgentMemoryItem, query: string): boolean {
  const normalizedQuery = normalizeAgentMemoryQuery(query);
  return [memory.title, memory.content, memory.reason, memory.application]
    .some(value => agentMemoryFieldMatchesQuery(value, normalizedQuery));
}

function compareMemories(left: AgentMemoryItem, right: AgentMemoryItem): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function useAgentMemories({
  active,
  libraryId,
  ownerScope,
}: UseAgentMemoriesInput) {
  const ownerAccountScope = ownerScope?.accountScope ?? '';
  const ownerBackendScope = ownerScope?.backendScope ?? '';
  const ownerScopeKey = serializeAgentOwnerScope(ownerScope);
  const stableOwnerScope = React.useMemo<AgentOwnerScope | null>(() => (
    ownerScopeKey
      ? { accountScope: ownerAccountScope, backendScope: ownerBackendScope }
      : null
  ), [ownerAccountScope, ownerBackendScope, ownerScopeKey]);
  const scopeKey = `${ownerScopeKey}\u0000${libraryId}`;
  const committedScopeKeyRef = React.useRef(scopeKey);
  const queryIdentityRef = React.useRef({ scopeKey, value: '', version: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [memories, setMemories] = React.useState<AgentMemoryItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<AgentMemoryCursor | null>(null);
  const [queryState, setQueryState] = React.useState({ scopeKey, value: '' });
  const [stateScopeKey, setStateScopeKey] = React.useState(scopeKey);
  const [total, setTotal] = React.useState(0);
  const requestIdRef = React.useRef(0);
  const query = queryState.scopeKey === scopeKey ? queryState.value : '';

  const load = React.useCallback(async (
    requestedQuery = '',
    cursor?: AgentMemoryCursor,
  ): Promise<boolean> => {
    if (!stableOwnerScope) {
      setError(null);
      setLoadMoreError(null);
      setLoading(false);
      setLoadingMore(false);
      setMemories([]);
      setNextCursor(null);
      setTotal(0);
      return false;
    }
    const requestId = requestIdRef.current + 1;
    const requestedScopeKey = scopeKey;
    requestIdRef.current = requestId;
    if (cursor) {
      setLoadMoreError(null);
      setLoadingMore(true);
    } else {
      setError(null);
      setLoadMoreError(null);
      setLoading(true);
      setLoadingMore(false);
    }

    try {
      const page = await listAgentMemories(
        stableOwnerScope,
        libraryId,
        requestedQuery,
        cursor,
      );
      if (
        requestIdRef.current !== requestId
        || committedScopeKeyRef.current !== requestedScopeKey
      ) return false;
      setMemories((current) => {
        if (!cursor) return page.memories;
        const existingIds = new Set(current.map(memory => memory.id));
        return [...current, ...page.memories.filter(memory => !existingIds.has(memory.id))];
      });
      setNextCursor(page.nextCursor || null);
      setTotal(page.total);
      setError(null);
      setLoadMoreError(null);
      return true;
    } catch (loadError) {
      if (
        requestIdRef.current === requestId
        && committedScopeKeyRef.current === requestedScopeKey
      ) {
        const message = errorMessage(loadError, '长期记忆加载失败');
        if (cursor) {
          setLoadMoreError(message);
        } else {
          setMemories([]);
          setNextCursor(null);
          setTotal(0);
          setError(message);
        }
      }
      return false;
    } finally {
      if (
        requestIdRef.current === requestId
        && committedScopeKeyRef.current === requestedScopeKey
      ) {
        if (cursor) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [libraryId, scopeKey, stableOwnerScope]);

  React.useLayoutEffect(() => {
    requestIdRef.current += 1;
    committedScopeKeyRef.current = scopeKey;
    queryIdentityRef.current = {
      scopeKey,
      value: '',
      version: queryIdentityRef.current.version + 1,
    };
    setStateScopeKey(scopeKey);
    setError(null);
    setLoadMoreError(null);
    setLoading(false);
    setLoadingMore(false);
    setMemories([]);
    setNextCursor(null);
    setQueryState({ scopeKey, value: '' });
    setTotal(0);
  }, [scopeKey]);

  React.useEffect(() => {
    if (!active || !stableOwnerScope) {
      requestIdRef.current += 1;
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setError(null);
    setLoadMoreError(null);
    setLoading(true);
    setLoadingMore(false);
    const timer = setTimeout(() => {
      void load(query);
    }, 160);
    return () => clearTimeout(timer);
  }, [active, load, query, stableOwnerScope]);

  const setQuery = React.useCallback((nextQuery: string) => {
    requestIdRef.current += 1;
    queryIdentityRef.current = {
      scopeKey,
      value: nextQuery,
      version: queryIdentityRef.current.version + 1,
    };
    setError(null);
    setLoadMoreError(null);
    setLoading(Boolean(stableOwnerScope));
    setLoadingMore(false);
    setMemories([]);
    setNextCursor(null);
    setQueryState({ scopeKey, value: nextQuery });
    setTotal(0);
  }, [scopeKey, stableOwnerScope]);

  const loadMore = React.useCallback(async (): Promise<boolean> => {
    if (!nextCursor) return false;
    return load(query, nextCursor);
  }, [load, nextCursor, query]);

  const retry = React.useCallback(() => load(query), [load, query]);

  const clearLoadMoreError = React.useCallback(() => {
    setLoadMoreError(null);
  }, []);

  const update = React.useCallback(async (
    input: MemoryUpdateInput,
  ): Promise<AgentMemoryMutationOutcome> => {
    if (!stableOwnerScope) return { ok: false };
    const requestedScopeKey = scopeKey;
    const requestedQueryVersion = queryIdentityRef.current.version;
    try {
      const updated = await updateAgentMemory({
        ...input,
        libraryId,
        ownerScope: stableOwnerScope,
      });
      if (committedScopeKeyRef.current === requestedScopeKey) {
        if (queryIdentityRef.current.version === requestedQueryVersion) {
          const matchesQuery = memoryMatchesQuery(updated, query);
          setMemories((current) => {
            if (!current.some(memory => memory.id === updated.id)) return current;
            const nextMemories = current.filter(memory => memory.id !== updated.id);
            if (matchesQuery) nextMemories.push(updated);
            return nextMemories.sort(compareMemories);
          });
          if (!matchesQuery) setTotal(current => Math.max(0, current - 1));
        } else {
          void load(queryIdentityRef.current.value);
        }
      }
      return { ok: true };
    } catch (updateError) {
      if (committedScopeKeyRef.current !== requestedScopeKey) return { ok: false };
      return { error: errorMessage(updateError, '长期记忆保存失败'), ok: false };
    }
  }, [libraryId, load, query, scopeKey, stableOwnerScope]);

  const remove = React.useCallback(async (
    input: MemoryDeleteInput,
  ): Promise<AgentMemoryMutationOutcome> => {
    if (!stableOwnerScope) return { ok: false };
    const requestedScopeKey = scopeKey;
    const requestedQueryVersion = queryIdentityRef.current.version;
    try {
      await deleteAgentMemory({
        ...input,
        libraryId,
        ownerScope: stableOwnerScope,
      });
      if (committedScopeKeyRef.current === requestedScopeKey) {
        if (queryIdentityRef.current.version === requestedQueryVersion) {
          setMemories(current => current.filter(memory => memory.id !== input.id));
          setTotal(current => Math.max(0, current - 1));
        } else {
          void load(queryIdentityRef.current.value);
        }
      }
      return { ok: true };
    } catch (deleteError) {
      if (committedScopeKeyRef.current !== requestedScopeKey) return { ok: false };
      return { error: errorMessage(deleteError, '长期记忆删除失败'), ok: false };
    }
  }, [libraryId, load, scopeKey, stableOwnerScope]);

  const stateMatchesScope = stateScopeKey === scopeKey;

  return {
    clearLoadMoreError,
    error: stateMatchesScope ? error : null,
    hasMore: stateMatchesScope && Boolean(nextCursor),
    loadMore,
    loadMoreError: stateMatchesScope ? loadMoreError : null,
    loading: stateMatchesScope
      ? loading
      : active && Boolean(stableOwnerScope),
    loadingMore: stateMatchesScope ? loadingMore : false,
    memories: stateMatchesScope ? memories : [],
    query,
    remove,
    retry,
    setQuery,
    total: stateMatchesScope ? total : 0,
    update,
  };
}
