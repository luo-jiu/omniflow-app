import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ importAgentAttachment: vi.fn(), discardAgentAttachment: vi.fn(async () => undefined) }));
vi.mock('../services/agent.api', () => mocks);
import { useAgentAttachments } from './useAgentAttachments';
const scope = { ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' }, libraryId: 3 };
let state: ReturnType<typeof useAgentAttachments>;
let renderer: TestRenderer.ReactTestRenderer;
function Probe({ libraryId = 3 }: { libraryId?: number }) { state = useAgentAttachments({ ...scope, libraryId }); return null; }
function file(name: string): File { return { name, size: 1, arrayBuffer: async () => new Uint8Array([97]).buffer } as File; }
function attachment(name: string) { return { id: name, name, kind: 'text', mimeType: 'text/plain', sizeBytes: 1 }; }
afterEach(() => { act(() => renderer?.unmount()); vi.resetAllMocks(); });
describe('composer attachment queue', () => {
  it('retains paste order despite out-of-order imports, and restores attachments after a failed submission', async () => {
    const pending: Record<string, (value: unknown) => void> = {};
    mocks.importAgentAttachment.mockImplementation(input => new Promise(resolve => { pending[input.name] = resolve; }));
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    await act(async () => { state.add([file('a'), file('b')]); });
    expect(state.ready).toBe(false);
    await act(async () => pending.b(attachment('b')));
    expect(state.entries.map(item => item.name)).toEqual(['a', 'b']);
    await act(async () => pending.a(attachment('a')));
    expect(state.ready).toBe(true);
    let taken: typeof state.entries = [];
    act(() => { taken = state.take(); });
    expect(state.entries).toHaveLength(0);
    act(() => state.restore(taken));
    expect(state.entries.map(item => item.attachment?.id)).toEqual(['a', 'b']);
  });
  it('cleans late imports after removal and library changes', async () => {
    let finish!: (value: unknown) => void;
    mocks.importAgentAttachment.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    await act(async () => { state.add([file('removed')]); });
    act(() => state.remove(state.entries[0].key));
    await act(async () => finish(attachment('removed')));
    expect(state.entries).toHaveLength(0);
    expect(mocks.discardAgentAttachment).toHaveBeenCalledWith(expect.objectContaining({ id: 'removed', libraryId: 3 }));
    await act(async () => state.add([file('old-library')])) ;
    await act(async () => { renderer.update(<Probe libraryId={4} />); });
    await act(async () => finish(attachment('old-library')));
    expect(state.entries).toHaveLength(0);
    expect(mocks.discardAgentAttachment).toHaveBeenCalledWith(expect.objectContaining({ id: 'old-library', libraryId: 3 }));
  });
});
