import TestRenderer, { act } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerStyleSheet } from 'styled-components';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/shared/agent/agent.types';
import AgentConversationIndex from './AgentConversationIndex';
import { useAgentIndexWave } from '../hooks/useAgentIndexWave';

vi.mock('@douyinfe/semi-icons', () => ({ IconBookmark: () => null }));
vi.mock('../hooks/useAgentIndexWave', () => ({ useAgentIndexWave: vi.fn(() => null) }));
afterEach(() => vi.unstubAllGlobals());

describe('Conversation index interactions', () => {
  it('selects the last question at the scroll boundary and keeps current green over milestones', () => {
    let update!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { update = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const messages: AgentMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `bottom-${i}`, sessionId: 'bottom', role: 'user', content: `Q${i}`, createdAt: '2026-09-09T00:00:00Z',
    }));
    const anchors = messages.map((message, i) => ({ dataset: { agentQuestion: message.id },
      getBoundingClientRect: () => ({ top: 140 + (i - 4) * 30 }) }));
    const scroll = { querySelectorAll: () => anchors, scrollTop: 399.5, scrollHeight: 1000, clientHeight: 600,
      getBoundingClientRect: () => ({ top: 100 }), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentConversationIndex messages={messages} runs={[]}
      scrollRef={{ current: scroll as unknown as HTMLDivElement }} storageKey="bottom" onNavigate={vi.fn()} />); });
    act(() => update(0));
    const ticks = () => renderer.root.findAllByProps({ className: 'dial-tick' });
    expect(ticks()[9].props['aria-current']).toBe('true');
    expect(ticks()[9].props.style['--tick-color']).toBe('var(--dial-green)');
    scroll.scrollTop = 200;
    const onScroll = scroll.addEventListener.mock.calls.find(call => call[0] === 'scroll')![1];
    act(() => { onScroll(); update(16); });
    expect(ticks()[4].props['aria-current']).toBe('true');
    expect(ticks()[4].props.style['--tick-color']).toBe('var(--dial-green)');
    expect(ticks()[9].props.style['--tick-color']).toBe('var(--dial-violet)');
    act(() => renderer.unmount());
  });
  it('resolves the clicked message against current DOM after same-ID transcript replacement', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const messages: AgentMessage[] = Array.from({ length: 5 }, (_, i) => ({
      id: `jump-${i}`, sessionId: 'jump', role: 'user', content: `Q${i}`, createdAt: '2026-09-09T00:00:00Z',
    }));
    let anchors = messages.map(message => ({ dataset: { agentQuestion: message.id }, getBoundingClientRect: () => ({ top: 500 }) }));
    const scroll = { querySelectorAll: () => anchors, scrollTop: 200, scrollTo: vi.fn(),
      getBoundingClientRect: () => ({ top: 100 }), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const onNavigate = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentConversationIndex messages={messages} runs={[]}
      scrollRef={{ current: scroll as unknown as HTMLDivElement }} storageKey="jump" onNavigate={onNavigate} />); });
    anchors = [...messages].reverse().map(message => ({ dataset: { agentQuestion: message.id }, getBoundingClientRect: () => ({ top: 900 }) }));
    act(() => renderer.root.findAllByProps({ className: 'dial-tick' })[4].props.onClick());
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 976, behavior: 'smooth' });
    act(() => renderer.unmount());
  });
  it('paints strokes from their own color token instead of reset-overridden currentColor', () => {
    const messages: AgentMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`, sessionId: 's1', role: 'user', content: `Question ${i}`, createdAt: '2026-09-09T00:00:00Z',
    }));
    const sheet = new ServerStyleSheet();
    try {
      renderToStaticMarkup(sheet.collectStyles(<AgentConversationIndex messages={messages} runs={[]}
        scrollRef={{ current: null }} storageKey="stroke-color" onNavigate={vi.fn()} />));
      const css = sheet.getStyleTags();
      expect(css).toMatch(/\.dial-stroke\{[^}]*background:var\(--tick-color,\s*var\(--app-text-muted\)\)/);
      expect(css).not.toMatch(/\.dial-stroke\{[^}]*background:currentColor/);
    } finally { sheet.seal(); }
  });
  it('colors one-based milestones at full opacity and enables running waves only from ten questions', () => {
    const messages: AgentMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`, runId: i === 0 ? 'r1' : undefined, sessionId: 's1', role: 'user', content: `Question ${i}`, createdAt: '2026-09-09T00:00:00Z',
    }));
    const run = { id: 'r1', sessionId: 's1', model: 'test', profileId: 'test', reasoningEffort: 'medium' as const,
      revision: 1, status: 'running' as const, userPrompt: 'test', createdAt: messages[0].createdAt, updatedAt: messages[0].createdAt };
    const props = { runs: [run], scrollRef: { current: null }, storageKey: 'milestones', onNavigate: vi.fn() };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentConversationIndex {...props} messages={messages.slice(0, 9)} />); });
    expect(useAgentIndexWave).toHaveBeenLastCalledWith(-1);
    act(() => renderer.update(<AgentConversationIndex {...props} messages={messages.slice(0, 10)} />));
    expect(useAgentIndexWave).toHaveBeenLastCalledWith(0);
    act(() => renderer.update(<AgentConversationIndex {...props} messages={messages} />));
    const ticks = renderer.root.findAllByProps({ className: 'dial-tick' });
    for (const ordinal of [5, 15]) expect(ticks[ordinal - 1].props.style['--tick-color']).toBe('var(--dial-rose-light)');
    for (const ordinal of [10, 20]) expect(ticks[ordinal - 1].props.style['--tick-color']).toBe('var(--dial-violet)');
    for (const ordinal of [5, 10, 15, 20]) expect(ticks[ordinal - 1].props.style['--tick-opacity']).toBe(1);
    act(() => renderer.update(<AgentConversationIndex {...props} runs={[]} messages={messages} />));
    expect(useAgentIndexWave).toHaveBeenLastCalledWith(-1);
    act(() => renderer.unmount());
  });
  it('caps visible height at 70 ticks while retaining later nodes, and isolates saved labels by scope', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const messages: AgentMessage[] = Array.from({ length: 85 }, (_, i) => ({
      id: `m${i}`, sessionId: 's1', role: 'user', content: `Question ${i}`, createdAt: '2026-09-09T00:00:00Z',
    }));
    const props = { messages, runs: [], scrollRef: { current: null }, storageKey: 'scope-a', onNavigate: vi.fn() };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentConversationIndex {...props} />); });
    expect(renderer.root.findAllByProps({ className: 'dial-tick' })).toHaveLength(85);
    expect(renderer.root.findByType('aside').props.style['--dial-height']).toBe('700px');
    expect(renderer.root.findAllByProps({ className: 'dial-tick' })[0].props.style['--tick-width']).toBe('6px');
    act(() => renderer.root.findAllByProps({ className: 'dial-tick' })[84].props.onFocus());
    act(() => renderer.root.findByProps({ 'aria-label': '标记此轮对话' }).props.onClick());
    expect(renderer.root.findAllByProps({ 'aria-label': '节点标签' })).toHaveLength(0);
    expect(JSON.parse(values.get('scope-a')!)).toEqual({ m84: '' });
    act(() => renderer.root.findByProps({ 'aria-label': '取消标记' }).props.onClick());
    expect(JSON.parse(values.get('scope-a')!)).toEqual({});
    act(() => renderer.root.findByProps({ 'aria-label': '标记此轮对话' }).props.onClick());
    act(() => renderer.unmount());
    act(() => { renderer = TestRenderer.create(<AgentConversationIndex {...props} storageKey="scope-b" />); });
    expect(renderer.root.findAllByProps({ className: 'dial-tick' })[84].props['data-marked']).toBe(false);
    act(() => renderer.unmount());
    act(() => { renderer = TestRenderer.create(<AgentConversationIndex {...props} />); });
    expect(renderer.root.findAllByProps({ className: 'dial-tick' })[84].props['data-marked']).toBe(true);
    act(() => renderer.unmount());
  });
  it('appears at the fifth question, stretches only on hover, and returns to short ticks', () => {
    const messages: AgentMessage[] = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`, sessionId: 's1', role: 'user', content: `Question ${i}`, createdAt: '2026-09-09T00:00:00Z',
    }));
    const props = { runs: [], scrollRef: { current: null }, storageKey: 'threshold', onNavigate: vi.fn() };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentConversationIndex {...props} messages={messages.slice(0, 4)} />); });
    expect(renderer.toJSON()).toBeNull();
    act(() => renderer.update(<AgentConversationIndex {...props} messages={messages} />));
    expect(renderer.root.findByType('aside').props.style['--dial-height']).toBe('50px');
    const ticks = () => renderer.root.findAllByProps({ className: 'dial-tick' });
    expect(ticks().map(tick => tick.props.style['--tick-width'])).toEqual(Array(5).fill('6px'));
    act(() => ticks()[2].props.onFocus());
    expect(ticks()[2].props.style['--tick-width']).toBe('20px');
    expect(renderer.root.findByType('aside').props.style['--preview-top']).toBe('1px');
    act(() => ticks()[4].props.onFocus());
    expect(renderer.root.findByType('aside').props.style['--preview-top']).toBe('21px');
    act(() => renderer.root.findByType('aside').props.onMouseLeave());
    expect(ticks().map(tick => tick.props.style['--tick-width'])).toEqual(Array(5).fill('6px'));
    act(() => renderer.unmount());
  });
});
