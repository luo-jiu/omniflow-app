import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), list: vi.fn(), diff: vi.fn() }));
vi.mock('../service/agent/agent-orchestrator', () => ({ agentOrchestrator: {
  prepareFileChange: mocks.prepare, listFileChanges: mocks.list, readFileDiff: mocks.diff,
} }));
vi.mock('../service/agent/agent-attachment-runtime', () => ({ getAgentAttachmentStore: vi.fn() }));
vi.mock('../service/agent/shell/agent-shell-settings-store', () => ({ agentShellSettingsStore: {} }));
vi.mock('../service/agent/agent-file-authority-broker', () => ({ agentFileAuthorityBroker: {} }));
vi.mock('../service/agent/computer/agent-first-party-controls', () => ({
  configureAgentFirstPartyControls: vi.fn(), agentFirstPartyControls: {},
}));
vi.mock('../service/agent/computer/agent-workspace-rendering', () => ({
  configureAgentWorkspaceRendering: vi.fn(), agentWorkspaceRendering: {},
}));
import { registerAgentIpc } from './agent';

function fixture() {
  const contents = Object.assign(new EventEmitter(), { id: 17, isDestroyed: () => false, mainFrame: { processId: 88, routingId: 2 } });
  vi.spyOn(contents, 'once');
  const main = { webContents: contents, isDestroyed: () => false };
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>();
  const ipcMain = { handle: (channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => unknown) => { handlers.set(channel, handler); } } as unknown as IpcMain;
  registerAgentIpc(ipcMain, { getMainWindow: () => main as unknown as BrowserWindow });
  const event = { sender: contents as unknown as WebContents, senderFrame: contents.mainFrame } as unknown as IpcMainInvokeEvent;
  return { handlers, event, contents };
}
beforeEach(() => { vi.clearAllMocks(); });

describe('Agent file change IPC', () => {
  it('privately prepares snapshots under the original sender and returns only an acknowledgment', async () => {
    const f = fixture();
    mocks.prepare.mockResolvedValue(undefined);
    const input = { executionId: 'execution', snapshot: { beforeBase64: 'private-before', afterBase64: 'private-after' } };
    expect(await f.handlers.get('agent:file-change:prepare')!(f.event, input)).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledWith(17, input);
    expect(f.contents.once).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });
  it('propagates prepare rejection so no target mutation may proceed', async () => {
    const f = fixture();
    mocks.prepare.mockRejectedValue(new Error('wrong owner or quota exceeded'));
    await expect(f.handlers.get('agent:file-change:prepare')!(f.event, {})).rejects.toThrow('wrong owner');
  });
  it('routes list and local diff through the scope-checked orchestrator', async () => {
    const f = fixture();
    const input = { sessionId: 'session', libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'backend' } };
    f.handlers.get('agent:file-changes:list')!(f.event, { ...input, runIds: ['run'] });
    await f.handlers.get('agent:file-change:diff')!(f.event, { ...input, changeId: 'change' });
    expect(mocks.list).toHaveBeenCalledWith({ ...input, runIds: ['run'] });
    expect(mocks.diff).toHaveBeenCalledWith({ ...input, changeId: 'change' }, expect.any(AbortSignal));
  });
  it.each(['agent:file-change:prepare', 'agent:file-changes:list', 'agent:file-change:diff', 'agent:file-change:diff:cancel'])('denies untrusted frame/window access to %s', async channel => {
    const f = fixture();
    for (const event of [
      { ...f.event, senderFrame: null },
      { ...f.event, senderFrame: { ...f.contents.mainFrame } },
      { ...f.event, sender: { ...f.contents } },
    ]) {
      await expect(async () => f.handlers.get(channel)!(event as IpcMainInvokeEvent, {})).rejects.toThrow('无权访问内置 Agent');
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.diff).not.toHaveBeenCalled();
  });
});
