import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioDockMeteor, type AudioDockMeteorEvent } from './AudioDockMeteor';
import { createAudioDockProgressGeometry, getAudioDockProgressPoint } from './audio-dock-progress-geometry';
import { createAudioDockReturnPath, getAudioDockReturnPoint } from './audio-dock-meteor-geometry';

let renderer: TestRenderer.ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

function mount(reduced = false) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  let resize!: (width: number, height: number) => void;
  const finish = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('window', {
    requestAnimationFrame: (frame: FrameRequestCallback) => { frames.set(++nextId, frame); return nextId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(),
    matchMedia: () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = (width, height) => callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    observe() {}
    disconnect = disconnect;
  });
  const node = () => ({ style: {} as Record<string, string>, attrs: {} as Record<string, string>, setAttribute(key: string, value: string) { this.attrs[key] = value; } });
  const group = node(); const dot = node(); const paths: ReturnType<typeof node>[] = [];
  const event: AudioDockMeteorEvent = { id: 1, src: 'song', ratio: 1, fromColor: '#ff0000' };
  act(() => { renderer = TestRenderer.create(<AudioDockMeteor event={event} color="#00ff00" onFinish={finish} />, {
    createNodeMock: element => {
      if (element.type === 'g') return group;
      if (element.type === 'circle') return dot;
      const mock = node();
      if (element.type === 'path') paths.push(mock);
      return mock;
    },
  }); });
  return {
    frames, finish, dot, group, disconnect,
    get trails() { return paths.slice(-24); },
    resize: () => act(() => resize(600, 76)),
    tick: (now: number) => act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(frame => frame(now)); }),
    color: (color: string) => act(() => renderer.update(<AudioDockMeteor event={event} color={color} onFinish={finish} />)),
  };
}

it('moves immediately with the whole bar as a shrinking tail, retargets color without restarting, and terminates', () => {
  const view = mount(); view.resize(); view.tick(0);
  expect(view.group.style.color).toBe('#ff0000');
  const g = createAudioDockProgressGeometry(600, 76)!;
  const fullLength = g.length + createAudioDockReturnPath(g).length;
  const tailLength = () => view.trails.reduce((sum, path) => sum + Number(path.attrs['stroke-dasharray'].split(' ')[0]), 0) * fullLength;
  expect(tailLength()).toBeCloseTo(g.length);
  expect(Number(view.dot.attrs.cx)).toBeCloseTo(598.5);
  expect(Number(view.dot.attrs.cy)).toBeCloseTo(24);
  view.tick(16);
  expect(Number(view.dot.attrs.cy)).toBeGreaterThan(24);
  expect(tailLength()).toBeLessThan(g.length);
  expect(tailLength()).toBeGreaterThan(110);
  view.tick(100);
  expect(view.group.style.color).toBe('#00ff00');
  view.color('#0000ff'); view.tick(475);
  expect(view.group.style.color).toBe('#0000ff');
  expect(tailLength()).toBeCloseTo(Math.min(110, createAudioDockReturnPath(g).length * 0.16));
  expect(Number(view.dot.attrs.cx)).toBeLessThan(300);
  expect(Number(view.dot.attrs.cy)).toBeCloseTo(74.5);
  view.tick(950);
  expect(Number(view.dot.attrs.cx)).toBeCloseTo(1.5);
  expect(Number(view.dot.attrs.cy)).toBeCloseTo(24);
  view.tick(1050);
  expect(view.finish).toHaveBeenCalledOnce();
  expect(view.frames.size).toBe(0);
});

it('skips motion for reduced-motion and cancels all frames and measurements when removed', () => {
  const reduced = mount(true);
  expect(reduced.finish).toHaveBeenCalledOnce();
  expect(reduced.frames.size).toBe(0);
  act(() => renderer.unmount());
  const view = mount(); view.resize(); view.tick(0);
  expect(view.frames.size).toBe(1);
  act(() => renderer.unmount());
  expect(view.frames.size).toBe(0);
  expect(view.disconnect).toHaveBeenCalledOnce();
});

it.each([[900, 76], [280, 140], [30, 20]])('joins both upper endpoints and stays inside a %dx%d rounded dock', (width, height) => {
  const g = createAudioDockProgressGeometry(width, height)!;
  const start = getAudioDockReturnPoint(g, 0);
  const end = getAudioDockReturnPoint(g, 1);
  expect(start.x).toBeCloseTo(getAudioDockProgressPoint(g, 1).x);
  expect(start.y).toBeCloseTo(g.corner);
  expect(end.x).toBeCloseTo(g.inset);
  expect(end.y).toBeCloseTo(g.corner);
  for (let i = 0; i <= 100; i++) {
    const p = getAudioDockReturnPoint(g, i / 100);
    expect(p.x).toBeGreaterThanOrEqual(g.inset - 1e-8);
    expect(p.x).toBeLessThanOrEqual(width - g.inset + 1e-8);
    expect(p.y).toBeGreaterThanOrEqual(g.corner - 1e-8);
    expect(p.y).toBeLessThanOrEqual(height - g.inset + 1e-8);
  }
});
