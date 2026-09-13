import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentOwnerScope, AgentSessionPage } from '@/shared/agent/agent.types';
import { useAgentSessionGroups } from './useAgentSessionGroups';

const api = vi.hoisted(() => ({ listAgentSessionGroups: vi.fn(), listAgentSessions: vi.fn() }));
vi.mock('../services/agent.api', () => api);
const owner: AgentOwnerScope = { accountScope: 'user:7', backendScope: 'https://example.test/api' };
const summary = { groups: [], total: 0, archivedCount: 0, ungroupedCount: 0 };
const page = (id: string): AgentSessionPage => ({ sessions: [{ id, title: id } as AgentSessionPage['sessions'][number]], total: 1 });
const mounted: TestRenderer.ReactTestRenderer[] = [];

function harness(libraryId = 3, scope: AgentOwnerScope | null = owner) {
  let current!: ReturnType<typeof useAgentSessionGroups>;
  function Probe(props: { libraryId: number; owner: AgentOwnerScope | null }) {
    current = useAgentSessionGroups(props.owner, props.libraryId);
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Probe libraryId={libraryId} owner={scope} />); });
  mounted.push(renderer);
  return { get current() { return current; }, switchLibrary(id: number) { renderer.update(<Probe libraryId={id} owner={scope} />); } };
}

describe('Session group page ownership', () => {
  beforeEach(() => { vi.resetAllMocks(); api.listAgentSessionGroups.mockResolvedValue(summary); });
  afterEach(() => { act(() => mounted.splice(0).forEach(renderer => renderer.unmount())); });

  it('does not load all session pages eagerly and deduplicates a group continuation', async () => {
    const view = harness();
    await act(async () => undefined);
    expect(api.listAgentSessions).not.toHaveBeenCalled();
    const cursor = { id: 'a', updatedAt: '2026-09-13T00:00:00Z' };
    api.listAgentSessions.mockResolvedValueOnce({ ...page('a'), total: 2, nextCursor: cursor })
      .mockResolvedValueOnce({ sessions: [...page('a').sessions, ...page('b').sessions], total: 2 });
    await act(async () => { await view.current.loadGroup('g'); });
    await act(async () => { await view.current.loadGroup('g', true); });
    expect(api.listAgentSessions).toHaveBeenLastCalledWith(owner, 3, '', cursor, { groupId: 'g' });
    expect(view.current.pages.g.sessions.map(item => item.id)).toEqual(['a', 'b']);
    expect(view.current.pages.g.nextCursor).toBeUndefined();
  });

  it('ignores a delayed page from another library', async () => {
    const view = harness();
    await act(async () => undefined);
    let resolveOld!: (value: AgentSessionPage) => void;
    api.listAgentSessions.mockImplementationOnce(() => new Promise<AgentSessionPage>(resolve => { resolveOld = resolve; }));
    let old!: Promise<void>;
    act(() => { old = view.current.loadGroup(null); });
    await act(async () => { view.switchLibrary(4); });
    api.listAgentSessions.mockResolvedValueOnce(page('new-library'));
    await act(async () => { await view.current.loadGroup(null); });
    await act(async () => { resolveOld(page('old-library')); await old; });
    expect(view.current.pages.__ungrouped.sessions[0].id).toBe('new-library');
  });

  it('keeps the latest request and supports retry after a failed page', async () => {
    const view = harness();
    await act(async () => undefined);
    let resolveOld!: (value: AgentSessionPage) => void;
    api.listAgentSessions.mockImplementationOnce(() => new Promise<AgentSessionPage>(resolve => { resolveOld = resolve; }))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page('retry'));
    let old!: Promise<void>;
    act(() => { old = view.current.loadGroup('g'); });
    await act(async () => { await view.current.loadGroup('g'); });
    expect(view.current.pages.g.error).toBe('offline');
    await act(async () => { await view.current.loadGroup('g'); });
    await act(async () => { resolveOld(page('stale')); await old; });
    expect(view.current.pages.g.sessions[0].id).toBe('retry');
    expect(view.current.pages.g.error).toBeUndefined();
  });

  it('settles an unauthenticated section without requesting data', async () => {
    const view = harness(3, null);
    await act(async () => { await view.current.loadGroup(null); });
    expect(view.current.loading).toBe(false);
    expect(view.current.pages.__ungrouped).toEqual({ sessions: [], total: 0, loading: false });
    expect(api.listAgentSessions).not.toHaveBeenCalled();
    expect(api.listAgentSessionGroups).not.toHaveBeenCalled();
  });
});
