import type { ComponentProps } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioDockProgress } from './audio-dock-progress';

const renderers: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => renderers.splice(0).forEach(renderer => renderer.unmount()));
  vi.unstubAllGlobals();
});

type ProgressInput = Omit<ComponentProps<typeof AudioDockProgress>, 'onPreview' | 'onCommit' | 'onCancel'>;

function renderProgress(overrides: Partial<ProgressInput> = {}) {
  const props = {
    visible: true,
    disabled: false,
    duration: 100,
    value: 25,
    startColor: '#123456',
    endColor: '#abcdef',
    onPreview: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const observe = vi.fn();
  const disconnect = vi.fn();
  let resize!: (width: number, height: number) => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = (width, height) => act(() => callback(
        [{ contentRect: { width, height } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      ));
    }
    observe = observe;
    disconnect = disconnect;
  });
  const capturedPointers = new Set<number>();
  const rootNode = {};
  const fillNode = { setAttribute: vi.fn() };
  const gradientNode = { setAttribute: vi.fn() };
  const inputNode = { focus: vi.fn() };
  const svgNode = {
    getBoundingClientRect: vi.fn(() => ({ left: 100, top: 50 })),
    setPointerCapture: vi.fn((pointerId: number) => capturedPointers.add(pointerId)),
    hasPointerCapture: vi.fn((pointerId: number) => capturedPointers.has(pointerId)),
    releasePointerCapture: vi.fn((pointerId: number) => capturedPointers.delete(pointerId)),
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<AudioDockProgress {...props} />, {
      createNodeMock: element => {
        if (element.type === 'input') return inputNode;
        if (element.type === 'svg') return svgNode;
        if (element.type === 'linearGradient') return gradientNode;
        if (element.type === 'path' && element.props.className === 'audio-dock-progress-fill') return fillNode;
        return rootNode;
      },
    });
  });
  renderers.push(renderer);
  return {
    props, renderer, observe, disconnect, rootNode, inputNode, svgNode, fillNode, gradientNode,
    resize: (width = 200, height = 80) => resize(width, height),
    input: () => renderer.root.findByType('input'),
    svg: () => renderer.root.findByType('svg'),
    pointer: (x: number, y: number, pointerId = 9) => ({
      pointerId,
      button: 0,
      clientX: x + 100,
      clientY: y + 50,
      currentTarget: svgNode,
      preventDefault: vi.fn(),
    }),
    update: (next: Partial<ProgressInput>) => {
      Object.assign(props, next);
      act(() => renderer.update(<AudioDockProgress {...props} />));
    },
  };
}

