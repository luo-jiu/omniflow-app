import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerAgentIpc } from './agent';

const mocks = vi.hoisted(() => ({
  configure: vi.fn(), register: vi.fn(), unregister: vi.fn(), releaseOwner: vi.fn(),
  releaseRunOwner: vi.fn(), releaseFileOwner: vi.fn(), releaseControlOwner: vi.fn(), configureControls: vi.fn(),
}));
vi.mock('../service/agent/computer/agent-workspace-rendering', () => ({
  configureAgentWorkspaceRendering: mocks.configure,
  agentWorkspaceRendering: { register: mocks.register, unregister: mocks.unregister, releaseOwner: mocks.releaseOwner },
}));
vi.mock('../service/agent/agent-orchestrator', () => ({ agentOrchestrator: { releaseOwner: mocks.releaseRunOwner } }));
vi.mock('../service/agent/agent-attachment-runtime', () => ({ getAgentAttachmentStore: vi.fn() }));
vi.mock('../service/agent/shell/agent-shell-settings-store', () => ({ agentShellSettingsStore: {} }));
vi.mock('../service/agent/agent-file-authority-broker', () => ({ agentFileAuthorityBroker: { releaseOwner: mocks.releaseFileOwner } }));
vi.mock('../service/agent/computer/agent-first-party-controls', () => ({
  configureAgentFirstPartyControls: mocks.configureControls,
  agentFirstPartyControls: { releaseOwner: mocks.releaseControlOwner },
}));

function fixture() {
  vi.clearAllMocks();
  const contents = { id: 17, isDestroyed: vi.fn(() => false), mainFrame: { processId: 88, routingId: 2 } };
  const main = { webContents: contents, isDestroyed: vi.fn(() => false) };
  const getMainWindow = vi.fn<() => BrowserWindow | null>(() => main as unknown as BrowserWindow);
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown>();
  const ipcMain = { handle: vi.fn((channel, handler) => { handlers.set(channel, handler); }) } as unknown as IpcMain;
  registerAgentIpc(ipcMain, { getMainWindow });
  const event = { sender: contents as unknown as WebContents, senderFrame: contents.mainFrame } as unknown as IpcMainInvokeEvent;
  function invoke(channel: 'register' | 'unregister', input: unknown, caller = event) {
    return handlers.get(`agent:workspace-rendering:${channel}`)!(caller, input);
  }
  return { contents, main, getMainWindow, handlers, event, invoke };
}

describe('Workspace drawing IPC boundary', () => {
  it('registers and unregisters through the trusted main frame and finite rendering manager', () => {
    const f = fixture();
    const input = { instanceId: '11111111-1111-4111-8111-111111111111', ownerScope: { accountScope: 'qa-account', backendScope: 'qa-backend' }, libraryId: 3 };
    const token = { registrationId: '22222222-2222-4222-8222-222222222222', documentGeneration: '33333333-3333-4333-8333-333333333333' };
    mocks.register.mockReturnValueOnce(token);
    mocks.unregister.mockReturnValueOnce(true);
    expect(f.invoke('register', input)).toEqual(token);
    expect(mocks.configure).toHaveBeenCalledWith(f.getMainWindow);
    expect(mocks.register).toHaveBeenCalledWith(f.contents, f.contents.mainFrame, input);
    expect(f.invoke('unregister', token)).toBe(true);
    expect(mocks.unregister).toHaveBeenCalledWith(17, f.contents.mainFrame, token);
    expect(mocks.releaseRunOwner).not.toHaveBeenCalled();
    expect(mocks.releaseControlOwner).not.toHaveBeenCalled();
  });

  it.each(['different-window', 'child-frame', 'null-frame', 'missing-window', 'destroyed-window', 'destroyed-contents'] as const)(
    'refuses a %s sender before reaching either rendering handler', cause => {
      const f = fixture();
      let caller = f.event;
      if (cause === 'different-window') caller = { ...f.event, sender: { ...f.contents } as unknown as WebContents };
      if (cause === 'child-frame') caller = { ...f.event, senderFrame: { ...f.contents.mainFrame } as IpcMainInvokeEvent['senderFrame'] };
      if (cause === 'null-frame') caller = { ...f.event, senderFrame: null as unknown as IpcMainInvokeEvent['senderFrame'] };
      if (cause === 'missing-window') f.getMainWindow.mockReturnValue(null);
      if (cause === 'destroyed-window') f.main.isDestroyed.mockReturnValue(true);
      if (cause === 'destroyed-contents') f.contents.isDestroyed.mockReturnValue(true);
      expect(() => f.invoke('register', {}, caller)).toThrow('无权访问内置 Agent');
      expect(() => f.invoke('unregister', {}, caller)).toThrow('无权访问内置 Agent');
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.unregister).not.toHaveBeenCalled();
    });

  it('owner release drains the independent drawing registration with the existing owner cleanup', () => {
    const f = fixture();
    expect(f.handlers.get('agent:owner:release')!(f.event)).toBe(true);
    expect(mocks.releaseOwner).toHaveBeenCalledOnce();
    expect(mocks.releaseOwner).toHaveBeenCalledWith(17);
    expect(mocks.releaseRunOwner).toHaveBeenCalledWith(17);
    expect(mocks.releaseFileOwner).toHaveBeenCalledWith(17);
    expect(mocks.releaseControlOwner).toHaveBeenCalledWith(17);
  });
});
