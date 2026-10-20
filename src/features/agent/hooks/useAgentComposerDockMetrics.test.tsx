import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentComposerDockMetrics } from './useAgentComposerDockMetrics';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: () => void) { ResizeObserverMock.instances.push(this); }
  notify() { act(() => this.callback()); }
}

function dockElements() {
  const dimensions = { height: 138, offsetWidth: 1000, clientWidth: 992 };
  const readHeight = vi.fn(() => ({ height: dimensions.height }));
  const readOffsetWidth = vi.fn(() => dimensions.offsetWidth);
  const readClientWidth = vi.fn(() => dimensions.clientWidth);
  const frame = { getBoundingClientRect: readHeight } as unknown as HTMLDivElement;
  const scroll = {
    get offsetWidth() { return readOffsetWidth(); },
    get clientWidth() { return readClientWidth(); },
  } as unknown as HTMLDivElement;
  return { frame, scroll, dimensions, readHeight, readOffsetWidth, readClientWidth };
}

type ProbeProps = Parameters<typeof useAgentComposerDockMetrics>[0];
function Probe(props: ProbeProps) {
  useAgentComposerDockMetrics(props);
  return null;
}

const mounted: TestRenderer.ReactTestRenderer[] = [];
function mountProbe(elements = dockElements(), initial: Partial<ProbeProps> = {}) {
  const onHeightChange = vi.fn();
  const onScrollbarWidth = vi.fn();
  let props: ProbeProps = { composerFrameRef: { current: elements.frame }, scrollRef: { current: elements.scroll },
    enabled: true, layoutMotionPending: false, onHeightChange, onScrollbarWidth, ...initial };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Probe {...props} />); });
  mounted.push(renderer);
  return {
    elements, onHeightChange, onScrollbarWidth, observer: ResizeObserverMock.instances.at(-1),
    clearMeasurements() {
      elements.readHeight.mockClear();
      elements.readOffsetWidth.mockClear();
      elements.readClientWidth.mockClear();
      onHeightChange.mockClear();
      onScrollbarWidth.mockClear();
    },
    update(patch: Partial<ProbeProps>) {
      props = { ...props, ...patch };
      act(() => renderer.update(<Probe {...props} />));
    },
    unmount() { act(() => renderer.unmount()); },
  };
}

function expectNoMeasurements(view: ReturnType<typeof mountProbe>) {
  expect(view.elements.readHeight).not.toHaveBeenCalled();
  expect(view.elements.readOffsetWidth).not.toHaveBeenCalled();
  expect(view.elements.readClientWidth).not.toHaveBeenCalled();
  expect(view.onHeightChange).not.toHaveBeenCalled();
  expect(view.onScrollbarWidth).not.toHaveBeenCalled();
}

