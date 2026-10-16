import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerRuntimeDependencies } from './agent-computer-runtime';
import type { AgentComputerWindowIndicatorLease, AgentComputerWindowIndicatorRequest } from '../../../platform/computer-use/window-indicator';
import { resolveComputerPointerAccent } from '../../../../src/shared/computer-use/pointer-appearance';

const mocks = vi.hoisted(() => ({ show: vi.fn(), create: vi.fn(), release: vi.fn(), releaseFirstParty: vi.fn(), inputSession: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {}, webContents: {} }));
vi.mock('../../../platform/computer-use', () => ({
  captureAgentComputerWindow: vi.fn(), captureAgentComputerWindowWithPointer: vi.fn(), clickAgentComputerPoint: vi.fn(), getAgentComputerWindows: vi.fn(),
  getAgentComputerWindowTarget: vi.fn(), requestAgentComputerClickPermission: vi.fn(), statusAgentComputerClick: vi.fn(),
  setAgentComputerText: vi.fn(), scrollAgentComputerControl: vi.fn(), getAgentComputerWindowInputStatus: vi.fn(),
  inputAgentComputerWindow: vi.fn(), showAgentComputerWindowIndicator: mocks.show,
}));
vi.mock('../../../platform/computer-use/window-menu', () => ({ createAgentComputerMenuSession: vi.fn() }));
vi.mock('../../../platform/computer-use/window-input-session', () => ({ createAgentComputerWindowInputSession: mocks.inputSession }));
vi.mock('../agent-attachment-runtime', () => ({ getAgentAttachmentStore: vi.fn() }));
vi.mock('./agent-computer-runtime', () => ({ createAgentComputerRuntime: mocks.create.mockReturnValue({ releaseRun: mocks.release }) }));
vi.mock('./agent-computer-rendering-service-runtime', () => ({ agentRenderingLeases: { keepOwnerRendering: vi.fn(), keepApprovedWindowRendering: vi.fn() } }));
vi.mock('./agent-first-party-controls', () => ({ agentFirstPartyControls: { releaseRun: mocks.releaseFirstParty } }));
import { configureAgentComputerAppearance, releaseAgentComputerRun } from './agent-computer-service-runtime';

const runtimeDependencies = mocks.create.mock.calls[0][0] as AgentComputerRuntimeDependencies;
const indicatePointer = runtimeDependencies.indicatePointer!;
const request: AgentComputerWindowIndicatorRequest = {
  window: { windowId: 10, pid: 20, processStartedAt: 100, layer: 0, bounds: { x: 0, y: 0, width: 300, height: 200 } },
  operation: 'click', point: { x: 40, y: 50 },
};

afterEach(() => { configureAgentComputerAppearance(() => undefined); vi.clearAllMocks(); mocks.release.mockReset(); });

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

  it('does not add update or graceful hide support to a lease that has neither', async () => {
    const native = { shown: false, closed: Promise.resolve(true), dispose: vi.fn() };
    mocks.show.mockResolvedValue(native);
    const lease = await indicatePointer(request, new AbortController().signal);
    expect(lease.update).toBeUndefined();
    expect(lease.syncTarget).toBeUndefined();
    expect(lease.hide).toBeUndefined();
    expect(lease.shown).toBe(false);
    expect(lease.closed).toBe(native.closed);
  });
  it('preserves the native receiver for graceful hiding and retains the actual close receipt', async () => {
    const native = { shown: true, closed: Promise.resolve(true), dispose: vi.fn(),
      hide: vi.fn(function (this: unknown) { expect(this).toBe(native); native.shown = false; }),
    };
    mocks.show.mockResolvedValue(native);
    const lease = await indicatePointer(request, new AbortController().signal);
    lease.hide!();
    expect(native.hide).toHaveBeenCalledOnce();
    expect(native.dispose).not.toHaveBeenCalled();
    expect(lease.shown).toBe(false);
    expect(lease.closed).toBe(native.closed);
  });
  it('preserves the native receiver for target synchronization, feedback, settlement and snapshots', async () => {
    const native = { shown: true, closed: Promise.resolve(true), dispose: vi.fn(),
      pointerEvent: vi.fn(function (this: unknown) { expect(this).toBe(native); }),
      inputSettled: vi.fn(function (this: unknown) { expect(this).toBe(native); }),
      snapshot: vi.fn(function (this: unknown) { expect(this).toBe(native); return Promise.resolve(request.window); }),
      syncTarget: vi.fn(function (this: unknown) { expect(this).toBe(native); return Promise.resolve(true); }),
    };
    mocks.show.mockResolvedValue(native);
    const lease = await indicatePointer(request, new AbortController().signal);
    const event = { phase: 'down' as const, point: request.point };
    lease.pointerEvent!(event); lease.inputSettled!();
    await expect(lease.snapshot!()).resolves.toEqual(request.window);
    await expect(lease.syncTarget!(request.window)).resolves.toBe(true);
    expect(native.syncTarget).toHaveBeenCalledWith(request.window);
    expect(native.pointerEvent).toHaveBeenCalledWith(event); expect(native.inputSettled).toHaveBeenCalledOnce();
  });
});

describe('Agent computer Run cleanup', () => {
  it('wires the persistent input factory into the production runtime without replacing its signal or close receipt', async () => {
    const signal = new AbortController().signal;
    const target = { ...request.window, applicationLabel: 'QA', windowLabel: 'QA' };
    const closed = Promise.resolve(true);
    const lease = { input: vi.fn(), close: vi.fn(), dispose: vi.fn(), closed };
    mocks.inputSession.mockResolvedValueOnce(lease);
    expect(runtimeDependencies.inputSession).toBe(mocks.inputSession);
    const received = await runtimeDependencies.inputSession!(target, signal);
    expect(mocks.inputSession).toHaveBeenCalledOnce();
    expect(mocks.inputSession).toHaveBeenCalledWith(target, signal);
    expect(received).toBe(lease);
    expect(received.closed).toBe(closed);
  });

  it.each(['normal', 'immediate'] as const)('revokes first-party controls synchronously while %s cleanup awaits native closure', async mode => {
    let resolveClosed!: () => void;
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    mocks.release.mockReturnValueOnce(closed);
    const result = releaseAgentComputerRun('run-pending', mode);
    expect(mocks.release).toHaveBeenCalledWith('run-pending', mode);
    expect(mocks.releaseFirstParty).toHaveBeenCalledWith('run-pending');
    expect(result).toBe(closed);
    let settled = false;
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveClosed();
    await result;
    expect(settled).toBe(true);
  });

  it('defaults to immediate cleanup without replacing the native completion Promise', async () => {
    const closed = Promise.resolve();
    mocks.release.mockReturnValueOnce(closed);
    const result = releaseAgentComputerRun('run-default');
    expect(mocks.release).toHaveBeenCalledWith('run-default', 'immediate');
    expect(mocks.releaseFirstParty).toHaveBeenCalledWith('run-default');
    expect(result).toBe(closed);
    await result;
  });

});
