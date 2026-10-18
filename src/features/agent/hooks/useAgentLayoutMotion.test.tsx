import type { RefObject } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentLayoutMotion } from './useAgentLayoutMotion';

function transition(target: object | null, property = 'transform', overrides: Record<string, unknown> = {}) {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const finished = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  const animation = { transitionProperty: property, effect: { target }, playState: 'running',
    pending: false, finished, ...overrides };
  return {
    animation: animation as unknown as Animation,
    resolve() { animation.playState = 'finished'; animation.pending = false; resolve(); },
    reject(error: Error) { animation.playState = 'idle'; animation.pending = false; reject(error); },
  };
}

const markedSurface = (kind = '') => ({
  hasAttribute: (name: string) => name === 'data-agent-layout-motion',
  getAttribute: (name: string) => name === 'data-agent-layout-motion' ? kind : null,
});

function MotionProbe({ rootRef, request, onSettled, waitForBubble }: {
  rootRef: RefObject<HTMLElement>; request: number | null; onSettled: (request: number) => void;
  waitForBubble: boolean;
}) {
  useAgentLayoutMotion(rootRef, request, onSettled, waitForBubble);
  return null;
}

const mounted: TestRenderer.ReactTestRenderer[] = [];
function mountProbe(root: object | null, request: number | null = 1, onSettled = vi.fn<(request: number) => void>(), waitForBubble = true) {
  const rootRef = { current: root as HTMLElement | null };
  const render = (nextRequest: number | null, callback: (request: number) => void, wait: boolean) =>
    <MotionProbe rootRef={rootRef} request={nextRequest} onSettled={callback} waitForBubble={wait} />;
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(render(request, onSettled, waitForBubble)); });
  mounted.push(renderer);
  return {
    onSettled,
    update(nextRequest: number | null, callback = onSettled, wait = waitForBubble) {
      act(() => renderer.update(render(nextRequest, callback, wait)));
    },
    unmount() { act(() => renderer.unmount()); },
  };
}

afterEach(() => {
  act(() => { for (const renderer of mounted.splice(0)) renderer.unmount(); });
});

