import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentScrollFollow, isAgentScrollbarPointer, isAgentScrollKey, isAgentScrollWheel } from './agent-scroll-follow';

afterEach(() => vi.unstubAllGlobals());

describe('Agent scroll following', () => {
  it('resumes after the final frame of PageDown/End and ignores later layout clamps', () => {
    const follow = { current: false };
    const scrolling = createAgentScrollFollow(follow);
    const metrics = { scrollHeight: 2000, clientHeight: 600, scrollTop: 300 };
    scrolling.startUserScroll();
    [600, 1000, 1400].forEach(scrollTop => scrolling.onScroll({ ...metrics, scrollTop }));
    expect(follow.current).toBe(true);
    scrolling.finishUserScroll();
    scrolling.pause();
    scrolling.onScroll({ scrollHeight: 900, clientHeight: 600, scrollTop: 300 });
    expect(follow.current).toBe(false);
    scrolling.startUserScroll();
    scrolling.onScroll({ scrollHeight: 900, clientHeight: 600, scrollTop: 300 });
    expect(follow.current).toBe(true);
  });

  it('invalidates an in-flight gesture when a tool is toggled and retains the last drag frame until scrollend', () => {
    const follow = { current: true };
    const scrolling = createAgentScrollFollow(follow);
    scrolling.startScrollbarDrag({ scrollHeight: 1500, clientHeight: 600, scrollTop: 100 });
    scrolling.onScroll({ scrollHeight: 1500, clientHeight: 600, scrollTop: 300 });
    expect(follow.current).toBe(false);
    // Pointerup can precede the last native scroll frame; scrollend owns completion.
    scrolling.finishPointerScroll({ scrollHeight: 1500, clientHeight: 600, scrollTop: 300 });
    scrolling.onScroll({ scrollHeight: 1500, clientHeight: 600, scrollTop: 900 });
    expect(follow.current).toBe(true);
    scrolling.pause();
    scrolling.onScroll({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    expect(follow.current).toBe(false);
  });

  it('does not retain a scrollbar click that never moved and never emits scrollend', () => {
    const follow = { current: false };
    const scrolling = createAgentScrollFollow(follow);
    const metrics = { scrollHeight: 1500, clientHeight: 600, scrollTop: 200 };
    scrolling.startScrollbarDrag(metrics);
    scrolling.finishPointerScroll(metrics);
    scrolling.onScroll({ scrollHeight: 800, clientHeight: 600, scrollTop: 200 });
    expect(follow.current).toBe(false);
  });

  it('distinguishes an inner AX wheel, scroll chaining, scrollbar dragging and tool clicks', () => {
    vi.stubGlobal('window', { getComputedStyle: () => ({ overflowY: 'auto', overscrollBehaviorY: 'auto' }) });
    const root = { offsetWidth: 800, clientWidth: 792, getBoundingClientRect: () => ({ right: 800 }) } as HTMLElement;
    const inner = { parentElement: root, scrollHeight: 900, clientHeight: 132, scrollTop: 200 } as HTMLElement;
    const wheel = { target: inner, currentTarget: root, deltaY: 60, defaultPrevented: false, ctrlKey: false };
    expect(isAgentScrollWheel(wheel)).toBe(false);
    inner.scrollTop = 768;
    expect(isAgentScrollWheel(wheel)).toBe(true);
    expect(isAgentScrollWheel({ ...wheel, ctrlKey: true })).toBe(false);
    expect(isAgentScrollbarPointer({ target: root, currentTarget: root, clientX: 797 })).toBe(true);
    expect(isAgentScrollbarPointer({ target: inner, currentTarget: root, clientX: 797 })).toBe(false);
    expect(isAgentScrollbarPointer({ target: root, currentTarget: root, clientX: 400 })).toBe(false);
    const overlayRoot = { offsetWidth: 800, clientWidth: 800, getBoundingClientRect: () => ({ right: 800 }) } as HTMLElement;
    expect(isAgentScrollbarPointer({ target: overlayRoot, currentTarget: overlayRoot, clientX: 797 })).toBe(true);
    expect(isAgentScrollKey({ key: 'End', target: { closest: () => inner } as unknown as EventTarget,
      currentTarget: root, defaultPrevented: false })).toBe(false);
    expect(isAgentScrollKey({ key: 'End', target: root, currentTarget: root, defaultPrevented: false })).toBe(true);
  });

  it('leaves PageDown/End with an inner AX or detail scroller and ignores prevented keys', () => {
    vi.stubGlobal('window', { getComputedStyle: () => ({ overflowY: 'auto', overscrollBehaviorY: 'auto' }) });
    const root = {} as HTMLElement;
    const inner = { parentElement: root, scrollHeight: 900, clientHeight: 132, scrollTop: 200 } as HTMLElement;
    const key = { key: 'PageDown', target: inner, currentTarget: root, defaultPrevented: false };
    expect(isAgentScrollKey(key)).toBe(false);
    expect(isAgentScrollKey({ ...key, key: 'End' })).toBe(false);
    expect(isAgentScrollKey({ ...key, key: 'Home' })).toBe(false);
    inner.scrollTop = 0;
    expect(isAgentScrollKey({ ...key, key: 'Home' })).toBe(true);
    expect(isAgentScrollKey({ ...key, target: root, defaultPrevented: true })).toBe(false);
    const follow = { current: false };
    const scrolling = createAgentScrollFollow(follow);
    if (isAgentScrollKey(key)) scrolling.startUserScroll();
    scrolling.onScroll({ scrollHeight: 800, clientHeight: 600, scrollTop: 200 });
    expect(follow.current).toBe(false);
  });
});
