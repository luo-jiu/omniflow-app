import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
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

it('stops wave frames while the retained workspace is hidden and resumes on return', () => {
  const request = vi.fn(() => 42);
  const cancel = vi.fn();
  const remove = vi.fn();
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: remove });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  function Wave() { useAgentIndexWave(10); return null; }
  const render = (active: boolean) => <WorkspaceVisibilityContext.Provider value={active}><Wave /></WorkspaceVisibilityContext.Provider>;
  let view!: TestRenderer.ReactTestRenderer;
  act(() => { view = TestRenderer.create(render(true)); });
  expect(request).toHaveBeenCalledTimes(1);
  act(() => view.update(render(false)));
  expect(cancel).toHaveBeenCalledWith(42);
  expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  expect(request).toHaveBeenCalledTimes(1);
  act(() => view.update(render(true)));
  expect(request).toHaveBeenCalledTimes(2);
  act(() => view.unmount());
});
