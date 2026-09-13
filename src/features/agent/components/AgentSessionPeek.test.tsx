import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import AgentSessionPeek from './AgentSessionPeek';
import { AGENT_DIRECTORY_WIDTH } from '../agent-session-directory-layout';
import type { AgentSessionDirectorySummary } from '@/shared/agent/agent-session-management';
import type { AgentSessionSummary } from '@/shared/agent/agent.types';

describe('Agent session peek', () => {
  it('reveals five more sessions per group and resets the limit when collapsed', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ id: `s${index}`, title: `会话 ${index}` } as AgentSessionSummary));
    const group = { id: 'g', name: '文档组', sessionCount: 12 } as AgentSessionDirectorySummary['groups'][number];
    const onLoadGroup = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentSessionPeek sessions={[]} total={24} activeSessionId={null} loading={false}
      onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()} currentGroupId="g"
      directory={{ groups: [group], total: 24, archivedCount: 0, ungroupedCount: 12 }}
      pages={{ __ungrouped: { sessions: items, total: 12, loading: false }, g: { sessions: items, total: 12, loading: false } }}
      onLoadGroup={onLoadGroup} />); });
    const sections = renderer.root.findAllByProps({ className: 'peek-group' });
    const rows = (index: number) => sections[index].findAllByProps({ className: 'peek-row' });
    const more = () => sections[1].findByProps({ className: 'peek-more' });
    expect(rows(0)).toHaveLength(5);
    expect(rows(1)).toHaveLength(5);
    expect(more().props.children).toBe('展开更多');
    act(() => more().props.onClick());
    expect(rows(1)).toHaveLength(10);
    expect(rows(0)).toHaveLength(5);
    act(() => more().props.onClick());
    expect(rows(1)).toHaveLength(12);
    expect(sections[1].findAllByProps({ className: 'peek-more' })).toHaveLength(0);
    expect(onLoadGroup).not.toHaveBeenCalled();
    const toggle = sections[1].findByProps({ className: 'peek-group-toggle' });
    act(() => toggle.props.onClick());
    act(() => toggle.props.onClick());
    expect(rows(1)).toHaveLength(5);
    act(() => renderer.unmount());
  });

  it('loads expanded groups independently and exposes archive and group actions', () => {
    const onLoadGroup = vi.fn(); const onNewInGroup = vi.fn(); const onArchive = vi.fn(); const onEditGroup = vi.fn();
    const item = { id: 's1', title: '组内任务', lastRunStatus: 'completed' } as AgentSessionSummary;
    const group = { id: 'g', name: '文档组', sessionCount: 12 } as AgentSessionDirectorySummary['groups'][number];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentSessionPeek sessions={[]} total={12} activeSessionId={null} loading={false}
      onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()}
      directory={{ groups: [group], total: 12, archivedCount: 0, ungroupedCount: 0 }}
      pages={{ g: { sessions: [item], total: 12, loading: false, nextCursor: { id: 's1', updatedAt: 'now' } } }}
      onLoadGroup={onLoadGroup} onNewInGroup={onNewInGroup} onArchive={onArchive} onEditGroup={onEditGroup} />); });
    expect(onLoadGroup).toHaveBeenCalledWith(null);
    expect(onLoadGroup).not.toHaveBeenCalledWith('g');
    const toggle = renderer.root.findAllByProps({ className: 'peek-group-toggle' })[1];
    expect(toggle.props['aria-expanded']).toBe(false);
    act(() => toggle.props.onClick());
    expect(toggle.props['aria-expanded']).toBe(true);
    act(() => renderer.root.findByProps({ 'aria-label': '在文档组新建会话' }).props.onClick());
    expect(onNewInGroup).toHaveBeenCalledWith('g');
    act(() => renderer.root.findByProps({ 'aria-label': '文档组设置' }).props.onClick());
    expect(onEditGroup).toHaveBeenCalledWith(group);
    act(() => renderer.root.findByProps({ 'aria-label': '归档 组内任务' }).props.onClick());
    expect(onArchive).toHaveBeenCalledWith(item);
    act(() => renderer.root.findByProps({ className: 'peek-more' }).props.onClick());
    expect(onLoadGroup).toHaveBeenCalledWith('g', true);
    act(() => renderer.unmount());
  });

  it('keeps the session directory visible without a trigger and exposes manage/new actions', () => {
    const onOpen = vi.fn(); const onManage = vi.fn(); const onNew = vi.fn(); const onMemories = vi.fn();
    const sessions = [{ id: 's1', title: '当前聊天', messageCount: 4, updatedAt: '2026-09-11T00:00:00Z' }, { id: 's2', title: '另一个聊天', messageCount: 2, updatedAt: '2026-09-10T00:00:00Z' }] as never[];
    const renderer = TestRenderer.create(<AgentSessionPeek sessions={sessions} total={2} activeSessionId="s1" loading={false} onOpen={onOpen} onManage={onManage} onNew={onNew} onMemories={onMemories} />);
    const directory = renderer.root.findByType('aside');
    expect(directory.props['aria-label']).toBe('会话目录');
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'toolbar-action-btn' })).toHaveLength(0);
    expect(renderer.root.findByProps({ 'aria-label': '最近会话' })).toBeTruthy();
    expect(renderer.root.findByProps({ 'aria-current': true })).toBeTruthy();
    const buttonWithText = (text: string) => renderer.root.findAllByType('button').find(button => button.findAllByType('span').some(span => String(span.props.children).includes(text)) || String(button.props.children).includes(text))!;
    act(() => buttonWithText('另一个聊天').props.onClick());
    expect(onOpen).toHaveBeenCalledWith(sessions[1]);
    act(() => buttonWithText('会话管理').props.onClick());
    act(() => buttonWithText('新建会话').props.onClick());
    act(() => renderer.root.findByProps({ 'aria-label': '长期记忆' }).props.onClick());
    expect(onMemories).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByProps({ className: 'peek-meta' })).toHaveLength(0);
    expect(renderer.root.findByProps({ className: 'peek-foot' }).findAllByType('svg')).toHaveLength(3);
    expect(onManage).toHaveBeenCalledOnce(); expect(onNew).toHaveBeenCalledOnce();

    act(() => renderer.update(<AgentSessionPeek sessions={sessions} total={2} activeSessionId="s1" loading busy onOpen={onOpen} onManage={onManage} onNew={onNew} onMemories={onMemories} />));
    expect(renderer.root.findByType('aside')).toBe(directory);
    expect(buttonWithText('另一个聊天').props.disabled).toBe(true);
    expect(buttonWithText('新建').props.disabled).toBe(true);
    expect(renderer.root.findAllByProps({ className: 'peek-row' })).toHaveLength(2);
    renderer.unmount();
  });

  it('drags the compact bubble vertically without opening it and clamps it when resized', () => {
    let bounds = { width: 900, height: 600 };
    let measure!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { measure = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const listeners = new Map<string, (event: unknown) => void>();
    const ownerDocument = {
      addEventListener: vi.fn((type, callback) => listeners.set(type, callback)),
      removeEventListener: vi.fn((type) => listeners.delete(type)),
    };
    const layer = { getBoundingClientRect: () => bounds, ownerDocument, contains: () => false };
    const target = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(), focus: vi.fn() };
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        renderer = TestRenderer.create(<AgentSessionPeek sessions={[]} total={0} activeSessionId={null}
          loading={false} onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()} />, {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer : target,
        });
      });
      const bubble = renderer.root.findAllByType('button').find(button => button.props['aria-haspopup'] === 'dialog')!;
      const card = renderer.root.findByType('aside');
      expect(bubble.props['data-visible']).toBe(true);
      expect(card.props['data-visible']).toBe(false);
      expect(card.props.hidden).toBeUndefined();
      expect(card.props.inert).toBe('');

      act(() => bubble.props.onPointerDown({ pointerId: 1, button: 0, isPrimary: true, clientX: 900, clientY: 300, currentTarget: target }));
      act(() => bubble.props.onPointerMove({ pointerId: 1, clientX: -400, clientY: 900 }));
      act(() => bubble.props.onPointerUp({ pointerId: 1, currentTarget: target }));
      act(() => bubble.props.onClick());
      expect(bubble.props.style).toEqual({ top: 556 });
      expect(card.props['data-visible']).toBe(false);

      act(() => bubble.props.onClick());
      expect(card.props['data-visible']).toBe(true);
      expect(card.props.style.top).toBe(448);

      bounds = { width: 900, height: 300 };
      act(() => measure());
      expect(card.props.style.top).toBe(148);
      expect(card.props.style['--agent-directory-available-height']).toBe('140px');
      act(() => listeners.get('keydown')?.({ key: 'Escape', preventDefault: vi.fn() }));
      expect(card.props['data-visible']).toBe(false);
      expect(bubble.props.style.top).toBe(148);
      expect(target.focus).toHaveBeenCalledOnce();

      act(() => bubble.props.onKeyDown({ key: 'Home', preventDefault: vi.fn() }));
      expect(bubble.props.style.top).toBe(12);
      act(() => bubble.props.onClick());
      expect(card.props.style.top).toBe(12);
      act(() => listeners.get('pointerdown')?.({ target: {} }));
      expect(card.props['data-visible']).toBe(false);

      act(() => bubble.props.onClick());
      bounds = { width: 1400, height: 600 };
      act(() => measure());
      expect(bubble.props['data-visible']).toBe(false);
      expect(card.props['data-visible']).toBe(true);
      expect(card.props.style.top).toBe(12);
      bounds = { width: 1265, height: 600 };
      act(() => measure());
      expect(card.props['data-visible']).toBe(false);
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
    expect(disconnect).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('drags the panel freely, snaps horizontally at release height and collapses at that same height', () => {
    let bounds = { left: 100, top: 50, width: 1400, height: 800 };
    let measure!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { measure = callback; }
      observe() {}
      disconnect() {}
    });
    const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
    const layer = { getBoundingClientRect: () => bounds, contains: () => true,
      ownerDocument: { addEventListener: vi.fn(), removeEventListener: vi.fn() } };
    const cardElement = { getBoundingClientRect: () => ({ left: bounds.left + bounds.width - AGENT_DIRECTORY_WIDTH - 12, top: 62, width: AGENT_DIRECTORY_WIDTH, height: 352 }) };
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        renderer = TestRenderer.create(<AgentSessionPeek sessions={[]} total={0} activeSessionId={null}
          loading={false} onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()} />, {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer
            : element.type === 'aside' ? cardElement : capture,
        });
      });
      const card = renderer.root.findByType('aside');
      const head = renderer.root.findByProps({ className: 'peek-head' });
      const bubble = renderer.root.findAllByType('button').find(button => button.props['aria-haspopup'] === 'dialog')!;
      act(() => head.props.onPointerDown({ pointerId: 2, button: 0, isPrimary: true, clientX: 1200, clientY: 70,
        target: { closest: () => null }, currentTarget: capture, preventDefault: vi.fn() }));
      act(() => head.props.onPointerMove({ pointerId: 2, clientX: 850, clientY: 280 }));
      expect(card.props['data-dragging']).toBe(true);
      expect(card.props.style.top).toBe(222);
      expect(card.props.style['--agent-directory-drag-x']).toBe('-350px');
      expect(renderer.root.findByProps({ 'data-agent-session-directory': true }).props['data-compact']).toBe(false);

      act(() => head.props.onPointerUp({ pointerId: 2, currentTarget: capture }));
      expect(card.props['data-dragging']).toBe(false);
      expect(card.props['data-snapping']).toBe(true);
      expect(card.props.style.top).toBe(222);
      expect(card.props.style['--agent-directory-drag-x']).toBe('0px');

      bounds = { ...bounds, width: 900 };
      act(() => measure());
      expect(card.props['data-visible']).toBe(false);
      expect(card.props.hidden).toBeUndefined();
      expect(card.props.style.top).toBe(222);
      expect(bubble.props['data-visible']).toBe(true);
      expect(bubble.props.style.top).toBe(222);
      act(() => bubble.props.onClick());
      expect(card.props['data-visible']).toBe(true);
      expect(card.props.style.top).toBe(222);
      act(() => renderer.root.findByProps({ 'aria-label': '收起会话目录' }).props.onClick());
      expect(card.props['data-visible']).toBe(false);
      expect(bubble.props.style.top).toBe(222);
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });
});
