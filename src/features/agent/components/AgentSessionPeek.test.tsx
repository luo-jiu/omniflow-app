import { Profiler, type ComponentProps } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import AgentSessionPeek from './AgentSessionPeek';
import {
  AGENT_DIRECTORY_BREAKPOINT,
  AGENT_DIRECTORY_LEFT_MIN_WIDTH,
  AGENT_DIRECTORY_MAX_HEIGHT,
  AGENT_DIRECTORY_WIDTH,
} from '../agent-session-directory-layout';
import type { AgentSessionDirectorySummary } from '@/shared/agent/agent-session-management';
import type { AgentSessionSummary } from '@/shared/agent/agent.types';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';

const directoryCard = (renderer: TestRenderer.ReactTestRenderer, side: 'left' | 'right' = 'right') =>
  renderer.root.findAllByType('aside').find(card => card.props['data-side'] === side)!;

const expectCardVisible = (card: TestRenderer.ReactTestInstance, visible: boolean) => {
  expect(card.props['data-visible']).toBe(visible);
  expect(card.props['aria-hidden']).toBe(!visible);
  expect(card.props.inert).toBe(visible ? undefined : '');
};

function dockingView({ width = 1400, dockLeft = false, allowMoveLeft = true, pending = false, active = true } = {}) {
  let bounds = { left: 100, top: 50, width, height: 800 };
  let measure!: () => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { measure = callback; }
    observe() {}
    disconnect() {}
  });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const ownerWindow = {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
  };
  const ownerDocument = { activeElement: null as object | null, defaultView: ownerWindow,
    addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const layer = { getBoundingClientRect: () => bounds, contains: () => true, ownerDocument };
  const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const leftList = { scrollTop: 0 };
  const rightList = { scrollTop: 0 };
  const leftLabel = { focus: vi.fn(() => { ownerDocument.activeElement = leftLabel; }) };
  const rightLabel = { focus: vi.fn(() => { ownerDocument.activeElement = rightLabel; }) };
  const cardElement = (side: 'left' | 'right') => ({
    contains: (element: object) => element === (side === 'left' ? leftLabel : rightLabel),
    querySelector: (selector: string) => selector === '.peek-list' ? side === 'left' ? leftList : rightList
      : selector === '.peek-drag-label' ? side === 'left' ? leftLabel : rightLabel : null,
    getBoundingClientRect: () => ({ left: bounds.left + (side === 'left' ? 12 : bounds.width - AGENT_DIRECTORY_WIDTH - 12),
      top: bounds.top + 12, width: AGENT_DIRECTORY_WIDTH, height: side === 'left' ? bounds.height - 24 : AGENT_DIRECTORY_MAX_HEIGHT }),
  });
  const leftElement = cardElement('left');
  const rightElement = cardElement('right');
  const onMoveLeft = vi.fn();
  const onMoveRight = vi.fn();
  let props: ComponentProps<typeof AgentSessionPeek> = {
    sessions: [], total: 0, activeSessionId: null, loading: false,
    onOpen: vi.fn(), onManage: vi.fn(), onNew: vi.fn(), onMemories: vi.fn(),
    onMoveLeft: allowMoveLeft ? onMoveLeft : undefined, onMoveRight, dockLeft, layoutMotionPending: pending,
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  const render = () => <WorkspaceVisibilityContext.Provider value={active}><AgentSessionPeek {...props} /></WorkspaceVisibilityContext.Provider>;
  act(() => {
    renderer = TestRenderer.create(render(), {
      createNodeMock: element => element.props['data-agent-session-directory'] ? layer
        : element.type === 'aside' ? element.props['data-side'] === 'left' ? leftElement : rightElement : capture,
    });
  });
  const card = (side: 'left' | 'right') => directoryCard(renderer, side);
  const head = (side: 'left' | 'right') => card(side).findByProps({ className: 'peek-head' });
  const event = { pointerId: 7, currentTarget: capture };
  return {
    renderer, card, head, event, onMoveLeft, onMoveRight, ownerWindow, frames, leftList, rightList, leftLabel, rightLabel,
    update(patch: Partial<typeof props> & { active?: boolean }) {
      const { active: nextActive, ...nextProps } = patch;
      if (nextActive !== undefined) active = nextActive;
      props = { ...props, ...nextProps };
      act(() => renderer.update(render()));
    },
    resize(nextWidth: number) { bounds = { ...bounds, width: nextWidth }; act(() => measure()); },
    openRight() {
      const bubble = renderer.root.findAllByType('button').find(button => button.props['aria-haspopup'] === 'dialog')!;
      act(() => bubble.props.onClick());
    },
    focus(side: 'left' | 'right') { ownerDocument.activeElement = side === 'left' ? leftLabel : rightLabel; },
    startDrag(side: 'left' | 'right') {
      act(() => head(side).props.onPointerDown({ ...event, button: 0, isPrimary: true, clientX: 500, clientY: 80,
        target: { closest: () => null }, preventDefault: vi.fn() }));
    },
    drag(side: 'left' | 'right', dx: number, dy = 0) {
      act(() => head(side).props.onPointerMove({ pointerId: 7, clientX: 500 + dx, clientY: 80 + dy }));
    },
    finish(side: 'left' | 'right', through = 'onPointerUp') { act(() => head(side).props[through](event)); },
    flushTransfer() {
      const callbacks = [...frames.values()];
      frames.clear();
      act(() => callbacks.forEach(callback => callback(0)));
    },
    unmount() { act(() => renderer.unmount()); },
  };
}

describe('Agent session peek', () => {
  it('restores group expansion locally and keeps different repository keys isolated', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const group = { id: 'g', name: '文档组', sessionCount: 1 } as AgentSessionDirectorySummary['groups'][number];
    const props = {
      sessions: [] as AgentSessionSummary[], total: 1, activeSessionId: null, loading: false,
      onOpen: vi.fn(), onManage: vi.fn(), onNew: vi.fn(), onMemories: vi.fn(),
      directory: { groups: [group], total: 1, archivedCount: 0, ungroupedCount: 0 },
      pages: { g: { sessions: [], total: 1, loading: false } },
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => { renderer = TestRenderer.create(<AgentSessionPeek {...props} storageKey="repository-a" />); });
      const groupToggle = () => directoryCard(renderer).findAllByProps({ className: 'peek-group-toggle' })[1];
      expect(groupToggle().props['aria-expanded']).toBe(false);
      act(() => groupToggle().props.onClick());
      expect(groupToggle().props['aria-expanded']).toBe(true);
      act(() => renderer.unmount());

      act(() => { renderer = TestRenderer.create(<AgentSessionPeek {...props} storageKey="repository-a" />); });
      expect(groupToggle().props['aria-expanded']).toBe(true);
      act(() => renderer.unmount());

      act(() => { renderer = TestRenderer.create(<AgentSessionPeek {...props} storageKey="repository-b" />); });
      expect(groupToggle().props['aria-expanded']).toBe(false);
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('does not override a locally collapsed current group when the session changes', () => {
    const values = new Map<string, string>([['repository-a', JSON.stringify({ g: true })]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const group = { id: 'g', name: '文档组', sessionCount: 1 } as AgentSessionDirectorySummary['groups'][number];
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => { renderer = TestRenderer.create(<AgentSessionPeek sessions={[]} total={1} activeSessionId={null} loading={false}
        onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()} currentGroupId="g"
        directory={{ groups: [group], total: 1, archivedCount: 0, ungroupedCount: 0 }}
        pages={{ g: { sessions: [], total: 1, loading: false } }} storageKey="repository-a" />); });
      expect(directoryCard(renderer).findAllByProps({ className: 'peek-group-toggle' })[1].props['aria-expanded']).toBe(false);
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });

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
    const sections = directoryCard(renderer).findAllByProps({ className: 'peek-group' });
    const rows = (index: number) => sections[index].findAllByProps({ className: 'peek-row' });
    const more = () => sections[1].findByProps({ className: 'peek-more' });
    expect(rows(0)).toHaveLength(5);
    expect(rows(1)).toHaveLength(5);
    expect(more().props.children).toBe('展开更多');
    act(() => more().props.onClick());
    expect(rows(1)).toHaveLength(10);
    expect(rows(0)).toHaveLength(5);
    expect(directoryCard(renderer, 'left').findAllByProps({ className: 'peek-group' })[1]
      .findAllByProps({ className: 'peek-row' })).toHaveLength(10);
    act(() => more().props.onClick());
    expect(rows(1)).toHaveLength(12);
    expect(sections[1].findAllByProps({ className: 'peek-more' })).toHaveLength(0);
    expect(onLoadGroup).not.toHaveBeenCalled();
    const toggle = sections[1].findByProps({ className: 'peek-group-toggle' });
    act(() => toggle.props.onClick());
    act(() => toggle.props.onClick());
    expect(rows(1)).toHaveLength(5);
    expect(directoryCard(renderer, 'left').findAllByProps({ className: 'peek-group' })[1]
      .findAllByProps({ className: 'peek-row' })).toHaveLength(5);
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
    const toggle = directoryCard(renderer).findAllByProps({ className: 'peek-group-toggle' })[1];
    expect(toggle.props['aria-expanded']).toBe(false);
    act(() => toggle.props.onClick());
    expect(toggle.props['aria-expanded']).toBe(true);
    act(() => directoryCard(renderer).findByProps({ 'aria-label': '在文档组新建会话' }).props.onClick());
    expect(onNewInGroup).toHaveBeenCalledWith('g');
    act(() => directoryCard(renderer).findByProps({ 'aria-label': '文档组设置' }).props.onClick());
    expect(onEditGroup).toHaveBeenCalledWith(group);
    act(() => directoryCard(renderer).findByProps({ 'aria-label': '归档 组内任务' }).props.onClick());
    expect(onArchive).toHaveBeenCalledWith(item);
    act(() => directoryCard(renderer).findByProps({ className: 'peek-more' }).props.onClick());
    expect(onLoadGroup).toHaveBeenCalledWith('g', true);
    act(() => renderer.unmount());
  });

  it('keeps the session directory visible without a trigger and exposes manage/new actions', () => {
    const onOpen = vi.fn(); const onManage = vi.fn(); const onNew = vi.fn(); const onMemories = vi.fn();
    const sessions = [{ id: 's1', title: '当前聊天', messageCount: 4, updatedAt: '2026-09-11T00:00:00Z' }, { id: 's2', title: '另一个聊天', messageCount: 2, updatedAt: '2026-09-10T00:00:00Z' }] as never[];
    const renderer = TestRenderer.create(<AgentSessionPeek sessions={sessions} total={2} activeSessionId="s1" loading={false} onOpen={onOpen} onManage={onManage} onNew={onNew} onMemories={onMemories} />);
    const directory = directoryCard(renderer);
    expect(directory.props['aria-label']).toBe('会话目录');
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'toolbar-action-btn' })).toHaveLength(0);
    expect(directoryCard(renderer).findByProps({ 'aria-label': '最近会话' })).toBeTruthy();
    expect(directoryCard(renderer).findByProps({ 'aria-current': true })).toBeTruthy();
    const buttonWithText = (text: string) => directoryCard(renderer).findAllByType('button').find(button => button.findAllByType('span').some(span => String(span.props.children).includes(text)) || String(button.props.children).includes(text))!;
    act(() => buttonWithText('另一个聊天').props.onClick());
    expect(onOpen).toHaveBeenCalledWith(sessions[1]);
    act(() => buttonWithText('会话管理').props.onClick());
    act(() => buttonWithText('新建会话').props.onClick());
    act(() => directoryCard(renderer).findByProps({ 'aria-label': '长期记忆' }).props.onClick());
    expect(onMemories).toHaveBeenCalledOnce();
    expect(directoryCard(renderer).findAllByProps({ className: 'peek-meta' })).toHaveLength(0);
    expect(directoryCard(renderer).findByProps({ className: 'peek-foot' }).findAllByType('svg')).toHaveLength(3);
    expect(onManage).toHaveBeenCalledOnce(); expect(onNew).toHaveBeenCalledOnce();

    act(() => renderer.update(<AgentSessionPeek sessions={sessions} total={2} activeSessionId="s1" loading busy onOpen={onOpen} onManage={onManage} onNew={onNew} onMemories={onMemories} />));
    expect(directoryCard(renderer)).toBe(directory);
    expect(buttonWithText('另一个聊天').props.disabled).toBe(true);
    expect(buttonWithText('新建').props.disabled).toBe(true);
    expect(directoryCard(renderer).findAllByProps({ className: 'peek-row' })).toHaveLength(2);
    renderer.unmount();
  });

  it('keeps the left directory full height after collapsing the tree and restores it after a narrow workspace', () => {
    let bounds = { width: 1100, height: 800 };
    let measure!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { measure = callback; }
      observe() {}
      disconnect() {}
    });
    const layer = { getBoundingClientRect: () => bounds, contains: () => true,
      ownerDocument: { addEventListener: vi.fn(), removeEventListener: vi.fn() } };
    const onMoveRight = vi.fn();
    const props = {
      sessions: [{ id: 's1', title: '当前聊天' }] as AgentSessionSummary[], total: 1,
      activeSessionId: 's1', loading: false,
      onOpen: vi.fn(), onManage: vi.fn(), onNew: vi.fn(), onMemories: vi.fn(), onMoveRight,
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        renderer = TestRenderer.create(<AgentSessionPeek {...props} />, {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer : { querySelector: () => null },
        });
      });
      const directory = renderer.root.findByProps({ 'data-agent-session-directory': true });
      const card = directoryCard(renderer, 'left');
      const rightCard = directoryCard(renderer, 'right');
      const bubble = renderer.root.findAllByType('button').find(button => button.props['aria-haspopup'] === 'dialog')!;
      expect(renderer.root.findAllByType('aside')).toHaveLength(2);
      expectCardVisible(card, false);
      expectCardVisible(rightCard, false);

      act(() => renderer.update(<AgentSessionPeek {...props} dockLeft />));
      expect(directory.props['data-docked-left']).toBe(true);
      expect(directory.props['data-compact']).toBe(false);
      expect(bubble.props['data-visible']).toBe(false);
      expectCardVisible(card, true);
      expectCardVisible(rightCard, false);
      expect(card.props.style.top).toBe(12);
      expect(card.props.style['--agent-directory-height']).toBe('calc(100% - 24px)');
      expect(card.props.style['--agent-directory-available-height']).toBe('776px');
      expect(card.props.style['--agent-directory-drag-x']).toBe('0px');
      act(() => card.findByProps({ className: 'peek-open' }).props.onClick());
      expect(props.onOpen).toHaveBeenCalledWith(props.sessions[0]);
      expect(card.props['data-visible']).toBe(true);

      bounds = { width: AGENT_DIRECTORY_LEFT_MIN_WIDTH - 1, height: 500 };
      act(() => measure());
      expect(directory.props['data-docked-left']).toBe(false);
      expect(bubble.props['data-visible']).toBe(true);
      expectCardVisible(card, false);
      expectCardVisible(rightCard, false);
      expect(rightCard.props.style['--agent-directory-height']).toBe(`${AGENT_DIRECTORY_MAX_HEIGHT}px`);

      bounds = { width: AGENT_DIRECTORY_LEFT_MIN_WIDTH, height: 500 };
      act(() => measure());
      expect(directory.props['data-docked-left']).toBe(true);
      expect(bubble.props['data-visible']).toBe(false);
      expectCardVisible(card, true);
      expectCardVisible(rightCard, false);
      expect(card.props.style.top).toBe(12);
      expect(card.props.style['--agent-directory-height']).toBe('calc(100% - 24px)');
      expect(card.props.style['--agent-directory-available-height']).toBe('476px');
      expect(onMoveRight).not.toHaveBeenCalled();

      const preventDefault = vi.fn();
      act(() => card.findByProps({ 'aria-label': '移动会话目录' }).props.onKeyDown({ key: 'ArrowRight', preventDefault }));
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(onMoveRight).toHaveBeenCalledOnce();
      expect(directory.props['data-docked-left']).toBe(true);
      act(() => renderer.update(<AgentSessionPeek {...props} dockLeft={false} />));
      expect(directory.props['data-docked-left']).toBe(false);
      expect(directory.props['data-compact']).toBe(true);
      expectCardVisible(card, false);
      expectCardVisible(rightCard, true);
      expect(rightCard.props['data-snapping']).toBe(true);
      expect(rightCard.props.style['--agent-directory-height']).toBe(`${AGENT_DIRECTORY_MAX_HEIGHT}px`);
      expect(rightCard.props.style['--agent-directory-drag-x']).toBe('0px');
      act(() => directoryCard(renderer).findByProps({ 'aria-label': '收起会话目录' }).props.onClick());
      expectCardVisible(rightCard, false);
      expect(bubble.props['data-visible']).toBe(true);
      expect(onMoveRight).toHaveBeenCalledOnce();

      bounds = { width: 1400, height: 800 };
      act(() => measure());
      expectCardVisible(rightCard, true);
      expect(rightCard.props.style['--agent-directory-height']).toBe('480px');
      expect(directoryCard(renderer, 'left')).toBe(card);
      expect(directoryCard(renderer, 'right')).toBe(rightCard);
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { direction: 'growing', initialWidth: 900, widths: [1000, 1100, 1250, 1400], initialDockLeft: false },
    { direction: 'shrinking', initialWidth: 1400, widths: [1300, 1100, 1047, 1000], initialDockLeft: true },
  ])('freezes the directory mode while layout is pending and the workspace is $direction', ({ initialWidth, widths, initialDockLeft }) => {
    let bounds = { width: initialWidth, height: 800 };
    let measure!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { measure = callback; }
      observe() {}
      disconnect() {}
    });
    const measureLayer = vi.fn(() => bounds);
    const layer = { getBoundingClientRect: measureLayer, contains: () => true,
      ownerDocument: { addEventListener: vi.fn(), removeEventListener: vi.fn() } };
    const props = { sessions: [] as AgentSessionSummary[], total: 0, activeSessionId: null, loading: false,
      onOpen: vi.fn(), onManage: vi.fn(), onNew: vi.fn(), onMemories: vi.fn() };
    const committedModes: { compact: boolean; dockedLeft: boolean }[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    const onRender = () => {
      if (!renderer) return;
      const directory = renderer.root.findByProps({ 'data-agent-session-directory': true });
      committedModes.push({ compact: directory.props['data-compact'], dockedLeft: directory.props['data-docked-left'] });
    };
    const render = (dockLeft: boolean, pending = false) => <Profiler id="settling-directory" onRender={onRender}>
      <AgentSessionPeek {...props} dockLeft={dockLeft} layoutMotionPending={pending} />
    </Profiler>;
    try {
      act(() => {
        renderer = TestRenderer.create(render(initialDockLeft), {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer : { querySelector: () => null },
        });
      });
      const directory = renderer.root.findByProps({ 'data-agent-session-directory': true });
      const bubble = renderer.root.findAllByType('button').find(button => button.props['aria-haspopup'] === 'dialog')!;
      act(() => renderer.update(render(initialDockLeft, true)));
      for (const width of widths) {
        bounds = { ...bounds, width };
        act(() => measure());
        expect(directory.props['data-compact']).toBe(!initialDockLeft);
        expect(directory.props['data-docked-left']).toBe(initialDockLeft);
        expect(bubble.props['data-visible']).toBe(!initialDockLeft);
        expectCardVisible(directoryCard(renderer, 'left'), initialDockLeft);
        expectCardVisible(directoryCard(renderer, 'right'), false);
      }

      const measurementsBeforeCompletion = measureLayer.mock.calls.length;
      committedModes.length = 0;
      act(() => renderer.update(render(!initialDockLeft)));
      expect(measureLayer).toHaveBeenCalledTimes(measurementsBeforeCompletion + 1);
      expect(committedModes.length).toBeGreaterThan(0);
      expect(committedModes.every(mode => mode.compact === initialDockLeft && mode.dockedLeft === !initialDockLeft)).toBe(true);
      expect(directory.props['data-compact']).toBe(initialDockLeft);
      expect(directory.props['data-docked-left']).toBe(!initialDockLeft);
      expect(bubble.props['data-visible']).toBe(initialDockLeft);
      expectCardVisible(directoryCard(renderer, 'left'), !initialDockLeft);
      expectCardVisible(directoryCard(renderer, 'right'), false);
      if (initialDockLeft) {
        act(() => bubble.props.onClick());
        expectCardVisible(directoryCard(renderer, 'right'), true);
        expectCardVisible(directoryCard(renderer, 'left'), false);
      }
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('prepares the final compact shape before the tree expands and keeps it when the target width is released', () => {
    let bounds = { width: 1400, height: 800 };
    let measure!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { measure = callback; }
      observe() {}
      disconnect() {}
    });
    const layer = { getBoundingClientRect: () => bounds, contains: () => true,
      ownerDocument: { addEventListener: vi.fn(), removeEventListener: vi.fn() } };
    const props = { sessions: [] as AgentSessionSummary[], total: 0, activeSessionId: null, loading: false,
      onOpen: vi.fn(), onManage: vi.fn(), onNew: vi.fn(), onMemories: vi.fn() };
    const committedModes: boolean[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    const onRender = () => {
      if (renderer) committedModes.push(renderer.root.findByProps({ 'data-agent-session-directory': true }).props['data-compact']);
    };
    const render = (dockLeft: boolean, pending: boolean, targetWidth?: number) => <Profiler id="prepared-directory" onRender={onRender}>
      <AgentSessionPeek {...props} dockLeft={dockLeft} layoutMotionPending={pending} layoutTargetWidth={targetWidth} />
    </Profiler>;
    try {
      act(() => {
        renderer = TestRenderer.create(render(true, false, 1100), {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer : { querySelector: () => null },
        });
      });
      const directory = renderer.root.findByProps({ 'data-agent-session-directory': true });
      const leftCard = directoryCard(renderer, 'left');
      const rightCard = directoryCard(renderer, 'right');
      const bubble = renderer.root.findAllByType('button').find(button => button.props['aria-haspopup'] === 'dialog')!;
      expect(directory.props['data-compact']).toBe(false);
      expectCardVisible(leftCard, true);
      committedModes.length = 0;

      act(() => renderer.update(render(false, false, 1100)));
      expect(directory.props['data-compact']).toBe(true);
      expectCardVisible(leftCard, false);
      expectCardVisible(rightCard, false);
      expect(bubble.props['data-visible']).toBe(true);

      act(() => renderer.update(render(false, true, 1100)));
      for (const width of [1300, 1200, 1100]) {
        bounds = { ...bounds, width };
        act(() => measure());
        expect(directory.props['data-compact']).toBe(true);
      }
      act(() => renderer.update(render(false, false)));
      expect(directory.props['data-compact']).toBe(true);
      expectCardVisible(rightCard, false);
      expect(bubble.props['data-visible']).toBe(true);
      expect(committedModes.length).toBeGreaterThan(0);
      expect(committedModes.every(Boolean)).toBe(true);
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('keeps same-mode resizes out of React commits and uses the latest width when dragging', () => {
    let bounds = { left: 100, top: 50, width: 1400, height: 800 };
    let measure!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { measure = callback; }
      observe() {}
      disconnect() {}
    });
    const layer = { getBoundingClientRect: () => bounds, contains: () => true,
      ownerDocument: { addEventListener: vi.fn(), removeEventListener: vi.fn() } };
    const cardElement = { querySelector: () => null, getBoundingClientRect: () => ({
      left: bounds.left + bounds.width - AGENT_DIRECTORY_WIDTH - 12, top: 62, width: AGENT_DIRECTORY_WIDTH, height: 352,
    }) };
    const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
    const sessions = Array.from({ length: 3 }, (_, index) => ({ id: `s${index}`, title: `会话 ${index}` } as AgentSessionSummary));
    const group = { id: 'g', name: '文档组', sessionCount: 9 } as AgentSessionDirectorySummary['groups'][number];
    const onLoadGroup = vi.fn();
    const onRender = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        renderer = TestRenderer.create(<Profiler id="session-directory" onRender={onRender}>
          <AgentSessionPeek sessions={[]} total={12} activeSessionId={null} loading={false}
            onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()} currentGroupId="g"
            directory={{ groups: [group], total: 12, archivedCount: 0, ungroupedCount: 3 }}
            pages={{ __ungrouped: { sessions, total: 3, loading: false } }} onLoadGroup={onLoadGroup} />
        </Profiler>, {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer
            : element.type === 'aside' ? cardElement : capture,
        });
      });
      const card = directoryCard(renderer);
      const list = card.findByProps({ className: 'peek-list' });
      const children = list.props.children;
      expect(card.findAllByProps({ className: 'peek-row' })).toHaveLength(3);
      expect(onLoadGroup).toHaveBeenCalledWith('g');
      onLoadGroup.mockClear();
      onRender.mockClear();

      for (const width of [1380, 1350, 1320]) {
        bounds = { ...bounds, width };
        act(() => measure());
      }
      expect(onRender).not.toHaveBeenCalled();
      expect(onLoadGroup).not.toHaveBeenCalled();
      expect(card.findByProps({ className: 'peek-list' }).props.children).toBe(children);

      const head = card.findByProps({ className: 'peek-head' });
      act(() => head.props.onPointerDown({ pointerId: 1, button: 0, isPrimary: true, clientX: 1200, clientY: 70,
        target: { closest: () => null }, currentTarget: capture, preventDefault: vi.fn() }));
      act(() => head.props.onPointerMove({ pointerId: 1, clientX: 1000, clientY: 70 }));
      expect(card.props.style['--agent-directory-drag-x']).toBe('-200px');
      expect(card.findByProps({ className: 'peek-list' }).props.children).toBe(children);
      expect(onLoadGroup).not.toHaveBeenCalled();
      act(() => head.props.onPointerUp({ pointerId: 1, currentTarget: capture }));
      expect(card.props.style['--agent-directory-drag-x']).toBe('0px');
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });

  it.each(['onPointerUp', 'onPointerCancel', 'onLostPointerCapture'] as const)(
    'only requests moving the left directory right once when a drag settles through %s', finish => {
      const bounds = { left: 100, top: 50, width: 1100, height: 800 };
      vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
      const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
      let renderer!: TestRenderer.ReactTestRenderer;
      let transferFrame!: FrameRequestCallback;
      const ownerWindow = {
        requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
          expectCardVisible(directoryCard(renderer), true);
          transferFrame = callback;
          return 42;
        }),
        cancelAnimationFrame: vi.fn(),
      };
      const layer = { getBoundingClientRect: () => bounds, contains: () => true,
        ownerDocument: { defaultView: ownerWindow, addEventListener: vi.fn(), removeEventListener: vi.fn() } };
      const cardElement = { querySelector: () => null, getBoundingClientRect: () => ({ left: 112, top: 62, width: AGENT_DIRECTORY_WIDTH, height: 776 }) };
      const rightElement = { querySelector: () => null, getBoundingClientRect: vi.fn(() => {
        expectCardVisible(directoryCard(renderer), true);
        return { left: 362, top: 62, width: AGENT_DIRECTORY_WIDTH, height: 776 };
      }) };
      const onMoveRight = vi.fn();
      const props = { sessions: [] as AgentSessionSummary[], total: 0, activeSessionId: null, loading: false,
        onOpen: vi.fn(), onManage: vi.fn(), onNew: vi.fn(), onMemories: vi.fn(), onMoveRight };
      try {
        act(() => {
          renderer = TestRenderer.create(<AgentSessionPeek {...props} dockLeft />, {
            createNodeMock: element => element.props['data-agent-session-directory'] ? layer
              : element.type === 'aside' ? element.props['data-side'] === 'left' ? cardElement : rightElement : capture,
          });
        });
        const card = directoryCard(renderer, 'left');
        const rightCard = directoryCard(renderer, 'right');
        const head = card.findByProps({ className: 'peek-head' });
        const event = { pointerId: 2, currentTarget: capture };
        const startDrag = () => head.props.onPointerDown({ ...event, button: 0, isPrimary: true,
          clientX: 150, clientY: 75, target: { closest: () => null }, preventDefault: vi.fn() });
        act(startDrag);
        act(() => head.props.onPointerMove({ pointerId: 2, clientX: 250, clientY: 75 }));
        act(() => head.props.onPointerUp(event));
        expect(onMoveRight).not.toHaveBeenCalled();

        act(startDrag);
        act(() => head.props.onPointerMove({ pointerId: 2, clientX: 400, clientY: 300 }));
        expect(card.props['data-dragging']).toBe(true);
        expect(card.props.style.top).toBe(12);
        expect(onMoveRight).not.toHaveBeenCalled();
        expect(renderer.root.findByProps({ 'data-agent-session-directory': true }).props['data-docked-left']).toBe(true);

        act(() => head.props[finish](event));
        act(() => head.props.onLostPointerCapture(event));
        act(() => head.props.onPointerUp(event));
        expect(onMoveRight).toHaveBeenCalledOnce();
        expect(card.props['data-dragging']).toBe(false);
        expect(card.props.style['--agent-directory-height']).toBe('calc(100% - 24px)');
        expect(rightElement.getBoundingClientRect).not.toHaveBeenCalled();
        expect(ownerWindow.requestAnimationFrame).not.toHaveBeenCalled();

        act(() => renderer.update(<AgentSessionPeek {...props} dockLeft={false} />));
        expect(renderer.root.findByProps({ 'data-agent-session-directory': true }).props['data-compact']).toBe(true);
        expectCardVisible(card, false);
        expectCardVisible(rightCard, true);
        expect(rightElement.getBoundingClientRect).toHaveBeenCalledOnce();
        expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledOnce();
        expect(rightCard.props['data-dragging']).toBe(true);
        expect(rightCard.props.style).toMatchObject({
          top: 12, '--agent-directory-height': '776px', '--agent-directory-drag-x': '-526px',
        });

        act(() => transferFrame(0));
        expect(rightCard.props['data-dragging']).toBe(false);
        expect(rightCard.props['data-snapping']).toBe(true);
        expect(rightCard.props.style['--agent-directory-height']).toBe('480px');
        expect(rightCard.props.style['--agent-directory-drag-x']).toBe('0px');
        expect(ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(42);
        expect(onMoveRight).toHaveBeenCalledOnce();
      } finally {
        if (renderer) act(() => renderer.unmount());
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(['dock-left', 'close', 'unmount'] as const)('cancels a pending right transfer frame on %s', end => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const ownerWindow = { requestAnimationFrame: vi.fn(() => 37), cancelAnimationFrame: vi.fn() };
    const layer = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1100, height: 800 }),
      ownerDocument: { defaultView: ownerWindow, addEventListener: vi.fn(), removeEventListener: vi.fn() } };
    const cardElement = { querySelector: () => null,
      getBoundingClientRect: () => ({ left: 112, top: 62, width: AGENT_DIRECTORY_WIDTH, height: 776 }) };
    const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
    const props = { sessions: [] as AgentSessionSummary[], total: 0, activeSessionId: null, loading: false,
      onOpen: vi.fn(), onManage: vi.fn(), onNew: vi.fn(), onMemories: vi.fn(), onMoveRight: vi.fn() };
    let renderer!: TestRenderer.ReactTestRenderer;
    let unmounted = false;
    try {
      act(() => {
        renderer = TestRenderer.create(<AgentSessionPeek {...props} dockLeft />, {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer
            : element.type === 'aside' ? cardElement : capture,
        });
      });
      const head = directoryCard(renderer, 'left').findByProps({ className: 'peek-head' });
      act(() => head.props.onPointerDown({ pointerId: 1, button: 0, isPrimary: true, clientX: 150, clientY: 75,
        target: { closest: () => null }, currentTarget: capture, preventDefault: vi.fn() }));
      act(() => head.props.onPointerMove({ pointerId: 1, clientX: 400, clientY: 75 }));
      act(() => head.props.onPointerUp({ pointerId: 1, currentTarget: capture }));
      act(() => renderer.update(<AgentSessionPeek {...props} dockLeft={false} />));
      expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledOnce();
      expect(ownerWindow.cancelAnimationFrame).not.toHaveBeenCalled();

      if (end === 'dock-left') {
        act(() => renderer.update(<AgentSessionPeek {...props} dockLeft />));
        expectCardVisible(directoryCard(renderer, 'left'), true);
        expectCardVisible(directoryCard(renderer, 'right'), false);
      } else if (end === 'close') {
        const rightCard = directoryCard(renderer);
        act(() => rightCard.findByProps({ 'aria-label': '收起会话目录' }).props.onClick());
        expectCardVisible(rightCard, false);
        expect(rightCard.props['data-dragging']).toBe(false);
        expect(rightCard.props.style['--agent-directory-height']).toBe('480px');
        expect(rightCard.props.style['--agent-directory-drag-x']).toBe('0px');
        const bubble = renderer.root.findAllByType('button').find(button => button.props['aria-haspopup'] === 'dialog')!;
        act(() => bubble.props.onClick());
        expectCardVisible(rightCard, true);
        expect(rightCard.props['data-dragging']).toBe(false);
        expect(rightCard.props.style['--agent-directory-height']).toBe('480px');
        expect(rightCard.props.style['--agent-directory-drag-x']).toBe('0px');
        expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledOnce();
      } else {
        act(() => renderer.unmount());
        unmounted = true;
      }
      expect(ownerWindow.cancelAnimationFrame).toHaveBeenCalledOnce();
      expect(ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(37);
    } finally {
      if (renderer && !unmounted) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });

  it.each(['onPointerUp', 'onPointerCancel', 'onLostPointerCapture'] as const)(
    'returns an opened compact directory left once through %s and starts from its release geometry', finish => {
      const view = dockingView({ width: 1100 });
      try {
        view.openRight();
        expectCardVisible(view.card('right'), true);
        expect(view.renderer.root.findByProps({ 'data-agent-session-directory': true }).props['data-compact']).toBe(true);
        view.startDrag('right');
        view.drag('right', -149);
        view.finish('right');
        expect(view.onMoveLeft).not.toHaveBeenCalled();
        expect(view.card('right').props['data-snapping']).toBe(true);
        expect(view.card('right').props.style['--agent-directory-drag-x']).toBe('0px');

        view.rightList.scrollTop = 93;
        view.startDrag('right');
        view.drag('right', -150, 100);
        expect(view.card('right').props.style).toMatchObject({ top: 112, '--agent-directory-drag-x': '-150px' });
        expect(view.onMoveLeft).not.toHaveBeenCalled();
        view.finish('right', finish);
        view.finish('right', 'onLostPointerCapture');
        view.finish('right', 'onPointerCancel');
        view.finish('right', 'onPointerUp');
        expect(view.onMoveLeft).toHaveBeenCalledOnce();
        expect(view.ownerWindow.requestAnimationFrame).not.toHaveBeenCalled();

        view.update({ dockLeft: true });
        expectCardVisible(view.card('right'), false);
        expectCardVisible(view.card('left'), true);
        expect(view.card('right').props['data-snapping']).toBe(true);
        expect(view.leftList.scrollTop).toBe(93);
        expect(view.card('left').props['data-dragging']).toBe(true);
        expect(view.card('left').props.style).toMatchObject({ top: 112,
          '--agent-directory-height': '480px', '--agent-directory-drag-x': '626px' });
        expect(view.ownerWindow.requestAnimationFrame).toHaveBeenCalledOnce();

        view.flushTransfer();
        expect(view.card('left').props['data-dragging']).toBe(false);
        expect(view.card('left').props['data-snapping']).toBe(true);
        expect(view.card('left').props.style).toMatchObject({ top: 12,
          '--agent-directory-height': 'calc(100% - 24px)', '--agent-directory-drag-x': '0px' });
        expect(view.leftList.scrollTop).toBe(93);
        expect(view.onMoveLeft).toHaveBeenCalledOnce();
      } finally {
        view.unmount();
        vi.unstubAllGlobals();
      }
    },
  );

  it.each([
    { reason: 'below the 1048px left docking minimum', width: AGENT_DIRECTORY_LEFT_MIN_WIDTH - 1, open: true },
    { reason: 'the tree has not been collapsed', width: 1400, allowMoveLeft: false },
    { reason: 'a tree layout transition is pending', width: 1400, pending: true },
    { reason: 'the Agent workspace is inactive', width: 1400, active: false },
    { reason: 'the right directory is hidden behind its bubble', width: 1100 },
  ])('keeps the right directory on its side when $reason', ({ open, ...options }) => {
    const view = dockingView(options);
    try {
      if (open) view.openRight();
      const preventDefault = vi.fn();
      act(() => view.card('right').findByProps({ 'aria-label': '移动会话目录' }).props.onKeyDown({ key: 'ArrowLeft', preventDefault }));
      view.startDrag('right');
      view.drag('right', -300);
      view.finish('right');
      expect(view.onMoveLeft).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
      expectCardVisible(view.card('left'), false);
      expect(view.ownerWindow.requestAnimationFrame).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it.each([AGENT_DIRECTORY_LEFT_MIN_WIDTH, AGENT_DIRECTORY_BREAKPOINT])(
    'supports ArrowLeft at compact width %i and transfers focus and scroll position both ways', width => {
      const view = dockingView({ width });
      try {
        view.openRight();
        view.rightList.scrollTop = 75;
        view.focus('right');
        const preventLeft = vi.fn();
        act(() => view.card('right').findByProps({ 'aria-label': '移动会话目录' }).props.onKeyDown({ key: 'ArrowLeft', preventDefault: preventLeft }));
        expect(preventLeft).toHaveBeenCalledOnce();
        expect(view.onMoveLeft).toHaveBeenCalledOnce();
        view.update({ dockLeft: true });
        expectCardVisible(view.card('left'), true);
        expectCardVisible(view.card('right'), false);
        expect(view.leftLabel.focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(view.leftList.scrollTop).toBe(75);

        view.leftList.scrollTop = 125;
        const preventRight = vi.fn();
        act(() => view.card('left').findByProps({ 'aria-label': '移动会话目录' }).props.onKeyDown({ key: 'ArrowRight', preventDefault: preventRight }));
        expect(preventRight).toHaveBeenCalledOnce();
        expect(view.onMoveRight).toHaveBeenCalledOnce();
        view.update({ dockLeft: false });
        expectCardVisible(view.card('right'), true);
        expectCardVisible(view.card('left'), false);
        expect(view.rightLabel.focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(view.rightList.scrollTop).toBe(125);
      } finally {
        view.unmount();
        vi.unstubAllGlobals();
      }
    },
  );

  it('uses the current measured width when deciding whether a visible right directory can return left', () => {
    const view = dockingView({ width: 1400 });
    try {
      view.resize(AGENT_DIRECTORY_LEFT_MIN_WIDTH - 1);
      view.openRight();
      view.startDrag('right');
      view.drag('right', -200);
      view.finish('right');
      expect(view.onMoveLeft).not.toHaveBeenCalled();

      view.resize(AGENT_DIRECTORY_LEFT_MIN_WIDTH);
      view.startDrag('right');
      view.drag('right', -200);
      view.finish('right');
      expect(view.onMoveLeft).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the live right anchor when the workspace resizes after the final pointer move', () => {
    const view = dockingView();
    try {
      view.startDrag('right');
      view.drag('right', -200);
      expect(view.card('right').props.style['--agent-directory-drag-x']).toBe('-200px');
      view.resize(1500);
      view.finish('right');
      expect(view.onMoveLeft).toHaveBeenCalledOnce();
      view.update({ dockLeft: true });
      expect(view.card('left').props.style['--agent-directory-drag-x']).toBe('976px');
      expect(view.card('left').props.style['--agent-directory-height']).toBe('480px');
      view.flushTransfer();
      expect(view.card('left').props.style['--agent-directory-drag-x']).toBe('0px');
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it.each(['pending', 'inactive'] as const)('cancels an unfinished right drag when the workspace becomes %s', end => {
    const view = dockingView();
    try {
      view.startDrag('right');
      view.drag('right', -200);
      expect(view.card('right').props['data-dragging']).toBe(true);
      view.update(end === 'pending' ? { layoutMotionPending: true } : { active: false });
      expect(view.card('right').props['data-dragging']).toBe(false);
      view.finish('right');
      view.finish('right', 'onLostPointerCapture');
      expect(view.onMoveLeft).not.toHaveBeenCalled();
      expect(view.frames.size).toBe(0);

      view.update({ layoutMotionPending: false, active: true });
      view.startDrag('right');
      view.drag('right', -200);
      view.finish('right');
      expect(view.onMoveLeft).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('discards a pending drag transfer when keyboard docking reverses twice before its first frame', () => {
    const view = dockingView();
    try {
      view.startDrag('right');
      view.drag('right', -200, 100);
      view.finish('right');
      view.update({ dockLeft: true });
      expect(view.card('left').props['data-dragging']).toBe(true);
      expect(view.card('left').props.style['--agent-directory-height']).toBe('480px');
      const frameId = [...view.frames.keys()][0];

      act(() => view.card('left').findByProps({ 'aria-label': '移动会话目录' }).props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }));
      expect(view.ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(frameId);
      expect(view.frames.size).toBe(0);
      view.update({ dockLeft: false });
      expectCardVisible(view.card('right'), true);
      expect(view.card('right').props['data-dragging']).toBe(false);

      act(() => view.card('right').findByProps({ 'aria-label': '移动会话目录' }).props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() }));
      view.update({ dockLeft: true });
      expectCardVisible(view.card('left'), true);
      expect(view.card('left').props['data-dragging']).toBe(false);
      expect(view.card('left').props.style).toMatchObject({ top: 12,
        '--agent-directory-height': 'calc(100% - 24px)', '--agent-directory-drag-x': '0px' });
      expect(view.ownerWindow.requestAnimationFrame).toHaveBeenCalledOnce();
      expect(view.onMoveLeft).toHaveBeenCalledTimes(2);
      expect(view.onMoveRight).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it.each(['reverse', 'pending', 'inactive', 'unmount'] as const)('cancels a pending left transfer frame on %s', end => {
    const view = dockingView();
    let unmounted = false;
    try {
      view.startDrag('right');
      view.drag('right', -200, 100);
      view.finish('right');
      expect(view.onMoveLeft).toHaveBeenCalledOnce();
      view.update({ dockLeft: true });
      expect(view.frames.size).toBe(1);
      const frameId = [...view.frames.keys()][0];
      expect(view.card('left').props['data-dragging']).toBe(true);

      if (end === 'reverse') {
        view.update({ dockLeft: false });
        expectCardVisible(view.card('left'), false);
        expectCardVisible(view.card('right'), true);
        expect(view.card('right').props['data-dragging']).toBe(false);
        expect(view.card('right').props.style['--agent-directory-height']).toBe('480px');
      } else if (end === 'unmount') {
        view.unmount();
        unmounted = true;
      } else {
        view.update(end === 'pending' ? { layoutMotionPending: true } : { active: false });
        expect(view.card('left').props['data-dragging']).toBe(false);
        expect(view.card('left').props.style['--agent-directory-height']).toBe('calc(100% - 24px)');
      }
      expect(view.ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(frameId);
      expect(view.frames.size).toBe(0);
    } finally {
      if (!unmounted) view.unmount();
      vi.unstubAllGlobals();
    }
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
    const target = { querySelector: () => null, setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(), focus: vi.fn() };
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        renderer = TestRenderer.create(<AgentSessionPeek sessions={[]} total={0} activeSessionId={null}
          loading={false} onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()} />, {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer : target,
        });
      });
      const bubble = renderer.root.findAllByType('button').find(button => button.props['aria-haspopup'] === 'dialog')!;
      const card = directoryCard(renderer);
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
      expect(card.props['data-visible']).toBe(true);
      bounds = { width: AGENT_DIRECTORY_BREAKPOINT, height: 600 };
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
    const cardElement = { querySelector: () => null, getBoundingClientRect: () => ({ left: bounds.left + bounds.width - AGENT_DIRECTORY_WIDTH - 12, top: 62, width: AGENT_DIRECTORY_WIDTH, height: 352 }) };
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        renderer = TestRenderer.create(<AgentSessionPeek sessions={[]} total={0} activeSessionId={null}
          loading={false} onOpen={vi.fn()} onManage={vi.fn()} onNew={vi.fn()} onMemories={vi.fn()} />, {
          createNodeMock: element => element.props['data-agent-session-directory'] ? layer
            : element.type === 'aside' ? cardElement : capture,
        });
      });
      const card = directoryCard(renderer);
      const head = directoryCard(renderer).findByProps({ className: 'peek-head' });
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
      act(() => directoryCard(renderer).findByProps({ 'aria-label': '收起会话目录' }).props.onClick());
      expect(card.props['data-visible']).toBe(false);
      expect(bubble.props.style.top).toBe(222);
    } finally {
      if (renderer) act(() => renderer.unmount());
      vi.unstubAllGlobals();
    }
  });
});
