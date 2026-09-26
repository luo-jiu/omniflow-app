import { useContext, useEffect, useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import AgentSessionPeek from '@/features/agent/components/AgentSessionPeek';
import type { AgentSessionSummary } from '@/shared/agent/agent.types';
import RetainedWorkspacePane from './RetainedWorkspacePane';

describe('Retained workspace pane', () => {
  it('mounts only on first entry and retains draft and component identity across page switches', () => {
    const mounted = vi.fn();
    const disposed = vi.fn();
    function Content() {
      const [draft, setDraft] = useState('');
      const active = useContext(WorkspaceVisibilityContext);
      useEffect(() => { mounted(); return disposed; }, []);
      return <input value={draft} data-active={active} onChange={event => setDraft(event.target.value)} />;
    }
    const render = (active: boolean, scope = 'library-3') => <RetainedWorkspacePane active={active} key={scope}><Content /></RetainedWorkspacePane>;
    let view!: TestRenderer.ReactTestRenderer;
    act(() => { view = TestRenderer.create(render(false)); });
    expect(mounted).not.toHaveBeenCalled();
    act(() => view.update(render(true)));
    const input = view.root.findByType('input');
    act(() => input.props.onChange({ target: { value: '未发送的草稿' } }));
    act(() => view.update(render(false)));
    expect(input.props['data-active']).toBe(false);
    expect(view.root.findByType('div').props.inert).toBe('');
    expect(view.root.findByType('div').props['aria-hidden']).toBe(true);
    act(() => view.update(render(true)));
    expect(view.root.findByType('input')).toBe(input);
    expect(input.props.value).toBe('未发送的草稿');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();
    act(() => view.update(render(false, 'library-4')));
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(view.root.findAllByType('input')).toHaveLength(0);
    act(() => view.update(render(true, 'library-4')));
    expect(view.root.findByType('input').props.value).toBe('');
    act(() => view.unmount());
    expect(disposed).toHaveBeenCalledTimes(2);
  });

  it('keeps the actual directory rows mounted and preserves expand-more state on return', () => {
    const sessions = Array.from({ length: 12 }, (_, index) => ({ id: `s${index}`, title: `会话 ${index}` } as AgentSessionSummary));
    const render = (active: boolean) => <RetainedWorkspacePane active={active}>
      <AgentSessionPeek sessions={sessions} total={12} activeSessionId="s1" loading={false}
        onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()}
        directory={{ groups: [], total: 12, archivedCount: 0, ungroupedCount: 12 }}
        pages={{ __ungrouped: { sessions, total: 12, loading: false } }} />
    </RetainedWorkspacePane>;
    let view!: TestRenderer.ReactTestRenderer;
    act(() => { view = TestRenderer.create(render(true)); });
    act(() => view.root.findByProps({ className: 'peek-more' }).props.onClick());
    const rows = view.root.findAllByProps({ className: 'peek-row-reveal' });
    expect(rows).toHaveLength(10);
    act(() => view.update(render(false)));
    act(() => view.update(render(true)));
    expect(view.root.findAllByProps({ className: 'peek-row-reveal' })).toEqual(rows);
    const toggle = view.root.findByProps({ className: 'peek-group-toggle' });
    act(() => toggle.props.onClick());
    act(() => view.update(render(false)));
    act(() => view.update(render(true)));
    expect(toggle.props['aria-expanded']).toBe(false);
    act(() => view.unmount());
  });
});
