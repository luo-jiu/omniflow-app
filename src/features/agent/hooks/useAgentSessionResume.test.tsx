import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAgentSessionSelection, saveAgentSessionSelection } from '../agent-session-selection';
import { useAgentSessionResume } from './useAgentSessionResume';

type Props = Parameters<typeof useAgentSessionResume>[0];
let latest: ReturnType<typeof useAgentSessionResume>;
const renderers: TestRenderer.ReactTestRenderer[] = [];
function Probe(props: Props) { latest = useAgentSessionResume(props); return null; }
function mount(props: Props) {
  const renderer = TestRenderer.create(<Probe {...props} />);
  renderers.push(renderer);
  return renderer;
}
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  });
});
afterEach(() => { act(() => renderers.splice(0).forEach(renderer => renderer.unmount())); vi.unstubAllGlobals(); });

describe('Agent last selected session recovery', () => {
  it('restores the chosen older session across unmounts, rather than the most recently updated one', async () => {
    saveAgentSessionSelection('library-3', 'older-chat');
    const props = { scope: 'library-3', loadLatest: vi.fn(async () => 'newest-chat'), restore: vi.fn(async () => true) };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = mount(props); });
    expect(props.restore).toHaveBeenLastCalledWith('older-chat');
    expect(props.loadLatest).not.toHaveBeenCalled();
    act(() => latest.select('chosen-chat'));
    act(() => renderer.unmount());
    await act(async () => { mount(props); });
    expect(props.restore).toHaveBeenLastCalledWith('chosen-chat');
    expect(latest.loading).toBe(false);
  });

  it('preserves an explicitly new empty conversation and falls back to latest only without a preference', async () => {
    const props = { scope: 'library-3', loadLatest: vi.fn(async () => 'last-chat'), restore: vi.fn(async () => true) };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = mount(props); });
    expect(loadAgentSessionSelection('library-3')).toBe('last-chat');
    act(() => latest.select(null));
    act(() => renderer.unmount());
    props.restore.mockClear(); props.loadLatest.mockClear();
    await act(async () => { mount(props); });
    expect(props.restore).not.toHaveBeenCalled();
    expect(props.loadLatest).not.toHaveBeenCalled();
    expect(latest.loading).toBe(false);
  });

  it('keeps failed recovery selected and allows retry instead of silently starting a new chat', async () => {
    saveAgentSessionSelection('library-3', 'saved-chat');
    const props = { scope: 'library-3', loadLatest: vi.fn(async () => null), restore: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) };
    await act(async () => { mount(props); });
    expect(latest.failed).toBe(true);
    expect(loadAgentSessionSelection('library-3')).toBe('saved-chat');
    await act(async () => { latest.retry(); });
    expect(latest.failed).toBe(false);
    expect(props.restore).toHaveBeenCalledTimes(2);
  });

  it('does not abandon in-flight recovery when callback identities change', async () => {
    let resolve!: (id: string) => void;
    const props = { scope: 'library-3', loadLatest: vi.fn(() => new Promise<string>(done => { resolve = done; })), restore: vi.fn(async () => true) };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = mount(props); });
    await act(async () => { renderer.update(<Probe {...props} loadLatest={async () => 'wrong-chat'} restore={async () => false} />); });
    await act(async () => { resolve('correct-chat'); });
    expect(props.restore).toHaveBeenCalledWith('correct-chat');
    expect(latest.failed).toBe(false);
    expect(latest.loading).toBe(false);
  });

  it('rejects late results after a scope switch and retries after mount/cleanup replay', async () => {
    let resolve!: (id: string) => void;
    const oldRestore = vi.fn(async () => true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = mount({ scope: 'old', loadLatest: () => new Promise<string>(done => { resolve = done; }), restore: oldRestore }); });
    saveAgentSessionSelection('new', 'new-chat');
    const restore = vi.fn(async () => true);
    await act(async () => { renderer.update(<Probe scope="new" loadLatest={async () => null} restore={restore} />); });
    await act(async () => { resolve('old-chat'); });
    expect(oldRestore).not.toHaveBeenCalled();
    expect(loadAgentSessionSelection('new')).toBe('new-chat');
    expect(latest.loading).toBe(false);
    act(() => renderer.unmount());
    restore.mockClear();
    act(() => { renderer = mount({ scope: 'new', loadLatest: async () => null, restore }); });
    act(() => renderer.unmount());
    await act(async () => { mount({ scope: 'new', loadLatest: async () => null, restore }); });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(latest.loading).toBe(false);
  });
});
