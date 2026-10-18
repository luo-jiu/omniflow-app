import type { RefObject } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentComposerAutoHeight } from './useAgentComposerAutoHeight';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: () => void) { ResizeObserverMock.instances.push(this); }
  notify() { act(() => this.callback()); }
}

function textareaMock(width = 800, contentHeight = 76) {
  const dimensions = { width, contentHeight };
  const readWidth = vi.fn(() => dimensions.width);
  const readContentHeight = vi.fn(() => dimensions.contentHeight);
  const writeHeight = vi.fn();
  let height = '';
  const element = {
    get clientWidth() { return readWidth(); },
    get scrollHeight() { return readContentHeight(); },
    style: {
      get height() { return height; },
      set height(value: string) { height = value; writeHeight(value); },
    },
  } as unknown as HTMLTextAreaElement;
  return { element, dimensions, readWidth, readContentHeight, writeHeight };
}

type ProbeProps = {
  textareaRef: RefObject<HTMLTextAreaElement>;
  draft: string;
  enabled: boolean;
  layoutMotionPending: boolean;
  onHeightChange: (height: number) => void;
};

function Probe(props: ProbeProps) {
  useAgentComposerAutoHeight(props);
  return null;
}

const mounted: TestRenderer.ReactTestRenderer[] = [];
function mountProbe(textarea = textareaMock(), initial: Partial<Omit<ProbeProps, 'textareaRef'>> = {}) {
  const onHeightChange = vi.fn();
  let props: ProbeProps = { textareaRef: { current: textarea.element }, draft: '', enabled: true,
    layoutMotionPending: false, onHeightChange, ...initial };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Probe {...props} />); });
  mounted.push(renderer);
  return {
    textarea,
    onHeightChange,
    observer: ResizeObserverMock.instances.at(-1),
    update(patch: Partial<ProbeProps>) {
      props = { ...props, ...patch };
      act(() => renderer.update(<Probe {...props} />));
    },
    unmount() { act(() => renderer.unmount()); },
  };
}

