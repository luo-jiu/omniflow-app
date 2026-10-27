import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import ReasoningStarfield from './ReasoningStarfield';

const mocks = vi.hoisted(() => ({ create: vi.fn(), draw: vi.fn(), dispose: vi.fn() }));
vi.mock('./reasoning-starfield-renderer', () => ({ createReasoningStarfieldRenderer: mocks.create }));

let view: TestRenderer.ReactTestRenderer | undefined;
let documentTarget: EventTarget & { hidden: boolean };
let windowTarget: EventTarget;
let media: EventTarget & { matches: boolean };
let canvas: EventTarget & { width: number; height: number; getBoundingClientRect: () => { width: number; height: number } };
let frames: Map<number, FrameRequestCallback>;
let intersection: (entries: Array<{ target: unknown; isIntersecting: boolean }>) => void;
let resize: () => void;
let nextFrame: number;
const disconnectResize = vi.fn();
const disconnectIntersection = vi.fn();

function mount(active = true, reducedMotion?: boolean) {
  act(() => { view = TestRenderer.create(<ReasoningStarfield active={active} reducedMotion={reducedMotion} />, {
    createNodeMock: element => element.type === 'canvas' ? canvas : null,
  }); });
}

function tick(timestamp: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(timestamp));
}

beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map(); nextFrame = 1;
  documentTarget = Object.assign(new EventTarget(), { hidden: false });
  media = Object.assign(new EventTarget(), { matches: false });
  windowTarget = Object.assign(new EventTarget(), {
    devicePixelRatio: 3,
    matchMedia: () => media,
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  canvas = Object.assign(new EventTarget(), { width: 0, height: 0, getBoundingClientRect: () => ({ width: 230, height: 24 }) });
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', documentTarget);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnectResize;
  });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersection) { intersection = callback; }
    observe() {}
    disconnect = disconnectIntersection;
  });
  mocks.create.mockReturnValue({ draw: mocks.draw, dispose: mocks.dispose });
  mocks.draw.mockReturnValue(true);
});

afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

describe('reasoning starfield lifecycle', () => {
  it('allocates only while active and releases its loop and resources when the popup closes', () => {
    mount(false);
    expect(mocks.create).not.toHaveBeenCalled();
    act(() => view!.update(<ReasoningStarfield active />));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(460);
    expect(canvas.height).toBe(48);
    expect(frames.size).toBe(1);
    tick(100); tick(116);
    expect(mocks.draw).toHaveBeenLastCalledWith(.016, 230, 24, { maximum: true, fastMode: false, reducedMotion: false });
    act(() => view!.update(<ReasoningStarfield active={false} />));
    expect(frames.size).toBe(0);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(disconnectResize).toHaveBeenCalledTimes(1);
    expect(disconnectIntersection).toHaveBeenCalledTimes(1);
    mocks.draw.mockClear();
    documentTarget.dispatchEvent(new Event('visibilitychange')); media.dispatchEvent(new Event('change'));
    windowTarget.dispatchEvent(new Event('resize')); canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(mocks.draw).not.toHaveBeenCalled();
  });

  it('pauses when hidden, outside the viewport or zero-sized and resumes without time jumps', () => {
    mount(); tick(100); tick(116);
    documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    tick(20_000);
    expect(mocks.draw).toHaveBeenLastCalledWith(.016, 230, 24, { maximum: true, fastMode: false, reducedMotion: false });
    intersection([{ target: canvas, isIntersecting: false }]);
    expect(frames.size).toBe(0);
    intersection([{ target: canvas, isIntersecting: true }]);
    expect(frames.size).toBe(1);
    canvas.getBoundingClientRect = () => ({ width: 0, height: 0 }); resize();
    expect(frames.size).toBe(0);
  });

  it('renders a static field without stars for reduced motion and reacts to preference changes', () => {
    media.matches = true; mount();
    expect(mocks.draw).toHaveBeenLastCalledWith(0, 230, 24, { maximum: true, fastMode: false, reducedMotion: true });
    expect(frames.size).toBe(0);
    media.matches = false; media.dispatchEvent(new Event('change'));
    expect(frames.size).toBe(1);
    media.matches = true; media.dispatchEvent(new Event('change'));
    expect(frames.size).toBe(0);
    act(() => view!.update(<ReasoningStarfield active reducedMotion />));
    expect(frames.size).toBe(0);
    expect(mocks.draw).toHaveBeenLastCalledWith(0, 230, 24, { maximum: true, fastMode: false, reducedMotion: true });
  });

  it('stops after WebGL loss, recreates on restoration and tolerates an unavailable GPU', () => {
    mount(); canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(frames.size).toBe(0);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(1);
    act(() => view!.unmount()); view = undefined;
    mocks.create.mockReturnValue(undefined); mount();
    expect(frames.size).toBe(0);
  });

  it('stops for retained hidden workspaces and rejects queued callbacks after unmount', () => {
    mount();
    const queuedFrame = [...frames.values()][0];
    act(() => view!.update(<WorkspaceVisibilityContext.Provider value={false}><ReasoningStarfield active /></WorkspaceVisibilityContext.Provider>));
    expect(frames.size).toBe(0);
    mocks.draw.mockClear();
    queuedFrame(100); resize(); intersection([{ target: canvas, isIntersecting: true }]);
    expect(frames.size).toBe(0);
    expect(mocks.draw).not.toHaveBeenCalled();
  });

  it('keeps the GPU owner on Fast changes and stops scheduling after the last exit frame', () => {
    mocks.draw.mockReturnValue(false);
    act(() => { view = TestRenderer.create(<ReasoningStarfield active maximum={false} />, {
      createNodeMock: element => element.type === 'canvas' ? canvas : null,
    }); });
    expect(frames.size).toBe(0);
    mocks.draw.mockReturnValue(true);
    act(() => view!.update(<ReasoningStarfield active maximum={false} fastMode />));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    expect(mocks.draw).toHaveBeenLastCalledWith(0, 230, 24, { maximum: false, fastMode: true, reducedMotion: false });
    act(() => view!.update(<ReasoningStarfield active maximum={false} fastMode={false} />));
    expect(frames.size).toBe(1);
    mocks.draw.mockReturnValue(false);
    tick(300);
    expect(frames.size).toBe(0);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
