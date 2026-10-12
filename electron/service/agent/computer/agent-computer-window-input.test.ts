import { describe, expect, it, vi } from 'vitest';
import { createAgentComputerRuntime } from './agent-computer-runtime';
import type { AgentComputerRuntimeDependencies } from './agent-computer-runtime';
import type { AgentComputerSharedWindow } from '../../../platform/computer-use';
import { AgentComputerWindowInputError } from '../../../platform/computer-use';
import type { AgentToolMainPreparationIdentity, AgentToolMainPreparationContext, AgentToolMainPreparationResult } from '../agent-tool-registry';
import { WINDOW_INPUT_OPERATIONS } from '../../../../src/shared/computer-use/window-input-contract';
import { createAgentToolBroker } from '../agent-tool-broker';
import { createAgentToolRegistry, hashAgentToolInputForPreparation } from '../agent-tool-registry';
import { getBuiltInAgentComputerTools } from '../tools/computer-tools';

const liveRuntime = vi.hoisted(() => ({ value: undefined as ReturnType<typeof createAgentComputerRuntime> | undefined }));
vi.mock('./agent-computer-service-runtime', () => ({ agentComputerRuntime: {
  prepareInput: (...args: Parameters<ReturnType<typeof createAgentComputerRuntime>['prepareInput']>) => liveRuntime.value!.prepareInput(...args),
  input: (...args: Parameters<ReturnType<typeof createAgentComputerRuntime>['input']>) => liveRuntime.value!.input(...args),
} }));

vi.mock('../../../platform/computer-use', () => {
  class AgentComputerInputError extends Error {
    constructor(message: string, readonly dispatchState: 'not-dispatched' | 'unknown') { super(message); }
  }
  class AgentComputerWindowInputError extends AgentComputerInputError {
    constructor(message: string, dispatchState: 'not-dispatched' | 'unknown', readonly releaseState: 'confirmed' | 'unconfirmed' | 'not-required') { super(message, dispatchState); }
  }
  return { AgentComputerInputError, AgentComputerWindowInputError };
});

function fixture() {
  const controller = new AbortController();
  let time = Date.parse('2026-10-12T10:00:00Z');
  const window: AgentComputerSharedWindow = { windowId: 24, pid: 800, processStartedAt: 1_770_000_000_000, layer: 0,
    bounds: { x: -800, y: 40, width: 800, height: 600 }, title: 'QA', applicationLabel: 'QA', windowLabel: 'QA' };
  const owner: AgentToolMainPreparationIdentity = { aiDestinationIdentity: `v1:${'a'.repeat(64)}`, runCapabilityIdentity: `v2:${'b'.repeat(64)}`,
    callId: 'observe', libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'http://localhost:9000' }, ownerWebContentsId: 17,
    preparedActionId: 'prepared', runId: 'run-1', sessionId: 'session-1', toolInputHash: `v1:${'c'.repeat(64)}`,
    toolName: 'computer.observe', toolRegistrationId: 'builtin:computer.observe@1', toolRunId: 'tool-observe' };
  const context = (identity = owner): AgentToolMainPreparationContext => ({ preparationIdentity: identity,
    ownerScope: identity.ownerScope, ownerWebContentsId: identity.ownerWebContentsId,
    appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
    aiDestination: { identity: identity.aiDestinationIdentity, configurationIdentity: `v1:${'d'.repeat(64)}`,
      model: 'gpt-5.5', profileId: 'profile', profileLabel: 'QA', providerType: 'openai' },
    runCapabilitySnapshot: {} as AgentToolMainPreparationContext['runCapabilitySnapshot'], signal: controller.signal });
  const images = { import: vi.fn(async () => ({ id: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68', name: '窗口.png',
    kind: 'image' as const, mimeType: 'image/png', sizeBytes: 1024, width: 1600, height: 1200 })),
  bind: vi.fn(async (_scope: unknown, ids: readonly string[]) => [...ids]), rollbackBinding: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) };
  const inputStatus = vi.fn<NonNullable<AgentComputerRuntimeDependencies['inputStatus']>>(async () => ({ ready: true, profile: 'appkit-fixture-v1', operations: [...WINDOW_INPUT_OPERATIONS] }));
  const input = vi.fn<NonNullable<AgentComputerRuntimeDependencies['input']>>(async () => ({ dispatched: true, method: 'CGEventPostToPid', eventCount: 2, releaseSent: true }));
  const dependencies: AgentComputerRuntimeDependencies = {
    windows: vi.fn(async () => ({ windows: [structuredClone(window)], truncated: false })), ownerWindowId: () => window.windowId,
    capture: vi.fn(async () => Buffer.from('png')), targets: vi.fn(async targetWindow => ({ target: { ...targetWindow, candidates: [] }, truncated: false })),
    click: vi.fn(async () => undefined), setText: vi.fn(async () => undefined), scroll: vi.fn(async () => undefined),
    clickStatus: vi.fn(async () => ({ available: true })), requestClickPermission: vi.fn(async () => undefined),
    images: () => images, inputStatus, input, now: () => time,
  };
  const runtime = createAgentComputerRuntime(dependencies);
  const execution = (prepared: AgentToolMainPreparationResult, identity = owner) => ({ identity,
    preparedActionId: identity.preparedActionId, publicAction: prepared.publicAction, binding: prepared.binding, snapshotHash: 'f'.repeat(64) });
  const commit = { begin: vi.fn(), settle: vi.fn() };
  const observe = async (mode: 'ax' | 'both' | 'screenshot' = 'both', legacy = false) => {
    const prepared = await runtime.prepareObserve({ mode }, context());
    if (legacy && prepared.publicAction.kind === 'computer.observe' && prepared.publicAction.version === 2) {
      delete prepared.publicAction.inputOperations;
      prepared.binding = { ...prepared.binding, inputOperations: [] };
    }
    const result = await runtime.observe(execution(prepared), controller.signal);
    return result.data as { observationId: string; availableInputOperations: string[]; inputReady: boolean; inputNotice?: string };
  };
  const prepare = async (values: Omit<Parameters<typeof runtime.prepareInput>[0], 'observationId'>, observationId: string, identity = owner) =>
    execution(await runtime.prepareInput({ observationId, ...values }, context(identity)), identity);
  return { window, owner, context, runtime, execution, dependencies, inputStatus, input, commit, controller, observe, prepare,
    advance: (milliseconds: number) => { time += milliseconds; } };
}