beforeEach(() => {
  ResizeObserverMock.instances = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterEach(() => {
  act(() => { for (const renderer of mounted.splice(0)) renderer.unmount(); });
  vi.unstubAllGlobals();
});

describe('Agent composer automatic height during sidebar motion', () => {
  it('measures the initial draft and immediately follows width changes outside sidebar motion', () => {
    const view = mountProbe(textareaMock(800, 180));
    expect(view.onHeightChange).toHaveBeenLastCalledWith(224);
    expect(view.textarea.element.style.height).toBe('180px');
    view.textarea.dimensions.width = 700;
    view.textarea.dimensions.contentHeight = 220;
    view.observer?.notify();
    expect(view.onHeightChange).toHaveBeenLastCalledWith(264);
    expect(view.textarea.element.style.height).toBe('220px');

    const measurements = view.textarea.readContentHeight.mock.calls.length;
    view.observer?.notify();
    expect(view.textarea.readContentHeight).toHaveBeenCalledTimes(measurements);
  });

  it('does no width or height layout reads/writes for resize notifications while motion is pending, then measures once', () => {
    const view = mountProbe(textareaMock(800, 120));
    view.update({ layoutMotionPending: true });
    view.textarea.readWidth.mockClear();
    view.textarea.readContentHeight.mockClear();
    view.textarea.writeHeight.mockClear();
    view.onHeightChange.mockClear();

    for (const width of [780, 740, 700, 660]) {
      view.textarea.dimensions.width = width;
      view.observer?.notify();
    }
    expect(view.textarea.readWidth).not.toHaveBeenCalled();
    expect(view.textarea.readContentHeight).not.toHaveBeenCalled();
    expect(view.textarea.writeHeight).not.toHaveBeenCalled();
    expect(view.onHeightChange).not.toHaveBeenCalled();
    expect(view.textarea.element.style.height).toBe('120px');

    view.textarea.dimensions.contentHeight = 240;
    view.update({ layoutMotionPending: false });
    expect(view.textarea.readContentHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenCalledWith(284);
    expect(view.textarea.element.style.height).toBe('240px');
    view.observer?.notify();
    expect(view.textarea.readContentHeight).toHaveBeenCalledOnce();
  });

  it('still grows and shrinks for draft edits while width measurements are deferred', () => {
    const view = mountProbe(textareaMock(), { layoutMotionPending: true });
    view.textarea.dimensions.width = 680;
    view.textarea.dimensions.contentHeight = 180;
    view.observer?.notify();
    view.update({ draft: 'A draft that wraps onto more lines' });
    expect(view.onHeightChange).toHaveBeenLastCalledWith(224);
    expect(view.textarea.element.style.height).toBe('180px');

    view.textarea.dimensions.contentHeight = 20;
    view.update({ draft: '' });
    expect(view.onHeightChange).toHaveBeenLastCalledWith(120);
    expect(view.textarea.element.style.height).toBe('76px');
    expect(ResizeObserverMock.instances).toHaveLength(1);
  });

  it('keeps the 320px composer limit and restores the current wrapped height after motion', () => {
    const view = mountProbe(textareaMock(800, 120), { layoutMotionPending: true });
    view.textarea.dimensions.width = 640;
    view.textarea.dimensions.contentHeight = 900;
    view.update({ draft: 'Long draft' });
    expect(view.onHeightChange).toHaveBeenLastCalledWith(320);
    expect(view.textarea.element.style.height).toBe('276px');

    view.textarea.dimensions.width = 850;
    view.textarea.dimensions.contentHeight = 210;
    view.observer?.notify();
    expect(view.textarea.element.style.height).toBe('276px');
    view.update({ layoutMotionPending: false });
    expect(view.onHeightChange).toHaveBeenLastCalledWith(254);
    expect(view.textarea.element.style.height).toBe('210px');
  });

  it('remeasures when a pending motion is cancelled even if its last resize notification has not arrived', () => {
    const view = mountProbe();
    view.update({ layoutMotionPending: true });
    view.textarea.dimensions.width = 650;
    view.textarea.dimensions.contentHeight = 190;
    view.update({ layoutMotionPending: false });
    expect(view.onHeightChange).toHaveBeenLastCalledWith(234);

    view.update({ layoutMotionPending: true });
    view.textarea.dimensions.width = 800;
    view.textarea.dimensions.contentHeight = 80;
    view.observer?.notify();
    view.update({ layoutMotionPending: false });
    expect(view.onHeightChange).toHaveBeenLastCalledWith(124);
    expect(view.textarea.element.style.height).toBe('80px');
  });

  it('performs one measurement when a draft edit and motion completion share a commit', () => {
    const view = mountProbe(textareaMock(), { layoutMotionPending: true });
    view.textarea.readContentHeight.mockClear();
    view.textarea.dimensions.contentHeight = 160;
    view.update({ draft: 'Edited at motion completion', layoutMotionPending: false });
    expect(view.textarea.readContentHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenLastCalledWith(204);
  });

  it('measures immediately when returning from a manager and ignores disconnected observer callbacks', () => {
    const view = mountProbe(textareaMock(), { layoutMotionPending: true });
    const oldObserver = view.observer;
    view.update({ enabled: false });
    expect(oldObserver?.disconnect).toHaveBeenCalledOnce();
    view.textarea.readContentHeight.mockClear();
    view.textarea.dimensions.contentHeight = 190;
    view.update({ draft: 'Changed outside the chat', layoutMotionPending: false });
    oldObserver?.notify();
    expect(view.textarea.readContentHeight).not.toHaveBeenCalled();

    view.update({ enabled: true, layoutMotionPending: true });
    expect(view.textarea.readContentHeight).toHaveBeenCalledOnce();
    expect(view.onHeightChange).toHaveBeenLastCalledWith(234);
    const activeObserver = ResizeObserverMock.instances.at(-1);
    view.unmount();
    expect(activeObserver?.disconnect).toHaveBeenCalledOnce();
    view.textarea.readContentHeight.mockClear();
    activeObserver?.notify();
    expect(view.textarea.readContentHeight).not.toHaveBeenCalled();
  });

  it('uses the latest height callback without recreating the resize observer', () => {
    const view = mountProbe();
    const onHeightChange = vi.fn();
    view.update({ onHeightChange });
    expect(onHeightChange).not.toHaveBeenCalled();
    view.textarea.dimensions.width = 700;
    view.textarea.dimensions.contentHeight = 160;
    view.observer?.notify();
    expect(onHeightChange).toHaveBeenCalledOnce();
    expect(onHeightChange).toHaveBeenCalledWith(204);
    expect(ResizeObserverMock.instances).toHaveLength(1);
  });
});
