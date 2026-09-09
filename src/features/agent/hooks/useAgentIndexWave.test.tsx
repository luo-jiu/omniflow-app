import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentIndexWave } from './useAgentIndexWave';

afterEach(() => vi.unstubAllGlobals());

describe('Index wave animation lifecycle', () => {
  it('pauses while hidden or reduced-motion is enabled, and stops on terminal state and unmount', () => {
    const media = Object.assign(new EventTarget(), { matches: false });
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('window', { matchMedia: () => media });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    function Probe({ active }: { active: number }) { return <span>{String(useAgentIndexWave(active))}</span>; }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<Probe active={9} />); });
    expect(frames.size).toBe(1);
    act(() => { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); });
    expect(frames.size).toBe(0);
    act(() => { doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); });
    expect(frames.size).toBe(1);
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(frames.size).toBe(0);
    act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
    expect(frames.size).toBe(1);
    act(() => renderer.update(<Probe active={-1} />));
    expect(frames.size).toBe(0);
    expect(renderer.root.findByType('span').children).toEqual(['null']);
    act(() => renderer.update(<Probe active={10} />));
    expect(frames.size).toBe(1);
    act(() => renderer.unmount());
    expect(frames.size).toBe(0);
  });
});
