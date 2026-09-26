import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSections from './SettingsSections';

afterEach(() => vi.unstubAllGlobals());

function mount(initialCategory = 'appearance', reducedMotion = false) {
  const ids = ['appearance', 'general', 'files', 'browser', 'plugins', 'about'];
  const positions = ids.map((_, index) => 24 + index * 300);
  let resize!: () => void;
  let scrollListener!: () => void;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) });
  const scroller = {
    scrollTop: 0, clientHeight: 600, scrollHeight: 2100,
    style: { setProperty: vi.fn() },
    scrollTo: vi.fn(),
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => ids.map((id, index) => ({
      dataset: { settingsSection: id },
      getBoundingClientRect: () => ({ top: 100 + positions[index] - scroller.scrollTop }),
    })),
    addEventListener: (_: string, callback: () => void) => { scrollListener = callback; },
    removeEventListener: vi.fn(),
  };
  const onCategoryChange = vi.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  const flush = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
  act(() => {
    renderer = TestRenderer.create(<SettingsSections initialCategory={initialCategory} onCategoryChange={onCategoryChange}>
      {ids.map(id => <section key={id} data-settings-section={id}>{id}</section>)}
    </SettingsSections>, { createNodeMock: element => element.props.className === 'settings-content-scroll' ? scroller : null });
  });
  flush();
  return {
    renderer, scroller, frames, disconnect, positions, resize: () => { resize(); flush(); },
    active: () => renderer.root.findAllByType('button').find(button => button.props['aria-current'] === 'location')?.findAllByType('span').at(-1)?.props.children,
    scroll: (top: number) => { scroller.scrollTop = top; scrollListener(); flush(); },
  };
}

describe('Settings continuous navigation', () => {
  it('keeps every section mounted and follows scrolling in both directions, including the bottom', () => {
    const view = mount();
    expect(view.renderer.root.findAllByType('section')).toHaveLength(6);
    expect(view.active()).toBe('外观');
    view.scroll(620);
    expect(view.active()).toBe('文件与存储');
    view.scroll(1500);
    expect(view.active()).toBe('关于与更新');
    view.scroll(300);
    expect(view.active()).toBe('通用');
    act(() => view.renderer.unmount());
  });

  it('scrolls only the content pane and respects reduced motion', () => {
    const view = mount('appearance', true);
    act(() => view.renderer.root.findAllByType('button')[3].props.onClick());
    expect(view.scroller.scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' });
    expect(view.renderer.root.findAllByType('section')).toHaveLength(6);
    act(() => view.renderer.unmount());
  });

  it('restores the category after a management page and remeasures changed section heights', () => {
    const view = mount('files');
    expect(view.scroller.scrollTop).toBe(600);
    expect(view.active()).toBe('文件与存储');
    view.positions[3] += 100;
    view.resize();
    act(() => view.renderer.root.findAllByType('button')[3].props.onClick());
    expect(view.scroller.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    act(() => view.renderer.unmount());
  });

  it('releases observers, scroll listeners and queued animation frames on exit', () => {
    const view = mount();
    act(() => view.renderer.unmount());
    expect(view.disconnect).toHaveBeenCalledOnce();
    expect(view.scroller.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(view.frames.size).toBe(0);
  });
});
