import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.removeListener } }));
import './preload';

beforeEach(() => { mocks.invoke.mockReset(); });

describe('Agent file change preload channels', () => {
  it('keeps private snapshot prepare and local Diff reads on their explicit channels', async () => {
    const bridge = mocks.expose.mock.calls.find(call => call[0] === 'electronAgent')![1];
    const input = { executionId: 'bound-execution', snapshot: { afterBase64: 'private' } };
    mocks.invoke.mockResolvedValue(true);
    await expect(bridge.prepareFileChange(input)).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('agent:file-change:prepare', input);
    const list = { sessionId: 's', runIds: ['r'] };
    await bridge.listFileChanges(list);
    expect(mocks.invoke).toHaveBeenLastCalledWith('agent:file-changes:list', list);
    const diff = { sessionId: 's', changeId: 'change' };
    await bridge.readFileDiff(diff);
    expect(mocks.invoke).toHaveBeenLastCalledWith('agent:file-change:diff', diff);
    const cancel = { sessionId: 's', requestId: 'controlled-request' };
    await bridge.cancelFileDiff(cancel);
    expect(mocks.invoke).toHaveBeenLastCalledWith('agent:file-change:diff:cancel', cancel);
    expect(mocks.invoke.mock.calls.every(call => !String(call[0]).startsWith('agent:tool:'))).toBe(true);
  });
});