describe('audio dock border progress', () => {
  it.each([10, 3600])('adapts live sampling to a %d-second track without React value updates', duration => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
      cancelAnimationFrame: (frame: number) => frames.delete(frame),
    });
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    let clock = 0;
    const readTime = vi.fn(() => clock);
    const view = renderProgress({ smooth: true, readTime, duration, value: 0 }); view.resize(900, 76);
    for (let i = 0; i <= 60; i++) {
      clock = i / 60;
      act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(i * 1000 / 60)); });
    }
    if (duration === 10) expect(readTime.mock.calls.length).toBeGreaterThanOrEqual(60);
    else expect(readTime.mock.calls.length).toBeLessThanOrEqual(6);
    expect(view.input().props.value).toBe(0);
    expect(view.svgNode.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it('samples the live clock between React updates, skips subpixel writes and snaps directly to seek/pause values', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
      cancelAnimationFrame: (frame: number) => frames.delete(frame),
    });
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    let clock = 25;
    const readTime = vi.fn(() => clock);
    const view = renderProgress({ smooth: true, readTime }); view.resize();
    let now = 0;
    const tick = () => act(() => { now += 100; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); });
    view.fillNode.setAttribute.mockClear();
    tick();
    expect(view.fillNode.setAttribute).not.toHaveBeenCalled();
    clock = 25.001; tick();
    expect(view.fillNode.setAttribute).not.toHaveBeenCalled();
    clock = 26; tick();
    expect(view.fillNode.setAttribute).toHaveBeenCalledWith('stroke-dashoffset', '0.74');
    expect(view.input().props.value).toBe(25);
    view.update({ smooth: false, value: 3 });
    expect(view.fillNode.setAttribute).toHaveBeenCalledWith('stroke-dashoffset', '0.97');
    expect(frames.size).toBe(0);
  });

  it('stops the live clock on document hiding, owner loss and unmount', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    let visibility!: () => void;
    const doc = { hidden: false, addEventListener: (_type: string, fn: () => void) => { visibility = fn; }, removeEventListener: vi.fn() };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
      cancelAnimationFrame: (frame: number) => frames.delete(frame),
    });
    let clock: number | null = 25;
    const view = renderProgress({ smooth: true, readTime: () => clock }); view.resize();
    expect(frames.size).toBe(1);
    doc.hidden = true; visibility();
    expect(frames.size).toBe(0);
    doc.hidden = false; visibility();
    expect(frames.size).toBe(1);
    clock = null;
    act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); });
    expect(frames.size).toBe(0);
    clock = 26; visibility();
    act(() => view.renderer.unmount());
    expect(frames.size).toBe(0);
    expect(doc.removeEventListener).toHaveBeenCalled();
  });
  it('keeps the initially hidden progress out of pointer and keyboard interaction', () => {
    const view = renderProgress({ visible: false });
    expect(view.input().props.disabled).toBe(true);
    expect(view.input().props.tabIndex).toBe(-1);
    expect(view.renderer.root.findByProps({ className: 'audio-dock-progress' }).props['aria-hidden']).toBe(true);
    view.resize();
    expect(view.renderer.root.findByProps({ className: 'audio-dock-progress-hit' }).props.pointerEvents).toBe('none');
    act(() => view.svg().props.onPointerDown(view.pointer(100, 1.5)));
    expect(view.props.onPreview).not.toHaveBeenCalled();
    expect(view.svgNode.getBoundingClientRect).not.toHaveBeenCalled();
    view.update({ visible: true });
    expect(view.input().props.disabled).toBe(false);
    expect(view.input().props.tabIndex).toBe(0);
  });

  it('observes once, preserves gestures across duplicate sizes and disconnects on unmount', () => {
    const view = renderProgress();
    expect(view.observe.mock.calls).toEqual([[view.rootNode]]);
    expect(view.renderer.root.findAllByType('svg')).toHaveLength(0);
    view.resize();
    expect(view.svg().props.viewBox).toBe('0 0 200 80');
    act(() => view.svg().props.onPointerDown(view.pointer(1.5, 24)));
    view.resize();
    view.resize();
    expect(view.props.onCancel).not.toHaveBeenCalled();
    expect(view.svgNode.releasePointerCapture).not.toHaveBeenCalled();
    act(() => view.svg().props.onPointerMove(view.pointer(100, 1.5)));
    expect(view.props.onPreview).toHaveBeenLastCalledWith(50);
    view.resize(300, 80);
    expect(view.svg().props.viewBox).toBe('0 0 300 80');
    expect(view.props.onCancel).toHaveBeenCalledOnce();
    expect(view.svgNode.releasePointerCapture.mock.calls).toEqual([[9]]);
    expect(view.observe).toHaveBeenCalledOnce();
    act(() => view.renderer.unmount());
    expect(view.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    { value: -10, current: 0, visibility: 'hidden', offset: 1 },
    { value: 0, current: 0, visibility: 'hidden', offset: 1 },
    { value: 100, current: 100, visibility: 'visible', offset: 0 },
    { value: 110, current: 100, visibility: 'visible', offset: 0 },
  ])('renders a precise border boundary for value $value', ({ value, current, visibility, offset }) => {
    const view = renderProgress({ value });
    view.resize();
    const fill = view.renderer.root.findByProps({ className: 'audio-dock-progress-fill' });
    expect(view.input().props.value).toBe(current);
    expect(fill.props.visibility).toBe(visibility);
    expect(fill.props.strokeDashoffset).toBe(offset);
    expect(fill.props.pathLength).toBe(1);
    expect(fill.props.strokeDasharray).toBe('1 1');
    expect(fill.props.strokeLinecap).toBe('round');
    expect(view.renderer.root.findByProps({ className: 'audio-dock-progress-track' }).props.strokeLinecap).toBe('round');
  });

  it('previews pointer movement using one origin read and commits once on release', () => {
    const view = renderProgress();
    view.resize();
    const down = view.pointer(1.5, 24);
    act(() => view.svg().props.onPointerDown(down));
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(view.svgNode.setPointerCapture.mock.calls).toEqual([[9]]);
    expect(view.inputNode.focus.mock.calls).toEqual([[{ preventScroll: true }]]);
    expect(view.props.onPreview).toHaveBeenLastCalledWith(0);
    expect(view.props.onCommit).not.toHaveBeenCalled();

    view.svgNode.getBoundingClientRect.mockImplementation(() => { throw new Error('layout read during pointer movement'); });
    act(() => view.svg().props.onPointerMove(view.pointer(100, 1.5)));
    expect(view.props.onPreview).toHaveBeenLastCalledWith(50);
    expect(view.props.onCommit).not.toHaveBeenCalled();
    act(() => view.svg().props.onPointerUp(view.pointer(198.5, 24)));
    expect(view.props.onPreview.mock.calls.map(([time]) => time)).toEqual([0, 50, 100]);
    expect(view.props.onCommit).toHaveBeenCalledOnce();
    expect(view.svgNode.getBoundingClientRect).toHaveBeenCalledOnce();
    expect(view.svgNode.releasePointerCapture.mock.calls).toEqual([[9]]);

    act(() => {
      view.svg().props.onLostPointerCapture(view.pointer(198.5, 24));
      view.svg().props.onPointerUp(view.pointer(198.5, 24));
      view.svg().props.onPointerMove(view.pointer(100, 1.5));
    });
    expect(view.props.onCommit).toHaveBeenCalledOnce();
    expect(view.props.onCancel).not.toHaveBeenCalled();
    expect(view.props.onPreview).toHaveBeenCalledTimes(3);
  });

  it('ignores a secondary button and unrelated pointers during an active gesture', () => {
    const view = renderProgress();
    view.resize();
    act(() => view.svg().props.onPointerDown({ ...view.pointer(100, 1.5), button: 2 }));
    expect(view.props.onPreview).not.toHaveBeenCalled();
    act(() => {
      view.svg().props.onPointerDown(view.pointer(1.5, 24));
      view.svg().props.onPointerDown(view.pointer(100, 1.5, 10));
      view.svg().props.onPointerMove(view.pointer(100, 1.5, 10));
      view.svg().props.onPointerUp(view.pointer(100, 1.5, 10));
      view.svg().props.onPointerCancel(view.pointer(100, 1.5, 10));
      view.svg().props.onLostPointerCapture(view.pointer(100, 1.5, 10));
    });
    expect(view.props.onPreview.mock.calls).toEqual([[0]]);
    expect(view.props.onCommit).not.toHaveBeenCalled();
    expect(view.props.onCancel).not.toHaveBeenCalled();
    act(() => view.svg().props.onPointerUp(view.pointer(198.5, 24)));
    expect(view.props.onCommit).toHaveBeenCalledOnce();
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'] as const)('cancels without submitting after %s', handler => {
    const view = renderProgress();
    view.resize();
    act(() => {
      view.svg().props.onPointerDown(view.pointer(100, 1.5));
      view.svg().props[handler](view.pointer(100, 1.5));
      view.svg().props.onPointerUp(view.pointer(198.5, 24));
      view.svg().props.onPointerMove(view.pointer(198.5, 24));
    });
    expect(view.props.onCancel).toHaveBeenCalledOnce();
    expect(view.props.onCommit).not.toHaveBeenCalled();
    expect(view.props.onPreview.mock.calls).toEqual([[50]]);
    if (handler === 'onPointerCancel') expect(view.svgNode.releasePointerCapture.mock.calls).toEqual([[9]]);
  });

  it('cancels Escape and does not commit from its keyup or the later pointer release', () => {
    const view = renderProgress();
    view.resize();
    const preventDefault = vi.fn();
    act(() => {
      view.svg().props.onPointerDown(view.pointer(100, 1.5));
      view.input().props.onKeyDown({ key: 'Escape', preventDefault });
      view.input().props.onKeyUp({ key: 'Escape' });
      view.svg().props.onPointerUp(view.pointer(198.5, 24));
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(view.props.onCancel).toHaveBeenCalledOnce();
    expect(view.props.onCommit).not.toHaveBeenCalled();
    expect(view.svgNode.releasePointerCapture.mock.calls).toEqual([[9]]);
  });

  it('previews range changes and commits only after the keyboard key is released', () => {
    const view = renderProgress();
    const preventDefault = vi.fn();
    act(() => {
      view.input().props.onKeyDown({ key: 'ArrowRight', preventDefault });
      view.input().props.onChange({ currentTarget: { value: '25.1' } });
      view.input().props.onChange({ currentTarget: { value: '25.2' } });
    });
    expect(view.props.onPreview.mock.calls.map(([time]) => time)).toEqual([25.1, 25.2]);
    expect(view.props.onCommit).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    act(() => view.input().props.onKeyUp({ key: 'ArrowRight' }));
    expect(view.props.onCommit).toHaveBeenCalledOnce();
    expect(view.props.onCancel).not.toHaveBeenCalled();
    expect(view.svgNode.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it.each([{ visible: false }, { disabled: true }, { duration: 0 }])('cancels an active preview when availability changes to %j', next => {
    const view = renderProgress();
    view.resize();
    act(() => view.svg().props.onPointerDown(view.pointer(100, 1.5)));
    view.update(next);
    act(() => view.svg().props.onPointerUp(view.pointer(198.5, 24)));
    expect(view.input().props.disabled).toBe(true);
    expect(view.props.onCancel).toHaveBeenCalledOnce();
    expect(view.props.onCommit).not.toHaveBeenCalled();
    expect(view.svgNode.releasePointerCapture.mock.calls).toEqual([[9]]);
  });
});
