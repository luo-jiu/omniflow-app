import { describe, expect, it, vi } from 'vitest';
import { createAgentComputerRuntime, type AgentComputerRuntimeDependencies } from './agent-computer-runtime';
import { AgentComputerMenuSessionCloseError, type AgentComputerMenuObservation,
  type AgentComputerMenuSessionLease } from '../../../platform/computer-use/window-menu';
import { AgentComputerInputError, type AgentComputerSharedWindow, type AgentComputerWindowIdentity } from '../../../platform/computer-use';
import type { AgentComputerWindowIndicatorLease } from '../../../platform/computer-use/window-indicator';
import type { AgentAttachment } from '../../../../src/shared/agent/agent-attachments';
import type { AgentMainCommitSettlement, AgentToolMainPreparationContext, AgentToolMainPreparationIdentity,
  AgentToolMainPreparationResult, AgentToolMainPreparedExecution } from '../agent-tool-registry';

vi.mock('../../../platform/computer-use', () => ({
  AgentComputerInputError: class extends Error {
    constructor(message: string, readonly dispatchState: 'not-dispatched' | 'unknown') { super(message); }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function fixture() {
  const controller = new AbortController();
  const identity: AgentToolMainPreparationIdentity = {
    aiDestinationIdentity: `v1:${'a'.repeat(64)}`, callId: 'call', libraryId: 3,
    ownerScope: { accountScope: 'user:7', backendScope: 'http://localhost:9000' }, ownerWebContentsId: 17,
    preparedActionId: 'prepared', runCapabilityIdentity: `v2:${'b'.repeat(64)}`, runId: 'run-1', sessionId: 'session-1',
    toolInputHash: `v1:${'c'.repeat(64)}`, toolName: 'computer.observe', toolRegistrationId: 'builtin:computer.observe@1', toolRunId: 'tool-observe',
  };
  const context: AgentToolMainPreparationContext = {
    preparationIdentity: identity, ownerScope: identity.ownerScope, ownerWebContentsId: identity.ownerWebContentsId,
    appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
    aiDestination: { identity: identity.aiDestinationIdentity, configurationIdentity: `v1:${'d'.repeat(64)}`,
      model: 'gpt-5.5', profileId: 'profile', profileLabel: 'Fixture AI', providerType: 'openai' },
    runCapabilitySnapshot: {} as AgentToolMainPreparationContext['runCapabilitySnapshot'], signal: controller.signal,
  };
  const window: AgentComputerSharedWindow = { windowId: 24, pid: 800, processStartedAt: 1770000000000, layer: 0,
    bounds: { x: 100, y: 100, width: 800, height: 600 }, title: 'Fixture', applicationLabel: 'Fixture App', windowLabel: 'Fixture' };
  let currentWindow = structuredClone(window);
  let clock = 1000;
  const native: AgentComputerMenuObservation = { observationId: 'private-native-observation',
    items: [{ itemId: 'private-native-item', role: 'AXMenuItem', label: 'More options',
      bounds: { x: 890, y: 200, width: 160, height: 30 }, operations: ['open', 'press'] }],
    axTree: 'AXMenu\n  AXMenuItem More options', truncated: false,
    menus: [{ bounds: { x: 880, y: 180, width: 180, height: 200 } }] };
  const closed = deferred<boolean>();
  const lease = {
    observe: vi.fn<AgentComputerMenuSessionLease['observe']>(async () => structuredClone(native)),
    resolvePointer: vi.fn<AgentComputerMenuSessionLease['resolvePointer']>(async () => ({ available: false, reason: 'menu_surface_unavailable' })),
    action: vi.fn<AgentComputerMenuSessionLease['action']>(async (_request, _signal, dispatched) => { dispatched?.(); }),
    capture: vi.fn<AgentComputerMenuSessionLease['capture']>(async () => ({ available: false, reason: 'menu_surface_unavailable' })),
    captureWindow: vi.fn<AgentComputerMenuSessionLease['captureWindow']>(async () => ({ png: Buffer.from('session-window-png'),
      cursorIncluded: false, captureMethod: 'independent-window' })),
    close: vi.fn(() => closed.resolve(true)), closed: closed.promise,
  };
  const attachment: AgentAttachment = { id: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68', name: 'Menu.png', kind: 'image',
    mimeType: 'image/png', sizeBytes: 1024, width: 960, height: 600 };
  const images = { import: vi.fn(async () => ({ ...attachment })), bind: vi.fn(async (_scope: unknown, ids: readonly string[]) => [...ids]),
    rollbackBinding: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) };
  const dependencies = {
    windows: vi.fn(async () => ({ windows: [structuredClone(currentWindow)], truncated: false })), ownerWindowId: () => 24,
    capture: vi.fn(async () => Buffer.from('root-png')), targets: vi.fn(async () => ({ target: { ...currentWindow, candidates: [] }, truncated: false })),
    click: vi.fn(async () => undefined), setText: vi.fn(async () => undefined), scroll: vi.fn(async () => undefined),
    clickStatus: vi.fn(async () => ({ available: true })), requestClickPermission: vi.fn(async () => undefined),
    images: () => images, menuSession: vi.fn<NonNullable<AgentComputerRuntimeDependencies['menuSession']>>(async () => lease), now: () => clock,
    indicatePointer: undefined as AgentComputerRuntimeDependencies['indicatePointer'],
    captureWithPointer: vi.fn<NonNullable<AgentComputerRuntimeDependencies['captureWithPointer']>>(async () => ({ png: Buffer.from('root-with-pointer'), cursorIncluded: true })),
  };
  const runtime = createAgentComputerRuntime(dependencies);
  const execution = (prepared: AgentToolMainPreparationResult, toolName = 'computer.observe'): AgentToolMainPreparedExecution => ({
    identity: { ...identity, toolName, toolRegistrationId: `builtin:${toolName}@1`, toolRunId: `tool-${toolName}` },
    publicAction: prepared.publicAction, binding: prepared.binding, preparedActionId: identity.preparedActionId, snapshotHash: 'a'.repeat(64),
  });
  type Data = { observationId: string; targetId: string; elements: Array<{ elementId: string; label: string; menuOperations: string[] }>;
    menuReady: boolean; menuCapture?: string; imageId?: string; axTree?: string; cursorIncluded?: boolean };
  const observe = async (input: Parameters<typeof runtime.prepareObserve>[0] = { scope: 'menu' }) => {
    const preparation = await runtime.prepareObserve(input, context);
    const result = await runtime.observe(execution(preparation), controller.signal);
    return { preparation, result, data: result.data as Data };
  };
  const prepareMenu = async (data: Data, operation: 'open' | 'press' | 'cancel' = 'press') => execution(
    await runtime.prepareMenu({ observationId: data.observationId, elementId: data.elements[0].elementId, operation }, context), 'computer.menu');
  const commit: AgentMainCommitSettlement = { begin: vi.fn(), settle: vi.fn() };
  return { controller, identity, context, window, native, closed, lease, images, dependencies, runtime, execution, observe, prepareMenu, commit,
    advance: (amount: number) => { clock += amount; }, setWindow: (next: AgentComputerSharedWindow) => { currentWindow = next; } };
}

function pointerFixture(f: ReturnType<typeof fixture>) {
  const surface: AgentComputerWindowIdentity = { ...f.window, windowId: 25, layer: 101,
    bounds: { x: 880, y: 180, width: 180, height: 200 } };
  const pointerWindow: AgentComputerWindowIdentity = { ...f.window, windowId: 90, pid: 900, layer: 102,
    bounds: { x: 970, y: 215, width: 36, height: 36 } };
  const closed = deferred<boolean>();
  const visual = {
    shown: true, closed: closed.promise,
    update: vi.fn<NonNullable<AgentComputerWindowIndicatorLease['update']>>(async () => true),
    snapshot: vi.fn<NonNullable<AgentComputerWindowIndicatorLease['snapshot']>>(async () => structuredClone(pointerWindow)),
    dispose: vi.fn(() => closed.resolve(true)),
  };
  f.dependencies.indicatePointer = vi.fn(async () => visual);
  const resolved = { available: true as const, observationId: f.native.observationId, itemId: f.native.items[0].itemId,
    point: { x: 970, y: 215 }, menuSurface: surface };
  f.lease.resolvePointer.mockResolvedValue(resolved);
  return { surface, pointerWindow, closed, visual, resolved };
}

describe('associated menu runtime', () => {
  it('uses AX by default and exposes fresh public IDs without native tokens, bounds or surface identity', async () => {
    const f = fixture();
    const first = await f.observe();
    expect(first.preparation.publicAction).toMatchObject({ kind: 'computer.observe', scope: 'menu', mode: 'ax', menuOperations: ['open', 'press', 'cancel'] });
    expect(first.data).toMatchObject({ menuReady: true, elements: [{ label: 'More options', menuOperations: ['open', 'press'] }] });
    expect(JSON.stringify(first.result)).not.toMatch(/private-native|windowId|processStartedAt|itemId|"bounds"/);
    expect(f.lease.capture).not.toHaveBeenCalled();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    const second = await f.observe();
    expect(second.data.observationId).not.toBe(first.data.observationId);
    expect(second.data.elements[0].elementId).not.toBe(first.data.elements[0].elementId);
    expect(f.dependencies.menuSession).toHaveBeenCalledOnce();
    await expect(f.prepareMenu(first.data)).rejects.toThrow(/过期/);
  });
  it('executes exactly the frozen menu operation with main commit settlement, then requires a fresh observation', async () => {
    const f = fixture();
    const { data } = await f.observe();
    const prepared = await f.prepareMenu(data, 'open');
    expect(prepared.publicAction).toMatchObject({ kind: 'computer.menu', elementLabel: 'More options', operation: 'open' });
    expect(JSON.stringify(prepared.publicAction)).not.toContain('private-native');
    const result = await f.runtime.menu(prepared, f.controller.signal, f.commit);
    expect(f.lease.action).toHaveBeenCalledWith({ observationId: 'private-native-observation', itemId: 'private-native-item', operation: 'open' }, f.controller.signal, expect.any(Function));
    expect(f.commit.begin).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mutationCommitState: 'commit_unknown' }) }));
    expect(f.commit.settle).toHaveBeenCalledWith(result);
    expect(result).toMatchObject({ ok: true, data: { menuOperation: 'open', elementLabel: 'More options', dispatchState: 'dispatched', retryAllowed: false } });
    await expect(f.runtime.menu(prepared, f.controller.signal, f.commit)).rejects.toThrow(/一次操作/);
    const refreshed = await f.observe();
    await expect(f.runtime.menu(await f.prepareMenu(refreshed.data), f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
    expect(f.lease.action).toHaveBeenCalledTimes(2);
  });
  it('previews a private menu position outside the grant window without changing its public action or input binding', async () => {
    const f = fixture(); const pointer = pointerFixture(f); const { data } = await f.observe();
    const prepared = await f.prepareMenu(data);
    expect(f.lease.resolvePointer).not.toHaveBeenCalled(); expect(f.dependencies.indicatePointer).not.toHaveBeenCalled();
    f.lease.action.mockImplementation(async (_request, _signal, dispatched) => {
      expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce();
      expect(f.commit.begin).toHaveBeenCalledOnce(); dispatched?.();
    });
    const result = await f.runtime.menu(prepared, f.controller.signal, f.commit);
    expect(f.lease.resolvePointer).toHaveBeenCalledWith({ observationId: f.native.observationId,
      itemId: f.native.items[0].itemId, operation: 'press' }, f.controller.signal);
    expect(f.dependencies.indicatePointer).toHaveBeenCalledWith({ window: f.window, operation: 'click',
      point: pointer.resolved.point, menuSurface: pointer.surface }, expect.any(AbortSignal));
    expect(pointer.resolved.point.x).toBeGreaterThan(f.window.bounds.x + f.window.bounds.width);
    expect(JSON.stringify({ action: prepared.publicAction, result })).not.toMatch(/menuSurface|windowId|processStartedAt|private-native/);
    expect(result).toMatchObject({ ok: true, data: { dispatchState: 'dispatched' } });
    expect(pointer.visual.dispose).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('reuses one Run pointer across menu positions and back to a source control on the grant window', async () => {
    const f = fixture(); const pointer = pointerFixture(f);
    const first = await f.observe(); await f.runtime.menu(await f.prepareMenu(first.data), f.controller.signal, f.commit);
    f.native.items[0].bounds.y = 240;
    f.lease.resolvePointer.mockResolvedValue({ ...pointer.resolved, point: { x: 970, y: 255 } });
    const second = await f.observe(); await f.runtime.menu(await f.prepareMenu(second.data), f.controller.signal, f.commit);
    expect(pointer.visual.update).toHaveBeenLastCalledWith({ window: f.window, operation: 'click',
      point: { x: 970, y: 255 }, menuSurface: pointer.surface });
    f.native.items[0] = { ...f.native.items[0], role: 'AXButton', bounds: { x: 200, y: 200, width: 100, height: 30 } };
    f.lease.resolvePointer.mockResolvedValue({ available: true, observationId: f.native.observationId,
      itemId: f.native.items[0].itemId, point: { x: 250, y: 215 } });
    const source = await f.observe(); await f.runtime.menu(await f.prepareMenu(source.data), f.controller.signal, f.commit);
    expect(pointer.visual.update).toHaveBeenLastCalledWith({ window: f.window, operation: 'click', point: { x: 250, y: 215 } });
    expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce(); expect(pointer.visual.dispose).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('includes the owned menu pointer only through the native menu capture, never an ordinary window screenshot', async () => {
    const f = fixture(); const pointer = pointerFixture(f);
    const first = await f.observe(); await f.runtime.menu(await f.prepareMenu(first.data), f.controller.signal, f.commit);
    f.lease.capture.mockResolvedValue({ available: true, png: Buffer.from('canonical-menu-with-pointer'), width: 960, height: 600,
      bounds: { x: 100, y: 100, width: 960, height: 600 }, menuCapture: 'included', cursorIncluded: true });
    const menu = await f.observe({ scope: 'menu', mode: 'both' });
    expect(f.lease.capture).toHaveBeenCalledWith({ observationId: f.native.observationId,
      pointerWindow: pointer.pointerWindow }, f.controller.signal);
    expect(menu.data).toMatchObject({ cursorIncluded: true, menuCapture: 'included' });
    expect(f.images.import).toHaveBeenLastCalledWith(expect.objectContaining({ base64: Buffer.from('canonical-menu-with-pointer').toString('base64') }));
    pointer.visual.snapshot.mockClear();
    await f.observe({ mode: 'both' });
    expect(pointer.visual.snapshot).not.toHaveBeenCalled(); expect(f.dependencies.captureWithPointer).not.toHaveBeenCalled();
    expect(f.lease.captureWindow).toHaveBeenCalledWith({}, f.controller.signal);
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('keeps ordinary screenshot pixels on the active native session without renewing menu actions', async () => {
    const f = fixture(); const first = await f.observe();
    const result = await f.observe({ mode: 'both' });
    expect(f.lease.captureWindow).toHaveBeenCalledOnce();
    expect(f.lease.capture).not.toHaveBeenCalled();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.images.import).toHaveBeenCalledWith(expect.objectContaining({ base64: Buffer.from('session-window-png').toString('base64') }));
    expect(result.data).toMatchObject({ cursorIncluded: false });
    await expect(f.prepareMenu(first.data)).rejects.toThrow(/过期/);
    await f.observe();
    expect(f.dependencies.menuSession).toHaveBeenCalledOnce();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('passes only an ordinary in-window pointer to the shared capture owner', async () => {
    const f = fixture(); const pointer = pointerFixture(f);
    const inside = { ...pointer.pointerWindow, bounds: { x: 250, y: 215, width: 36, height: 36 } };
    pointer.visual.snapshot.mockResolvedValue(inside);
    f.lease.resolvePointer.mockResolvedValue({ available: true, observationId: f.native.observationId,
      itemId: f.native.items[0].itemId, point: { x: 250, y: 215 } });
    const first = await f.observe(); await f.runtime.menu(await f.prepareMenu(first.data), f.controller.signal, f.commit);
    f.lease.captureWindow.mockResolvedValue({ png: Buffer.from('session-pointer-png'), cursorIncluded: true, captureMethod: 'included-windows' });
    const result = await f.observe({ mode: 'both' });
    expect(f.lease.captureWindow).toHaveBeenCalledWith({ pointerWindow: inside }, f.controller.signal);
    expect(result.data.cursorIncluded).toBe(true);
    expect(f.dependencies.captureWithPointer).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('does not open a second capture process after a native session capture failure', async () => {
    const f = fixture(); await f.observe();
    f.lease.captureWindow.mockRejectedValue(new AgentComputerInputError('capture timeout', 'not-dispatched'));
    await expect(f.observe({ mode: 'both' })).rejects.toThrow('capture timeout');
    expect(f.lease.captureWindow).toHaveBeenCalledOnce();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.dependencies.captureWithPointer).not.toHaveBeenCalled();
    expect(f.images.import).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('discards an ordinary session capture that arrives after Run release', async () => {
    const f = fixture(); await f.observe();
    const pending = deferred<Awaited<ReturnType<AgentComputerMenuSessionLease['captureWindow']>>>();
    f.lease.captureWindow.mockReturnValue(pending.promise);
    const observing = f.observe({ mode: 'both' });
    const rejected = expect(observing).rejects.toThrow(/已结束/);
    await vi.waitFor(() => expect(f.lease.captureWindow).toHaveBeenCalledOnce());
    await f.runtime.releaseRun(f.identity.runId);
    pending.resolve({ png: Buffer.from('late-png'), cursorIncluded: false, captureMethod: 'independent-window' });
    await rejected;
    expect(f.images.import).not.toHaveBeenCalled();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
  });
  it('waits for old menu capture ownership to close before capturing changed window geometry', async () => {
    const f = fixture(); await f.observe(); f.lease.close.mockImplementation(() => undefined);
    f.setWindow({ ...f.window, bounds: { ...f.window.bounds, x: 120 } });
    const observing = f.observe({ mode: 'both' });
    await vi.waitFor(() => expect(f.lease.close).toHaveBeenCalledOnce());
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    f.closed.resolve(true); await observing;
    expect(f.dependencies.capture).toHaveBeenCalledOnce();
    expect(f.lease.captureWindow).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('blocks ordinary capture if prior native capture ownership did not close', async () => {
    const f = fixture(); await f.observe(); f.lease.close.mockImplementation(() => f.closed.resolve(false));
    await f.runtime.releaseRun(f.identity.runId);
    await expect(f.observe({ mode: 'both' })).rejects.toThrow(/关闭未确认/);
    expect(f.dependencies.capture).not.toHaveBeenCalled();
  });
  it('awaits removal of an old intent when the next menu position is unavailable, then preserves the AX action', async () => {
    const f = fixture(); const pointer = pointerFixture(f);
    const first = await f.observe(); await f.runtime.menu(await f.prepareMenu(first.data), f.controller.signal, f.commit);
    pointer.visual.dispose.mockImplementation(() => undefined);
    f.lease.resolvePointer.mockResolvedValue({ available: false, reason: 'menu_surface_unavailable' });
    f.lease.action.mockClear(); vi.mocked(f.commit.begin).mockClear();
    const next = await f.observe(); const running = f.runtime.menu(await f.prepareMenu(next.data), f.controller.signal, f.commit);
    await vi.waitFor(() => expect(pointer.visual.dispose).toHaveBeenCalledOnce());
    expect(f.lease.action).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
    pointer.closed.resolve(true);
    await expect(running).resolves.toMatchObject({ ok: true, data: { dispatchState: 'dispatched' } });
    expect(f.lease.action).toHaveBeenCalledOnce(); expect(f.lease.close).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('blocks an unavailable visual target if the preceding pointer cannot confirm its exit', async () => {
    const f = fixture(); const pointer = pointerFixture(f);
    const first = await f.observe(); await f.runtime.menu(await f.prepareMenu(first.data), f.controller.signal, f.commit);
    pointer.visual.dispose.mockImplementation(() => pointer.closed.resolve(false));
    f.lease.resolvePointer.mockResolvedValue({ available: false, reason: 'menu_surface_unavailable' });
    f.lease.action.mockClear(); vi.mocked(f.commit.begin).mockClear();
    const next = await f.observe();
    await expect(f.runtime.menu(await f.prepareMenu(next.data), f.controller.signal, f.commit)).rejects.toThrow(/关闭未确认/);
    expect(f.lease.action).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('does not treat an unavailable but confirmed-closed renderer as an AX dispatch failure', async () => {
    const f = fixture(); const pointer = pointerFixture(f);
    pointer.visual.shown = false; pointer.closed.resolve(true);
    const { data } = await f.observe();
    await expect(f.runtime.menu(await f.prepareMenu(data), f.controller.signal, f.commit)).resolves.toMatchObject({
      ok: true, data: { dispatchState: 'dispatched', mutationCommitState: 'committed' } });
    expect(pointer.visual.dispose).toHaveBeenCalledOnce(); expect(f.lease.action).toHaveBeenCalledOnce();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('rejects a pointer receipt for another native item before visual creation or commit', async () => {
    const f = fixture(); const pointer = pointerFixture(f);
    f.lease.resolvePointer.mockResolvedValue({ ...pointer.resolved, itemId: 'different-native-item' });
    const { data } = await f.observe();
    await expect(f.runtime.menu(await f.prepareMenu(data), f.controller.signal, f.commit)).rejects.toThrow(/视觉位置/);
    expect(f.dependencies.indicatePointer).not.toHaveBeenCalled(); expect(f.lease.action).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.lease.close).toHaveBeenCalledOnce();
  });
  it.each(['cancelled', 'released'] as const)('ignores a late native menu position after the Run is %s', async change => {
    const f = fixture(); const pointer = pointerFixture(f);
    const resolved = deferred<Awaited<ReturnType<AgentComputerMenuSessionLease['resolvePointer']>>>();
    f.lease.resolvePointer.mockImplementation(async () => resolved.promise);
    const { data } = await f.observe(); const running = f.runtime.menu(await f.prepareMenu(data), f.controller.signal, f.commit);
    const rejected = expect(running).rejects.toThrow();
    await vi.waitFor(() => expect(f.lease.resolvePointer).toHaveBeenCalledOnce());
    if (change === 'cancelled') f.controller.abort();
    else await f.runtime.releaseRun(f.identity.runId);
    resolved.resolve(pointer.resolved); await rejected;
    expect(f.dependencies.indicatePointer).not.toHaveBeenCalled(); expect(f.lease.action).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.lease.close).toHaveBeenCalledOnce();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it('removes the old intent and menu references after native position resolution fails', async () => {
    const f = fixture(); const pointer = pointerFixture(f);
    const first = await f.observe(); await f.runtime.menu(await f.prepareMenu(first.data), f.controller.signal, f.commit);
    f.lease.resolvePointer.mockRejectedValue(new AgentComputerInputError('menu ancestry changed', 'not-dispatched'));
    f.lease.action.mockClear(); vi.mocked(f.commit.begin).mockClear();
    const next = await f.observe();
    await expect(f.runtime.menu(await f.prepareMenu(next.data), f.controller.signal, f.commit)).rejects.toThrow(/ancestry changed/);
    expect(pointer.visual.dispose).toHaveBeenCalledOnce(); expect(f.lease.close).toHaveBeenCalledOnce();
    expect(f.lease.action).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
    await expect(f.prepareMenu(next.data)).rejects.toThrow();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it.each(['cancelled', 'released', 'moved', 'expired'] as const)('does not commit when %s during menu preview', async change => {
    const f = fixture(); const pointer = pointerFixture(f); const ready = deferred<AgentComputerWindowIndicatorLease>();
    f.dependencies.indicatePointer = vi.fn(async () => ready.promise);
    const { data } = await f.observe(); const running = f.runtime.menu(await f.prepareMenu(data), f.controller.signal, f.commit);
    const rejected = expect(running).rejects.toThrow();
    await vi.waitFor(() => expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce());
    let releasing: Promise<void> | undefined;
    if (change === 'cancelled') f.controller.abort();
    if (change === 'released') releasing = f.runtime.releaseRun(f.identity.runId);
    if (change === 'moved') f.setWindow({ ...f.window, bounds: { ...f.window.bounds, x: 120 } });
    if (change === 'expired') f.advance(60_001);
    ready.resolve(pointer.visual); await rejected; await releasing;
    expect(f.lease.action).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
    expect(pointer.visual.dispose).toHaveBeenCalled();
    await f.runtime.releaseRun(f.identity.runId);
  });
  it.each(['not-dispatched', 'unknown'] as const)('settles %s honestly and does not replay a consumed action', async state => {
    const f = fixture(); const { data } = await f.observe(); const prepared = await f.prepareMenu(data);
    f.lease.action.mockRejectedValueOnce(new AgentComputerInputError('native failure', state));
    const result = await f.runtime.menu(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: false, data: { dispatchState: state, mutationCommitState: state === 'unknown' ? 'commit_unknown' : 'uncommitted', retryAllowed: false } });
    expect(f.commit.settle).toHaveBeenCalledWith(result);
    await expect(f.runtime.menu(prepared, f.controller.signal, f.commit)).rejects.toThrow();
    expect(f.lease.action).toHaveBeenCalledOnce();
    expect(f.lease.close).toHaveBeenCalledTimes(state === 'unknown' ? 1 : 0);
  });
  it('reserves an unknown fallback before an action transport rejection without an ACK', async () => {
    const f = fixture(); const { data } = await f.observe();
    f.lease.action.mockImplementation(async () => { expect(f.commit.begin).toHaveBeenCalledOnce(); throw new Error('transport closed'); });
    await expect(f.runtime.menu(await f.prepareMenu(data), f.controller.signal, f.commit)).resolves.toMatchObject({ data: { dispatchState: 'unknown' } });
  });
  it('rejects expired, unsupported, cross-owner and tampered prepared menu actions before dispatch', async () => {
    const f = fixture(); const { data } = await f.observe();
    await expect(f.prepareMenu(data, 'cancel')).rejects.toThrow(/未声明/);
    const prepared = await f.prepareMenu(data);
    await expect(f.runtime.menu({ ...prepared, identity: { ...prepared.identity, sessionId: 'other' } }, f.controller.signal, f.commit)).rejects.toThrow();
    await expect(f.runtime.menu({ ...prepared, binding: { ...prepared.binding, menu: { itemId: 'forged' } } }, f.controller.signal, f.commit)).rejects.toThrow(/私有绑定/);
    f.advance(60_001);
    await expect(f.runtime.menu(prepared, f.controller.signal, f.commit)).rejects.toThrow(/过期/);
    expect(f.lease.action).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });
  it('does not permit ordinary click, text or scroll with menu element IDs', async () => {
    const f = fixture(); const { data } = await f.observe();
    const target = { observationId: data.observationId, elementId: data.elements[0].elementId };
    await expect(f.runtime.prepareClick(target, f.context)).rejects.toThrow();
    await expect(f.runtime.prepareSetText({ ...target, text: 'x', mode: 'replace' }, f.context)).rejects.toThrow();
    await expect(f.runtime.prepareScroll({ ...target, direction: 'down', unit: 'page' }, f.context)).rejects.toThrow();
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });
  it('does not invent a screenshot or fall back to the root window when a menu surface is unavailable', async () => {
    const f = fixture(); const { data } = await f.observe({ scope: 'menu', mode: 'both' });
    expect(data).toMatchObject({ menuCapture: 'unavailable', menuReady: true });
    expect(data.imageId).toBeUndefined(); expect(data.axTree).toContain('AXMenu');
    expect(f.dependencies.capture).not.toHaveBeenCalled(); expect(f.images.import).not.toHaveBeenCalled();
  });
  it('imports only the native canonical menu PNG and gives screenshot-only observations no menu IDs', async () => {
    const f = fixture();
    f.lease.capture.mockResolvedValue({ available: true, png: Buffer.from('menu-png'), width: 960, height: 600,
      bounds: { x: 100, y: 100, width: 960, height: 600 }, menuCapture: 'included', cursorIncluded: false });
    const { data } = await f.observe({ scope: 'menu', mode: 'screenshot' });
    expect(data).toMatchObject({ menuCapture: 'included', elements: [], menuReady: false, cursorIncluded: false });
    expect(data.imageId).toBeDefined(); expect(data.axTree).toBeUndefined();
    expect(f.images.import).toHaveBeenCalledWith(expect.objectContaining({ base64: Buffer.from('menu-png').toString('base64') }));
    expect(f.dependencies.capture).not.toHaveBeenCalled();
  });
  it('waits for real native close on Run release and immediately revokes old menu observations', async () => {
    const f = fixture(); const { data } = await f.observe(); f.lease.close.mockImplementation(() => undefined);
    let released = false; const releasing = f.runtime.releaseRun(f.identity.runId).then(() => { released = true; });
    await Promise.resolve(); expect(released).toBe(false); expect(f.lease.close).toHaveBeenCalledOnce();
    await expect(f.prepareMenu(data)).rejects.toThrow();
    f.closed.resolve(true); await releasing; expect(released).toBe(true);
  });
  it('invalidates menu IDs on an ordinary observation and closes the old helper when window geometry changes', async () => {
    const f = fixture(); const { data } = await f.observe();
    await f.observe({ mode: 'ax' });
    await expect(f.prepareMenu(data)).rejects.toThrow(/过期/);
    expect(f.lease.close).not.toHaveBeenCalled();
    f.setWindow({ ...f.window, bounds: { ...f.window.bounds, x: 120 } });
    await f.observe({ mode: 'ax' });
    expect(f.lease.close).toHaveBeenCalledOnce();
  });
  it('rolls back a captured attachment if cancellation arrives during binding', async () => {
    const f = fixture();
    f.lease.capture.mockResolvedValue({ available: true, png: Buffer.from('menu-png'), width: 960, height: 600,
      bounds: { x: 100, y: 100, width: 960, height: 600 }, menuCapture: 'included', cursorIncluded: false });
    f.images.bind.mockImplementation(async (_scope, ids) => { f.controller.abort(); return [...ids]; });
    await expect(f.observe({ scope: 'menu', mode: 'both' })).rejects.toThrow();
    expect(f.images.rollbackBinding).toHaveBeenCalledOnce();
    expect(f.images.discard).toHaveBeenCalledOnce();
    expect(f.lease.close).toHaveBeenCalledOnce();
  });
  it('awaits startup races and closes a late native lease without reviving a released Run', async () => {
    const f = fixture(); const startup = deferred<AgentComputerMenuSessionLease>();
    f.dependencies.menuSession.mockReturnValue(startup.promise);
    const observing = f.observe(); const rejected = expect(observing).rejects.toThrow(/共享已结束/);
    await vi.waitFor(() => expect(f.dependencies.menuSession).toHaveBeenCalledOnce());
    let released = false; const releasing = f.runtime.releaseRun(f.identity.runId).then(() => { released = true; });
    await Promise.resolve(); expect(released).toBe(false);
    startup.resolve(f.lease); await rejected; await releasing;
    expect(f.lease.close).toHaveBeenCalledOnce(); expect(f.lease.observe).not.toHaveBeenCalled();
  });
  it('blocks a replacement menu helper when prior close was not confirmed', async () => {
    const f = fixture(); await f.observe(); f.lease.close.mockImplementation(() => f.closed.resolve(false));
    await f.runtime.releaseRun(f.identity.runId);
    await expect(f.observe()).rejects.toThrow(/关闭未确认/);
    expect(f.dependencies.menuSession).toHaveBeenCalledOnce();
  });
  it('preserves a global launch barrier when startup itself reports an unconfirmed helper close', async () => {
    const f = fixture();
    f.dependencies.menuSession.mockRejectedValueOnce(new AgentComputerMenuSessionCloseError());
    await expect(f.observe()).rejects.toBeInstanceOf(AgentComputerMenuSessionCloseError);
    await f.runtime.releaseRun(f.identity.runId);
    await expect(f.observe()).rejects.toThrow(/关闭未确认/);
    expect(f.dependencies.menuSession).toHaveBeenCalledOnce();
  });
  it('requires a fresh menu grant when an historical single-window action omitted menuOperations', async () => {
    const f = fixture(); const prepared = await f.runtime.prepareObserve({ mode: 'ax' }, f.context);
    if (prepared.publicAction.kind !== 'computer.observe' || prepared.publicAction.version !== 2) throw new Error('fixture action');
    delete prepared.publicAction.menuOperations;
    await f.runtime.observe(f.execution({ ...prepared, binding: { ...prepared.binding, menuOperations: [] } }), f.controller.signal);
    const next = await f.runtime.prepareObserve({ scope: 'menu' }, f.context);
    expect(next.decision).toMatchObject({ behavior: 'ask' });
    expect(next.publicAction).toMatchObject({ menuOperations: ['open', 'press', 'cancel'] });
  });
  it('rejects combining menu scope with ordinary region, operation or changes options', async () => {
    const f = fixture();
    for (const invalid of [{ operation: 'press' }, { includeChanges: true }, { focus: {} }]) {
      await expect(f.runtime.prepareObserve({ scope: 'menu', ...invalid } as Parameters<typeof f.runtime.prepareObserve>[0], f.context)).rejects.toThrow(/混用/);
    }
    expect(f.dependencies.menuSession).not.toHaveBeenCalled();
  });
});