beforeEach(() => {
  ResizeObserverMock.instances = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterEach(() => {
  act(() => { for (const renderer of mounted.splice(0)) renderer.unmount(); });
  vi.unstubAllGlobals();
});

describe('Agent composer dock metrics during sidebar motion', () => {
  it('measures the mounted dock once and follows frame and scroll changes with one observer', () => {
    const view = mountProbe();
    expect(view.onHeightChange).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(138);
    expect(view.onScrollbarWidth).toHaveBeenCalledOnce();
    expect(view.onScrollbarWidth).toHaveBeenCalledWith(8);
    expect(view.observer?.observe.mock.calls).toEqual([[view.elements.frame], [view.elements.scroll]]);

    view.clearMeasurements();
    view.elements.dimensions.height = 228;
    view.elements.dimensions.clientWidth = 984;
    view.observer?.notify();
    expect(view.elements.readHeight).toHaveBeenCalledOnce();
    expect(view.elements.readOffsetWidth).toHaveBeenCalledOnce();
    expect(view.elements.readClientWidth).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(228);
    expect(view.onScrollbarWidth).toHaveBeenCalledWith(16);
    expect(ResizeObserverMock.instances).toHaveLength(1);
  });

  it('performs no layout reads or setters during animation or dragging and measures the final geometry once', () => {
    const view = mountProbe();
    view.update({ layoutMotionPending: true });
    view.clearMeasurements();
    for (const width of [980, 900, 820, 780]) {
      view.elements.dimensions.offsetWidth = width;
      view.elements.dimensions.clientWidth = width - 8;
      view.observer?.notify();
    }
    expectNoMeasurements(view);

    view.elements.dimensions.height = 178;
    view.update({ layoutMotionPending: false });
    expect(view.elements.readHeight).toHaveBeenCalledOnce();
    expect(view.elements.readOffsetWidth).toHaveBeenCalledOnce();
    expect(view.elements.readClientWidth).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(178);
    expect(view.onScrollbarWidth).toHaveBeenCalledOnce();
    expect(view.onScrollbarWidth).toHaveBeenCalledWith(8);
    expect(ResizeObserverMock.instances).toHaveLength(1);

    view.clearMeasurements();
    view.update({ layoutMotionPending: false });
    expectNoMeasurements(view);
  });

  it('defers even the initial measurement when mounted during pending motion', () => {
    const view = mountProbe(dockElements(), { layoutMotionPending: true });
    view.observer?.notify();
    expectNoMeasurements(view);
    expect(view.observer?.observe).toHaveBeenCalledTimes(2);
    view.update({ layoutMotionPending: false });
    expect(view.elements.readHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(138);
    expect(view.onScrollbarWidth).toHaveBeenCalledWith(8);
  });

  it('measures on motion cancellation even when the final observer notification has not arrived', () => {
    const view = mountProbe();
    view.update({ layoutMotionPending: true });
    view.clearMeasurements();
    view.elements.dimensions.height = 188;
    view.elements.dimensions.clientWidth = 1000;
    view.update({ layoutMotionPending: false });
    expect(view.elements.readHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(188);
    expect(view.onScrollbarWidth).toHaveBeenCalledWith(0);
  });

  it('disconnects in manager views and defers measuring the returned dock until motion settles', () => {
    const view = mountProbe();
    const oldObserver = view.observer;
    view.update({ enabled: false, layoutMotionPending: true });
    expect(oldObserver?.disconnect).toHaveBeenCalledOnce();
    view.clearMeasurements();
    oldObserver?.notify();
    view.update({ layoutMotionPending: false });
    expectNoMeasurements(view);
    expect(ResizeObserverMock.instances).toHaveLength(1);

    view.elements.dimensions.height = 208;
    view.update({ enabled: true, layoutMotionPending: true });
    const returnedObserver = ResizeObserverMock.instances.at(-1);
    expect(ResizeObserverMock.instances).toHaveLength(2);
    returnedObserver?.notify();
    oldObserver?.notify();
    expectNoMeasurements(view);
    view.update({ layoutMotionPending: false });
    expect(view.elements.readHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(208);
  });

  it('measures once when returning from a manager and ending motion in the same commit', () => {
    const view = mountProbe(dockElements(), { enabled: false, layoutMotionPending: true });
    expect(ResizeObserverMock.instances).toHaveLength(0);
    expectNoMeasurements(view);
    view.update({ enabled: true, layoutMotionPending: false });
    expect(ResizeObserverMock.instances).toHaveLength(1);
    expect(view.elements.readHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledOnce();
    expect(view.onScrollbarWidth).toHaveBeenCalledOnce();
  });

  it('uses the latest metric callbacks without recreating the observer or measuring during a callback-only render', () => {
    const view = mountProbe();
    const onHeightChange = vi.fn();
    const onScrollbarWidth = vi.fn();
    view.clearMeasurements();
    view.update({ onHeightChange, onScrollbarWidth });
    expectNoMeasurements(view);
    expect(onHeightChange).not.toHaveBeenCalled();
    expect(onScrollbarWidth).not.toHaveBeenCalled();

    view.elements.dimensions.height = 248;
    view.observer?.notify();
    expect(onHeightChange).toHaveBeenCalledWith(248);
    expect(onScrollbarWidth).toHaveBeenCalledWith(8);
    expect(view.onHeightChange).not.toHaveBeenCalled();
    expect(view.onScrollbarWidth).not.toHaveBeenCalled();
    expect(ResizeObserverMock.instances).toHaveLength(1);
  });

  it('disconnects on unmount and ignores a queued callback from the disposed observer', () => {
    const view = mountProbe();
    view.unmount();
    expect(view.observer?.disconnect).toHaveBeenCalledOnce();
    view.clearMeasurements();
    view.observer?.notify();
    expectNoMeasurements(view);
  });

  it('skips absent frames and still measures height when the scroll region is absent', () => {
    const view = mountProbe(dockElements(), { composerFrameRef: { current: null }, scrollRef: { current: null } });
    expect(ResizeObserverMock.instances).toHaveLength(0);
    expectNoMeasurements(view);
    view.update({ composerFrameRef: { current: view.elements.frame } });
    expect(view.elements.readHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(138);
    expect(view.elements.readOffsetWidth).not.toHaveBeenCalled();
    expect(view.elements.readClientWidth).not.toHaveBeenCalled();
    expect(view.onScrollbarWidth).not.toHaveBeenCalled();
    expect(ResizeObserverMock.instances.at(-1)?.observe.mock.calls).toEqual([[view.elements.frame]]);
  });

  it('switches to replacement refs and prevents the previous observer from measuring stale nodes', () => {
    const view = mountProbe();
    const oldObserver = view.observer;
    const replacement = dockElements();
    replacement.dimensions.height = 288;
    view.clearMeasurements();
    view.update({ composerFrameRef: { current: replacement.frame }, scrollRef: { current: replacement.scroll } });
    expect(oldObserver?.disconnect).toHaveBeenCalledOnce();
    oldObserver?.notify();
    expect(view.elements.readHeight).not.toHaveBeenCalled();
    expect(view.elements.readOffsetWidth).not.toHaveBeenCalled();
    expect(view.elements.readClientWidth).not.toHaveBeenCalled();
    expect(replacement.readHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(288);
    expect(view.onScrollbarWidth).toHaveBeenCalledOnce();
    expect(view.onScrollbarWidth).toHaveBeenCalledWith(8);
  });
});
