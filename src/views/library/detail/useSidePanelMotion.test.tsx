import { Profiler, type RefObject } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidePanelMotion } from './useSidePanelMotion';

function transition(target: object, overrides: Record<string, unknown> = {}) {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const finished = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  const animation = { transitionProperty: 'width', effect: { target },
    playState: 'running', pending: false, finished, ...overrides };
  return {
    animation: animation as unknown as Animation,
    resolve() { animation.playState = 'finished'; animation.pending = false; resolve(); },
    reject(error: Error) { animation.playState = 'idle'; animation.pending = false; reject(error); },
  };
}

function MotionProbe({ wrapperRef, collapsed, signal }: {
  wrapperRef: RefObject<HTMLDivElement>; collapsed: boolean; signal: number;
}) {
  const motion = useSidePanelMotion(wrapperRef, collapsed, signal);
  return <output data-collapsed={motion.collapsed} data-pending={motion.pending} />;
}

const mounted: TestRenderer.ReactTestRenderer[] = [];
function mountProbe(wrapper: object | null, initialCollapsed = false) {
  const wrapperRef = { current: wrapper as HTMLDivElement | null };
  const onRender = vi.fn();
  const render = (collapsed: boolean, signal = 0) => <Profiler id="side-panel-motion" onRender={onRender}>
    <MotionProbe wrapperRef={wrapperRef} collapsed={collapsed} signal={signal} />
  </Profiler>;
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(render(initialCollapsed)); });
  mounted.push(renderer);
  return {
    update(collapsed: boolean, signal = 0) { act(() => renderer.update(render(collapsed, signal))); },
    state() {
      const props = renderer.root.findByType('output').props;
      return { collapsed: props['data-collapsed'], pending: props['data-pending'] };
    },
    commits() { return onRender.mock.calls.length; },
    unmount() { act(() => renderer.unmount()); },
  };
}

afterEach(() => {
  act(() => { for (const renderer of mounted.splice(0)) renderer.unmount(); });
});

describe('side panel motion completion', () => {
  it.each([false, true])('waits for the side panel width transitions when changing collapsed from %s', async initialCollapsed => {
    let animations: Animation[] = [];
    const wrapper = { getAnimations: vi.fn(() => animations) };
    const view = mountProbe(wrapper, initialCollapsed);
    const running = transition(wrapper);
    const pending = transition(wrapper, { playState: 'idle', pending: true });
    animations = [running.animation, pending.animation,
      transition({}, { playState: 'running' }).animation,
      transition(wrapper, { transitionProperty: '--side-panel-visual-width' }).animation,
      transition(wrapper, { transitionProperty: 'opacity' }).animation,
      transition(wrapper, { playState: 'paused' }).animation,
      transition(wrapper, { playState: 'finished', pending: true }).animation];
    view.update(!initialCollapsed);
    expect(view.state()).toEqual({ collapsed: initialCollapsed, pending: true });
    await act(async () => { running.resolve(); });
    expect(view.state()).toEqual({ collapsed: initialCollapsed, pending: true });
    await act(async () => { pending.resolve(); });
    expect(view.state()).toEqual({ collapsed: !initialCollapsed, pending: false });
  });

  it.each([null, {}, { getAnimations: () => [] }])('settles immediately without an active transition: %j', wrapper => {
    const view = mountProbe(wrapper);
    view.update(true);
    expect(view.state()).toEqual({ collapsed: true, pending: false });
    view.update(false);
    expect(view.state()).toEqual({ collapsed: false, pending: false });
  });

  it.each([false, true])('keeps the last settled collapsed=%s when the motion reverses', async initialCollapsed => {
    let animations: Animation[] = [];
    const wrapper = { getAnimations: () => animations };
    const view = mountProbe(wrapper, initialCollapsed);
    const outgoing = transition(wrapper);
    animations = [outgoing.animation];
    view.update(!initialCollapsed);
    expect(view.state()).toEqual({ collapsed: initialCollapsed, pending: true });
    const returning = transition(wrapper);
    animations = [returning.animation];
    view.update(initialCollapsed, 1);
    await act(async () => { outgoing.resolve(); });
    expect(view.state()).toEqual({ collapsed: initialCollapsed, pending: true });
    await act(async () => { returning.resolve(); });
    expect(view.state()).toEqual({ collapsed: initialCollapsed, pending: false });
  });

  it('rechecks a new motion signal and does not publish the previous transition', async () => {
    let animations: Animation[] = [];
    const wrapper = { getAnimations: () => animations };
    const view = mountProbe(wrapper);
    const previous = transition(wrapper);
    animations = [previous.animation];
    view.update(true, 1);
    const replacement = transition(wrapper);
    animations = [replacement.animation];
    view.update(true, 2);
    await act(async () => { previous.resolve(); });
    expect(view.state()).toEqual({ collapsed: false, pending: true });
    await act(async () => { replacement.resolve(); });
    expect(view.state()).toEqual({ collapsed: true, pending: false });
  });

  it.each([false, true])('starts a transition from collapsed=%s without an extra layout commit', async initialCollapsed => {
    let animations: Animation[] = [];
    const wrapper = { getAnimations: () => animations };
    const view = mountProbe(wrapper, initialCollapsed);
    const initialCommits = view.commits();
    const moving = transition(wrapper);
    animations = [moving.animation];

    view.update(!initialCollapsed, 1);
    expect(view.state()).toEqual({ collapsed: initialCollapsed, pending: true });
    expect(view.commits() - initialCommits).toBe(1);

    await act(async () => { moving.resolve(); });
    expect(view.state()).toEqual({ collapsed: !initialCollapsed, pending: false });
    expect(view.commits() - initialCommits).toBe(2);
  });

  it.each(['resolve', 'reject'] as const)('waits for a same-signal replacement after the original transition %s', async completion => {
    let animations: Animation[] = [];
    const wrapper = { getAnimations: () => animations };
    const view = mountProbe(wrapper);
    const previous = transition(wrapper);
    animations = [previous.animation];
    view.update(true, 1);
    const initialCommits = view.commits();

    const replacement = transition(wrapper);
    animations = [replacement.animation];
    await act(async () => {
      if (completion === 'resolve') previous.resolve();
      else previous.reject(new Error('Transition retargeted during resize'));
    });
    expect(view.state()).toEqual({ collapsed: false, pending: true });
    expect(view.commits()).toBe(initialCommits);

    await act(async () => { replacement.resolve(); });
    expect(view.state()).toEqual({ collapsed: true, pending: false });
    expect(view.commits()).toBe(initialCommits + 1);
  });

  it('settles a cancelled transition and ignores later completion after unmount', async () => {
    let animations: Animation[] = [];
    const wrapper = { getAnimations: () => animations };
    const view = mountProbe(wrapper);
    const folding = transition(wrapper);
    animations = [folding.animation];
    view.update(true);
    await act(async () => { folding.reject(new Error('Animation cancelled')); });
    expect(view.state()).toEqual({ collapsed: true, pending: false });

    const reopening = transition(wrapper);
    animations = [reopening.animation];
    view.update(false);
    view.unmount();
    await act(async () => { reopening.resolve(); });
  });
});
