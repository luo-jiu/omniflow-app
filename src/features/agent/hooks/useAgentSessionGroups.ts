import React from 'react';
import type { AgentOwnerScope, AgentSessionPage } from '@/shared/agent/agent.types';
import type { AgentSessionDirectorySummary } from '@/shared/agent/agent-session-management';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import { listAgentSessionGroups, listAgentSessions } from '../services/agent.api';

export interface AgentGroupPage extends AgentSessionPage { loading: boolean; error?: string }
const EMPTY: AgentSessionDirectorySummary = { groups: [], total: 0, archivedCount: 0, ungroupedCount: 0 };
const emptyPage = (): AgentGroupPage => ({ sessions: [], total: 0, loading: false });
export const agentGroupPageKey = (id: string | null) => id || '__ungrouped';

export function useAgentSessionGroups(owner: AgentOwnerScope | null, libraryId: number) {
  const scopeKey = JSON.stringify([serializeAgentOwnerScope(owner), libraryId]);
  const liveScope = React.useRef(scopeKey);
  liveScope.current = scopeKey;
  const [state, setState] = React.useState<{ scope: string; summary: AgentSessionDirectorySummary; pages: Record<string, AgentGroupPage>; loading: boolean; error?: string }>(
    { scope: scopeKey, summary: EMPTY, pages: {}, loading: true });
  const current = state.scope === scopeKey ? state : { scope: scopeKey, summary: EMPTY, pages: {}, loading: true };
  const stateRef = React.useRef(current);
  stateRef.current = current;
  const requests = React.useRef(new Map<string, symbol>());
  const summaryRequest = React.useRef<symbol>();

  const loadGroup = React.useCallback(async (groupId: string | null, more = false) => {
    const key = agentGroupPageKey(groupId);
    if (!owner) {
      setState(value => ({ ...(value.scope === scopeKey ? value : { scope: scopeKey, summary: EMPTY, pages: {}, loading: false }),
        pages: { ...(value.scope === scopeKey ? value.pages : {}), [key]: emptyPage() } }));
      return;
    }
    const previous = stateRef.current.pages[key] || emptyPage();
    if (more && (!previous.nextCursor || previous.loading)) return;
    const request = Symbol(key);
    requests.current.set(key, request);
    setState(value => ({ ...(value.scope === scopeKey ? value : { scope: scopeKey, summary: EMPTY, pages: {}, loading: false }),
      pages: { ...(value.scope === scopeKey ? value.pages : {}), [key]: { ...previous, loading: true, error: undefined } } }));
    try {
      const page = await listAgentSessions(owner, libraryId, '', more ? previous.nextCursor : undefined, { groupId });
      if (liveScope.current !== scopeKey || requests.current.get(key) !== request) return;
      setState(value => {
        const entries = more ? [...previous.sessions, ...page.sessions.filter(item => !previous.sessions.some(old => old.id === item.id))] : page.sessions;
        return { ...value, pages: { ...value.pages, [key]: { ...page, sessions: entries, loading: false } } };
      });
    } catch (error) {
      if (liveScope.current !== scopeKey || requests.current.get(key) !== request) return;
      setState(value => ({ ...value, pages: { ...value.pages, [key]: { ...previous, loading: false,
        error: error instanceof Error ? error.message : '会话加载失败' } } }));
    }
  }, [libraryId, owner, scopeKey]);

  const refresh = React.useCallback(async () => {
    const request = Symbol('groups');
    summaryRequest.current = request;
    if (!owner) {
      setState({ scope: scopeKey, summary: EMPTY, pages: {}, loading: false });
      return;
    }
    setState(value => ({ ...(value.scope === scopeKey ? value : { scope: scopeKey, summary: EMPTY, pages: {} }), loading: true, error: undefined }));
    try {
      const summary = await listAgentSessionGroups(owner, libraryId);
      if (liveScope.current !== scopeKey || summaryRequest.current !== request) return;
      const loaded = Object.keys(stateRef.current.pages);
      setState(value => ({ ...value, scope: scopeKey, summary, loading: false, error: undefined }));
      await Promise.all(loaded.map(key => loadGroup(key === '__ungrouped' ? null : key)));
    } catch (error) {
      if (liveScope.current !== scopeKey || summaryRequest.current !== request) return;
      setState(value => ({ ...value, loading: false, error: error instanceof Error ? error.message : '会话组加载失败' }));
    }
  }, [libraryId, loadGroup, owner, scopeKey]);

  React.useEffect(() => {
    void refresh();
    const pending = requests.current;
    return () => { pending.clear(); summaryRequest.current = undefined; };
  }, [refresh]);

  return { ...current, loadGroup, refresh };
}
