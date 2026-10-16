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
import { AgentComputerWindowIndicatorCloseError, type AgentComputerWindowIndicatorLease } from '../../../platform/computer-use/window-indicator';
import type { AgentComputerWindowInputSessionLease } from '../../../platform/computer-use/window-input-session';

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
  const inputStatus = vi.fn<NonNullable<AgentComputerRuntimeDependencies['inputStatus']>>(async () => ({ ready: true, profile: 'appkit-fixture-v1', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'a'.repeat(64) }));
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
    return result.data as { observationId: string; availableInputOperations: string[]; inputReady: boolean; inputNotice?: string; notice?: string };
  };
  const prepare = async (values: Omit<Parameters<typeof runtime.prepareInput>[0], 'observationId'>, observationId: string, identity = owner) =>
    execution(await runtime.prepareInput({ observationId, ...values }, context(identity)), identity);
  return { window, owner, context, runtime, execution, dependencies, images, inputStatus, input, commit, controller, observe, prepare,
    advance: (milliseconds: number) => { time += milliseconds; } };
}

describe('Agent window input lifecycle', () => {
  async function observeRun(f: ReturnType<typeof fixture>, owner: AgentToolMainPreparationIdentity) {
    const prepared = await f.runtime.prepareObserve({ mode: 'both' }, f.context(owner));
    const result = await f.runtime.observe(f.execution(prepared, owner), f.controller.signal);
    return result.data as { observationId: string };
  }

  function sessionFixture() {
    const f = fixture();
    f.inputStatus.mockResolvedValue({ ready: true, profile: 'directed-v1', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'a'.repeat(64) });
    let finishClose!: (confirmed: boolean) => void;
    const closed = new Promise<boolean>(resolve => { finishClose = resolve; });
    const send = vi.fn<AgentComputerWindowInputSessionLease['input']>(async () => ({
      dispatched: true, method: 'CGEventPostToPid', eventCount: 2, releaseSent: true,
    }));
    const lease: AgentComputerWindowInputSessionLease = { input: send, close: vi.fn(), dispose: vi.fn(), closed };
    const create = vi.fn<NonNullable<AgentComputerRuntimeDependencies['inputSession']>>(async () => lease);
    f.dependencies.inputSession = create;
    return { ...f, lease, send, create, finishClose };
  }

  it('reuses the generic click session across new observations and waits for its real close at Run end', async () => {
    const f = sessionFixture();
    for (let index = 0; index < 2; index++) {
      const seen = await f.observe();
      const prepared = await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, seen.observationId);
      const result = await f.runtime.input(prepared, f.controller.signal, f.commit);
      expect(result.data).toMatchObject({ dispatchState: 'dispatched', releaseState: 'confirmed', eventCount: 2 });
    }
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.input).not.toHaveBeenCalled();
    let released = false;
    const release = f.runtime.releaseRun(f.owner.runId).then(() => { released = true; });
    await Promise.resolve();
    expect(f.lease.close).toHaveBeenCalledOnce();
    expect(released).toBe(false);
    f.finishClose(true);
    await release;
    expect(released).toBe(true);
  });

  it('keeps a mixed generic gesture, keyboard and wheel sequence in the same focus-owner process', async () => {
    const f = sessionFixture();
    const actions: Parameters<typeof f.prepare>[0][] = [
      { operation: 'click', point: { x: 100, y: 200 } },
      { operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } },
      { operation: 'typeText', text: '中文 e\u0301 🧑‍💻' },
      { operation: 'scroll', point: { x: 100, y: 200 }, deltaX: 0, deltaY: -300 },
      { operation: 'doubleClick', point: { x: 100, y: 200 } },
      { operation: 'drag', point: { x: 100, y: 200 }, endPoint: { x: 200, y: 200 }, durationMs: 300 },
      { operation: 'rightClick', point: { x: 100, y: 200 } },
    ];
    for (const action of actions) {
      const seen = await f.observe();
      const result = await f.runtime.input(await f.prepare(action, seen.observationId), f.controller.signal, f.commit);
      expect(result.data).toMatchObject({ dispatchState: 'dispatched', releaseState: 'confirmed' });
    }
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.send.mock.calls.map(([request]) => request.operation)).toEqual(actions.map(action => action.operation));
    expect(f.input).not.toHaveBeenCalled();
    const release = f.runtime.releaseRun(f.owner.runId); f.finishClose(true); await release;
  });

  it('keeps legacy receivers on their one-shot input route', async () => {
    const f = sessionFixture();
    const legacy = fixture();
    legacy.dependencies.inputSession = f.create;
    const legacySeen = await legacy.observe();
    await legacy.runtime.input(await legacy.prepare({ operation: 'click', point: { x: 100, y: 200 } }, legacySeen.observationId), legacy.controller.signal, legacy.commit);
    expect(legacy.input).toHaveBeenCalledOnce();
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each(['dispatched', 'unknown'] as const)('preserves posted drag feedback on the shared session and drops it after %s settlement', async state => {
    vi.useFakeTimers();
    try {
      const f = sessionFixture(); const seen = await f.observe(); const visual = closingIndicator(true);
      const pointerEvent = vi.fn(); const inputSettled = vi.fn();
      Object.assign(visual.lease, { pointerEvent, inputSettled });
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      let feedback: Parameters<AgentComputerWindowInputSessionLease['input']>[2];
      let complete!: (value: Awaited<ReturnType<AgentComputerWindowInputSessionLease['input']>>) => void;
      let fail!: (error: Error) => void;
      f.send.mockImplementationOnce((_request, _signal, onPointerEvent) => {
        feedback = onPointerEvent;
        return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
      });
      const prepared = await f.prepare({ operation: 'drag', point: { x: 100, y: 200 }, endPoint: { x: 600, y: 400 }, durationMs: 300 }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0);
      expect(feedback).toEqual(expect.any(Function)); expect(f.input).not.toHaveBeenCalled();
      const point = f.send.mock.calls[0][0].point!;
      feedback!({ phase: 'down', point, sequence: 1 });
      expect(pointerEvent).toHaveBeenCalledWith({ phase: 'down', point });
      expect(f.commit.settle).not.toHaveBeenCalled();
      if (state === 'dispatched') complete({ dispatched: true, method: 'CGEventPostToPid', eventCount: 12, releaseSent: true });
      else fail(new AgentComputerWindowInputError('interrupted', 'unknown', 'confirmed'));
      const result = await running;
      expect(result.data).toMatchObject({ dispatchState: state, releaseState: 'confirmed' });
      expect(f.commit.settle).toHaveBeenCalledWith(result); expect(inputSettled).toHaveBeenCalledOnce();
      feedback!({ phase: 'up', point, sequence: 2 });
      expect(pointerEvent).toHaveBeenCalledOnce();
      const release = f.runtime.releaseRun(f.owner.runId); visual.close(true); f.finishClose(true); await release;
    } finally { vi.useRealTimers(); }
  });

  it.each([true, false])('waits for a retained generic focus owner before legacy input, cleanup=%s', async confirmed => {
    const f = sessionFixture(); const seen = await f.observe();
    await f.runtime.input(await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, seen.observationId), f.controller.signal, f.commit);
    f.inputStatus.mockResolvedValue({ ready: true, profile: 'appkit-fixture-v1', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'a'.repeat(64) });
    const secondOwner = { ...f.owner, runId: 'run-2', toolRunId: 'legacy-input' };
    const second = await observeRun(f, secondOwner);
    const prepared = await f.prepare({ operation: 'typeText', text: 'legacy private text' }, second.observationId, secondOwner);
    f.commit.begin.mockClear();
    const next = f.runtime.input(prepared, f.controller.signal, f.commit);
    const rejected = confirmed ? undefined : expect(next).rejects.toThrow('后台输入会话关闭未确认');
    await vi.waitFor(() => expect(f.lease.close).toHaveBeenCalledOnce());
    expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
    f.finishClose(confirmed);
    if (confirmed) {
      await next;
      expect(f.input).toHaveBeenCalledOnce(); expect(f.commit.begin).toHaveBeenCalledOnce();
    } else {
      await rejected;
      expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
    }
    await f.runtime.releaseRun(f.owner.runId); await f.runtime.releaseRun(secondOwner.runId);
  });

  it('hands the sole focus owner to another Run only after a clean native close, retaining the first Run share', async () => {
    const f = sessionFixture(); const replacement = sessionFixture();
    const first = await f.observe();
    await f.runtime.input(await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, first.observationId), f.controller.signal, f.commit);
    const secondOwner = { ...f.owner, runId: 'run-2', toolRunId: 'input-2' };
    const second = await observeRun(f, secondOwner);
    f.create.mockResolvedValueOnce(replacement.lease);
    const next = f.runtime.input(await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, second.observationId, secondOwner), f.controller.signal, f.commit);
    await vi.waitFor(() => expect(f.lease.close).toHaveBeenCalledOnce());
    expect(f.create).toHaveBeenCalledOnce(); expect(replacement.send).not.toHaveBeenCalled();
    f.finishClose(true); await next;
    expect(f.create).toHaveBeenCalledTimes(2); expect(replacement.send).toHaveBeenCalledOnce();
    // Focus handover neither revokes observation permission nor changes Run identity.
    await expect(f.observe()).resolves.toHaveProperty('observationId');
    const release = f.runtime.releaseRun(secondOwner.runId); replacement.finishClose(true); await release;
    await f.runtime.releaseRun(f.owner.runId);
  });

  it('blocks a second focus owner when the previous Run cannot confirm focus cleanup', async () => {
    const f = sessionFixture(); const first = await f.observe();
    await f.runtime.input(await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, first.observationId), f.controller.signal, f.commit);
    const secondOwner = { ...f.owner, runId: 'run-2', toolRunId: 'input-2' };
    const second = await observeRun(f, secondOwner);
    const next = f.runtime.input(await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, second.observationId, secondOwner), f.controller.signal, f.commit);
    const rejected = expect(next).rejects.toThrow('后台输入会话关闭未确认');
    await vi.waitFor(() => expect(f.lease.close).toHaveBeenCalledOnce());
    f.finishClose(false); await rejected;
    expect(f.create).toHaveBeenCalledOnce(); expect(f.send).toHaveBeenCalledOnce(); expect(f.input).not.toHaveBeenCalled();
    await f.runtime.releaseRun(f.owner.runId); await f.runtime.releaseRun(secondOwner.runId);
  });

  it('serializes a second Run behind an opening first owner and its subsequent native cleanup', async () => {
    const f = sessionFixture(); const replacement = sessionFixture();
    let open!: (lease: AgentComputerWindowInputSessionLease) => void;
    f.create.mockReturnValueOnce(new Promise(resolve => { open = resolve; }));
    const first = await f.observe();
    const firstPrepared = await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, first.observationId);
    const secondOwner = { ...f.owner, runId: 'run-2', toolRunId: 'input-2' };
    const second = await observeRun(f, secondOwner);
    const secondPrepared = await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, second.observationId, secondOwner);
    f.create.mockResolvedValueOnce(replacement.lease);
    const firstInput = f.runtime.input(firstPrepared, f.controller.signal, f.commit);
    const secondInput = f.runtime.input(secondPrepared, f.controller.signal, f.commit);
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    expect(f.lease.close).not.toHaveBeenCalled(); expect(replacement.send).not.toHaveBeenCalled();
    open(f.lease); await firstInput;
    await vi.waitFor(() => expect(f.lease.close).toHaveBeenCalledOnce());
    expect(f.create).toHaveBeenCalledOnce(); f.finishClose(true); await secondInput;
    expect(f.create).toHaveBeenCalledTimes(2);
    const release = f.runtime.releaseRun(secondOwner.runId); replacement.finishClose(true); await release;
    await f.runtime.releaseRun(f.owner.runId);
  });

  it.each([
    { operation: 'click', point: { x: 100, y: 200 } },
    { operation: 'typeText', text: 'private text' },
    { operation: 'drag', point: { x: 100, y: 200 }, endPoint: { x: 200, y: 200 }, durationMs: 300 },
  ] as const)('does not fall back or begin a $operation mutation when private session startup fails', async action => {
    const f = sessionFixture();
    f.create.mockRejectedValueOnce(new Error('startup failed'));
    const seen = await f.observe();
    const prepared = await f.prepare(action, seen.observationId);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow('startup failed');
    expect(f.input).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it('revokes an opening input session and awaits cleanup instead of attaching it to an ended Run', async () => {
    const f = sessionFixture();
    let open!: (lease: AgentComputerWindowInputSessionLease) => void;
    f.create.mockReturnValueOnce(new Promise(resolve => { open = resolve; }));
    const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, seen.observationId);
    const pending = f.runtime.input(prepared, f.controller.signal, f.commit);
    const rejected = expect(pending).rejects.toThrow('窗口共享已结束');
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    let released = false;
    const release = f.runtime.releaseRun(f.owner.runId).then(() => { released = true; });
    open(f.lease);
    await vi.waitFor(() => expect(f.lease.close).toHaveBeenCalledOnce());
    expect(released).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    f.finishClose(true);
    await Promise.all([rejected, release]);
    expect(f.commit.begin).not.toHaveBeenCalled();
    expect(f.input).not.toHaveBeenCalled();
  });

  it('keeps unknown session closure blocked across fresh observations and Run cleanup', async () => {
    const f = sessionFixture();
    const seen = await f.observe();
    await f.runtime.input(await f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, seen.observationId), f.controller.signal, f.commit);
    f.finishClose(false);
    await Promise.resolve();
    const next = await f.observe();
    await expect(f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, next.observationId)).rejects.toThrow('关闭未确认');
    await f.runtime.releaseRun(f.owner.runId);
    const restarted = await f.observe();
    await expect(f.prepare({ operation: 'rightClick', point: { x: 100, y: 200 } }, restarted.observationId)).rejects.toThrow('关闭未确认');
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.input).not.toHaveBeenCalled();
  });

  it.each(['missing', 'changed'] as const)('withholds only typeText when the private receiver binding is %s across observation', async scenario => {
    const f = fixture();
    const status = { ready: true, profile: 'appkit-fixture-v1', operations: [...WINDOW_INPUT_OPERATIONS] };
    f.inputStatus.mockResolvedValueOnce({ ...status, focusToken: 'a'.repeat(64) })
      .mockResolvedValueOnce({ ...status, ...(scenario === 'changed' ? { focusToken: 'b'.repeat(64) } : {}) });
    const seen = await f.observe();
    expect(seen.availableInputOperations).not.toContain('typeText');
    expect(seen.availableInputOperations).toContain('click');
    expect(seen.availableInputOperations).toContain('shortcut');
    expect(JSON.stringify(seen)).not.toContain('focusToken');
    await expect(f.prepare({ operation: 'typeText', text: 'private text' }, seen.observationId)).rejects.toThrow('未提供');
    expect(f.input).not.toHaveBeenCalled();
  });

  it.each(['before preparation', 'after preparation'] as const)('refuses a different focused control %s without beginning the commit', async timing => {
    const f = fixture();
    const seen = await f.observe('ax');
    const changed = { ready: true, profile: 'appkit-fixture-v1', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'b'.repeat(64) };
    if (timing === 'before preparation') f.inputStatus.mockResolvedValue(changed);
    const prepared = await f.prepare({ operation: 'typeText', text: 'private text' }, seen.observationId);
    if (timing === 'after preparation') f.inputStatus.mockResolvedValue(changed);
    expect(prepared.binding.request).toMatchObject({ focusToken: 'a'.repeat(64) });
    expect(JSON.stringify(prepared.publicAction)).not.toContain('focusToken');
    expect(JSON.stringify(seen)).not.toContain('focusToken');
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow('文字接收控件已变化');
    expect(f.input).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it('refuses a substituted private text receiver in the sealed request', async () => {
    const f = fixture(); const seen = await f.observe('ax');
    const prepared = await f.prepare({ operation: 'typeText', text: 'private text' }, seen.observationId);
    (prepared.binding.request as { focusToken: string }).focusToken = 'b'.repeat(64);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow('接收者不匹配');
    expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it.each(['partial', 'changed', 'empty', 'anonymous', 'unavailable'] as const)('keeps directed click available when AX controls are %s', async scenario => {
    const f = fixture();
    const candidate = { path: [0], role: 'AXButton', title: 'QA button', bounds: { x: -700, y: 100, width: 100, height: 40 }, operations: ['press' as const] };
    let reads = 0;
    f.dependencies.targets = vi.fn(async window => {
      if (scenario === 'unavailable') throw new Error('AX scan failed');
      return { target: { ...window, candidates: scenario === 'empty' ? [] : [scenario === 'anonymous'
        ? { ...candidate, title: '', operations: [] }
        : { ...candidate, path: scenario === 'changed' ? [reads++] : candidate.path }] }, truncated: scenario === 'partial' };
    });
    const seen = await f.observe();
    expect(seen.availableInputOperations).toContain('click');
    expect(seen.notice).toContain('computer.input 以 availableInputOperations 为准');
    expect(seen.notice).not.toContain('坐标点击不可用');
    await expect(f.prepare({ operation: 'click', point: { x: 100, y: 200 } }, seen.observationId)).resolves.toMatchObject({
      publicAction: { kind: 'computer.input', operation: 'click' },
    });
  });

  it('distinguishes AX element rules from available directed keyboard input in AX-only observations', async () => {
    const f = fixture();
    const seen = await f.observe('ax');
    expect(seen.availableInputOperations).toEqual(['shortcut', 'typeText']);
    expect(seen.notice).toContain('AX 工具仅使用本次 elements');
    expect(seen.notice).toContain('computer.input 以 availableInputOperations 为准');
  });

  it.each([
    { operation: 'click', point: { x: 100, y: 200 } },
    { operation: 'scroll', point: { x: 100, y: 200 }, deltaX: 0, deltaY: -400 },
    { operation: 'typeText', text: '测试 🌟\r\n' },
  ] as const)('executes new $operation through real builtin registration, sealing and broker settlement', async rawOperation => {
    const f = fixture(); liveRuntime.value = f.runtime;
    const seen = await f.observe(rawOperation.operation === 'typeText' ? 'ax' : 'both');
    const raw = { observationId: seen.observationId, ...rawOperation };
    const identity = { ...f.owner, toolName: 'computer.input', toolRegistrationId: 'builtin:computer.input@1',
      toolRunId: '83fc584b-037d-4c82-8883-a609846ea0d4', toolInputHash: hashAgentToolInputForPreparation(raw) };
    const tool = getBuiltInAgentComputerTools().find(item => item.name === 'computer.input')!;
    const registry = createAgentToolRegistry([tool]).createSnapshot();
    const prepared = await tool.prepareMain!(raw, undefined, f.context(identity));
    if (raw.operation === 'typeText') {
      expect(prepared.publicAction).toMatchObject({ operation: 'typeText', textLength: 6, textBytes: 13 });
      expect(JSON.stringify(prepared.publicAction)).not.toContain(raw.text);
      expect(prepared.binding.request).toMatchObject({ text: raw.text });
    }
    const sealed = registry.sealMainPreparedExecution(tool.name, { identity, publicAction: prepared.publicAction,
      binding: prepared.binding, approvalSemantics: prepared.decision });
    const broker = createAgentToolBroker({ toolRegistry: registry });
    const context = { appContext: f.context().appContext, onProgress: vi.fn(), signal: f.controller.signal,
      mainPreparationCapability: sealed.capability, mainPreparationIdentity: sealed.identity,
      runCapabilitySnapshot: { getTool: () => registry.get(tool.name) } as never };
    if (raw.operation === 'typeText') {
      await expect(broker.executeMain(tool.name, { ...raw, text: 'replacement' }, context, 25_000, registry, 6_000))
        .rejects.toThrow();
      expect(f.input).not.toHaveBeenCalled();
    }
    const result = await broker.executeMain(tool.name, raw, context, 25_000, registry, 6_000);
    expect(result).toMatchObject({ ok: true, data: { operation: 'computer.input', inputOperation: raw.operation,
      dispatchState: 'dispatched', mutationCommitState: 'committed', releaseState: 'confirmed', retryAllowed: false } });
    expect(f.input).toHaveBeenCalledOnce();
    if (raw.operation === 'typeText') expect(JSON.stringify(result)).not.toContain(raw.text);
  });

  it('requires a new explicit grant when an old share granted only the original four input operations', async () => {
    const f = fixture();
    const prepared = await f.runtime.prepareObserve({ mode: 'both' }, f.context());
    if (prepared.publicAction.kind !== 'computer.observe' || prepared.publicAction.version !== 2) throw new Error('invalid fixture');
    const oldOperations = ['shortcut', 'rightClick', 'doubleClick', 'drag'] as const;
    prepared.publicAction.inputOperations = [...oldOperations];
    prepared.binding = { ...prepared.binding, inputOperations: [...oldOperations] };
    const seen = await f.runtime.observe(f.execution(prepared), f.controller.signal);
    expect(seen.data).toMatchObject({ availableInputOperations: [...oldOperations] });
    const id = (seen.data as { observationId: string }).observationId;
    await expect(f.prepare({ operation: 'click', point: { x: 1, y: 1 } }, id)).rejects.toThrow('未提供');
    await expect(f.prepare({ operation: 'typeText', text: 'x' }, id)).rejects.toThrow('未提供');
    const next = await f.runtime.prepareObserve({ mode: 'ax' }, f.context());
    expect(next.decision).toMatchObject({ behavior: 'ask', preview: { description: expect.stringContaining('后台单击、文字输入、滚轮、快捷键、右键、双击及窗内拖拽') } });
  });

  it('maps generic scroll from the approved image and never turns it into a click or press callback', async () => {
    const f = fixture();
    const pointerEvent = vi.fn();
    const lease = { shown: true, closed: Promise.resolve(true), dispose: vi.fn(), pointerEvent };
    f.dependencies.indicatePointer = vi.fn(async () => lease);
    const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'scroll', point: { x: 100, y: 200 }, deltaX: 0, deltaY: -400 }, seen.observationId);
    const result = await f.runtime.input(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.indicatePointer).toHaveBeenCalledWith(expect.objectContaining({ operation: 'click', point: { x: -749.75, y: 140.25 } }), expect.any(AbortSignal));
    expect(f.input).toHaveBeenCalledWith(expect.objectContaining({ operation: 'scroll', point: { x: -749.75, y: 140.25 }, deltaX: 0, deltaY: -400 }), f.controller.signal);
    expect(pointerEvent).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ inputOperation: 'scroll' });
    await f.runtime.releaseRun(f.owner.runId);
  });

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
    expect(seen.availableInputOperations).toEqual(['shortcut', 'typeText']);
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
    expect(seen).toMatchObject({ inputReady: false, availableInputOperations: [], inputNotice: expect.stringContaining('无法确认') });
    await expect(f.prepare({ operation: 'rightClick', point: { x: 1, y: 2 } }, seen.observationId)).rejects.toThrow('未提供');
    expect(f.input).not.toHaveBeenCalled();
  });
  it('withholds capability when the receiver profile changes across capture', async () => {
    const f = fixture(); f.inputStatus.mockResolvedValueOnce({ ready: true, profile: 'old', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'a'.repeat(64) });
    const seen = await f.observe();
    expect(seen.availableInputOperations).toEqual([]);
  });
  it.each(['profile', 'operation', 'point', 'target', 'frontmost'] as const)('rejects changed %s before commit and dispatch', async change => {
    const f = fixture(); const seen = await f.observe();
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId);
    if (change === 'profile') f.inputStatus.mockResolvedValue({ ready: true, profile: 'different', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'a'.repeat(64) });
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
    finish({ ready: true, profile: 'appkit-fixture-v1', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'a'.repeat(64) });
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

function closingIndicator(shown: boolean) {
  let close!: (confirmed: boolean) => void;
  const closed = new Promise<boolean>(resolve => { close = resolve; });
  let disposed!: () => void;
  const inClosing = new Promise<void>(resolve => { disposed = resolve; });
  const dispose = vi.fn(() => { disposed(); });
  const lease: AgentComputerWindowIndicatorLease = { shown, closed, dispose };
  return { lease, close, dispose, inClosing };
}

async function anotherRun(f: ReturnType<typeof fixture>) {
  const owner = { ...f.owner, runId: 'run-2', sessionId: 'session-2', toolRunId: 'tool-observe-2' };
  const controller = new AbortController();
  const context = { ...f.context(owner), signal: controller.signal };
  const observe = async () => {
    const prepared = await f.runtime.prepareObserve({ mode: 'both' }, context);
    return (await f.runtime.observe(f.execution(prepared, owner), controller.signal)).data as {
      observationId: string; availableInputOperations: string[]; inputNotice?: string; clickReady: boolean;
      textReady: boolean; scrollReady: boolean; elements: Array<{ elementId: string; label: string; operations: string[] }>;
    };
  };
  const seen = await observe();
  const prepare = async (values: Omit<Parameters<typeof f.runtime.prepareInput>[0], 'observationId'>, observationId = seen.observationId) =>
    f.execution(await f.runtime.prepareInput({ observationId, ...values }, context), owner);
  return { owner, controller, context, seen, observe, prepare };
}

async function activatePointer(f: ReturnType<typeof fixture>, visual: ReturnType<typeof closingIndicator>) {
  const seen = await f.observe();
  f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
  const prepared = await f.prepare({ operation: 'rightClick', point: { x: 100, y: 200 } }, seen.observationId);
  const running = f.runtime.input(prepared, f.controller.signal, f.commit);
  await vi.advanceTimersByTimeAsync(0);
  await running;
}

describe('Agent native pointer projection', () => {
  it('synchronizes a fresh same-window observation before capture and reuses the pointer for the next action', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      const syncTarget = vi.fn(async () => true); const update = vi.fn(async () => true);
      const pointerWindow = { ...f.window, windowId: 91, pid: 901, bounds: { x: -700, y: 140, width: 35, height: 35 } };
      const snapshot = vi.fn(async () => pointerWindow);
      Object.assign(visual.lease, { syncTarget, update, snapshot });
      f.dependencies.captureWithPointer = vi.fn(async () => ({ png: Buffer.from('with cursor'), cursorIncluded: true }));
      await activatePointer(f, visual);
      const previous = await f.observe();
      const oldAction = await f.prepare({ operation: 'doubleClick', point: { x: 100, y: 200 } }, previous.observationId);
      f.window.bounds.x += 50; f.window.bounds.width += 40; f.window.title = 'QA renamed'; f.window.windowLabel = 'QA renamed';
      await expect(f.runtime.input(oldAction, f.controller.signal, f.commit)).rejects.toThrow('移动或变化');
      expect(f.input).toHaveBeenCalledOnce();
      vi.mocked(f.dependencies.capture).mockClear(); vi.mocked(f.dependencies.captureWithPointer).mockClear(); snapshot.mockClear();
      const next = await f.observe();
      expect(syncTarget).toHaveBeenCalledOnce(); expect(syncTarget).toHaveBeenCalledWith(f.window);
      expect(syncTarget.mock.invocationCallOrder[0]).toBeLessThan(snapshot.mock.invocationCallOrder[0]);
      expect(f.dependencies.captureWithPointer).toHaveBeenCalledWith(f.window, f.controller.signal, pointerWindow);
      expect(f.dependencies.capture).not.toHaveBeenCalled(); expect(next).toMatchObject({ cursorIncluded: true });
      await expect(f.runtime.input(oldAction, f.controller.signal, f.commit)).rejects.toThrow('已过期');
      const action = await f.prepare({ operation: 'doubleClick', point: { x: 120, y: 220 } }, next.observationId);
      await expect(f.runtime.input(action, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ window: f.window }));
      expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce(); expect(visual.dispose).not.toHaveBeenCalled();
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
    } finally { vi.useRealTimers(); }
  });

  it('keeps a synchronized but temporarily unavailable native surface alive while capturing the ordinary window', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      const syncTarget = vi.fn(async () => true); const snapshot = vi.fn(async () => undefined);
      Object.assign(visual.lease, { syncTarget, snapshot });
      f.dependencies.captureWithPointer = vi.fn(async () => ({ png: Buffer.from('unused'), cursorIncluded: true }));
      await activatePointer(f, visual);
      f.window.bounds.y += 30;
      vi.mocked(f.dependencies.capture).mockClear();
      const next = await f.observe();
      expect(syncTarget).toHaveBeenCalledWith(f.window); expect(snapshot).toHaveBeenCalledOnce();
      expect(f.dependencies.captureWithPointer).not.toHaveBeenCalled();
      expect(f.dependencies.capture).toHaveBeenCalledWith(f.window, f.controller.signal);
      expect(next).toMatchObject({ cursorIncluded: false }); expect(visual.dispose).not.toHaveBeenCalled();
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
    } finally { vi.useRealTimers(); }
  });

  it('synchronizes AX-only observations without taking a screenshot or changing input observation authority', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      const syncTarget = vi.fn(async () => true); const snapshot = vi.fn(async () => undefined);
      Object.assign(visual.lease, { syncTarget, snapshot });
      await activatePointer(f, visual);
      f.window.bounds.y += 30;
      vi.mocked(f.dependencies.capture).mockClear();
      const next = await f.observe('ax');
      expect(syncTarget).toHaveBeenCalledWith(f.window); expect(snapshot).not.toHaveBeenCalled();
      expect(f.dependencies.capture).not.toHaveBeenCalled(); expect(next.availableInputOperations).toEqual(['shortcut', 'typeText']);
      expect(visual.dispose).not.toHaveBeenCalled();
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
    } finally { vi.useRealTimers(); }
  });

  it.each(['windowId', 'pid', 'processStartedAt'] as const)('never reuses a cursor when a new grant changes %s', async field => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      const syncTarget = vi.fn(async () => true); const snapshot = vi.fn(async () => undefined);
      Object.assign(visual.lease, { syncTarget, snapshot });
      await activatePointer(f, visual);
      f.window[field] += 1;
      const next = await f.runtime.prepareObserve({ application: 'QA' }, f.context());
      expect(next.decision.behavior).toBe('ask');
      await f.runtime.observe(f.execution(next), f.controller.signal);
      expect(visual.dispose).toHaveBeenCalledOnce(); expect(syncTarget).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled();
      visual.close(true); await f.runtime.releaseRun(f.owner.runId);
    } finally { vi.useRealTimers(); }
  });

  it.each(['unsupported', 'refused', 'rejected'] as const)('waits for actual closure after %s geometry synchronization', async state => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      if (state !== 'unsupported') visual.lease.syncTarget = vi.fn(async () => {
        if (state === 'rejected') throw new Error('sync unavailable');
        return false;
      });
      await activatePointer(f, visual); f.window.bounds.x += 50;
      vi.mocked(f.dependencies.capture).mockClear(); f.images.import.mockClear();
      const pending = f.observe();
      const result = state === 'rejected' ? expect(pending).rejects.toThrow('sync unavailable') : expect(pending).resolves.toMatchObject({ cursorIncluded: false });
      await visual.inClosing;
      expect(f.dependencies.capture).not.toHaveBeenCalled(); expect(f.images.import).not.toHaveBeenCalled();
      let finished = false; void pending.then(() => { finished = true; }, () => { finished = true; });
      await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(false);
      visual.close(true); await result;
      expect(f.dependencies.capture).toHaveBeenCalledTimes(state === 'rejected' ? 0 : 1);
      expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce();
      await f.runtime.releaseRun(f.owner.runId);
    } finally { vi.useRealTimers(); }
  });

  it.each(['cancelled', 'released'] as const)('rejects a late geometry ACK after the observation is %s and waits for actual closure', async change => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      let acknowledge!: (synced: boolean) => void;
      let entered!: () => void; const atSync = new Promise<void>(resolve => { entered = resolve; });
      visual.lease.syncTarget = vi.fn(() => { entered(); return new Promise<boolean>(resolve => { acknowledge = resolve; }); });
      const snapshot = vi.fn(async () => undefined); visual.lease.snapshot = snapshot;
      await activatePointer(f, visual); f.window.bounds.x += 50;
      vi.mocked(f.dependencies.capture).mockClear(); f.images.import.mockClear();
      const pending = f.observe(); const rejected = expect(pending).rejects.toThrow();
      await atSync;
      if (change === 'cancelled') f.controller.abort(); else f.runtime.releaseRun(f.owner.runId);
      await visual.inClosing; acknowledge(true);
      let finished = false; void pending.then(() => { finished = true; }, () => { finished = true; });
      await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(false);
      expect(snapshot).not.toHaveBeenCalled(); expect(f.dependencies.capture).not.toHaveBeenCalled(); expect(f.images.import).not.toHaveBeenCalled();
      visual.close(true); await rejected;
      expect(visual.dispose).toHaveBeenCalledOnce(); expect(f.input).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('keeps the global pointer gate closed when refused geometry synchronization cannot confirm native exit', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      visual.lease.syncTarget = vi.fn(async () => false);
      await activatePointer(f, visual); f.window.bounds.x += 50;
      const pending = f.observe(); const rejected = expect(pending).rejects.toBeInstanceOf(AgentComputerWindowIndicatorCloseError);
      await visual.inClosing; visual.close(false); await rejected;
      const fresh = await f.observe();
      expect(fresh.availableInputOperations).toEqual(['shortcut', 'typeText']);
      await expect(f.prepare({ operation: 'doubleClick', point: { x: 40, y: 50 } }, fresh.observationId)).rejects.toThrow('重启应用');
      visual.close(true);
      const other = await anotherRun(f);
      await expect(other.prepare({ operation: 'doubleClick', point: { x: 40, y: 50 } })).rejects.toThrow('重启应用');
      expect(f.input).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it.each([true, false])('imports the native cursor image when included=%s as the one canonical screenshot', async included => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      const pointerWindow = { ...f.window, windowId: 91, pid: 901, bounds: { x: -750, y: 140, width: 35, height: 35 } };
      const snapshot = vi.fn(async () => pointerWindow); visual.lease.snapshot = snapshot;
      const base = Buffer.from('actual target PNG'); const cursor = Buffer.from('actual target with cursor PNG');
      const captureWithPointer = vi.fn<NonNullable<AgentComputerRuntimeDependencies['captureWithPointer']>>(async () => ({
        png: included ? cursor : base, cursorIncluded: included,
      }));
      f.dependencies.captureWithPointer = captureWithPointer;
      await activatePointer(f, visual);
      vi.mocked(f.dependencies.capture).mockClear(); f.images.import.mockClear(); f.images.bind.mockClear();
      const seen = await f.observe();
      expect(snapshot).toHaveBeenCalledOnce();
      expect(captureWithPointer).toHaveBeenCalledOnce();
      expect(captureWithPointer).toHaveBeenCalledWith(f.window, f.controller.signal, pointerWindow);
      expect(f.dependencies.capture).not.toHaveBeenCalled();
      expect(f.images.import).toHaveBeenCalledOnce();
      expect(f.images.import).toHaveBeenCalledWith({ ownerScope: f.owner.ownerScope, libraryId: f.owner.libraryId,
        name: '窗口截图.png', base64: (included ? cursor : base).toString('base64') });
      expect(f.images.bind).toHaveBeenCalledOnce();
      expect(seen).toMatchObject({ cursorPresentation: 'native-window', cursorIncluded: included,
        imageId: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68' });
      expect(JSON.stringify(seen)).not.toMatch(/pointerWindow|windowId|cursorPng|processStartedAt/);
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
    } finally { vi.useRealTimers(); }
  });

  it.each(['unavailable', 'rejected', 'hidden'] as const)('captures the base window when the pointer snapshot is %s', async state => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      const snapshot = vi.fn<NonNullable<AgentComputerWindowIndicatorLease['snapshot']>>(async () => undefined);
      if (state === 'rejected') snapshot.mockRejectedValue(new Error('surface no longer available'));
      visual.lease.snapshot = snapshot;
      f.dependencies.captureWithPointer = vi.fn(async () => ({ png: Buffer.from('unused'), cursorIncluded: false }));
      await activatePointer(f, visual);
      if (state === 'hidden') visual.lease.shown = false;
      vi.mocked(f.dependencies.capture).mockClear(); f.images.import.mockClear();
      const seen = await f.observe();
      expect(snapshot).toHaveBeenCalledTimes(state === 'hidden' ? 0 : 1);
      expect(f.dependencies.captureWithPointer).not.toHaveBeenCalled();
      expect(f.dependencies.capture).toHaveBeenCalledOnce();
      expect(f.dependencies.capture).toHaveBeenCalledWith(f.window, f.controller.signal);
      expect(f.images.import).toHaveBeenCalledOnce();
      expect(f.images.import).toHaveBeenCalledWith(expect.objectContaining({ base64: Buffer.from('png').toString('base64') }));
      expect(seen).toMatchObject({ cursorPresentation: 'native-window', cursorIncluded: false });
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
    } finally { vi.useRealTimers(); }
  });

  it('keeps AX-only observation free of screenshot and pointer snapshot calls while a cursor is live', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      const snapshot = vi.fn(async () => ({ ...f.window, windowId: 91, pid: 901 })); visual.lease.snapshot = snapshot;
      f.dependencies.captureWithPointer = vi.fn(async () => ({ png: Buffer.from('unused'), cursorIncluded: false }));
      await activatePointer(f, visual);
      vi.mocked(f.dependencies.capture).mockClear(); f.images.import.mockClear();
      const seen = await f.observe('ax');
      expect(snapshot).not.toHaveBeenCalled(); expect(f.dependencies.captureWithPointer).not.toHaveBeenCalled();
      expect(f.dependencies.capture).not.toHaveBeenCalled(); expect(f.images.import).not.toHaveBeenCalled();
      expect(seen.availableInputOperations).toEqual(['shortcut', 'typeText']);
      expect(seen).not.toHaveProperty('cursorIncluded'); expect(seen).not.toHaveProperty('imageId');
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
    } finally { vi.useRealTimers(); }
  });

  it.each(['dispatched', 'unknown'] as const)('forwards only actual input progress and restores visual pressure without inventing %s receipts or an up event', async state => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const seen = await f.observe(); const visual = closingIndicator(true);
      let pressed = false;
      const pointerEvent = vi.fn<NonNullable<AgentComputerWindowIndicatorLease['pointerEvent']>>(event => {
        if (event.phase === 'down') pressed = true;
        if (event.phase === 'up') pressed = false;
      });
      const inputSettled = vi.fn(() => { pressed = false; });
      Object.assign(visual.lease, { pointerEvent, inputSettled });
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      let feedback: Parameters<NonNullable<AgentComputerRuntimeDependencies['input']>>[2];
      let resolveInput!: (value: Awaited<ReturnType<NonNullable<AgentComputerRuntimeDependencies['input']>>>) => void;
      let rejectInput!: (reason: Error) => void;
      f.input.mockImplementationOnce((_request, _signal, onPointerEvent) => {
        feedback = onPointerEvent;
        return new Promise((resolve, reject) => { resolveInput = resolve; rejectInput = reject; });
      });
      const prepared = await f.prepare({ operation: 'drag', point: { x: 100, y: 200 }, endPoint: { x: 600, y: 400 }, durationMs: 100 }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0);
      expect(feedback).toEqual(expect.any(Function));
      expect(pointerEvent).not.toHaveBeenCalled(); expect(inputSettled).not.toHaveBeenCalled();
      expect(f.commit.settle).not.toHaveBeenCalled();
      const down = { phase: 'down' as const, point: { x: -749.75, y: 140.25 }, sequence: 1 };
      const move = { phase: 'move' as const, point: { x: -700.25, y: 160.25 }, sequence: 2 };
      feedback!(down); feedback!(move);
      expect(pointerEvent.mock.calls.map(call => call[0])).toEqual([
        { phase: down.phase, point: down.point }, { phase: move.phase, point: move.point },
      ]);
      expect(pressed).toBe(true); expect(f.commit.settle).not.toHaveBeenCalled();
      // Telemetry can lose the up even when native independently confirms it.
      if (state === 'dispatched') resolveInput({ dispatched: true, method: 'CGEventPostToPid', eventCount: 10, releaseSent: true });
      else rejectInput(new AgentComputerWindowInputError('native sequence interrupted', 'unknown', 'confirmed'));
      const result = await running;
      expect(result).toMatchObject({ ok: state === 'dispatched', data: { dispatchState: state,
        mutationCommitState: state === 'dispatched' ? 'committed' : 'commit_unknown', releaseState: 'confirmed' } });
      expect(f.commit.settle).toHaveBeenCalledOnce(); expect(f.commit.settle).toHaveBeenCalledWith(result);
      expect(inputSettled).toHaveBeenCalledOnce(); expect(pressed).toBe(false);
      expect(pointerEvent).toHaveBeenCalledTimes(2);
      feedback!({ phase: 'up', point: move.point, sequence: 3 });
      expect(pointerEvent).toHaveBeenCalledTimes(2);
      expect(visual.dispose).not.toHaveBeenCalled();
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
    } finally { vi.useRealTimers(); }
  });

  it('retains the original two-argument input route when no active visual lease exists', async () => {
    const f = fixture(); const seen = await f.observe();
    const pointerEvent = vi.fn(); const inputSettled = vi.fn();
    f.dependencies.indicatePointer = vi.fn(async () => ({ shown: false, closed: Promise.resolve(true),
      dispose: vi.fn(), pointerEvent, inputSettled }));
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 100, y: 200 } }, seen.observationId);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
    expect(f.input.mock.calls[0]).toHaveLength(2);
    expect(pointerEvent).not.toHaveBeenCalled(); expect(inputSettled).not.toHaveBeenCalled();
  });

  it('drops pending native feedback after Run release without replacing the authoritative input result', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const seen = await f.observe(); const visual = closingIndicator(true);
      const pointerEvent = vi.fn(); const inputSettled = vi.fn(); Object.assign(visual.lease, { pointerEvent, inputSettled });
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      let feedback: Parameters<NonNullable<AgentComputerRuntimeDependencies['input']>>[2];
      let complete!: (value: Awaited<ReturnType<NonNullable<AgentComputerRuntimeDependencies['input']>>>) => void;
      f.input.mockImplementationOnce((_request, _signal, onPointerEvent) => {
        feedback = onPointerEvent; return new Promise(resolve => { complete = resolve; });
      });
      const prepared = await f.prepare({ operation: 'rightClick', point: { x: 100, y: 200 } }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0);
      const down = { phase: 'down' as const, point: { x: -749.75, y: 140.25 }, sequence: 1 };
      feedback!(down); expect(pointerEvent).toHaveBeenCalledOnce();
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
      feedback!({ ...down, phase: 'up', sequence: 2 });
      expect(pointerEvent).toHaveBeenCalledOnce();
      complete({ dispatched: true, method: 'CGEventPostToPid', eventCount: 2, releaseSent: true });
      await expect(running).resolves.toMatchObject({ ok: true, data: { dispatchState: 'dispatched', releaseState: 'confirmed' } });
      expect(inputSettled).not.toHaveBeenCalled(); expect(visual.dispose).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('never routes a completed gesture callback into its replacement visual lease', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const first = closingIndicator(true); const second = closingIndicator(true);
      const firstPointer = vi.fn(); const secondPointer = vi.fn();
      Object.assign(first.lease, { pointerEvent: firstPointer, inputSettled: vi.fn() });
      Object.assign(second.lease, { pointerEvent: secondPointer, inputSettled: vi.fn() });
      let previousFeedback: Parameters<NonNullable<AgentComputerRuntimeDependencies['input']>>[2];
      f.input.mockImplementationOnce(async (request, _signal, feedback) => {
        previousFeedback = feedback;
        feedback!({ phase: 'down', point: request.point!, sequence: 1 });
        return { dispatched: true, method: 'CGEventPostToPid', eventCount: 2, releaseSent: true };
      });
      await activatePointer(f, first);
      first.close(true); await Promise.resolve();
      const seen = await f.observe();
      f.dependencies.indicatePointer = vi.fn(async () => second.lease);
      let currentFeedback: Parameters<NonNullable<AgentComputerRuntimeDependencies['input']>>[2];
      let complete!: (value: Awaited<ReturnType<NonNullable<AgentComputerRuntimeDependencies['input']>>>) => void;
      f.input.mockImplementationOnce((_request, _signal, feedback) => {
        currentFeedback = feedback; return new Promise(resolve => { complete = resolve; });
      });
      const prepared = await f.prepare({ operation: 'rightClick', point: { x: 200, y: 300 } }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0);
      previousFeedback!({ phase: 'up', point: { x: -749.75, y: 140.25 }, sequence: 2 });
      expect(firstPointer).toHaveBeenCalledOnce(); expect(secondPointer).not.toHaveBeenCalled();
      currentFeedback!({ phase: 'down', point: { x: -699.75, y: 190.25 }, sequence: 1 });
      expect(secondPointer).toHaveBeenCalledOnce();
      expect(secondPointer).toHaveBeenCalledWith({ phase: 'down', point: { x: -699.75, y: 190.25 } });
      complete({ dispatched: true, method: 'CGEventPostToPid', eventCount: 2, releaseSent: true }); await running;
      f.runtime.releaseRun(f.owner.runId); second.close(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('Agent pointer intent indicator', () => {
  it('previews the sealed screenshot coordinates only during execution and closes before committing', async () => {
    const f = fixture(); const seen = await f.observe();
    const dispose = vi.fn();
    const show = vi.fn<NonNullable<AgentComputerRuntimeDependencies['indicatePointer']>>(async () => ({ shown: false, closed: Promise.resolve(true), dispose }));
    f.dependencies.indicatePointer = show;
    const prepared = await f.prepare({ operation: 'drag', point: { x: 100, y: 200 }, endPoint: { x: 600, y: 400 }, durationMs: 100 }, seen.observationId);
    expect(show).not.toHaveBeenCalled();
    const result = await f.runtime.input(prepared, f.controller.signal, f.commit);
    expect(show).toHaveBeenCalledWith({ window: f.window, operation: 'drag', point: { x: -749.75, y: 140.25 },
      endPoint: { x: -499.75, y: 240.25 } }, expect.any(AbortSignal));
    expect(show.mock.invocationCallOrder[0]).toBeLessThan(f.commit.begin.mock.invocationCallOrder[0]);
    expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(f.commit.begin.mock.invocationCallOrder[0]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, data: { dispatchState: 'dispatched', releaseState: 'confirmed' } });
    expect(JSON.stringify(result)).not.toMatch(/indicator|shown|profile|windowId/);
  });
  it('also indicates a validated AX-only click at the actual control center', async () => {
    const f = fixture(); const dispose = vi.fn();
    f.dependencies.targets = vi.fn(async window => ({ target: { ...window, candidates: [
      { path: [0], role: 'AXButton', title: 'Fixture button', bounds: { x: -700, y: 100, width: 100, height: 40 } },
    ] }, truncated: false }));
    const show = vi.fn<NonNullable<AgentComputerRuntimeDependencies['indicatePointer']>>(async () => ({ shown: false, closed: Promise.resolve(true), dispose }));
    f.dependencies.indicatePointer = show;
    const elements = (await f.runtime.observe(f.execution(await f.runtime.prepareObserve({ mode: 'ax' }, f.context())), f.controller.signal)).data as {
      observationId: string; elements: Array<{ elementId: string }>;
    };
    const prepared = await f.runtime.prepareClick({ observationId: elements.observationId, elementId: elements.elements[0].elementId }, f.context());
    await expect(f.runtime.click(f.execution(prepared), f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
    expect(show).toHaveBeenCalledWith({ window: f.window, operation: 'click', point: { x: -650, y: 120 } }, expect.any(AbortSignal));
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('does not invent a pointer location for a shortcut', async () => {
    const f = fixture(); const seen = await f.observe('ax');
    const show = vi.fn<NonNullable<AgentComputerRuntimeDependencies['indicatePointer']>>(async () => ({ shown: false, closed: Promise.resolve(true), dispose: vi.fn() }));
    f.dependencies.indicatePointer = show;
    const prepared = await f.prepare({ operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } }, seen.observationId);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
    expect(show).not.toHaveBeenCalled();
  });
  it('continues the original input route when the adapter proves no visual child remains', async () => {
    const f = fixture(); const seen = await f.observe();
    f.dependencies.indicatePointer = vi.fn(async () => ({ shown: false, closed: Promise.resolve(true), dispose: vi.fn() }));
    const prepared = await f.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } }, seen.observationId);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true,
      data: { dispatchState: 'dispatched', releaseState: 'confirmed' } });
    expect(f.input).toHaveBeenCalledOnce();
  });
  it('does not assume that a rejected visual adapter proves no child was spawned', async () => {
    const f = fixture(); const seen = await f.observe();
    f.dependencies.indicatePointer = vi.fn(async () => { throw new Error('visual lifecycle unavailable'); });
    const prepared = await f.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } }, seen.observationId);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow('visual lifecycle unavailable');
    expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
    await expect(f.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } }, seen.observationId)).rejects.toThrow('重启应用');
  });
  it.each(['cancelled', 'released', 'moved', 'expired', 'receiver changed'] as const)('never commits after %s while the preview starts', async change => {
    const f = fixture(); const seen = await f.observe();
    let entered!: () => void; const inPreview = new Promise<void>(resolve => { entered = resolve; });
    let ready!: (lease: AgentComputerWindowIndicatorLease) => void; const dispose = vi.fn();
    let visualSignal!: AbortSignal;
    f.dependencies.indicatePointer = vi.fn<NonNullable<AgentComputerRuntimeDependencies['indicatePointer']>>((_request, signal) => {
      visualSignal = signal; entered(); return new Promise<AgentComputerWindowIndicatorLease>(resolve => { ready = resolve; });
    });
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId);
    const running = f.runtime.input(prepared, f.controller.signal, f.commit);
    const rejected = expect(running).rejects.toThrow();
    await inPreview;
    if (change === 'cancelled') f.controller.abort();
    else if (change === 'released') f.runtime.releaseRun(f.owner.runId);
    else if (change === 'moved') f.window.bounds.x += 20;
    else if (change === 'expired') f.advance(60_001);
    else f.inputStatus.mockResolvedValue({ ready: false, operations: [], reason: 'focused_window_mismatch' });
    if (change === 'cancelled' || change === 'released') expect(visualSignal.aborted).toBe(true);
    ready({ shown: false, closed: Promise.resolve(true), dispose });
    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
    expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
  });
  it('cleans the indicator when a real input reports unknown without changing its release state', async () => {
    const f = fixture(); const seen = await f.observe(); const dispose = vi.fn();
    f.dependencies.indicatePointer = vi.fn(async () => ({ shown: false, closed: Promise.resolve(true), dispose }));
    f.input.mockRejectedValueOnce(new AgentComputerWindowInputError('cancelled', 'unknown', 'unconfirmed'));
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: false,
      data: { dispatchState: 'unknown', releaseState: 'unconfirmed' } });
    expect(dispose).toHaveBeenCalledOnce();
    expect((await f.observe()).availableInputOperations).toEqual([]);
  });
  it('waits only for native readiness and keeps the visible intention after input finishes', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const seen = await f.observe(); const visual = closingIndicator(true);
      const dispose = visual.dispose;
      let ready!: (lease: AgentComputerWindowIndicatorLease) => void;
      f.dependencies.indicatePointer = vi.fn(() => new Promise<AgentComputerWindowIndicatorLease>(resolve => { ready = resolve; }));
      const prepared = await f.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce();
      expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.input).not.toHaveBeenCalled();
      ready(visual.lease);
      // A ready native lease already completed its own appearance animation.
      // No timer is advanced between readiness and the actual input.
      await expect(running).resolves.toMatchObject({ ok: true });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(dispose).not.toHaveBeenCalled();
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
      expect(dispose).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('immediately removes a visible intention on Run release without sending the action', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const seen = await f.observe(); const visual = closingIndicator(true);
      const dispose = visual.dispose;
      let ready!: (lease: AgentComputerWindowIndicatorLease) => void;
      f.dependencies.indicatePointer = vi.fn(() => new Promise<AgentComputerWindowIndicatorLease>(resolve => { ready = resolve; }));
      const prepared = await f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      const rejected = expect(running).rejects.toThrow('窗口共享已结束');
      await vi.advanceTimersByTimeAsync(0);
      f.runtime.releaseRun(f.owner.runId);
      ready(visual.lease);
      await visual.inClosing;
      expect(dispose).toHaveBeenCalledOnce();
      visual.close(true);
      await rejected;
      expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.input).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('waits for actual visual closure before dispatch when startup did not show a surface', async () => {
    const shown = false;
    vi.useFakeTimers();
    try {
      const f = fixture(); const seen = await f.observe(); const visual = closingIndicator(shown);
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      const prepared = await f.prepare({ operation: 'drag', point: { x: 10, y: 10 }, endPoint: { x: 20, y: 20 }, durationMs: 300 }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await visual.inClosing;
      expect(visual.dispose).toHaveBeenCalledOnce();
      const windowsBeforeClosure = vi.mocked(f.dependencies.windows).mock.calls.length;
      const statusBeforeClosure = f.inputStatus.mock.calls.length;
      expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.commit.settle).not.toHaveBeenCalled(); expect(f.input).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(f.input).not.toHaveBeenCalled();
      visual.close(true);
      await expect(running).resolves.toMatchObject({ ok: true });
      expect(vi.mocked(f.dependencies.windows).mock.calls.length).toBeGreaterThan(windowsBeforeClosure);
      expect(f.inputStatus.mock.calls.length).toBeGreaterThan(statusBeforeClosure);
      expect(visual.dispose.mock.invocationCallOrder[0]).toBeLessThan(f.commit.begin.mock.invocationCallOrder[0]);
      expect(f.input).toHaveBeenCalledOnce(); expect(visual.dispose).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('reuses one live surface across observations, shortcuts and later pointer intentions, and explicitly hides it', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const first = await f.observe(); const visual = closingIndicator(true);
      const update = vi.fn(async () => true); visual.lease.update = update;
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      const act = async (observationId: string, point: { x: number; y: number }) => {
        const prepared = await f.prepare({ operation: 'doubleClick', point }, observationId);
        const running = f.runtime.input(prepared, f.controller.signal, f.commit);
        await vi.advanceTimersByTimeAsync(0); await running;
      };
      await act(first.observationId, { x: 10, y: 10 });
      const after = await f.observe('ax');
      const shortcut = await f.prepare({ operation: 'shortcut', shortcut: { key: 'arrowLeft', modifiers: [] } }, after.observationId);
      await f.runtime.input(shortcut, f.controller.signal, f.commit);
      expect(visual.dispose).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
      const next = await f.observe(); await act(next.observationId, { x: 40, y: 50 });
      expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ operation: 'doubleClick', point: { x: -779.75, y: 65.25 } }));
      const other = await anotherRun(f);
      await expect(f.runtime.hidePointerForRun(other.owner, other.controller.signal)).resolves.toEqual({ closeConfirmed: true });
      expect(visual.dispose).not.toHaveBeenCalled();
      await expect(f.runtime.hidePointerForRun({ ...f.owner, ownerWebContentsId: 18 }, f.controller.signal)).rejects.toThrow('不属于');
      expect(visual.dispose).not.toHaveBeenCalled();
      const hiding = f.runtime.hidePointerForRun(f.owner, f.controller.signal);
      await visual.inClosing; visual.close(true);
      await expect(hiding).resolves.toEqual({ closeConfirmed: true });
      await expect(f.runtime.hidePointerForRun(f.owner, f.controller.signal)).resolves.toEqual({ closeConfirmed: true });
      expect(visual.dispose).toHaveBeenCalledOnce();
      expect(f.input).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('waits for a reused pointer movement ACK and dispatches without an additional timer', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      let moved!: (shown: boolean) => void;
      let entered!: () => void; const inMovement = new Promise<void>(resolve => { entered = resolve; });
      const update = vi.fn(() => { entered(); return new Promise<boolean>(resolve => { moved = resolve; }); });
      visual.lease.update = update;
      await activatePointer(f, visual);
      const next = await f.observe();
      const prepared = await f.prepare({ operation: 'doubleClick', point: { x: 40, y: 50 } }, next.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await inMovement;
      expect(f.input).toHaveBeenCalledOnce(); expect(f.commit.begin).toHaveBeenCalledOnce();
      moved(true);
      // Keep all timers frozen: native movement completion is the only wait.
      await expect(running).resolves.toMatchObject({ ok: true });
      expect(f.input).toHaveBeenCalledTimes(2);
      expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledOnce();
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
    } finally { vi.useRealTimers(); }
  });

  it.each(['cancelled', 'released', 'moved', 'expired'] as const)(
    'revalidates the original action after a reused movement ACK when %s', async change => {
      vi.useFakeTimers();
      try {
        const f = fixture(); const visual = closingIndicator(true);
        let moved!: (shown: boolean) => void;
        let entered!: () => void; const inMovement = new Promise<void>(resolve => { entered = resolve; });
        visual.lease.update = vi.fn(() => { entered(); return new Promise<boolean>(resolve => { moved = resolve; }); });
        await activatePointer(f, visual);
        const next = await f.observe();
        const prepared = await f.prepare({ operation: 'doubleClick', point: { x: 40, y: 50 } }, next.observationId);
        const running = f.runtime.input(prepared, f.controller.signal, f.commit);
        const rejected = expect(running).rejects.toThrow();
        await inMovement;
        if (change === 'cancelled') f.controller.abort();
        else if (change === 'released') f.runtime.releaseRun(f.owner.runId);
        else if (change === 'moved') f.window.bounds.x += 20;
        else f.advance(60_001);
        moved(true);
        await visual.inClosing; visual.close(true); await rejected;
        expect(f.input).toHaveBeenCalledOnce(); expect(f.commit.begin).toHaveBeenCalledOnce();
        expect(visual.dispose).toHaveBeenCalledOnce();
      } finally { vi.useRealTimers(); }
    },
  );

  it.each([false, true])('keeps the actual closure barrier through explicit normal hide with cancellation=%s', async cancelled => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true); const hide = vi.fn(); visual.lease.hide = hide;
      await activatePointer(f, visual);
      const controller = new AbortController();
      const hiding = f.runtime.hidePointerForRun(f.owner, controller.signal);
      const outcome = cancelled ? expect(hiding).rejects.toMatchObject({ name: 'AbortError' })
        : expect(hiding).resolves.toEqual({ closeConfirmed: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(hide).toHaveBeenCalledOnce(); expect(visual.dispose).not.toHaveBeenCalled();
      if (cancelled) controller.abort();
      expect(visual.dispose).toHaveBeenCalledTimes(cancelled ? 1 : 0);
      let ended = false; void hiding.then(() => { ended = true; }, () => { ended = true; });
      await vi.advanceTimersByTimeAsync(0); expect(ended).toBe(false);
      visual.close(true); await outcome;
      expect(hide).toHaveBeenCalledOnce(); expect(visual.dispose).toHaveBeenCalledTimes(cancelled ? 1 : 0);
    } finally { vi.useRealTimers(); }
  });

  it.each([false, true])('revokes a normally completed Run synchronously while retaining its fade with cancellation=%s', async cancelled => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true); const hide = vi.fn(); visual.lease.hide = hide;
      await activatePointer(f, visual);
      const seen = await f.observe();
      const prepared = await f.prepare({ operation: 'doubleClick', point: { x: 40, y: 50 } }, seen.observationId);
      const releasing = f.runtime.releaseRun(f.owner.runId, 'normal');
      let released = false; void releasing.then(() => { released = true; });
      expect(hide).toHaveBeenCalledOnce(); expect(visual.dispose).not.toHaveBeenCalled();
      const denied = f.runtime.input(prepared, f.controller.signal, f.commit);
      await expect(denied).rejects.toThrow('不属于当前共享窗口');
      expect(f.input).toHaveBeenCalledOnce();
      if (cancelled) f.runtime.releaseRun(f.owner.runId);
      expect(visual.dispose).toHaveBeenCalledTimes(cancelled ? 1 : 0);
      await vi.advanceTimersByTimeAsync(0); expect(released).toBe(false);
      visual.close(true); await releasing;
      expect(released).toBe(true);
      expect(hide).toHaveBeenCalledOnce(); expect(visual.dispose).toHaveBeenCalledTimes(cancelled ? 1 : 0);
    } finally { vi.useRealTimers(); }
  });

  it('does not let a finished normal cleanup delete a newer share of the same Run', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true); const hide = vi.fn(); visual.lease.hide = hide;
      await activatePointer(f, visual);
      const releasing = f.runtime.releaseRun(f.owner.runId, 'normal');
      const replacement = await f.observe();
      expect(hide).toHaveBeenCalledOnce(); expect(visual.dispose).toHaveBeenCalledOnce();
      visual.close(true); await releasing;
      delete f.dependencies.indicatePointer;
      const prepared = await f.prepare({ operation: 'doubleClick', point: { x: 40, y: 50 } }, replacement.observationId);
      await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
      expect(f.input).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('keeps the intended location after unknown input and closes it only when the Run releases', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const seen = await f.observe(); const visual = closingIndicator(true);
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      f.input.mockRejectedValueOnce(new AgentComputerWindowInputError('transient', 'unknown', 'confirmed'));
      const prepared = await f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0);
      await expect(running).resolves.toMatchObject({ ok: false, data: { dispatchState: 'unknown' } });
      expect(visual.dispose).not.toHaveBeenCalled();
      f.runtime.releaseRun(f.owner.runId); visual.close(true);
      expect(visual.dispose).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it.each(['normal', 'immediate'] as const)('waits for pending %s Run-release cleanup before admitting another pointer action', async mode => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const seen = await f.observe(); const next = await anotherRun(f); const visual = closingIndicator(true);
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      const first = await f.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } }, seen.observationId);
      const running = f.runtime.input(first, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0); await running;
      const hide = vi.fn(); visual.lease.hide = hide;
      f.runtime.releaseRun(f.owner.runId, mode);
      expect(hide).toHaveBeenCalledTimes(mode === 'normal' ? 1 : 0);
      expect(visual.dispose).toHaveBeenCalledTimes(mode === 'immediate' ? 1 : 0);
      const nextPrepared = await next.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } });
      const nextRunning = f.runtime.input(nextPrepared, next.controller.signal, f.commit);
      const rejected = expect(nextRunning).rejects.toThrow('重启应用');
      await vi.advanceTimersByTimeAsync(50);
      expect(f.input).toHaveBeenCalledOnce();
      visual.close(false); await rejected;
      await expect(f.runtime.hidePointerForRun(next.owner, next.controller.signal)).resolves.toEqual({ closeConfirmed: false });
    } finally { vi.useRealTimers(); }
  });

  it('refuses an unconfirmed visual exit without consuming the observation, and retains its pointer gate after late closure', async () => {
    const f = fixture(); const seen = await f.observe(); const visual = closingIndicator(false);
    f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
    const values = { operation: 'rightClick' as const, point: { x: 10, y: 10 } };
    const prepared = await f.prepare(values, seen.observationId);
    const running = f.runtime.input(prepared, f.controller.signal, f.commit);
    const rejected = expect(running).rejects.toThrow('图案关闭未确认');
    await visual.inClosing;
    visual.close(false); await rejected;
    visual.close(true); await Promise.resolve();
    expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.commit.settle).not.toHaveBeenCalled();
    expect(visual.dispose).toHaveBeenCalledOnce();
    await expect(f.prepare(values, seen.observationId)).rejects.toThrow('重启应用');
    const nextPrepared = await f.prepare({ operation: 'shortcut', shortcut: { key: 'arrowLeft', modifiers: [] } }, seen.observationId);
    f.dependencies.indicatePointer = vi.fn(async () => ({ shown: false, closed: Promise.resolve(true), dispose: vi.fn() }));
    await expect(f.runtime.input(nextPrepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true });
    expect(f.input).toHaveBeenCalledOnce();
  });

  it.each(['cancelled', 'released', 'owner changed', 'moved', 'expired', 'receiver profile changed', 'receiver capability removed'] as const)(
    'revalidates after real visual exit and never commits after %s while awaiting closure', async change => {
      const f = fixture(); const seen = await f.observe(); const visual = closingIndicator(false);
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      const prepared = await f.prepare({ operation: 'drag', point: { x: 10, y: 10 }, endPoint: { x: 20, y: 20 }, durationMs: 300 }, seen.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      const rejected = expect(running).rejects.toThrow();
      await visual.inClosing;
      if (change === 'cancelled') f.controller.abort();
      else if (change === 'released') f.runtime.releaseRun(f.owner.runId);
      else if (change === 'owner changed') Object.assign(f.owner, { ownerScope: { ...f.owner.ownerScope, accountScope: 'user:8' } });
      else if (change === 'moved') f.window.bounds.x += 20;
      else if (change === 'expired') f.advance(60_001);
      else if (change === 'receiver profile changed') f.inputStatus.mockResolvedValue({ ready: true, profile: 'textedit-415-25f84-v1', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'a'.repeat(64) });
      else f.inputStatus.mockResolvedValue({ ready: true, profile: 'appkit-fixture-v1', operations: ['shortcut'] });
      expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled();
      visual.close(true); await rejected;
      expect(f.input).not.toHaveBeenCalled(); expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.commit.settle).not.toHaveBeenCalled();
      expect(visual.dispose).toHaveBeenCalledOnce();
    },
  );

  it.each([true, false])('keeps another Run queued through startup cancellation and preserves the pointer gate when closure=%s', async confirmed => {
    const f = fixture(); const seen = await f.observe(); const next = await anotherRun(f);
    const nextPointer = await next.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } });
    const nextShortcut = await next.prepare({ operation: 'shortcut', shortcut: { key: 'arrowLeft', modifiers: [] } });
    const visual = closingIndicator(false);
    let entered!: () => void; const inStartup = new Promise<void>(resolve => { entered = resolve; });
    f.dependencies.indicatePointer = vi.fn<NonNullable<AgentComputerRuntimeDependencies['indicatePointer']>>(async () => ({
      shown: false, closed: Promise.resolve(true), dispose: vi.fn(),
    })).mockImplementationOnce((_request, signal) => {
      entered();
      // Match the native adapter contract: a cancelled spawned startup holds
      // this Promise until closure, then distinguishes true cleanup from false.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          void visual.lease.closed.then(closed => { reject(closed ? signal.reason : new AgentComputerWindowIndicatorCloseError()); });
        }, { once: true });
      });
    });
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId);
    const running = f.runtime.input(prepared, f.controller.signal, f.commit);
    const cancelled = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await inStartup; f.controller.abort();
    const nextCommit = { begin: vi.fn(), settle: vi.fn() };
    const nextRunning = f.runtime.input(nextPointer, next.controller.signal, nextCommit);
    const nextOutcome = confirmed ? expect(nextRunning).resolves.toMatchObject({ ok: true })
      : expect(nextRunning).rejects.toThrow('重启应用');
    await Promise.resolve(); await Promise.resolve();
    expect(f.input).not.toHaveBeenCalled(); expect(nextCommit.begin).not.toHaveBeenCalled();
    visual.close(confirmed); await cancelled; await nextOutcome;
    f.runtime.releaseRun(f.owner.runId);
    if (confirmed) {
      expect(f.input).toHaveBeenCalledOnce(); expect(nextCommit.begin).toHaveBeenCalledOnce();
    } else {
      expect(f.input).not.toHaveBeenCalled(); expect(nextCommit.begin).not.toHaveBeenCalled();
      visual.close(true); await Promise.resolve();
      const observed = await next.observe();
      expect(observed.availableInputOperations).toEqual(['shortcut', 'typeText']);
      expect(observed.inputNotice).toContain('重启应用');
      await expect(next.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, observed.observationId)).rejects.toThrow('重启应用');
      // The pre-sealed shortcut is unaffected by the pointer-specific gate.
      await expect(f.runtime.input(nextShortcut, next.controller.signal, nextCommit)).rejects.toThrow('过期');
      const shortcut = await next.prepare({ operation: 'shortcut', shortcut: { key: 'arrowLeft', modifiers: [] } }, observed.observationId);
      await expect(f.runtime.input(shortcut, next.controller.signal, nextCommit)).resolves.toMatchObject({ ok: true });
      expect(f.input).toHaveBeenCalledOnce();
    }
    expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.commit.settle).not.toHaveBeenCalled();
  });

  it.each(['false', 'show rejection', 'closed rejection'] as const)('blocks new grants and pre-sealed clicks across Runs after %s without disabling text, scroll or shortcuts', async failure => {
    const f = fixture();
    f.dependencies.targets = vi.fn(async window => ({ target: { ...window, candidates: [
      { path: [0], role: 'AXButton', title: 'QA button', bounds: { x: -700, y: 100, width: 100, height: 40 }, operations: ['press'] },
      { path: [1], role: 'AXTextArea', title: 'QA text', bounds: { x: -600, y: 160, width: 200, height: 100 },
        operations: ['replaceText', 'insertText'], textState: { subrole: null, selection: { location: 0, length: 0 } } },
      { path: [2], role: 'AXButton', title: 'QA scroll', bounds: { x: -400, y: 200, width: 20, height: 20 }, operations: ['scrollDownPage'] },
    ] }, truncated: false }));
    const seen = await f.observe(); const next = await anotherRun(f);
    const button = next.seen.elements.find(element => element.label === 'QA button')!;
    const click = f.execution(await f.runtime.prepareClick({ observationId: next.seen.observationId, elementId: button.elementId }, next.context), next.owner);
    const pointer = await next.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } });
    if (failure === 'show rejection') f.dependencies.indicatePointer = vi.fn(async () => { throw new Error('unknown visual lifecycle'); });
    else f.dependencies.indicatePointer = vi.fn(async () => ({ shown: false,
      closed: failure === 'false' ? Promise.resolve(false) : Promise.reject(new Error('unknown visual closure')), dispose: vi.fn() }));
    const prepared = await f.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } }, seen.observationId);
    await expect(f.runtime.input(prepared, f.controller.signal, f.commit)).rejects.toThrow();
    f.runtime.releaseRun(f.owner.runId);
    const nextCommit = { begin: vi.fn(), settle: vi.fn() };
    await expect(f.runtime.input(pointer, next.controller.signal, nextCommit)).rejects.toThrow('重启应用');
    await expect(f.runtime.click(click, next.controller.signal, nextCommit)).rejects.toThrow('重启应用');
    f.runtime.releaseRun(next.owner.runId);
    const observed = await next.observe();
    expect(observed).toMatchObject({ clickReady: false, textReady: true, scrollReady: true, availableInputOperations: ['shortcut', 'typeText'] });
    expect(observed.elements.every(element => !element.operations.includes('press'))).toBe(true);
    expect(observed.inputNotice).toContain('重启应用');
    const text = observed.elements.find(element => element.label === 'QA text')!;
    const setText = f.execution(await f.runtime.prepareSetText({ observationId: observed.observationId, elementId: text.elementId,
      text: 'QA', mode: 'replace' }, next.context), next.owner);
    await expect(f.runtime.setText(setText, next.controller.signal, nextCommit)).resolves.toMatchObject({ ok: true });
    const afterText = await next.observe();
    const scroll = afterText.elements.find(element => element.label === 'QA scroll')!;
    const preparedScroll = f.execution(await f.runtime.prepareScroll({ observationId: afterText.observationId, elementId: scroll.elementId,
      direction: 'down', unit: 'page' }, next.context), next.owner);
    await expect(f.runtime.scroll(preparedScroll, next.controller.signal, nextCommit)).resolves.toMatchObject({ ok: true });
    const afterScroll = await next.observe();
    const shortcut = await next.prepare({ operation: 'shortcut', shortcut: { key: 'arrowLeft', modifiers: [] } }, afterScroll.observationId);
    await expect(f.runtime.input(shortcut, next.controller.signal, nextCommit)).resolves.toMatchObject({ ok: true });
    expect(f.dependencies.setText).toHaveBeenCalledOnce(); expect(f.dependencies.scroll).toHaveBeenCalledOnce();
    expect(f.dependencies.click).not.toHaveBeenCalled(); expect(f.input).toHaveBeenCalledOnce();
    expect(f.commit.begin).not.toHaveBeenCalled(); expect(f.commit.settle).not.toHaveBeenCalled();
  });

  it.each([true, false])('waits for the replaced window surface before reporting hide confirmation=%s in the same Run', async confirmed => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const first = await f.observe(); const visual = closingIndicator(true);
      f.dependencies.indicatePointer = vi.fn(async () => visual.lease);
      const prepared = await f.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } }, first.observationId);
      const running = f.runtime.input(prepared, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0); await running;
      const replacement = { ...structuredClone(f.window), windowId: 25, title: 'QA2', windowLabel: 'QA2' };
      f.dependencies.windows = vi.fn(async () => ({ windows: [structuredClone(f.window), replacement], truncated: false }));
      const next = await f.runtime.prepareObserve({ application: 'QA', windowTitle: 'QA2', mode: 'both' }, f.context());
      await f.runtime.observe(f.execution(next), f.controller.signal);
      await visual.inClosing;
      let hidden: boolean | undefined;
      const hiding = f.runtime.hidePointerForRun(f.owner, f.controller.signal);
      void hiding.then(result => { hidden = result.closeConfirmed; });
      await vi.advanceTimersByTimeAsync(50);
      expect(hidden).toBeUndefined();
      expect(visual.dispose).toHaveBeenCalledOnce();
      visual.close(confirmed);
      await expect(hiding).resolves.toEqual({ closeConfirmed: confirmed });
      expect(f.dependencies.indicatePointer).toHaveBeenCalledOnce();
      expect(f.input).toHaveBeenCalledOnce();
      f.runtime.releaseRun(f.owner.runId);
    } finally { vi.useRealTimers(); }
  });

  it.each([true, false])('waits for a replaced share surface on Run release even when the current share has no pointer, closure=%s', async confirmed => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const visual = closingIndicator(true);
      await activatePointer(f, visual);
      const replacement = { ...structuredClone(f.window), windowId: 25, title: 'QA2', windowLabel: 'QA2' };
      f.dependencies.windows = vi.fn(async () => ({ windows: [structuredClone(f.window), replacement], truncated: false }));
      const next = await f.runtime.prepareObserve({ application: 'QA', windowTitle: 'QA2', mode: 'both' }, f.context());
      await f.runtime.observe(f.execution(next), f.controller.signal);
      await visual.inClosing;
      let ended = false;
      const releasing = f.runtime.releaseRun(f.owner.runId, 'normal');
      void releasing.then(() => { ended = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(ended).toBe(false); expect(visual.dispose).toHaveBeenCalledOnce();
      visual.close(confirmed); await expect(releasing).resolves.toBeUndefined();
      expect(ended).toBe(true);
      visual.close(true);
      await expect(f.runtime.hidePointerForRun(f.owner, f.controller.signal)).resolves.toEqual({ closeConfirmed: confirmed });
    } finally { vi.useRealTimers(); }
  });

  it.each(['pending', 'unconfirmed'] as const)('refuses first input when another Run closure becomes %s during the final receiver check', async closure => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const first = await f.observe(); const next = await anotherRun(f);
      const oldVisual = closingIndicator(true); const nextVisual = closingIndicator(true);
      f.dependencies.indicatePointer = vi.fn(async () => nextVisual.lease).mockResolvedValueOnce(oldVisual.lease);
      const firstInput = await f.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } }, first.observationId);
      const firstRunning = f.runtime.input(firstInput, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0); await firstRunning;
      const nextPrepared = await next.prepare({ operation: 'rightClick', point: { x: 10, y: 10 } });
      const status = { ready: true, profile: 'appkit-fixture-v1', operations: [...WINDOW_INPUT_OPERATIONS], focusToken: 'a'.repeat(64) };
      let entered!: () => void; const inFinalStatus = new Promise<void>(resolve => { entered = resolve; });
      let reply!: (value: typeof status) => void;
      f.inputStatus.mockResolvedValueOnce(status).mockImplementationOnce(() => {
        entered(); return new Promise(resolve => { reply = resolve; });
      });
      const commit = { begin: vi.fn(), settle: vi.fn() };
      const running = f.runtime.input(nextPrepared, next.controller.signal, commit);
      const rejected = expect(running).rejects.toThrow(closure === 'pending' ? '仍在收起' : '重启应用');
      await vi.advanceTimersByTimeAsync(0); await inFinalStatus;
      f.runtime.releaseRun(f.owner.runId); await oldVisual.inClosing;
      if (closure === 'unconfirmed') oldVisual.close(false);
      reply(status); await rejected;
      expect(commit.begin).not.toHaveBeenCalled(); expect(commit.settle).not.toHaveBeenCalled();
      expect(f.input).toHaveBeenCalledOnce();
      if (closure === 'pending') oldVisual.close(true);
      f.runtime.releaseRun(next.owner.runId); nextVisual.close(true);
      expect(nextVisual.dispose).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('refuses first AX click when another Run starts cleanup during the final window check', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.dependencies.targets = vi.fn(async window => ({ target: { ...window, candidates: [
        { path: [0], role: 'AXButton', title: 'QA button', bounds: { x: -700, y: 100, width: 100, height: 40 }, operations: ['press'] },
      ] }, truncated: false }));
      const first = await f.observe(); const next = await anotherRun(f);
      const oldVisual = closingIndicator(true); const nextVisual = closingIndicator(true);
      f.dependencies.indicatePointer = vi.fn(async () => nextVisual.lease).mockResolvedValueOnce(oldVisual.lease);
      const firstPrepared = await f.prepare({ operation: 'doubleClick', point: { x: 10, y: 10 } }, first.observationId);
      const firstRunning = f.runtime.input(firstPrepared, f.controller.signal, f.commit);
      await vi.advanceTimersByTimeAsync(0); await firstRunning;
      const button = next.seen.elements.find(element => element.label === 'QA button')!;
      const click = f.execution(await f.runtime.prepareClick({ observationId: next.seen.observationId,
        elementId: button.elementId }, next.context), next.owner);
      const snapshot = { windows: [structuredClone(f.window)], truncated: false };
      let entered!: () => void; const inFinalWindow = new Promise<void>(resolve => { entered = resolve; });
      let reply!: (value: typeof snapshot) => void;
      f.dependencies.windows = vi.fn<AgentComputerRuntimeDependencies['windows']>(async () => snapshot)
        .mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot).mockImplementationOnce(() => {
          entered(); return new Promise(resolve => { reply = resolve; });
        });
      const commit = { begin: vi.fn(), settle: vi.fn() };
      const running = f.runtime.click(click, next.controller.signal, commit);
      const rejected = expect(running).rejects.toThrow('仍在收起');
      await vi.advanceTimersByTimeAsync(0); await inFinalWindow;
      f.runtime.releaseRun(f.owner.runId); await oldVisual.inClosing;
      reply(snapshot); await nextVisual.inClosing;
      nextVisual.close(true); await rejected;
      expect(commit.begin).not.toHaveBeenCalled(); expect(commit.settle).not.toHaveBeenCalled();
      expect(f.dependencies.click).not.toHaveBeenCalled();
      oldVisual.close(true);
      f.runtime.releaseRun(next.owner.runId); nextVisual.close(true);
    } finally { vi.useRealTimers(); }
  });
});