describe('Agent layout motion completion', () => {
  it('still waits for the left directory exit when bubble waiting is disabled', async () => {
    const moving = transition(markedSurface());
    const bubble = transition(markedSurface('bubble'));
    const root = { getAnimations: vi.fn(() => [moving.animation, bubble.animation]) };
    const view = mountProbe(root, 7, vi.fn(), false);
    expect(root.getAnimations).toHaveBeenCalledWith({ subtree: true });
    expect(view.onSettled).not.toHaveBeenCalled();
    await act(async () => { bubble.resolve(); });
    expect(view.onSettled).not.toHaveBeenCalled();
    await act(async () => { moving.resolve(); });
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(view.onSettled).toHaveBeenCalledWith(7);
  });

  it('settles after the left directory and layout finish without waiting for the delayed bubble', async () => {
    const moving = ['transform', 'opacity', 'padding-left', 'padding-right', 'height', 'top']
      .map(property => transition(markedSurface(), property));
    const bubble = transition(markedSurface('bubble'), 'transform', { playState: 'idle', pending: true });
    const root = { getAnimations: vi.fn(() => [...moving.map(item => item.animation), bubble.animation]) };
    const view = mountProbe(root, 6, vi.fn(), false);
    await act(async () => { moving[0].resolve(); });
    expect(view.onSettled).not.toHaveBeenCalled();
    await act(async () => { for (const item of moving.slice(1)) item.resolve(); });
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(view.onSettled).toHaveBeenCalledWith(6);
    expect(bubble.animation.pending).toBe(true);
  });

  it('keeps waiting for the left exit when switching to bubble mode and ignores the old batch', async () => {
    const moving = transition(markedSurface());
    const bubble = transition(markedSurface('bubble'));
    const root = { getAnimations: vi.fn(() => [moving.animation, bubble.animation]) };
    const view = mountProbe(root, 8);
    expect(view.onSettled).not.toHaveBeenCalled();

    view.update(8, view.onSettled, false);
    expect(view.onSettled).not.toHaveBeenCalled();
    expect(root.getAnimations).toHaveBeenCalledTimes(2);

    await act(async () => { moving.resolve(); });
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(view.onSettled).toHaveBeenCalledWith(8);
    expect(root.getAnimations).toHaveBeenCalledTimes(3);

    await act(async () => { bubble.reject(new Error('Old bubble transition cancelled after release')); });
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(root.getAnimations).toHaveBeenCalledTimes(3);
  });

  it('does not acknowledge a null request when bubble waiting is disabled', () => {
    const root = { getAnimations: vi.fn() };
    const view = mountProbe(root, null, vi.fn(), false);
    expect(root.getAnimations).not.toHaveBeenCalled();
    expect(view.onSettled).not.toHaveBeenCalled();
  });

  it('waits for marked layout transitions including a delayed bubble, ignoring other targets and properties', async () => {
    const surface = markedSurface();
    const moving = ['transform', 'opacity', 'padding-left', 'padding-right', 'height']
      .map(property => transition(surface, property));
    const bubble = transition(markedSurface('bubble'), 'transform', { playState: 'idle', pending: true });
    const child = { hasAttribute: () => false, closest: () => surface };
    const animations = [...moving.map(item => item.animation), bubble.animation,
      transition(child).animation,
      transition(surface, 'width').animation,
      transition(surface, 'transform', { playState: 'finished', pending: true }).animation,
      transition(surface, 'opacity', { playState: 'paused' }).animation,
      transition(null).animation];
    const root = { getAnimations: vi.fn(() => animations) };
    const view = mountProbe(root, 0);
    expect(root.getAnimations).toHaveBeenCalledWith({ subtree: true });
    expect(view.onSettled).not.toHaveBeenCalled();
    await act(async () => { for (const item of moving) item.resolve(); });
    expect(view.onSettled).not.toHaveBeenCalled();
    await act(async () => { bubble.resolve(); });
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(view.onSettled).toHaveBeenCalledWith(0);
  });

  it.each([null, {}, { getAnimations: () => [] }])('settles without animations or an available root API: %j', root => {
    const view = mountProbe(root, 3);
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(view.onSettled).toHaveBeenCalledWith(3);
  });

  it('waits only while requested and uses the latest callback without restarting the wait', async () => {
    const motion = transition(markedSurface());
    const root = { getAnimations: vi.fn(() => [motion.animation]) };
    const view = mountProbe(root, null);
    expect(root.getAnimations).not.toHaveBeenCalled();
    view.update(1);
    const latest = vi.fn();
    view.update(1, latest);
    expect(root.getAnimations).toHaveBeenCalledOnce();
    await act(async () => { motion.resolve(); });
    expect(view.onSettled).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledWith(1);
  });

  it('does not publish the old request when a newer layout motion is pending', async () => {
    const first = transition(markedSurface());
    const second = transition(markedSurface());
    let animations = [first.animation];
    const root = { getAnimations: vi.fn(() => animations) };
    const view = mountProbe(root, 1);
    animations = [second.animation];
    view.update(2);
    await act(async () => { first.resolve(); });
    expect(view.onSettled).not.toHaveBeenCalled();
    expect(root.getAnimations).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(); });
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(view.onSettled).toHaveBeenCalledWith(2);
  });

  it.each(['request-null', 'unmount'] as const)('invalidates the pending callback on %s', async end => {
    const motion = transition(markedSurface());
    const root = { getAnimations: vi.fn(() => [motion.animation]) };
    const view = mountProbe(root);
    if (end === 'request-null') view.update(null);
    else view.unmount();
    await act(async () => { motion.reject(new Error('Transition cancelled')); });
    expect(view.onSettled).not.toHaveBeenCalled();
    expect(root.getAnimations).toHaveBeenCalledOnce();
  });

  it.each([true, false])('waits for same-request replacement transitions with waitForBubble=%s', async waitForBubble => {
    const first = transition(markedSurface());
    const replacement = transition(markedSurface(), 'padding-right');
    let animations = [first.animation];
    const root = { getAnimations: vi.fn(() => animations) };
    const view = mountProbe(root, 5, vi.fn(), waitForBubble);
    animations = [replacement.animation];
    await act(async () => { first.reject(new Error('Replaced on resize')); });
    expect(root.getAnimations).toHaveBeenCalledTimes(2);
    expect(view.onSettled).not.toHaveBeenCalled();
    await act(async () => { replacement.resolve(); });
    expect(root.getAnimations).toHaveBeenCalledTimes(3);
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(view.onSettled).toHaveBeenCalledWith(5);
  });

  it('settles the current request when a tracked CSS transition is cancelled', async () => {
    const motion = transition(markedSurface());
    const view = mountProbe({ getAnimations: () => [motion.animation] }, 4);
    await act(async () => { motion.reject(new Error('Transition cancelled')); });
    expect(view.onSettled).toHaveBeenCalledOnce();
    expect(view.onSettled).toHaveBeenCalledWith(4);
  });
});
