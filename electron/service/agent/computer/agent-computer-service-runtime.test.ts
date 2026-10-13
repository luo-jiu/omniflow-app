import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerRuntimeDependencies } from './agent-computer-runtime';
import type { AgentComputerWindowIndicatorLease, AgentComputerWindowIndicatorRequest } from '../../../platform/computer-use/window-indicator';
import { resolveComputerPointerAccent } from '../../../../src/shared/computer-use/pointer-appearance';

const mocks = vi.hoisted(() => ({ show: vi.fn(), create: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {}, webContents: {} }));
vi.mock('../../../platform/computer-use', () => ({
  captureAgentComputerWindow: vi.fn(), clickAgentComputerPoint: vi.fn(), getAgentComputerWindows: vi.fn(),
  getAgentComputerWindowTarget: vi.fn(), requestAgentComputerClickPermission: vi.fn(), statusAgentComputerClick: vi.fn(),
  setAgentComputerText: vi.fn(), scrollAgentComputerControl: vi.fn(), getAgentComputerWindowInputStatus: vi.fn(),
  inputAgentComputerWindow: vi.fn(), showAgentComputerWindowIndicator: mocks.show,
}));
vi.mock('../agent-attachment-runtime', () => ({ getAgentAttachmentStore: vi.fn() }));
vi.mock('./agent-computer-runtime', () => ({ createAgentComputerRuntime: mocks.create.mockReturnValue({ releaseRun: vi.fn() }) }));
vi.mock('./agent-computer-rendering-service-runtime', () => ({ agentRenderingLeases: { keepOwnerRendering: vi.fn(), keepApprovedWindowRendering: vi.fn() } }));
vi.mock('./agent-first-party-controls', () => ({ agentFirstPartyControls: { releaseRun: vi.fn() } }));
import { configureAgentComputerAppearance } from './agent-computer-service-runtime';

const indicatePointer = (mocks.create.mock.calls[0][0] as AgentComputerRuntimeDependencies).indicatePointer!;
const request: AgentComputerWindowIndicatorRequest = {
  window: { windowId: 10, pid: 20, processStartedAt: 100, layer: 0, bounds: { x: 0, y: 0, width: 300, height: 200 } },
  operation: 'click', point: { x: 40, y: 50 },
};

afterEach(() => { configureAgentComputerAppearance(() => undefined); vi.clearAllMocks(); });

describe('Agent pointer appearance projection', () => {
  it('reads the current accent for startup and each update without replacing lease state', async () => {
    let accent: string | undefined = '#abc';
    configureAgentComputerAppearance(() => accent);
    const native: AgentComputerWindowIndicatorLease = {
      shown: true, closed: Promise.resolve(true), dispose: vi.fn(), update: vi.fn().mockResolvedValue(true),
    };
    mocks.show.mockResolvedValue(native);
    const signal = new AbortController().signal;
    const lease = await indicatePointer({ ...request, accentColor: '#ff0000' }, signal);
    expect(mocks.show).toHaveBeenCalledWith({ ...request, accentColor: '#aabbcc' }, signal);
    expect(lease.closed).toBe(native.closed);
    expect(lease.shown).toBe(true);
    native.shown = false;
    expect(lease.shown).toBe(false);
    accent = 'rgb(10, 120, 200)';
    const next = { ...request, point: { x: 70, y: 60 } };
    expect(await lease.update!(next)).toBe(true);
    expect(native.update).toHaveBeenLastCalledWith({ ...next, accentColor: '#0a78c8' });
    accent = undefined;
    await lease.update!(next);
    expect(native.update).toHaveBeenLastCalledWith({ ...next, accentColor: resolveComputerPointerAccent() });
    lease.dispose();
    expect(native.dispose).toHaveBeenCalledOnce();
  });

  it('does not add update support to a lease that has none', async () => {
    const native = { shown: false, closed: Promise.resolve(true), dispose: vi.fn() };
    mocks.show.mockResolvedValue(native);
    const lease = await indicatePointer(request, new AbortController().signal);
    expect(lease.update).toBeUndefined();
    expect(lease.shown).toBe(false);
    expect(lease.closed).toBe(native.closed);
  });
});