describe('Agent window input lifecycle', () => {
  it('uses the actual builtin Tool and registry through broker-provided commit settlement', async () => {
    const f = fixture(); liveRuntime.value = f.runtime;
    const seen = await f.observe();
    const raw = { observationId: seen.observationId, operation: 'rightClick' as const, point: { x: 10, y: 10 } };
    const identity = { ...f.owner, toolName: 'computer.input', toolRegistrationId: 'builtin:computer.input@1',
      toolRunId: '83fc584b-037d-4c82-8883-a609846ea0d4', toolInputHash: hashAgentToolInputForPreparation(raw) };
    const tool = getBuiltInAgentComputerTools().find(item => item.name === 'computer.input')!;
    const registry = createAgentToolRegistry([tool]).createSnapshot();
    const prepared = await tool.prepareMain!(raw, undefined, f.context(identity));
    const preparation = registry.sealMainPreparedExecution(tool.name, { identity, publicAction: prepared.publicAction,
      binding: prepared.binding, approvalSemantics: prepared.decision });
    const broker = createAgentToolBroker({ toolRegistry: registry });
    const result = await broker.executeMain(tool.name, raw, { appContext: f.context().appContext, onProgress: vi.fn(),
      signal: f.controller.signal, mainPreparationCapability: preparation.capability, mainPreparationIdentity: preparation.identity,
      runCapabilitySnapshot: { getTool: () => registry.get(tool.name) } as never },
    10_000, registry, 6_000);
    expect(result).toMatchObject({ ok: true, data: { operation: 'computer.input', dispatchState: 'dispatched' } });
    expect(f.input).toHaveBeenCalledOnce();
  });
  it.each(['rightClick', 'doubleClick', 'drag'] as const)('maps %s from the exact screenshot with Retina and negative window origins', async operation => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation, point: { x: 100, y: 200 },
      ...(operation === 'drag' ? { endPoint: { x: 600, y: 400 }, durationMs: 500 } : {}) }, seen.observationId);
    expect(prepared.binding.request).toMatchObject({ window: f.window, profile: 'appkit-fixture-v1', operation,
      point: { x: -749.75, y: 140.25 } });
    const result = await f.runtime.input(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: true, data: { operation: 'computer.input', inputOperation: operation,
      observationId: seen.observationId, dispatchState: 'dispatched', mutationCommitState: 'committed',
      releaseState: 'confirmed', nextAction: 'observe', retryAllowed: false } });
    expect(f.input).toHaveBeenCalledOnce();
    expect(f.commit.begin.mock.invocationCallOrder[0]).toBeLessThan(f.input.mock.invocationCallOrder[0]);
    expect(JSON.stringify(result)).not.toMatch(/profile|windowId|processStartedAt|"pid"/);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow('已用于');
  });
  it('allows an AX-only shortcut but never signs image coordinates from AX-only or screenshot-only', async () => {
    const f = fixture(); const seen = await f.observe('ax');
    expect(seen.availableInputOperations).toEqual(['shortcut']);
    const prepared = await f.prepare({ operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } }, seen.observationId);
    await f.runtime.input(prepared, f.controller.signal, f.commit);
    expect(f.input).toHaveBeenCalledWith(expect.objectContaining({ shortcut: { key: 'a', modifiers: ['command'] } }), f.controller.signal);
    const next = await f.observe('ax');
    await expect(f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, next.observationId)).rejects.toThrow('未提供');
    const image = await f.observe('screenshot');
    expect(image.availableInputOperations).toEqual([]);
    await expect(f.prepare({ operation: 'shortcut', shortcut: { key: 'escape', modifiers: [] } }, image.observationId)).rejects.toThrow('未提供');
  });
  it('does not upgrade legacy window grants and asks again for new input permissions', async () => {
    const f = fixture(); const seen = await f.observe('both', true);
    expect(seen.availableInputOperations).toEqual([]);
    await expect(f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId)).rejects.toThrow('未提供');
    const newGrant = await f.runtime.prepareObserve({}, f.context());
    expect(newGrant.decision.behavior).toBe('ask');
    expect(newGrant.publicAction).toMatchObject({ inputOperations: [...WINDOW_INPUT_OPERATIONS] });
  });
  it('reports unsupported receivers without preventing observation or providing input authority', async () => {
    const f = fixture(); f.inputStatus.mockResolvedValue({ ready: false, operations: [], reason: 'unsupported_receiver' });
    const seen = await f.observe();
    expect(seen).toMatchObject({ inputReady: false, availableInputOperations: [], inputNotice: expect.stringContaining('尚未通过') });
    await expect(f.prepare({ operation: 'rightClick', point: { x: 1, y: 2 } }, seen.observationId)).rejects.toThrow('未提供');
    expect(f.input).not.toHaveBeenCalled();
  });
  it('withholds capability when the receiver profile changes across capture', async () => {
    const f = fixture(); f.inputStatus.mockResolvedValueOnce({ ready: true, profile: 'old', operations: [...WINDOW_INPUT_OPERATIONS] });
    const seen = await f.observe();
    expect(seen.availableInputOperations).toEqual([]);
  });
  it.each(['profile', 'operation', 'point', 'target', 'frontmost'] as const)('rejects changed %s before commit and dispatch', async change => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId);
    if (change === 'profile') f.inputStatus.mockResolvedValue({ ready: true, profile: 'different', operations: [...WINDOW_INPUT_OPERATIONS] });
    if (change === 'operation') f.inputStatus.mockResolvedValue({ ready: true, profile: 'appkit-fixture-v1', operations: ['shortcut'] });
    if (change === 'frontmost') f.inputStatus.mockResolvedValue({ ready: false, operations: [], reason: 'target_frontmost' });
    if (change === 'point') (prepared.binding.request as { point: { x: number } }).point.x++;
    if (change === 'target') prepared.binding = { ...prepared.binding, targetId: 'different' };
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow();
    expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
  });
  it('rejects out-of-image points even when within the schema maximum', async () => {
    const f = fixture(); const seen = await f.observe();
    await expect(f.prepare({ operation: 'rightClick', point: { x: 1600, y: 0 } }, seen.observationId)).rejects.toThrow('超出');
  });
  it.each(['expired', 'new-observation', 'owner', 'released'] as const)('rejects %s identity without input', async change => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, seen.observationId);
    if (change === 'expired') f.advance(60_001);
    if (change === 'new-observation') await f.observe();
    if (change === 'owner') prepared.identity = { ...f.owner, ownerWebContentsId: 999 };
    if (change === 'released') f.runtime.releaseRun(f.owner.runId);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow();
    expect(f.input).not.toHaveBeenCalled();
  });
  it.each(['expired', 'released'] as const)('rechecks %s lifecycle after asynchronous receiver preflight', async change => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, seen.observationId);
    let entered!: () => void; const atPreflight = new Promise<void>(resolve => { entered = resolve; });
    let finish!: (value: Awaited<ReturnType<NonNullable<AgentComputerRuntimeDependencies['inputStatus']>>>) => void;
    f.inputStatus.mockImplementationOnce(() => { entered(); return new Promise(resolve => { finish = resolve; }); });
    const running = f.runtime.input(prepared, f.controller.signal, f.commit);
    const rejected = expect(running).rejects.toThrow();
    await atPreflight;
    if (change === 'expired') f.advance(60_001); else f.runtime.releaseRun(f.owner.runId);
    finish({ ready: true, profile: 'appkit-fixture-v1', operations: [...WINDOW_INPUT_OPERATIONS] });
    await rejected;
    expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
  });
  it.each(['confirmed', 'unconfirmed'] as const)('keeps unknown action separate from %s release and consumes the observation', async releaseState => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'drag', point: { x: 1, y: 1 }, endPoint: { x: 10, y: 10 }, durationMs: 500 }, seen.observationId);
    f.input.mockRejectedValue(new AgentComputerWindowInputError('cancelled', 'unknown', releaseState));
    const result = await f.runtime.input(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: false, data: { dispatchState: 'unknown', mutationCommitState: 'commit_unknown', releaseState, retryAllowed: false } });
    expect(f.commit.settle).toHaveBeenCalledWith(result);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow(releaseState === 'unconfirmed' ? '释放事件未确认' : '已用于');
    expect(f.input).toHaveBeenCalledOnce();
  });
  it.each([
    { operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } },
    { operation: 'rightClick', point: { x: 10, y: 10 } },
    { operation: 'doubleClick', point: { x: 10, y: 10 } },
    { operation: 'drag', point: { x: 10, y: 10 }, endPoint: { x: 20, y: 20 }, durationMs: 100 },
  ] as const)('blocks fresh-observation $operation after an unconfirmed release', async nextInput => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, seen.observationId);
    f.input.mockRejectedValueOnce(new AgentComputerWindowInputError('missing receipt', 'unknown', 'unconfirmed'));
    await f.runtime.input(prepared, f.controller.signal, f.commit);
    const next = await f.observe();
    expect(next).toMatchObject({ inputReady: false, availableInputOperations: [], inputNotice: expect.stringContaining('释放事件未确认') });
    await expect(f.prepare(structuredClone(nextInput), next.observationId)).rejects.toThrow('本次任务的后台定向输入已关闭');
    expect(f.input).toHaveBeenCalledOnce();
  });
  it('blocks an already sealed input and a previously approved share after an unconfirmed release', async () => {
    const f = fixture(); liveRuntime.value = f.runtime;
    const seen = await f.observe();
    const pendingShare = await f.runtime.prepareObserve({}, f.context());
    const raw = { observationId: seen.observationId, operation: 'shortcut' as const, shortcut: { key: 'a' as const, modifiers: ['command' as const] } };
    const identity = { ...f.owner, toolName: 'computer.input', toolRegistrationId: 'builtin:computer.input@1',
      toolRunId: '83fc584b-037d-4c82-8883-a609846ea0d4', toolInputHash: hashAgentToolInputForPreparation(raw) };
    const tool = getBuiltInAgentComputerTools().find(item => item.name === 'computer.input')!;
    const registry = createAgentToolRegistry([tool]).createSnapshot();
    const prepared = await tool.prepareMain!(raw, undefined, f.context(identity));
    const sealed = registry.sealMainPreparedExecution(tool.name, { identity, publicAction: prepared.publicAction,
      binding: prepared.binding, approvalSemantics: prepared.decision });
    const first = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, seen.observationId);
    f.input.mockRejectedValueOnce(new AgentComputerWindowInputError('missing receipt', 'unknown', 'unconfirmed'));
    await f.runtime.input(first, f.controller.signal, f.commit);
    const broker = createAgentToolBroker({ toolRegistry: registry });
    await expect(broker.executeMain(tool.name, raw, { appContext: f.context().appContext, onProgress: vi.fn(),
      signal: f.controller.signal, mainPreparationCapability: sealed.capability, mainPreparationIdentity: sealed.identity,
      runCapabilitySnapshot: { getTool: () => registry.get(tool.name) } as never }, 10_000, registry, 6_000))
      .rejects.toThrow('本次任务的后台定向输入已关闭');
    const renewed = await f.runtime.observe(f.execution(pendingShare), f.controller.signal);
    expect(renewed.data).toMatchObject({ inputReady: false, availableInputOperations: [] });
    expect(f.input).toHaveBeenCalledOnce();
  });
  it('keeps the Run blocked when another window is approved while retaining observation and AX', async () => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, seen.observationId);
    f.input.mockRejectedValueOnce(new AgentComputerWindowInputError('missing receipt', 'unknown', 'unconfirmed'));
    await f.runtime.input(prepared, f.controller.signal, f.commit);
    Object.assign(f.window, { windowId: 25, title: 'QA2', windowLabel: 'QA2' });
    f.dependencies.targets = vi.fn(async window => ({ target: { ...window, candidates: [
      { path: [0], role: 'AXButton', title: 'Fixture button', bounds: { ...window.bounds } },
    ] }, truncated: false }));
    const newShare = await f.runtime.prepareObserve({ application: 'QA', windowTitle: 'QA2', mode: 'ax' }, f.context());
    expect(newShare.decision.behavior).toBe('ask');
    expect(newShare.publicAction).not.toHaveProperty('inputOperations');
    const observed = await f.runtime.observe(f.execution(newShare), f.controller.signal);
    const next = observed.data as { observationId: string; elements: Array<{ elementId: string }> };
    expect(observed.data).toMatchObject({ inputReady: false, availableInputOperations: [], clickReady: true });
    await expect(f.prepare({ operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } }, next.observationId))
      .rejects.toThrow('本次任务的后台定向输入已关闭');
    const click = await f.runtime.prepareClick({ observationId: next.observationId, elementId: next.elements[0].elementId }, f.context());
    await expect(f.runtime.click(f.execution(click), f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
    expect(f.dependencies.click).toHaveBeenCalledOnce();
    expect(f.input).toHaveBeenCalledOnce();
  });
  it.each(['confirmed', 'not-required'] as const)('allows new input when the previous release is %s', async releaseState => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, seen.observationId);
    f.input.mockRejectedValueOnce(new AgentComputerWindowInputError('refused', releaseState === 'confirmed' ? 'unknown' : 'not-dispatched', releaseState));
    await f.runtime.input(prepared, f.controller.signal, f.commit);
    const next = await f.observe();
    expect(next.availableInputOperations).toEqual([...WINDOW_INPUT_OPERATIONS]);
    const nextPrepared = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, next.observationId);
    await expect(f.runtime.input(nextPrepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
    expect(f.input).toHaveBeenCalledTimes(2);
  });
  it('clears only the Run gate on release and does not retain a late unconfirmed result', async () => {
    for (const releaseBeforeReceipt of [false, true]) {
      const f = fixture(); const seen = await f.observe();
      const prepared = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, seen.observationId);
      let entered!: () => void; const inHelper = new Promise<void>(resolve => { entered = resolve; });
      let fail!: (reason: Error) => void;
      f.input.mockImplementationOnce(() => { entered(); return new Promise((_resolve, reject) => { fail = reject; }); });
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await inHelper;
      if (releaseBeforeReceipt) f.runtime.releaseRun(f.owner.runId);
      fail(new AgentComputerWindowInputError('missing receipt', 'unknown', 'unconfirmed'));
      await expect(running).resolves.toMatchObject({ ok: false, data: { releaseState: 'unconfirmed' } });
      if (!releaseBeforeReceipt) f.runtime.releaseRun(f.owner.runId);
      const newShare = await f.runtime.prepareObserve({}, f.context());
      expect(newShare.decision.behavior).toBe('ask');
      const observed = await f.runtime.observe(f.execution(newShare), f.controller.signal);
      const next = observed.data as { observationId: string; availableInputOperations: string[] };
      expect(next.availableInputOperations).toEqual([...WINDOW_INPUT_OPERATIONS]);
      const nextPrepared = await f.prepare({ operation: 'rightClick', point: { x: 1, y: 1 } }, next.observationId);
      await expect(f.runtime.input(nextPrepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
      expect(f.input).toHaveBeenCalledTimes(2);
    }
  });
});
