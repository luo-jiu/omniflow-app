import type { ComponentProps } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpandedLyricsRoller } from './audio-viewer-presenters';

vi.mock('@douyinfe/semi-icons', () => ({ IconChevronDown: () => null, IconChevronUp: () => null, IconMusic: () => null }));
const renderers: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => renderers.splice(0).forEach(renderer => renderer.unmount()));
  vi.unstubAllGlobals();
});

function mount(sideBySide = false) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let reducedMotion = false;
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    matchMedia: () => ({ matches: reducedMotion }),
  });
  const disconnect = vi.fn();
  const observe = vi.fn();
  let resize!: () => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const coverBounds = { top: 120, height: 100, right: 280 };
  const cover = { getBoundingClientRect: () => coverBounds };
  const player = { querySelector: () => cover };
  const styles = new Map<string, string>();
  const stage = {
    clientTop: 0, clientHeight: 200, scrollTop: 0,
    getBoundingClientRect: () => ({ top: 100, left: 300 }),
    closest: () => sideBySide ? player : null,
    style: {
      setProperty: (key: string, value: string) => styles.set(key, value),
      removeProperty: (key: string) => styles.delete(key),
    },
    scrollTo: vi.fn(({ top }: { top: number }) => { stage.scrollTop = top; }),
  };
  const positions = [0, 50, 100, 150, 200];
  const heights = [40, 40, 40, 40, 40];
  const props: ComponentProps<typeof ExpandedLyricsRoller> = {
    currentAudioUrl: null, currentTime: 1, duration: 50,
    getPlayerState: () => ({ src: null, currentTime: 0 }),
    isOwnedSource: false, isPlaying: false, onLyricJump: vi.fn(), subtitleError: null,
    subtitleCues: positions.map((_, i) => ({ id: String(i), start: i * 10, end: (i + 1) * 10, lines: [`line-${i}`] })),
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ExpandedLyricsRoller {...props} />, {
      createNodeMock: element => {
        if (element.props.className === 'lyrics-stage') return stage;
        const i = Number(String(element.props.children).replace('line-', ''));
        return { getBoundingClientRect: () => ({ top: 100 + positions[i] - stage.scrollTop, height: heights[i] }) };
      },
    });
  });
  renderers.push(renderer);
  const flush = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
  flush();
  return {
    stage, props, heights, renderer, frames, disconnect, observe, cover, player, coverBounds, styles,
    flush,
    resize: () => { act(() => resize()); flush(); },
    reduceMotion: () => { reducedMotion = true; },
    update: (next: Partial<typeof props>) => {
      Object.assign(props, next);
      act(() => renderer.update(<ExpandedLyricsRoller {...props} />));
      flush();
    },
  };
}

describe('lyrics descend before following their visual anchor', () => {
  it('lets opening highlights descend before aligning later lyrics with the cover center', () => {
    const view = mount(true);
    view.update({ currentTime: 11 });
    expect(view.stage.scrollTo).not.toHaveBeenCalled();
    view.update({ currentTime: 21 });
    const lineCenter = 100 + 100 + view.heights[2] / 2 - view.stage.scrollTop;
    expect(lineCenter).toBe(view.coverBounds.top + view.coverBounds.height / 2);
    expect(lineCenter).toBeLessThan(100 + view.stage.clientHeight / 2);
    expect(view.observe).toHaveBeenCalledWith(view.player);
    expect(view.observe).toHaveBeenCalledWith(view.cover);
  });

  it('realigns the same cue when the cover moves and reserves sufficient space for the last cue', () => {
    const view = mount(true);
    view.update({ currentTime: 41 });
    view.coverBounds.top += 25;
    view.stage.clientHeight = 240;
    view.resize();
    const anchor = view.coverBounds.top + view.coverBounds.height / 2 - 100;
    expect(200 + view.heights[4] / 2 - view.stage.scrollTop).toBe(anchor);
    expect(Number.parseFloat(view.styles.get('--audio-lyrics-tail-space')!)).toBeGreaterThanOrEqual(view.stage.clientHeight - anchor - view.heights[4] / 2);
    view.update({ currentTime: 1 });
    expect(view.stage.scrollTop).toBe(0);
  });

  it('returns to the stage midpoint when the cover stacks above the lyrics', () => {
    const view = mount(true);
    view.update({ currentTime: 41 });
    view.coverBounds.right = 400;
    view.resize();
    expect(200 + view.heights[4] / 2 - view.stage.scrollTop).toBe(view.stage.clientHeight / 2);
    expect(view.styles.get('--audio-lyrics-tail-space')).toBe('100px');
  });

  it('starts at the top and keeps opening highlights above the middle without scrolling', () => {
    const view = mount();
    expect(view.stage.scrollTo).not.toHaveBeenCalled();
    view.update({ currentTime: 11 });
    expect(view.stage.scrollTop).toBe(0);
    expect(view.stage.scrollTo).not.toHaveBeenCalled();
    expect(view.renderer.root.findByProps({ className: 'lyrics-stage' }).props['data-scrolled']).toBe(false);
  });

  it('scrolls only the lyrics stage after the focused line reaches the middle', () => {
    const view = mount();
    view.update({ currentTime: 21 });
    expect(view.stage.scrollTo).toHaveBeenLastCalledWith({ top: 20, behavior: 'smooth' });
    view.update({ currentTime: 31 });
    expect(view.stage.scrollTo).toHaveBeenLastCalledWith({ top: 70, behavior: 'smooth' });
  });

  it('restores top alignment when seeking back to the opening lines', () => {
    const view = mount();
    view.update({ currentTime: 41 });
    expect(view.stage.scrollTop).toBe(120);
    view.update({ currentTime: 1 });
    expect(view.stage.scrollTop).toBe(0);
  });

  it('remeasures the middle after resizing without changing the focused cue', () => {
    const view = mount();
    view.update({ currentTime: 11 });
    view.stage.clientHeight = 100;
    view.resize();
    expect(view.stage.scrollTop).toBe(20);
    view.stage.clientHeight = 240;
    view.resize();
    expect(view.stage.scrollTop).toBe(0);
  });

  it('uses the actual wrapped line height', () => {
    const view = mount();
    view.heights[1] = 140;
    view.update({ currentTime: 11 });
    expect(view.stage.scrollTop).toBe(20);
  });

  it('realigns replaced lyrics even when the focused cue index is unchanged', () => {
    const view = mount();
    view.stage.scrollTop = 120;
    view.update({ subtitleCues: view.props.subtitleCues.map(cue => ({ ...cue, id: `new-${cue.id}` })) });
    expect(view.stage.scrollTop).toBe(0);
  });

  it('enables the top fade only after scrolling and resets it for an empty song', () => {
    const view = mount();
    view.update({ currentTime: 31 });
    act(() => view.renderer.root.findByProps({ className: 'lyrics-stage' }).props.onScroll({ currentTarget: view.stage }));
    expect(view.renderer.root.findByProps({ className: 'lyrics-stage' }).props['data-scrolled']).toBe(true);
    view.update({ subtitleCues: [] });
    expect(view.stage.scrollTop).toBe(0);
    expect(view.renderer.root.findByProps({ className: 'lyrics-stage' }).props['data-scrolled']).toBe(false);
  });

  it('respects reduced motion and releases its observer and pending frame', () => {
    const view = mount();
    view.reduceMotion();
    view.update({ currentTime: 31 });
    expect(view.stage.scrollTo).toHaveBeenLastCalledWith({ top: 70, behavior: 'auto' });
    act(() => view.renderer.unmount());
    expect(view.disconnect).toHaveBeenCalled();
    expect(view.frames.size).toBe(0);
  });
});
