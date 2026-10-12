import { describe, expect, it, vi } from 'vitest';

import type { AgentAttachment } from '../../../../src/shared/agent/agent-attachments';
import type { AgentComputerScrollRequest, AgentComputerSharedWindow, AgentComputerTarget } from '../../../platform/computer-use';
import { AgentComputerInputError } from '../../../platform/computer-use';
import type {
  AgentMainCommitSettlement,
  AgentToolMainPreparationContext,
  AgentToolMainPreparationIdentity,
  AgentToolMainPreparationResult,
  AgentToolMainPreparedExecution,
} from '../agent-tool-registry';
import { createAgentComputerRuntime, type AgentComputerRuntimeDependencies } from './agent-computer-runtime';
import { COMPUTER_ELEMENT_OPERATIONS, type ComputerElementOperation } from '../../../../src/shared/computer-use/computer-use-contract';
import type { FirstPartyBoundControl } from '../../../../src/shared/computer-use/first-party-control-contract';

vi.mock('../../../platform/computer-use', () => ({
  AgentComputerInputError: class extends Error {
    constructor(message: string, readonly dispatchState: 'not-dispatched' | 'unknown') { super(message); }
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function identity(overrides: Partial<AgentToolMainPreparationIdentity> = {}): AgentToolMainPreparationIdentity {
  return {
    aiDestinationIdentity: `v1:${'a'.repeat(64)}`,
    callId: 'call-observe', libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'http://localhost:9000' },
    ownerWebContentsId: 17, preparedActionId: 'prepared-observe', runCapabilityIdentity: `v2:${'b'.repeat(64)}`,
    runId: 'run-1', sessionId: 'session-1', toolInputHash: `v1:${'c'.repeat(64)}`,
    toolName: 'computer.observe', toolRegistrationId: 'computer.observe@1', toolRunId: 'tool-observe', ...overrides,
  };
}

function context(input: AgentToolMainPreparationIdentity, signal: AbortSignal): AgentToolMainPreparationContext {
  return {
    preparationIdentity: input, ownerScope: input.ownerScope, ownerWebContentsId: input.ownerWebContentsId,
    appContext: { libraryId: input.libraryId, platform: 'darwin', selectedNodeIds: [] },
    aiDestination: { identity: input.aiDestinationIdentity, configurationIdentity: `v1:${'d'.repeat(64)}`,
      model: 'gpt-5.5', profileId: 'profile-1', profileLabel: 'Fixture AI', providerType: 'openai' },
    runCapabilitySnapshot: {} as AgentToolMainPreparationContext['runCapabilitySnapshot'], signal,
  };
}

function execution(value: AgentToolMainPreparationResult, input: AgentToolMainPreparationIdentity): AgentToolMainPreparedExecution {
  return { identity: input, preparedActionId: input.preparedActionId, publicAction: value.publicAction,
    binding: value.binding, snapshotHash: 'a'.repeat(64) };
}

function sharedWindow(overrides: Partial<AgentComputerSharedWindow> = {}): AgentComputerSharedWindow {
  return { windowId: 24, pid: 800, processStartedAt: 1_770_000_000_000, layer: 0,
    bounds: { x: 0, y: 0, width: 1920, height: 1200 }, title: 'Fixture window',
    applicationLabel: 'Electron', windowLabel: 'OmniFlow', ...overrides };
}

function target(window = sharedWindow()): AgentComputerTarget {
  return { windowId: window.windowId, pid: window.pid, processStartedAt: window.processStartedAt, layer: window.layer,
    bounds: { ...window.bounds }, ...(window.title ? { title: window.title } : {}),
    candidates: [{ path: [0], role: 'AXButton', title: 'Fixture button', bounds: { ...window.bounds } }] };
}

function fixture(firstPartyControls?: AgentComputerRuntimeDependencies['firstPartyControls']) {
  const controller = new AbortController();
  const runIdentity = identity();
  let clock = Date.parse('2026-10-09T09:00:00.000Z');
  const window = sharedWindow();
  let windows = [structuredClone(window)];
  let truncated = false;
  const attachment: AgentAttachment = { id: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68', name: '窗口截图.png',
    kind: 'image', mimeType: 'image/png', sizeBytes: 1024, width: 2048, height: 1280 };
  const images = {
    import: vi.fn(async (): Promise<AgentAttachment> => ({ ...attachment })),
    bind: vi.fn(async (_scope: unknown, ids: readonly string[]): Promise<string[]> => [...ids]),
    rollbackBinding: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
  };
  const renderingReleases: ReturnType<typeof vi.fn>[] = [];
  const dependencies = {
    windows: vi.fn<AgentComputerRuntimeDependencies['windows']>(async () => ({ windows: structuredClone(windows), truncated })),
    ownerWindowId: vi.fn(() => 24),
    capture: vi.fn<AgentComputerRuntimeDependencies['capture']>(async () => Buffer.from('fixture-png')),
    targets: vi.fn<AgentComputerRuntimeDependencies['targets']>(async window => ({ target: target(window), truncated: false })),
    click: vi.fn<AgentComputerRuntimeDependencies['click']>(async () => undefined),
    setText: vi.fn<AgentComputerRuntimeDependencies['setText']>(async () => undefined),
    scroll: vi.fn<AgentComputerRuntimeDependencies['scroll']>(async () => undefined),
    clickStatus: vi.fn<AgentComputerRuntimeDependencies['clickStatus']>(async () => ({ available: true })),
    requestClickPermission: vi.fn<AgentComputerRuntimeDependencies['requestClickPermission']>(async () => undefined),
    keepWindowRendering: vi.fn<NonNullable<AgentComputerRuntimeDependencies['keepWindowRendering']>>(() => {
      const release = vi.fn();
      renderingReleases.push(release);
      return release;
    }),
    images: () => images, now: () => clock,
    ...(firstPartyControls ? { firstPartyControls } : {}),
  };
  const runtime = createAgentComputerRuntime(dependencies);
  const prepareContext = context(runIdentity, controller.signal);
  const commit = { begin: vi.fn<AgentMainCommitSettlement['begin']>(() => undefined),
    settle: vi.fn<AgentMainCommitSettlement['settle']>(() => undefined) };
  const takeScreenshot = async (input: Parameters<typeof runtime.prepareObserve>[0] = {}) => {
    const prepared = await runtime.prepareObserve(input, prepareContext);
    const result = await runtime.observe(execution(prepared, runIdentity), controller.signal);
    return result.data as { observationId: string; imageId: string; screenshotWidth: number; screenshotHeight: number;
      expiresInMs: number; clickReady: boolean; coordinateClickReady: boolean; candidateScanComplete: boolean;
      notice?: string; targetId: string; captureScope: string;
      axTree?: string; axTreeTruncated?: boolean; elements: Array<{ elementId: string; role: string; label: string; description?: string }> };
  };
  const prepareClick = async (observationId: string, overrides: Partial<Parameters<typeof runtime.prepareClick>[0]> = {}) => {
    const clickIdentity = identity({ callId: 'call-click', preparedActionId: 'prepared-click', toolName: 'computer.click',
      toolRegistrationId: 'computer.click@1', toolRunId: 'tool-click' });
    const prepared = await runtime.prepareClick({ observationId, x: 10, y: 20, ...overrides }, context(clickIdentity, controller.signal));
    return execution(prepared, clickIdentity);
  };
  return { controller, runIdentity, prepareContext, window, attachment, images, dependencies, runtime, commit,
    takeScreenshot, prepareClick, renderingReleases,
    advance: (milliseconds: number) => { clock += milliseconds; },
    setWindows: (value: AgentComputerSharedWindow[], isTruncated = false) => { windows = structuredClone(value); truncated = isTruncated; },
  };
}

describe('native AX observation regions', () => {
  async function focusedFixture() {
    const f = fixture();
    const controls = target(f.window);
    controls.candidates[0].path = [0, 1, 2];
    controls.candidates[0].identifier = 'private-anchor';
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: true, axTree: 'AXWindow partial', axTreeTruncated: true });
    const original = await f.takeScreenshot({ mode: 'ax' });
    const focus = { observationId: original.observationId, elementId: original.elements[0].elementId, ancestorLevels: 2 };
    f.dependencies.targets.mockImplementation(async (window, _signal, scope) => ({ target: { ...target(window), candidates: [
      structuredClone(controls.candidates[0]), { ...controls.candidates[0], path: [0, 3], title: 'Previously missed button' },
    ] }, truncated: false, axTree: 'AXGroup local', axTreeTruncated: false,
    ...(scope ? { scope: { path: scope.anchor.path.slice(0, scope.anchor.path.length - scope.ancestorLevels) } } : {}) }));
    f.dependencies.targets.mockClear();
    return { ...f, controls, original, focus };
  }

  it.each(['ax', 'both'] as const)('rescans a validated region in %s mode, rotates IDs and keeps full window action paths', async mode => {
    const f = await focusedFixture();
    const prepared = await f.runtime.prepareObserve({ mode, focus: f.focus, includeChanges: true }, f.prepareContext);
    expect(prepared.decision).toMatchObject({ behavior: 'allow', risk: 'read' });
    const observed = (await f.runtime.observe(execution(prepared, f.runIdentity), f.controller.signal)).data as Awaited<ReturnType<typeof f.takeScreenshot>>;
    expect(observed).toMatchObject({ scope: { kind: 'element-ancestor', ancestorLevels: 2 }, scopeScanComplete: true,
      candidateScanComplete: false, coordinateClickReady: false, clickReady: true,
      changeSummary: { baselineAvailable: false }, axTree: 'AXGroup local', elements: [
        { label: 'Fixture button' }, { label: 'Previously missed button' },
      ] });
    expect(f.dependencies.targets).toHaveBeenCalledTimes(2);
    for (const [window, signal, scope] of f.dependencies.targets.mock.calls) {
      expect(window).toEqual(f.window);
      expect(signal).toBe(f.controller.signal);
      expect(scope).toEqual({ anchor: f.controls.candidates[0], ancestorLevels: 2 });
    }
    if (mode === 'ax') {
      expect(f.dependencies.capture).not.toHaveBeenCalled();
      expect(f.images.import).not.toHaveBeenCalled();
      expect(observed).not.toHaveProperty('imageId');
    } else {
      expect(f.dependencies.capture).toHaveBeenCalledWith(f.window, f.controller.signal);
      expect(observed).toMatchObject({ captureScope: 'window', screenshotWidth: 2048, screenshotHeight: 1280 });
    }
    expect(JSON.stringify([observed, prepared.publicAction])).not.toMatch(/private-anchor|"path"|"anchor"|"scopeKey"/);
    await expect(f.prepareClick(f.original.observationId, { elementId: f.original.elements[0].elementId, x: undefined, y: undefined })).rejects.toThrow('未发送');
    await expect(f.prepareClick(observed.observationId)).rejects.toThrow();
    const clicked = await f.prepareClick(observed.observationId, { elementId: observed.elements[1].elementId, x: undefined, y: undefined });
    expect(clicked.binding.target).toMatchObject({ candidate: { path: [0, 3] } });
    await f.runtime.click(clicked, f.controller.signal, f.commit);
    expect(f.dependencies.click).toHaveBeenCalledOnce();
  });

  it('never turns local uniqueness into anonymous AX-only IDs or window coordinate authority', async () => {
    const f = await focusedFixture();
    f.dependencies.targets.mockImplementation(async (window, _signal, scope) => ({ target: { ...target(window), candidates: [
      { path: [0, 4], role: 'AXTextArea', title: '', identifier: 'private-text', operations: ['replaceText'],
        identityProfile: 'native-text-identifier-v1', descriptionDeclared: false, bounds: { x: 100, y: 100, width: 100, height: 100 } },
      { path: [0, 5], role: 'AXScrollBar', title: '', orientation: 'vertical', operations: ['scrollDownStep'],
        bounds: { x: 300, y: 100, width: 20, height: 100 } },
    ] }, truncated: false, ...(scope ? { scope: { path: [0] } } : {}) }));
    expect(await f.takeScreenshot({ mode: 'ax', focus: f.focus })).toMatchObject({ elements: [], scopeScanComplete: true,
      candidateScanComplete: false, coordinateClickReady: false, textReady: false, scrollReady: false });
  });

  it.each(['old-helper', 'wrong-region', 'outside-region', 'before-failure', 'after-failure'] as const)(
    'rejects %s without issuing new IDs or silently observing the whole window', async fault => {
      const f = await focusedFixture();
      const success = { target: { ...target(f.window), candidates: [f.controls.candidates[0]] }, truncated: false, scope: { path: [0] } };
      if (fault === 'before-failure') f.dependencies.targets.mockRejectedValue(new Error('anchor changed'));
      else if (fault === 'after-failure') f.dependencies.targets.mockResolvedValueOnce(success).mockRejectedValueOnce(new Error('anchor changed'));
      else if (fault === 'old-helper') f.dependencies.targets.mockResolvedValue({ target: success.target, truncated: false });
      else if (fault === 'wrong-region') f.dependencies.targets.mockResolvedValue({ ...success, scope: { path: [1] } });
      else f.dependencies.targets.mockResolvedValue({ ...success, target: { ...success.target, candidates: [target().candidates[0],
        { ...target().candidates[0], path: [9] }] } });
      await expect(f.takeScreenshot({ mode: 'both', focus: f.focus })).rejects.toThrow();
      expect(f.dependencies.targets).toHaveBeenCalledTimes(fault === 'after-failure' ? 2 : 1);
      for (const [, , scope] of f.dependencies.targets.mock.calls) expect(scope).toMatchObject({ ancestorLevels: 2 });
      if (fault !== 'after-failure') expect(f.dependencies.capture).not.toHaveBeenCalled();
      expect(f.images.import).not.toHaveBeenCalled();
      expect(f.dependencies.click).not.toHaveBeenCalled();
      await expect(f.prepareClick(f.original.observationId)).rejects.toThrow('未发送');
    });

  it.each(['expired', 'consumed', 'other-run', 'released', 'replaced', 'window-changed'] as const)(
    'rechecks the anchor at execution after it becomes %s', async invalidation => {
      const f = await focusedFixture();
      const prepared = await f.runtime.prepareObserve({ mode: 'ax', focus: f.focus }, f.prepareContext);
      if (invalidation === 'expired') f.advance(60_001);
      else if (invalidation === 'released') f.runtime.releaseRun(f.runIdentity.runId);
      else if (invalidation === 'other-run') { /* Use a distinct immutable execution identity below. */ }
      else if (invalidation === 'window-changed') f.setWindows([{ ...f.window, bounds: { ...f.window.bounds, x: 10 } }]);
      else if (invalidation === 'replaced') await f.takeScreenshot({ mode: 'ax' });
      else {
        const click = await f.prepareClick(f.original.observationId, { elementId: f.focus.elementId, x: undefined, y: undefined });
        await f.runtime.click(click, f.controller.signal, f.commit);
      }
      f.dependencies.targets.mockClear();
      const executingIdentity = invalidation === 'other-run' ? { ...f.runIdentity, runId: 'different-run' } : f.runIdentity;
      await expect(f.runtime.observe(execution(prepared, executingIdentity), f.controller.signal)).rejects.toThrow();
      expect(f.dependencies.targets).not.toHaveBeenCalled();
      expect(f.dependencies.capture).not.toHaveBeenCalled();
    });

  it('rejects cross-window selectors and ancestor traversal beyond the window before scanning', async () => {
    const f = await focusedFixture();
    for (const input of [{ focus: f.focus, mode: 'screenshot' }, { focus: f.focus, application: 'Finder' },
      { focus: f.focus, windowRef: f.focus.elementId }, { focus: f.focus, windowTitle: 'Other' },
      { focus: { ...f.focus, elementId: '43b39553-9a74-4ba1-a976-1a6738397275' } }]) {
      await expect(f.runtime.prepareObserve(input as Parameters<typeof f.runtime.prepareObserve>[0], f.prepareContext)).rejects.toThrow();
    }
    const shorter = target(f.window);
    f.dependencies.targets.mockResolvedValue({ target: shorter, truncated: false });
    const observed = await f.takeScreenshot({ mode: 'ax' });
    f.dependencies.targets.mockClear();
    await expect(f.runtime.prepareObserve({ focus: { observationId: observed.observationId,
      elementId: observed.elements[0].elementId, ancestorLevels: 2 } }, f.prepareContext)).rejects.toThrow('越过');
    expect(f.dependencies.targets).not.toHaveBeenCalled();
  });

  it('uses a diff baseline only for the same region and mode', async () => {
    const f = await focusedFixture();
    const first = await f.takeScreenshot({ mode: 'ax', focus: f.focus, includeChanges: true });
    const second = await f.takeScreenshot({ mode: 'ax', focus: { observationId: first.observationId,
      elementId: first.elements[0].elementId, ancestorLevels: 2 }, includeChanges: true });
    expect(second).toMatchObject({ changeSummary: { baselineAvailable: true, previousObservationId: first.observationId,
      scopeScanComplete: true, previousScopeScanComplete: true, candidateScanComplete: false, previousCandidateScanComplete: false } });
    const root = await f.takeScreenshot({ mode: 'ax', includeChanges: true });
    expect(root).toMatchObject({ scope: { kind: 'window' }, changeSummary: { baselineAvailable: false } });
    const both = await f.takeScreenshot({ mode: 'both', focus: { observationId: root.observationId,
      elementId: root.elements[0].elementId, ancestorLevels: 2 }, includeChanges: true });
    expect(both).toMatchObject({ changeSummary: { baselineAvailable: false } });
  });

  it('does not publish a region when the Run is cancelled during scanning', async () => {
    const f = await focusedFixture();
    f.dependencies.targets.mockImplementation(async () => { f.controller.abort(); throw new Error('cancelled'); });
    await expect(f.takeScreenshot({ mode: 'both', focus: f.focus })).rejects.toThrow();
    expect(f.dependencies.targets).toHaveBeenCalledOnce();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.images.import).not.toHaveBeenCalled();
  });
});

describe('native AX scrollbar page-button runtime', () => {
  function pageButtonFixture(orientation: 'vertical' | 'horizontal' = 'vertical', increment = true) {
    const f = fixture();
    const direction = orientation === 'vertical' ? increment ? 'down' : 'up' : increment ? 'right' : 'left';
    const operation = `scroll${direction[0].toUpperCase()}${direction.slice(1)}Page` as ComputerElementOperation;
    const candidate: AgentComputerTarget['candidates'][number] = {
      path: [0, 0], role: 'AXButton', title: '', subrole: increment ? 'AXIncrementPage' : 'AXDecrementPage',
      operations: [operation], enabledState: 'absent', identityProfile: 'native-scroll-button-v1',
      bounds: orientation === 'vertical' ? { x: 1800, y: 150, width: 15, height: 300 } : { x: 150, y: 1125, width: 300, height: 15 },
      scrollButtonState: { orientation, parentBounds: orientation === 'vertical'
        ? { x: 1800, y: -600, width: 15, height: 2400 } : { x: -600, y: 1125, width: 3000, height: 15 } },
    };
    const nativeTarget = { ...target(f.window), candidates: [candidate] };
    f.dependencies.targets.mockResolvedValue({ target: nativeTarget, truncated: false });
    const scrollIdentity = identity({ toolName: 'computer.scroll', toolRegistrationId: 'builtin:computer.scroll@1',
      toolRunId: 'd0df27b2-4fda-4794-91fc-3b1863b72f22' });
    async function prepare(observationId: string, elementId: string, requestedDirection: 'up' | 'down' | 'left' | 'right' = direction, unit: 'page' | 'step' | 'fraction' = 'page') {
      return execution(await f.runtime.prepareScroll({ observationId, elementId, direction: requestedDirection, unit },
        context(scrollIdentity, f.controller.signal)), scrollIdentity);
    }
    return { ...f, candidate, nativeTarget, prepare, direction, operation };
  }

  it.each([
    ['ax', 'vertical', true, '向下滚动一页'], ['ax', 'vertical', false, '向上滚动一页'],
    ['ax', 'horizontal', true, '向右滚动一页'], ['ax', 'horizontal', false, '向左滚动一页'],
    ['both', 'vertical', true, '向下滚动一页'], ['both', 'vertical', false, '向上滚动一页'],
    ['both', 'horizontal', true, '向右滚动一页'], ['both', 'horizontal', false, '向左滚动一页'],
  ] as const)('uses the %s %s page-button semantic ID for one operation (%s)', async (mode, orientation, increment, label) => {
    const f = pageButtonFixture(orientation, increment);
    const observed = await f.takeScreenshot({ mode });
    expect(observed).toMatchObject({ scrollReady: true, clickReady: false, coordinateClickReady: false,
      elements: [{ label, labelSource: 'native-scroll-button', operations: [f.operation], subrole: f.candidate.subrole }] });
    if (mode === 'both') {
      expect(observed.elements[0]).toHaveProperty('screenshotBounds', orientation === 'vertical'
        ? { x: 1920, y: 160, width: 16, height: 320 } : { x: 160, y: 1200, width: 320, height: 16 });
    } else {
      expect(observed.elements[0]).not.toHaveProperty('screenshotBounds');
      expect(f.dependencies.capture).not.toHaveBeenCalled();
      expect(f.images.import).not.toHaveBeenCalled();
    }
    const prepared = await f.prepare(observed.observationId, observed.elements[0].elementId);
    expect(prepared.binding.target).toMatchObject({ candidate: { identityProfile: 'native-scroll-button-v1',
      scrollButtonState: f.candidate.scrollButtonState, subrole: f.candidate.subrole, enabledState: 'absent' } });
    const result = await f.runtime.scroll(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: true, data: { direction: f.direction, unit: 'page',
      dispatchState: 'dispatched', mutationCommitState: 'committed', nextAction: 'observe', retryAllowed: false } });
    expect(f.dependencies.scroll).toHaveBeenCalledWith({ operation: f.operation, target: prepared.binding.target }, f.controller.signal);
    expect(f.dependencies.scroll).toHaveBeenCalledOnce();
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.dependencies.setText).not.toHaveBeenCalled();
    for (const value of [observed, prepared.publicAction, result]) {
      expect(JSON.stringify(value)).not.toMatch(/"identityProfile"|"scrollButtonState"|"parentBounds"|"descriptionDeclared"|"path"/);
    }
  });

  it('keeps opposite page buttons for one proven scrollbar available without claiming they are native names', async () => {
    const f = pageButtonFixture();
    f.nativeTarget.candidates.push({ ...f.candidate, path: [0, 1], subrole: 'AXDecrementPage', operations: ['scrollUpPage'],
      bounds: { ...f.candidate.bounds, y: 600 } });
    expect((await f.takeScreenshot({ mode: 'ax' })).elements).toMatchObject([
      { label: '向下滚动一页', labelSource: 'native-scroll-button' }, { label: '向上滚动一页', labelSource: 'native-scroll-button' },
    ]);
  });

  it.each(['another-parent', 'duplicate-page-button', 'other-native-scrollbar'] as const)(
    'does not issue anonymous AX-only IDs or a false unique-scrollbar label with %s', async ambiguity => {
      const f = pageButtonFixture();
      if (ambiguity === 'other-native-scrollbar') {
        f.nativeTarget.candidates.push({ path: [1], role: 'AXScrollBar', title: '', orientation: 'vertical',
          operations: ['scrollDownStep'], enabledState: 'enabled', bounds: { x: 300, y: 0, width: 15, height: 1200 } });
      } else {
        f.nativeTarget.candidates.push({ ...structuredClone(f.candidate),
          path: ambiguity === 'another-parent' ? [1, 0] : [0, 1], bounds: { x: 300, y: 150, width: 15, height: 300 },
          scrollButtonState: { orientation: 'vertical', parentBounds: ambiguity === 'another-parent'
            ? { x: 300, y: -600, width: 15, height: 2400 } : { x: 0, y: -600, width: 1900, height: 2400 } } });
        if (ambiguity === 'duplicate-page-button') f.candidate.scrollButtonState!.parentBounds = { x: 0, y: -600, width: 1900, height: 2400 };
      }
      expect(await f.takeScreenshot({ mode: 'ax' })).toMatchObject({ elements: [], scrollReady: false });
      const both = await f.takeScreenshot({ mode: 'both' });
      expect(both.elements).toHaveLength(ambiguity === 'other-native-scrollbar' ? 1 : 2);
      for (const element of both.elements) {
        expect(element).toMatchObject({ label: '向下滚动一页', labelSource: 'native-scroll-button', screenshotBounds: expect.any(Object) });
        expect(element.label).not.toContain('唯一');
      }
    });

  it('recognizes a scrollbar candidate and its page child as the same AX parent', async () => {
    const f = pageButtonFixture();
    f.candidate.scrollButtonState!.parentBounds = { x: 1800, y: 0, width: 15, height: 1200 };
    f.nativeTarget.candidates.push({ path: [0], role: 'AXScrollBar', title: '', orientation: 'vertical',
      operations: ['scrollDownStep'], enabledState: 'enabled', bounds: { ...f.candidate.scrollButtonState!.parentBounds } });
    expect((await f.takeScreenshot({ mode: 'ax' })).elements).toMatchObject([
      { label: '向下滚动一页', labelSource: 'native-scroll-button' },
      { label: '本窗口唯一可操作的垂直滚动条', labelSource: 'unique-actionable-scrollbar' },
    ]);
  });

  it('requires screenshot geometry when the native scan is partial', async () => {
    const f = pageButtonFixture();
    f.dependencies.targets.mockResolvedValue({ target: f.nativeTarget, truncated: true });
    expect(await f.takeScreenshot({ mode: 'ax' })).toMatchObject({ elements: [], candidateScanComplete: false, scrollReady: false });
    expect(await f.takeScreenshot({ mode: 'both' })).toMatchObject({ candidateScanComplete: false, scrollReady: true,
      elements: [{ labelSource: 'native-scroll-button', screenshotBounds: { x: 1920, y: 160, width: 16, height: 320 } }] });
  });

  it('does not issue screenshot IDs for overlapping same-direction page buttons', async () => {
    const f = pageButtonFixture();
    f.nativeTarget.candidates.push({ ...structuredClone(f.candidate), path: [1, 0] });
    expect(await f.takeScreenshot({ mode: 'both' })).toMatchObject({ elements: [], scrollReady: false });
  });

  it.each(['parent-x', 'parent-width', 'axis', 'state-missing', 'profile', 'subrole', 'operation', 'child-bounds'] as const)(
    'rejects page-button IDs when %s changes across capture', async field => {
      const f = pageButtonFixture();
      const after = structuredClone(f.nativeTarget);
      const candidate = after.candidates[0];
      if (field === 'parent-x') candidate.scrollButtonState!.parentBounds.x -= 1;
      if (field === 'parent-width') candidate.scrollButtonState!.parentBounds.width += 1;
      if (field === 'axis') candidate.scrollButtonState!.orientation = 'horizontal';
      if (field === 'state-missing') delete candidate.scrollButtonState;
      if (field === 'profile') delete candidate.identityProfile;
      if (field === 'subrole') candidate.subrole = 'AXDecrementPage';
      if (field === 'operation') candidate.operations = ['scrollUpPage'];
      if (field === 'child-bounds') candidate.bounds.height -= 1;
      f.dependencies.targets.mockResolvedValueOnce({ target: f.nativeTarget, truncated: false })
        .mockResolvedValueOnce({ target: after, truncated: false });
      expect((await f.takeScreenshot({ mode: 'both' })).elements).toEqual([]);
      expect(f.dependencies.scroll).not.toHaveBeenCalled();
    });

  it.each(['parent-x', 'parent-width', 'axis', 'state-missing', 'profile', 'subrole', 'operation'] as const)(
    'rejects a modified sealed page-button %s before commit or dispatch', async field => {
      const f = pageButtonFixture();
      const observed = await f.takeScreenshot({ mode: 'both' });
      const prepared = structuredClone(await f.prepare(observed.observationId, observed.elements[0].elementId));
      const candidate = (prepared.binding.target as AgentComputerScrollRequest['target']).candidate;
      if (field === 'parent-x') candidate.scrollButtonState!.parentBounds.x -= 1;
      if (field === 'parent-width') candidate.scrollButtonState!.parentBounds.width += 1;
      if (field === 'axis') candidate.scrollButtonState!.orientation = 'horizontal';
      if (field === 'state-missing') delete candidate.scrollButtonState;
      if (field === 'profile') delete candidate.identityProfile;
      if (field === 'subrole') candidate.subrole = 'AXDecrementPage';
      if (field === 'operation') candidate.operations = ['scrollUpPage'];
      await expect(f.runtime.scroll(prepared, f.controller.signal, f.commit)).rejects.toThrow('已准备的后台控件身份不匹配');
      expect(f.commit.begin).not.toHaveBeenCalled();
      expect(f.dependencies.scroll).not.toHaveBeenCalled();
    });

  it('refuses click IDs, unobserved direction and other scroll units on a page-only child', async () => {
    const f = pageButtonFixture();
    const observed = await f.takeScreenshot({ mode: 'both' });
    const elementId = observed.elements[0].elementId;
    await expect(f.prepareClick(observed.observationId, { elementId, x: undefined, y: undefined })).rejects.toThrow('点击能力');
    for (const [direction, unit] of [['up', 'page'], ['down', 'step'], ['down', 'fraction']] as const) {
      await expect(f.prepare(observed.observationId, elementId, direction, unit)).rejects.toThrow('操作能力');
    }
    expect(f.commit.begin).not.toHaveBeenCalled();
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.dependencies.scroll).not.toHaveBeenCalled();
  });

  it('consumes an unknown page-button operation without replay or fallback', async () => {
    const f = pageButtonFixture();
    const observed = await f.takeScreenshot({ mode: 'both' });
    const prepared = await f.prepare(observed.observationId, observed.elements[0].elementId);
    f.dependencies.scroll.mockRejectedValueOnce(new AgentComputerInputError('private button action', 'unknown'));
    const result = await f.runtime.scroll(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: false, data: { unit: 'page', direction: 'down', dispatchState: 'unknown',
      mutationCommitState: 'commit_unknown', nextAction: 'observe', retryAllowed: false } });
    expect(JSON.stringify(result)).not.toContain('private button action');
    await expect(f.runtime.scroll(prepared, f.controller.signal, f.commit)).rejects.toThrow('重复');
    expect(f.dependencies.scroll).toHaveBeenCalledOnce();
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.dependencies.setText).not.toHaveBeenCalled();
  });
});

describe('main-owned computer observation and input lifecycle', () => {
  it('reads AX without capture, imports, screenshot dimensions, or coordinate authorization and clicks by V3 once', async () => {
    const f = fixture();
    const observed = await f.takeScreenshot({ mode: 'ax' });
    expect(f.dependencies.targets).toHaveBeenCalledTimes(2);
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.images.import).not.toHaveBeenCalled();
    expect(f.images.bind).not.toHaveBeenCalled();
    expect(f.dependencies.keepWindowRendering).toHaveBeenCalledOnce();
    expect(observed).toMatchObject({ mode: 'ax', observationSource: 'ax', coordinateClickReady: false, clickReady: true });
    expect(observed).not.toHaveProperty('imageId');
    expect(observed).not.toHaveProperty('screenshotWidth');
    await expect(f.prepareClick(observed.observationId)).rejects.toThrow('elementId');
    const prepared = await f.prepareClick(observed.observationId, { x: undefined, y: undefined, elementId: observed.elements[0].elementId });
    expect(prepared.publicAction).toMatchObject({ kind: 'computer.click', version: 3, elementId: observed.elements[0].elementId });
    expect(prepared.publicAction).not.toHaveProperty('x');
    expect(prepared.publicAction).not.toHaveProperty('screenshotWidth');
    const result = await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: true, data: { libraryId: 3, targetId: observed.targetId,
      applicationLabel: 'Electron', windowLabel: 'OmniFlow', dispatchState: 'dispatched', mutationCommitState: 'committed' } });
    expect(result.data).not.toHaveProperty('x');
    await expect(f.runtime.click(prepared, f.controller.signal, f.commit)).rejects.toThrow('勿直接重复');
    expect(f.dependencies.click).toHaveBeenCalledOnce();
  });

  it('captures an image alone without AX or first-party scans and invalidates old action references', async () => {
    const f = fixture();
    const old = await f.takeScreenshot({ mode: 'ax' });
    f.dependencies.targets.mockClear();
    f.dependencies.clickStatus.mockClear();
    const image = await f.takeScreenshot({ mode: 'screenshot' });
    expect(image).toMatchObject({ mode: 'screenshot', imageId: f.attachment.id, elements: [],
      clickReady: false, textReady: false, scrollReady: false, coordinateClickReady: false });
    expect(f.dependencies.targets).not.toHaveBeenCalled();
    expect(f.dependencies.clickStatus).not.toHaveBeenCalled();
    await expect(f.prepareClick(old.observationId, { x: undefined, y: undefined, elementId: old.elements[0].elementId })).rejects.toThrow('未发送');
    await expect(f.prepareClick(image.observationId)).rejects.toThrow('无法后台点击');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it('keeps AX observations available after image quota but caps total observations independently', async () => {
    const f = fixture();
    for (let i = 0; i < 32; i += 1) await f.takeScreenshot();
    const ax = await f.takeScreenshot({ mode: 'ax' });
    expect(ax.elements).toHaveLength(1);
    expect(f.dependencies.capture).toHaveBeenCalledTimes(32);
    await expect(f.takeScreenshot()).rejects.toThrow('32');
    for (let i = 33; i < 256; i += 1) await f.takeScreenshot({ mode: 'ax' });
    await expect(f.takeScreenshot({ mode: 'ax' })).rejects.toThrow('256');
  });

  it('never assigns screenshot-position text labels in AX-only observations', async () => {
    const f = fixture();
    const controls = target();
    controls.candidates = [{ path: [0], role: 'AXTextArea', title: '', identifier: 'native-text',
      identityProfile: 'native-text-identifier-v1', descriptionDeclared: true, bounds: { ...f.window.bounds },
      operations: ['replaceText'], textState: { subrole: null } }];
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: true });
    const ax = await f.takeScreenshot({ mode: 'ax' });
    expect(ax.elements).toEqual([]);
    expect(ax).toMatchObject({ textReady: false });
    const both = await f.takeScreenshot({ mode: 'both' });
    expect(both.elements[0]).toMatchObject({ label: '原生文本区域', labelSource: 'native-text-screenshot-bounds', screenshotBounds: expect.any(Object) });
  });

  it('filters and pages only confirmed controls without hiding scan incompleteness', async () => {
    const f = fixture();
    const controls = target();
    controls.candidates = Array.from({ length: 5 }, (_, i) => ({ ...controls.candidates[0], path: [i], title: `Button ${i}` }));
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: true });
    const observed = await f.takeScreenshot({ mode: 'ax', query: 'button', role: 'AXButton', operation: 'press', offset: 2, limit: 2 });
    expect(observed).toMatchObject({ candidateScanComplete: false, totalMatched: 5, offset: 2, limit: 2,
      hasMore: true, searchScope: 'observed-controls' });
    expect(observed.elements.map(element => element.label)).toEqual(['Button 2', 'Button 3']);
    const prepared = await f.prepareClick(observed.observationId, { x: undefined, y: undefined, elementId: observed.elements[0].elementId });
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    const empty = await f.takeScreenshot({ mode: 'ax', query: 'not-scanned' });
    expect(empty).toMatchObject({ elements: [], totalMatched: 0, candidateScanComplete: false });
  });

  it('describes bounded changes without reusing element IDs or exposing private AX identity', async () => {
    const f = fixture();
    const controls = target();
    controls.candidates[0].identifier = 'private-native-id';
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: true });
    const first = await f.takeScreenshot({ mode: 'ax', includeChanges: true });
    expect(first).toMatchObject({ changeSummary: { baselineAvailable: false } });
    const next = structuredClone(controls);
    next.candidates[0].title = 'Changed title';
    f.dependencies.targets.mockResolvedValue({ target: next, truncated: true });
    const changed = await f.takeScreenshot({ mode: 'ax', includeChanges: true });
    expect(changed).toMatchObject({ changeSummary: { baselineAvailable: true, previousObservationId: first.observationId,
      candidateScanComplete: false, previousCandidateScanComplete: false, added: 0, noLongerObserved: 0, changed: 1 },
      changes: { changed: [{ before: { label: 'Fixture button' }, after: { label: 'Changed title' } }] } });
    expect(changed.elements[0].elementId).not.toBe(first.elements[0].elementId);
    const changes = (changed as unknown as { changes: unknown }).changes;
    expect(JSON.stringify(changes)).not.toMatch(/private-native-id|elementId|path|key/);
    await expect(f.prepareClick(first.observationId)).rejects.toThrow('未发送');
  });

  it('offers an independently stable anonymous native scroll area only with unambiguous screenshot geometry', async () => {
    const f = fixture();
    const controls = target();
    controls.candidates = [{ path: [0], role: 'AXScrollArea', title: '', bounds: { x: 0, y: 100, width: 1900, height: 1000 },
      operations: ['scrollUpPage', 'scrollDownPage'] }];
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: true });
    expect((await f.takeScreenshot({ mode: 'ax' })).elements).toEqual([]);
    const both = await f.takeScreenshot();
    expect(both.elements).toEqual([expect.objectContaining({ label: '原生滚动区域', labelSource: 'native-scroll-screenshot-bounds',
      screenshotBounds: expect.any(Object), operations: ['scrollUpPage', 'scrollDownPage'] })]);
    controls.candidates.push({ ...controls.candidates[0], path: [1], bounds: { x: 100, y: 100, width: 1000, height: 1000 } });
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: true });
    expect((await f.takeScreenshot()).elements).toEqual([]);
  });

  it('rejects invalid observation mode and image-only query parameters before capture', async () => {
    const f = fixture();
    for (const input of [{ mode: 'display' }, { mode: 'screenshot', query: 'x' }, { mode: 'screenshot', includeChanges: true }, { includeChanges: 'yes' }]) {
      await expect(f.runtime.prepareObserve(input as Parameters<typeof f.runtime.prepareObserve>[0], f.prepareContext)).rejects.toThrow();
    }
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.dependencies.targets).not.toHaveBeenCalled();
  });

  it('discovers window metadata and binds the exact reference through normal single-window sharing', async () => {
    const f = fixture();
    const other = sharedWindow({ windowId: 25, pid: 801, applicationLabel: 'Calculator', windowLabel: 'History' });
    f.setWindows([f.window, other]);
    const discoveryIdentity = identity({ toolName: 'computer.windows', toolRegistrationId: 'builtin:computer.windows@1' });
    const prepared = await f.runtime.prepareWindows({ query: 'calc' }, context(discoveryIdentity, f.controller.signal));
    const result = await f.runtime.windows(execution(prepared, discoveryIdentity), f.controller.signal);
    const data = result.data as { windows: Array<{ windowRef: string; applicationLabel: string; windowLabel: string }> };
    expect(data.windows).toHaveLength(1);
    expect(data.windows[0]).toEqual({ windowRef: expect.any(String), applicationLabel: 'Calculator', windowLabel: 'History' });
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.dependencies.targets).not.toHaveBeenCalled();
    expect(f.dependencies.requestClickPermission).not.toHaveBeenCalled();
    const observe = await f.runtime.prepareObserve({ windowRef: data.windows[0].windowRef }, f.prepareContext);
    expect(observe.decision.behavior).toBe('ask');
    expect(observe.binding.window).toEqual(other);
    f.runtime.releaseRun(f.runIdentity.runId);
    await expect(f.runtime.prepareObserve({ windowRef: data.windows[0].windowRef }, f.prepareContext)).rejects.toThrow();
  });

  it('uses observation-bound element identity to target overlapping controls without guessing screenshot coordinates', async () => {
    const f = fixture();
    const controls = target();
    controls.candidates = [
      { ...controls.candidates[0], title: '', description: 'Show Sidebar', identifier: 'sidebar', bounds: { x: 40, y: 0, width: 20, height: 20 } },
      { ...controls.candidates[0], path: [1], title: 'Other control', bounds: { x: 40, y: 0, width: 20, height: 20 } },
    ];
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: false, axTree: 'AXWindow [truncated]', axTreeTruncated: true });
    const screenshot = await f.takeScreenshot();
    expect(screenshot.elements).toHaveLength(2);
    expect(screenshot.elements[0]).toMatchObject({ label: 'Show Sidebar', description: 'Show Sidebar', role: 'AXButton' });
    expect(JSON.stringify(screenshot.elements)).not.toMatch(/"path"|"pid"|"identifier"|"bounds"/);
    const prepared = await f.prepareClick(screenshot.observationId, { x: undefined, y: undefined, elementId: screenshot.elements[0].elementId });
    expect(prepared.publicAction).toMatchObject({ elementId: screenshot.elements[0].elementId, x: 53, y: 10 });
    const result = await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ data: { elementId: screenshot.elements[0].elementId, retryAllowed: false, nextAction: 'observe' } });
    expect(f.dependencies.click).toHaveBeenCalledWith(expect.objectContaining({ x: 50, y: 10,
      target: expect.objectContaining({ candidate: expect.objectContaining({ description: 'Show Sidebar', path: [0] }) }) }), f.controller.signal);
    await expect(f.runtime.click(prepared, f.controller.signal, f.commit)).rejects.toThrow('勿直接重复');
    expect(f.dependencies.click).toHaveBeenCalledOnce();
  });

  it('rejects stale, foreign, mixed, and expired semantic element references before native dispatch', async () => {
    const f = fixture();
    const old = await f.takeScreenshot();
    const current = await f.takeScreenshot();
    const semantic = { x: undefined, y: undefined, elementId: old.elements[0].elementId };
    await expect(f.prepareClick(current.observationId, semantic)).rejects.toThrow('控件标识');
    await expect(f.prepareClick(current.observationId, { elementId: current.elements[0].elementId })).rejects.toThrow('混用');
    const input = { observationId: current.observationId, elementId: current.elements[0].elementId };
    await expect(f.runtime.prepareClick(input, context(identity({ ownerWebContentsId: 18 }), f.controller.signal))).rejects.toThrow('未发送');
    f.advance(60_001);
    await expect(f.runtime.prepareClick(input, f.prepareContext)).rejects.toThrow('重新定位');
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
    const fresh = await f.takeScreenshot();
    const prepared = await f.prepareClick(fresh.observationId, { x: undefined, y: undefined, elementId: fresh.elements[0].elementId });
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.click).toHaveBeenCalledOnce();
  });

  it.each([false, true])('does not issue role-only semantic IDs for anonymous controls when truncated=%s', async truncated => {
    const f = fixture();
    const controls = target();
    controls.candidates[0].title = '';
    controls.candidates[0].identifier = 'private-native-identifier';
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated });
    const screenshot = await f.takeScreenshot();
    expect(screenshot.elements).toEqual([]);
    expect(screenshot.coordinateClickReady).toBe(!truncated);
    expect(screenshot.clickReady).toBe(!truncated);
    expect(JSON.stringify(screenshot)).not.toContain('private-native-identifier');
    await expect(f.prepareClick(screenshot.observationId, { x: undefined, y: undefined,
      elementId: '8ac54c9e-c8d2-4a7a-a593-15e61941f17e' })).rejects.toThrow('控件标识');
    if (truncated) {
      expect(screenshot.notice).toContain('请勿');
      await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('坐标');
    } else {
      await f.runtime.click(await f.prepareClick(screenshot.observationId), f.controller.signal, f.commit);
      expect(f.dependencies.click).toHaveBeenCalledOnce();
    }
  });

  it('uses a meaningful description when title is whitespace, preserving its exact identity', async () => {
    const f = fixture();
    const controls = target();
    controls.candidates[0].title = '   ';
    controls.candidates[0].description = 'Show Sidebar';
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot.elements[0].label).toBe('Show Sidebar');
    const prepared = await f.prepareClick(screenshot.observationId, { x: undefined, y: undefined,
      elementId: screenshot.elements[0].elementId });
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.click.mock.calls[0][0].target?.candidate.title).toBe('   ');
  });

  it('retains anonymous nested controls in coordinate hit-testing even though they have no semantic ID', async () => {
    const f = fixture();
    const controls = target();
    controls.candidates.push({ ...controls.candidates[0], path: [0, 1], title: '' });
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot.elements).toHaveLength(1);
    expect(screenshot.coordinateClickReady).toBe(true);
    await f.runtime.click(await f.prepareClick(screenshot.observationId), f.controller.signal, f.commit);
    expect(f.dependencies.click.mock.calls[0][0].target?.candidate.path).toEqual([0, 1]);
  });

  it('prepares explicit task sharing without screenshots, attachment writes, or system permission requests', async () => {
    const f = fixture();
    const prepared = await f.runtime.prepareObserve({}, f.prepareContext);
    expect(prepared.decision).toMatchObject({ behavior: 'ask', risk: 'read', preview: { title: '共享应用窗口并允许操作',
      details: [{ label: '应用', value: 'Electron' }, { label: '窗口', value: 'OmniFlow' }] } });
    expect(prepared.publicAction).toEqual({ kind: 'computer.observe', version: 2, libraryId: 3,
      targetId: expect.stringMatching(/^[a-f0-9-]{36}$/u), applicationLabel: 'Electron', windowLabel: 'OmniFlow', operations: COMPUTER_ELEMENT_OPERATIONS });
    expect(prepared.binding.window).toEqual(f.window);
    expect(f.dependencies.ownerWindowId).toHaveBeenCalledWith(17);
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.dependencies.targets).not.toHaveBeenCalled();
    expect(f.dependencies.clickStatus).not.toHaveBeenCalled();
    expect(f.dependencies.requestClickPermission).not.toHaveBeenCalled();
    expect(f.dependencies.keepWindowRendering).not.toHaveBeenCalled();
    expect(f.images.import).not.toHaveBeenCalled();
    await expect(f.runtime.prepareClick({ observationId: '83fc584b-037d-4c82-8883-a609846ea0d4', x: 0, y: 0 }, f.prepareContext)).rejects.toThrow('过期');
    const screenshot = await f.takeScreenshot();
    const repeated = await f.runtime.prepareObserve({}, f.prepareContext);
    expect(repeated.decision).toEqual({ behavior: 'allow', risk: 'read' });
    expect(repeated.publicAction).toMatchObject({ targetId: screenshot.targetId });
    f.setWindows([f.window, sharedWindow({ windowId: 25, pid: 801, applicationLabel: 'Preview', windowLabel: '测试文档' })]);
    const switched = await f.runtime.prepareObserve({ application: 'Preview', windowTitle: '测试文档' }, f.prepareContext);
    expect(switched.decision.behavior).toBe('ask');
    expect(switched.publicAction).toMatchObject({ applicationLabel: 'Preview', windowLabel: '测试文档' });
    expect(switched.publicAction).not.toMatchObject({ targetId: screenshot.targetId });
  });

  it('keeps the pending target stable across the formal reprepare without creating a share grant', async () => {
    const f = fixture();
    const initial = await f.runtime.prepareObserve({}, f.prepareContext);
    const reprepare = context(identity({ preparedActionId: 'fresh-sealed-action-id' }), f.controller.signal);
    const finalized = await f.runtime.prepareObserve({}, reprepare);
    expect(finalized.publicAction).toEqual(initial.publicAction);
    expect(finalized.binding).toEqual(initial.binding);
    expect(finalized.decision.behavior).toBe('ask');
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    await expect(f.prepareClick('83fc584b-037d-4c82-8883-a609846ea0d4')).rejects.toThrow('过期');
    const result = await f.runtime.observe(execution(finalized, reprepare.preparationIdentity), f.controller.signal);
    expect(result.data).toMatchObject({ targetId: Reflect.get(initial.publicAction, 'targetId') });
    expect((await f.runtime.prepareObserve({}, f.prepareContext)).publicAction).toEqual(initial.publicAction);
  });

  it('acquires rendering only after a formally executed observe validates the approved window and releases once at Run end', async () => {
    const f = fixture();
    const prepared = await f.runtime.prepareObserve({}, f.prepareContext);
    expect(f.dependencies.keepWindowRendering).not.toHaveBeenCalled();
    await f.runtime.observe(execution(prepared, f.runIdentity), f.controller.signal);
    await f.takeScreenshot();
    expect(f.dependencies.keepWindowRendering).toHaveBeenCalledOnce();
    expect(f.dependencies.keepWindowRendering).toHaveBeenCalledWith(f.window, 17);
    expect(f.dependencies.keepWindowRendering.mock.invocationCallOrder[0]).toBeGreaterThan(f.dependencies.windows.mock.invocationCallOrder[1]);
    expect(f.dependencies.keepWindowRendering.mock.invocationCallOrder[0]).toBeLessThan(f.dependencies.capture.mock.invocationCallOrder[0]);
    expect(f.renderingReleases[0]).not.toHaveBeenCalled();
    f.runtime.releaseRun(f.runIdentity.runId);
    f.runtime.releaseRun(f.runIdentity.runId);
    f.controller.abort();
    expect(f.renderingReleases[0]).toHaveBeenCalledOnce();
  });

  it('releases the old rendering lease before replacing the approved target', async () => {
    const f = fixture();
    await f.takeScreenshot();
    const external = sharedWindow({ windowId: 25, pid: 801, applicationLabel: 'Preview', windowLabel: 'Test document' });
    f.setWindows([f.window, external]);
    const prepared = await f.runtime.prepareObserve({ application: 'Preview' }, f.prepareContext);
    expect(f.renderingReleases[0]).not.toHaveBeenCalled();
    await f.runtime.observe(execution(prepared, f.runIdentity), f.controller.signal);
    expect(f.renderingReleases[0]).toHaveBeenCalledOnce();
    expect(f.renderingReleases[0].mock.invocationCallOrder[0]).toBeLessThan(f.dependencies.keepWindowRendering.mock.invocationCallOrder[1]);
    f.runtime.releaseRun(f.runIdentity.runId);
    expect(f.renderingReleases[1]).toHaveBeenCalledOnce();
  });

  it('does not acquire rendering if the approved window disappears before formal observation', async () => {
    const f = fixture();
    const prepared = await f.runtime.prepareObserve({}, f.prepareContext);
    f.setWindows([]);
    await expect(f.runtime.observe(execution(prepared, f.runIdentity), f.controller.signal)).rejects.toThrow('应用窗口');
    expect(f.dependencies.keepWindowRendering).not.toHaveBeenCalled();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
  });

  it('releases an earlier share lease when the same Run is replaced with a different owner identity', async () => {
    const f = fixture();
    await f.takeScreenshot();
    const other = identity({ ownerScope: { accountScope: 'user:8', backendScope: 'http://localhost:9000' } });
    const prepared = await f.runtime.prepareObserve({}, context(other, f.controller.signal));
    await f.runtime.observe(execution(prepared, other), f.controller.signal);
    expect(f.renderingReleases[0]).toHaveBeenCalledOnce();
    expect(f.dependencies.keepWindowRendering).toHaveBeenCalledTimes(2);
    f.runtime.releaseRun(f.runIdentity.runId);
    expect(f.renderingReleases[1]).toHaveBeenCalledOnce();
  });

  it('restores rendering immediately on cancellation and ignores late screenshot completion', async () => {
    const f = fixture();
    const capture = deferred<Buffer>();
    const started = deferred<void>();
    f.dependencies.capture.mockImplementationOnce(async () => { started.resolve(); return capture.promise; });
    const pending = f.takeScreenshot();
    const failure = expect(pending).rejects.toThrow();
    await started.promise;
    f.controller.abort();
    expect(f.renderingReleases[0]).toHaveBeenCalledOnce();
    capture.resolve(Buffer.from('late PNG'));
    await failure;
    f.runtime.releaseRun(f.runIdentity.runId);
    expect(f.renderingReleases[0]).toHaveBeenCalledOnce();
    expect(f.images.import).not.toHaveBeenCalled();
  });

  it('restores rendering after an observation failure and can reacquire for a fresh observation', async () => {
    const f = fixture();
    f.dependencies.capture.mockRejectedValueOnce(new Error('Fixture capture failed'));
    await expect(f.takeScreenshot()).rejects.toThrow('Fixture capture failed');
    expect(f.renderingReleases[0]).toHaveBeenCalledOnce();
    await f.takeScreenshot();
    expect(f.dependencies.keepWindowRendering).toHaveBeenCalledTimes(2);
    f.runtime.releaseRun(f.runIdentity.runId);
    expect(f.renderingReleases[0]).toHaveBeenCalledOnce();
    expect(f.renderingReleases[1]).toHaveBeenCalledOnce();
  });

  it('does not let a rendering restoration failure replace the original capture failure or interrupt Run release', async () => {
    const f = fixture();
    const release = vi.fn(() => { throw new Error('Fixture restoration failed'); });
    f.dependencies.keepWindowRendering.mockReturnValueOnce(release);
    f.dependencies.capture.mockRejectedValueOnce(new Error('Fixture capture failed'));
    await expect(f.takeScreenshot()).rejects.toThrow('Fixture capture failed');
    expect(() => f.runtime.releaseRun(f.runIdentity.runId)).not.toThrow();
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    { title: 'Changed title', windowLabel: '新窗口标题' },
    { bounds: { x: 20, y: 0, width: 1920, height: 1200 } },
    { pid: 801 }, { processStartedAt: 1_770_000_000_001 }, { applicationLabel: 'Changed application label' },
  ])('changes the pending target when approved window facts change before execution: %j', async change => {
    const f = fixture();
    const initial = await f.runtime.prepareObserve({}, f.prepareContext);
    f.setWindows([{ ...f.window, ...change }]);
    const refreshed = await f.runtime.prepareObserve({}, context(identity({ preparedActionId: 'fresh-action' }), f.controller.signal));
    expect(refreshed.decision.behavior).toBe('ask');
    expect(refreshed.publicAction).not.toMatchObject({ targetId: Reflect.get(initial.publicAction, 'targetId') });
    expect(f.dependencies.capture).not.toHaveBeenCalled();
  });

  it.each([
    { callId: 'other-call' }, { toolRunId: 'other-tool-run' }, { toolInputHash: 'v1:' + 'e'.repeat(64) },
    { ownerWebContentsId: 18 }, { sessionId: 'other-session' },
  ])('does not reuse a pending target for changed execution identity: %j', async change => {
    const f = fixture();
    const initial = await f.runtime.prepareObserve({}, f.prepareContext);
    const refreshed = await f.runtime.prepareObserve({}, context(identity(change), f.controller.signal));
    expect(refreshed.publicAction).not.toMatchObject({ targetId: Reflect.get(initial.publicAction, 'targetId') });
    expect(refreshed.decision.behavior).toBe('ask');
    expect(f.dependencies.capture).not.toHaveBeenCalled();
  });

  it('clears a pending target when its Run is released', async () => {
    const f = fixture();
    const initial = await f.runtime.prepareObserve({}, f.prepareContext);
    f.runtime.releaseRun(f.runIdentity.runId);
    const refreshed = await f.runtime.prepareObserve({}, f.prepareContext);
    expect(refreshed.publicAction).not.toMatchObject({ targetId: Reflect.get(initial.publicAction, 'targetId') });
    expect(refreshed.decision.behavior).toBe('ask');
    expect(f.dependencies.capture).not.toHaveBeenCalled();
  });

  it.each([
    ['Run', { runId: 'run-2' }], ['Session', { sessionId: 'session-2' }], ['资料库', { libraryId: 4 }],
    ['窗口', { ownerWebContentsId: 18 }], ['账号', { ownerScope: { accountScope: 'user:8', backendScope: 'http://localhost:9000' } }],
    ['后端', { ownerScope: { accountScope: 'user:7', backendScope: 'http://other.test' } }],
    ['AI destination', { aiDestinationIdentity: `v1:${'f'.repeat(64)}` }],
    ['Run capability', { runCapabilityIdentity: `v2:${'f'.repeat(64)}` }],
  ] as Array<[string, Partial<AgentToolMainPreparationIdentity>]>)('does not lend the grant or observation to a changed %s', async (_label, overrides) => {
    const f = fixture();
    const screenshot = await f.takeScreenshot();
    const foreign = context(identity(overrides), f.controller.signal);
    expect((await f.runtime.prepareObserve({}, foreign)).decision.behavior).toBe('ask');
    await expect(f.runtime.prepareClick({ observationId: screenshot.observationId, x: 0, y: 0 }, foreign)).rejects.toThrow('过期');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it('selects the exact owner window even when another app precedes it in z-order', async () => {
    const f = fixture();
    const front = sharedWindow({ windowId: 25, pid: 801, applicationLabel: 'Preview', windowLabel: 'Front window' });
    f.setWindows([front, f.window]);
    const prepared = await f.runtime.prepareObserve({}, f.prepareContext);
    expect(prepared.binding.window).toEqual(f.window);
    await f.runtime.observe(execution(prepared, f.runIdentity), f.controller.signal);
    expect(f.dependencies.capture).toHaveBeenCalledWith(f.window, f.controller.signal);
    expect(f.dependencies.targets.mock.calls.every(([window]) => window.windowId === 24)).toBe(true);
  });

  it.each(['missing', 'ambiguous'] as const)('never falls back to an unrelated app when the owner window is %s', async state => {
    const f = fixture();
    const unrelated = sharedWindow({ windowId: 25, pid: 801, applicationLabel: 'Preview', windowLabel: 'Unrelated window' });
    f.setWindows(state === 'missing' ? [unrelated] : [unrelated, f.window, { ...f.window }]);
    await expect(f.runtime.prepareObserve({}, f.prepareContext)).rejects.toThrow();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.dependencies.targets).not.toHaveBeenCalled();
    expect(f.dependencies.clickStatus).not.toHaveBeenCalled();
  });

  it('selects external windows by exact application and window labels and retains the approved window as default', async () => {
    const f = fixture();
    const external = sharedWindow({ windowId: 25, pid: 801, applicationLabel: 'Preview', windowLabel: '测试文档' });
    const sibling = sharedWindow({ windowId: 26, pid: 801, applicationLabel: 'Preview', windowLabel: '另一文档' });
    f.setWindows([sibling, f.window, external]);
    const screenshot = await f.takeScreenshot({ application: 'Preview', windowTitle: '测试文档' });
    expect(f.dependencies.capture).toHaveBeenCalledWith(external, f.controller.signal);
    const retained = await f.runtime.prepareObserve({}, f.prepareContext);
    expect(retained.decision.behavior).toBe('allow');
    expect(retained.publicAction).toMatchObject({ targetId: screenshot.targetId, applicationLabel: 'Preview', windowLabel: '测试文档' });
    expect(retained.binding.window).toEqual(external);
    for (const input of [{ application: 'preview', windowTitle: '测试文档' }, { application: 'Preview', windowTitle: '测试' }]) {
      await expect(f.runtime.prepareObserve(input, f.prepareContext)).rejects.toThrow('不可用');
    }
    expect(f.dependencies.capture).toHaveBeenCalledOnce();
  });

  it.each(['ambiguous', 'truncated', 'missing'] as const)('refuses %s external window selection before capture or permission checks', async state => {
    const f = fixture();
    const external = sharedWindow({ windowId: 25, pid: 801, applicationLabel: 'Preview', windowLabel: '测试文档' });
    const windows = state === 'missing' ? [f.window] : [f.window, external];
    if (state === 'ambiguous') windows.push({ ...external, windowId: 26 });
    f.setWindows(windows, state === 'truncated');
    await expect(f.runtime.prepareObserve({ application: 'Preview', windowTitle: '测试文档' }, f.prepareContext)).rejects.toThrow();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.dependencies.targets).not.toHaveBeenCalled();
    expect(f.dependencies.clickStatus).not.toHaveBeenCalled();
    expect(f.dependencies.requestClickPermission).not.toHaveBeenCalled();
  });

  it('requires a fresh grant and targetId after switching windows, replacing the old observation', async () => {
    const f = fixture();
    const first = await f.takeScreenshot();
    const firstClick = await f.prepareClick(first.observationId);
    const external = sharedWindow({ windowId: 25, pid: 801, applicationLabel: 'Preview', windowLabel: '测试文档' });
    f.setWindows([f.window, external]);
    const prepared = await f.runtime.prepareObserve({ application: 'Preview' }, f.prepareContext);
    expect(prepared.decision.behavior).toBe('ask');
    expect(prepared.publicAction).not.toMatchObject({ targetId: first.targetId });
    const result = await f.runtime.observe(execution(prepared, f.runIdentity), f.controller.signal);
    expect(result.data).toMatchObject({ captureScope: 'window', targetId: Reflect.get(prepared.publicAction, 'targetId') });
    expect(f.dependencies.capture).toHaveBeenLastCalledWith(external, f.controller.signal);
    await expect(f.runtime.click(firstClick, f.controller.signal, f.commit)).rejects.toThrow('过期');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it.each([{ windowId: 25 }, { pid: 801 }, { processStartedAt: 1_770_000_000_001 }, { layer: 1 },
    { bounds: { x: 100, y: 0, width: 1920, height: 1200 } }])('rejects a capture if the approved window changes before storage: %j', async change => {
    const f = fixture();
    f.dependencies.capture.mockImplementationOnce(async window => {
      expect(window).toEqual(f.window);
      f.setWindows([{ ...f.window, ...change }]);
      return Buffer.from('snapshot-of-old-window');
    });
    await expect(f.takeScreenshot()).rejects.toThrow('应用窗口');
    expect(f.dependencies.capture).toHaveBeenCalledOnce();
    expect(f.images.import).not.toHaveBeenCalled();
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it('expires screenshots and consumes each observation before one click can be replayed', async () => {
    const f = fixture();
    const expired = await f.takeScreenshot();
    f.advance(60_001);
    await expect(f.prepareClick(expired.observationId)).rejects.toThrow('过期');
    const current = await f.takeScreenshot();
    const prepared = await f.prepareClick(current.observationId);
    await expect(f.runtime.click(prepared, f.controller.signal, f.commit)).resolves.toMatchObject({ ok: true,
      data: { dispatchState: 'dispatched', mutationCommitState: 'committed' } });
    await expect(f.runtime.click(prepared, f.controller.signal, f.commit)).rejects.toThrow('过期');
    await expect(f.prepareClick(current.observationId)).rejects.toThrow('过期');
    expect(f.dependencies.click).toHaveBeenCalledTimes(1);
    expect(f.commit.begin).toHaveBeenCalledTimes(1);
  });

  it('invalidates an older prepared click when a fresh screenshot replaces its observation', async () => {
    const f = fixture();
    const first = await f.takeScreenshot();
    const prepared = await f.prepareClick(first.observationId);
    await f.takeScreenshot();
    await expect(f.runtime.click(prepared, f.controller.signal, f.commit)).rejects.toThrow('过期');
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it('counts capture and attachment storage latency against screenshot freshness', async () => {
    const f = fixture();
    f.dependencies.capture.mockImplementationOnce(async () => { f.advance(20_000); return Buffer.from('png'); });
    f.images.import.mockImplementationOnce(async () => { f.advance(40_001); return f.attachment; });
    const screenshot = await f.takeScreenshot();
    expect(screenshot.expiresInMs).toBe(0);
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('过期');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it('converts Retina window screenshot pixels to global DIP with a negative window origin', async () => {
    const f = fixture();
    f.setWindows([{ ...f.window, bounds: { x: -1920, y: -1200, width: 1920, height: 1200 } }]);
    f.attachment.width = 960;
    f.attachment.height = 600;
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepareClick(screenshot.observationId, { x: 959, y: 599 });
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.click).toHaveBeenCalledWith({ x: -1, y: -1, button: 'left', clickCount: 1,
      target: { window: { windowId: 24, pid: 800, processStartedAt: 1_770_000_000_000, layer: 0,
        bounds: { x: -1920, y: -1200, width: 1920, height: 1200 }, title: 'Fixture window' },
      candidate: expect.objectContaining({ path: [0], role: 'AXButton', title: 'Fixture button' }) } }, f.controller.signal);
  });

  it('binds only the approved window around capture and ignores other app stacking changes', async () => {
    const f = fixture();
    const original = target();
    f.dependencies.targets.mockResolvedValue({ target: original, truncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot.clickReady).toBe(true);
    const [beforeCall, afterCall] = f.dependencies.targets.mock.invocationCallOrder;
    expect(beforeCall).toBeLessThan(f.dependencies.capture.mock.invocationCallOrder[0]);
    expect(afterCall).toBeGreaterThan(f.dependencies.capture.mock.invocationCallOrder[0]);
    const prepared = await f.prepareClick(screenshot.observationId);
    original.pid = 900;
    original.candidates[0].title = 'Changed';
    f.setWindows([sharedWindow({ windowId: 31, pid: 901, applicationLabel: 'Preview', windowLabel: 'New front window' }), f.window]);
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.targets).toHaveBeenCalledTimes(2);
    expect(f.dependencies.click).toHaveBeenCalledWith(expect.objectContaining({ target: {
      window: expect.objectContaining({ windowId: 24, pid: 800 }),
      candidate: expect.objectContaining({ title: 'Fixture button' }),
    } }), f.controller.signal);
  });

  it('returns the post-capture approved-window AX summary with the existing screenshot', async () => {
    const f = fixture();
    const axTree = 'AXWindow "OmniFlow"\n  AXButton "查看资料" enabled=true\n  AXTextField "搜索" value="你好"';
    f.dependencies.targets.mockResolvedValueOnce({ target: target(), truncated: false, axTree: 'Before capture', axTreeTruncated: false })
      .mockResolvedValueOnce({ target: target(), truncated: false, axTree, axTreeTruncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot).toMatchObject({ captureScope: 'window', imageId: f.attachment.id, clickReady: true, axTree, axTreeTruncated: false });
    expect(screenshot).not.toHaveProperty('pid');
    expect(screenshot).not.toHaveProperty('windowId');
    expect(screenshot).not.toHaveProperty('candidates');
    expect(f.dependencies.targets.mock.calls.every(([window]) => window === f.dependencies.capture.mock.calls[0][0])).toBe(true);
    const [beforeCall, afterCall] = f.dependencies.targets.mock.invocationCallOrder;
    expect(beforeCall).toBeLessThan(f.dependencies.capture.mock.invocationCallOrder[0]);
    expect(afterCall).toBeGreaterThan(f.dependencies.capture.mock.invocationCallOrder[0]);
    expect(f.images.bind).toHaveBeenCalledWith({ ownerScope: f.runIdentity.ownerScope, libraryId: 3 }, [f.attachment.id], f.runIdentity.sessionId);
  });

  it.each([
    { axTree: '', axTreeTruncated: false },
    { axTree: 'AXWindow\n  AXButton "partial"\n…', axTreeTruncated: true },
  ])('keeps AX summary availability independent from complete click candidates: %j', async summary => {
    const f = fixture();
    f.dependencies.targets.mockResolvedValue({ target: target(), truncated: false, ...summary });
    const screenshot = await f.takeScreenshot();
    expect(screenshot).toMatchObject({ ...summary, clickReady: true });
    const prepared = await f.prepareClick(screenshot.observationId);
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.click).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'mismatch'] as const)('returns a matching post AX summary without enabling clicks after a %s pre-scan', async failure => {
    const f = fixture();
    if (failure === 'missing') f.dependencies.targets.mockRejectedValueOnce(new Error('AX unavailable'));
    else f.dependencies.targets.mockResolvedValueOnce({ target: failure === 'mismatch' ? target(sharedWindow({ pid: 801 })) : target(),
      truncated: false, axTree: 'Unconfirmed before tree', axTreeTruncated: false });
    f.dependencies.targets.mockResolvedValueOnce({ target: target(), truncated: false,
      axTree: 'AXWindow\n  AXButton "visible"', axTreeTruncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot).toMatchObject({ axTree: 'AXWindow\n  AXButton "visible"', axTreeTruncated: false, clickReady: false });
    expect(f.dependencies.targets).toHaveBeenCalledTimes(2);
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('控件');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it.each(['before', 'after', 'both'] as const)('allows only stable semantic IDs when the %s candidate scan is incomplete', async incomplete => {
    const f = fixture();
    const axTree = '中'.repeat(4096);
    const before = target();
    before.candidates.push({ ...before.candidates[0], path: [1], title: 'Rejected later' });
    const after = target();
    after.candidates.push({ ...after.candidates[0], path: [2], title: 'Not observed before' });
    f.dependencies.targets.mockResolvedValueOnce({ target: before, truncated: incomplete !== 'after' })
      .mockResolvedValueOnce({ target: after, truncated: incomplete !== 'before', axTree, axTreeTruncated: true });
    const screenshot = await f.takeScreenshot();
    expect(screenshot).toMatchObject({ axTree, axTreeTruncated: true, clickReady: true,
      coordinateClickReady: false, candidateScanComplete: false });
    expect(screenshot.elements).toEqual([expect.objectContaining({ label: 'Fixture button' })]);
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('坐标');
    expect(f.dependencies.click).not.toHaveBeenCalled();
    const prepared = await f.prepareClick(screenshot.observationId, { x: undefined, y: undefined,
      elementId: screenshot.elements[0].elementId });
    await expect(f.runtime.click({ ...prepared,
      publicAction: { ...prepared.publicAction, elementId: undefined } } as AgentToolMainPreparedExecution,
    f.controller.signal, f.commit)).rejects.toThrow('坐标');
    expect(f.commit.begin).not.toHaveBeenCalled();
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.click).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ candidate: expect.objectContaining({ path: [0], title: 'Fixture button' }) }),
    }), f.controller.signal);
  });

  it('keeps a stable semantic target when a nested control changes, but forbids coordinate inference', async () => {
    const f = fixture();
    const before = target();
    before.candidates.push({ ...before.candidates[0], path: [0, 1], title: 'Nested control before' });
    const after = structuredClone(before);
    after.candidates[1].title = 'Nested control after';
    f.dependencies.targets.mockResolvedValueOnce({ target: before, truncated: false })
      .mockResolvedValueOnce({ target: after, truncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot).toMatchObject({ clickReady: true, coordinateClickReady: false, candidateScanComplete: true });
    expect(screenshot.elements).toHaveLength(1);
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('坐标');
    const prepared = await f.prepareClick(screenshot.observationId, { x: undefined, y: undefined,
      elementId: screenshot.elements[0].elementId });
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.click).toHaveBeenCalledOnce();
    expect(f.dependencies.click.mock.calls[0][0].target?.candidate.path).toEqual([0]);
  });

  it.each(['missing', 'legacy'] as const)('omits pre-capture AX text when the post receipt is %s', async failure => {
    const f = fixture();
    f.dependencies.targets.mockResolvedValueOnce({ target: target(), truncated: false, axTree: 'Stale pre tree', axTreeTruncated: false });
    if (failure === 'missing') f.dependencies.targets.mockRejectedValueOnce(new Error('Post scan unavailable'));
    else f.dependencies.targets.mockResolvedValueOnce({ target: target(), truncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot).not.toHaveProperty('axTree');
    expect(screenshot).not.toHaveProperty('axTreeTruncated');
    expect(screenshot.clickReady).toBe(failure === 'legacy');
    expect(f.images.bind).toHaveBeenCalledOnce();
  });

  it.each(['geometry', 'process', 'pid', 'window', 'layer', 'title'] as const)('keeps the screenshot read-only when AX target %s changes across capture', async change => {
    const f = fixture();
    const first = target();
    const after = target();
    if (change === 'geometry') after.bounds.x = 10;
    if (change === 'process') after.processStartedAt! += 1;
    if (change === 'pid') after.pid += 1;
    if (change === 'window') after.windowId += 1;
    if (change === 'layer') after.layer = 1;
    if (change === 'title') after.title = 'Another window title';
    f.dependencies.targets.mockResolvedValueOnce({ target: first, truncated: false, axTree: 'Old tree', axTreeTruncated: false })
      .mockResolvedValueOnce({ target: after, truncated: false, axTree: 'Post tree', axTreeTruncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot).toMatchObject({ clickReady: false, imageId: f.attachment.id });
    expect(screenshot).not.toHaveProperty('axTree');
    expect(screenshot).not.toHaveProperty('axTreeTruncated');
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('后台点击');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it.each(['missing', 'empty-partial', 'permission'] as const)('does not bind targets after an unusable %s observation', async failure => {
    const f = fixture();
    if (failure === 'missing') f.dependencies.targets.mockRejectedValue(new Error('AX unavailable'));
    if (failure === 'empty-partial') f.dependencies.targets.mockResolvedValue({ target: { ...target(), candidates: [] }, truncated: true });
    if (failure === 'permission') f.dependencies.clickStatus.mockResolvedValue({ available: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot.clickReady).toBe(false);
    if (failure === 'permission') {
      expect(f.dependencies.targets).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveProperty('axTree');
      expect(screenshot).not.toHaveProperty('axTreeTruncated');
    }
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('后台点击');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it.each(['path', 'title', 'role', 'bounds', 'description', 'subrole', 'identifier'] as const)('drops a candidate whose %s changes across capture', async field => {
    const f = fixture();
    const after = target();
    if (field === 'path') after.candidates[0].path = [1];
    if (field === 'title') after.candidates[0].title = 'New button';
    if (field === 'role') after.candidates[0].role = 'AXLink';
    if (field === 'bounds') after.candidates[0].bounds.width -= 1;
    if (field === 'description' || field === 'subrole' || field === 'identifier') after.candidates[0][field] = 'changed';
    f.dependencies.targets.mockResolvedValueOnce({ target: target(), truncated: false })
      .mockResolvedValueOnce({ target: after, truncated: false });
    const screenshot = await f.takeScreenshot();
    expect(screenshot.clickReady).toBe(false);
    expect(screenshot.elements).toEqual([]);
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('控件');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it.each(['unsupported', 'overlay', 'unidentified'] as const)('does not bind an actionable target from an %s observation', async kind => {
    const f = fixture();
    const observed = { ...target(), candidates: [] };
    if (kind === 'overlay') observed.layer = 2;
    if (kind === 'unidentified') observed.processStartedAt = null;
    f.dependencies.targets.mockResolvedValue({ target: observed, truncated: false });
    const screenshot = await f.takeScreenshot();
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('控件');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it('chooses the containing descendant and rejects unrelated overlapping AX controls', async () => {
    const f = fixture();
    const window = target();
    window.candidates.push({ ...window.candidates[0], path: [0, 1], title: 'Child button' });
    f.dependencies.targets.mockResolvedValue({ target: window, truncated: false });
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepareClick(screenshot.observationId);
    await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(f.dependencies.click).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({
      candidate: expect.objectContaining({ path: [0, 1], title: 'Child button' }),
    }) }), f.controller.signal);
    window.candidates.push({ ...window.candidates[0], path: [2], title: 'Overlapping sibling' });
    const overlapping = await f.takeScreenshot();
    await expect(f.prepareClick(overlapping.observationId)).rejects.toThrow('不唯一');
    expect(f.dependencies.click).toHaveBeenCalledTimes(1);
  });

  it.each([{ button: 'right' as const }, { clickCount: 2 as const }])('rejects unsupported click semantics %j before dispatch', async override => {
    const f = fixture();
    const screenshot = await f.takeScreenshot();
    await expect(f.prepareClick(screenshot.observationId, override)).rejects.toThrow('点击动作');
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it('requires the sealed control binding to match the observation', async () => {
    const f = fixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepareClick(screenshot.observationId);
    const foreignBinding = { ...prepared, binding: { ...prepared.binding, target: { window: { pid: 801 } } } };
    await expect(f.runtime.click(foreignBinding, f.controller.signal, f.commit)).rejects.toThrow('控件身份');
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it.each([
    { bounds: { x: 20, y: 0, width: 1920, height: 1200 } },
    { bounds: { x: 0, y: 0, width: 1600, height: 1200 } },
    { windowId: 25 }, { pid: 801 }, { processStartedAt: 1_770_000_000_001 }, { layer: 1 }, { title: 'Changed window' },
  ])('rejects prepared coordinates after shared window identity or geometry changes: %j', async change => {
    const f = fixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepareClick(screenshot.observationId);
    f.setWindows([{ ...f.window, ...change }]);
    await expect(f.runtime.click(prepared, f.controller.signal, f.commit)).rejects.toThrow('应用窗口');
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it('retains the window grant after a move, rejects old coordinates, and observes the fresh geometry without another approval', async () => {
    const f = fixture();
    const first = await f.takeScreenshot();
    const oldClick = await f.prepareClick(first.observationId);
    const moved = { ...f.window, bounds: { x: -100, y: 30, width: 1600, height: 900 } };
    f.setWindows([moved]);
    await expect(f.runtime.click(oldClick, f.controller.signal, f.commit)).rejects.toThrow('应用窗口');
    const updated = await f.runtime.prepareObserve({}, f.prepareContext);
    expect(updated.decision.behavior).toBe('allow');
    expect(updated.publicAction).toMatchObject({ targetId: first.targetId });
    const result = await f.runtime.observe(execution(updated, f.runIdentity), f.controller.signal);
    expect(result).toMatchObject({ ok: true, data: { captureScope: 'window', targetId: first.targetId, clickReady: true } });
    expect(f.dependencies.capture).toHaveBeenLastCalledWith(moved, f.controller.signal);
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it.each(['observe', 'click'] as const)('refuses historical V1 %s execution without restoring global screen behavior', async operation => {
    const f = fixture();
    const action = operation === 'observe'
      ? { kind: 'computer.observe' as const, version: 1 as const, libraryId: 3, displayId: '1', displayLabel: '旧屏幕' }
      : { kind: 'computer.click' as const, version: 1 as const, libraryId: 3, displayId: '1', displayLabel: '旧屏幕',
        observationId: '83fc584b-037d-4c82-8883-a609846ea0d4', screenshotWidth: 2048, screenshotHeight: 1280,
        x: 10, y: 20, button: 'left' as const, clickCount: 1 as const };
    const prepared = execution({ publicAction: action, binding: {}, decision: { behavior: 'allow', risk: 'read' } }, f.runIdentity);
    await expect(operation === 'observe' ? f.runtime.observe(prepared, f.controller.signal)
      : f.runtime.click(prepared, f.controller.signal, f.commit)).rejects.toThrow();
    expect(f.dependencies.windows).not.toHaveBeenCalled();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.dependencies.targets).not.toHaveBeenCalled();
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it('does not revive a released share when the pre-capture window validation finishes late', async () => {
    const f = fixture();
    const prepared = await f.runtime.prepareObserve({}, f.prepareContext);
    const snapshot = deferred<Awaited<ReturnType<AgentComputerRuntimeDependencies['windows']>>>();
    const started = deferred<void>();
    f.dependencies.windows.mockImplementationOnce(async () => { started.resolve(); return snapshot.promise; });
    const pending = f.runtime.observe(execution(prepared, f.runIdentity), f.controller.signal);
    const failure = expect(pending).rejects.toThrow('已结束');
    await started.promise;
    f.runtime.releaseRun(f.runIdentity.runId);
    snapshot.resolve({ windows: [f.window], truncated: false });
    await failure;
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.dependencies.targets).not.toHaveBeenCalled();
    expect(f.images.import).not.toHaveBeenCalled();
    expect(f.dependencies.keepWindowRendering).not.toHaveBeenCalled();
    expect((await f.runtime.prepareObserve({}, f.prepareContext)).decision.behavior).toBe('ask');
  });

  it.each(['release', 'cancel'] as const)('discards an asynchronous import after %s without retaining a session image', async stop => {
    const f = fixture();
    const importing = deferred<AgentAttachment>();
    const started = deferred<void>();
    f.images.import.mockImplementationOnce(async () => { started.resolve(); return importing.promise; });
    const pending = f.takeScreenshot();
    const failure = expect(pending).rejects.toThrow();
    await started.promise;
    if (stop === 'release') f.runtime.releaseRun(f.runIdentity.runId); else f.controller.abort();
    importing.resolve({ ...f.attachment });
    await failure;
    expect(f.images.discard).toHaveBeenCalledWith({ ownerScope: f.runIdentity.ownerScope, libraryId: 3 }, f.attachment.id);
    if (f.images.bind.mock.calls.length) expect(f.images.rollbackBinding).toHaveBeenCalledWith(
      { ownerScope: f.runIdentity.ownerScope, libraryId: 3 }, [f.attachment.id], f.runIdentity.sessionId);
  });

  it('rolls back a completed binding if the Run is released while that binding is awaiting completion', async () => {
    const f = fixture();
    const binding = deferred<string[]>();
    const started = deferred<void>();
    f.images.bind.mockImplementationOnce(async () => { started.resolve(); return binding.promise; });
    const pending = f.takeScreenshot();
    const failure = expect(pending).rejects.toThrow('已结束');
    await started.promise;
    f.runtime.releaseRun(f.runIdentity.runId);
    binding.resolve([f.attachment.id]);
    await failure;
    expect(f.images.rollbackBinding).toHaveBeenCalledWith({ ownerScope: f.runIdentity.ownerScope, libraryId: 3 }, [f.attachment.id], 'session-1');
    expect(f.images.discard).toHaveBeenCalledWith({ ownerScope: f.runIdentity.ownerScope, libraryId: 3 }, f.attachment.id);
    expect((await f.runtime.prepareObserve({}, f.prepareContext)).decision.behavior).toBe('ask');
  });

  it('does not import a capture completed after Run release', async () => {
    const f = fixture();
    const capture = deferred<Buffer>();
    const started = deferred<void>();
    f.dependencies.capture.mockImplementationOnce(async () => { started.resolve(); return capture.promise; });
    const pending = f.takeScreenshot();
    const failure = expect(pending).rejects.toThrow('已结束');
    await started.promise;
    f.runtime.releaseRun(f.runIdentity.runId);
    capture.resolve(Buffer.from('late-png'));
    await failure;
    expect(f.images.import).not.toHaveBeenCalled();
  });

  it.each(['release', 'cancel'] as const)('does not publish a post-capture AX summary returned after %s', async stop => {
    const f = fixture();
    const scan = deferred<Awaited<ReturnType<AgentComputerRuntimeDependencies['targets']>>>();
    const started = deferred<void>();
    f.dependencies.targets.mockResolvedValueOnce({ target: target(), truncated: true })
      .mockImplementationOnce(async () => { started.resolve(); return scan.promise; });
    const pending = f.takeScreenshot();
    const failure = expect(pending).rejects.toThrow();
    await started.promise;
    if (stop === 'release') f.runtime.releaseRun(f.runIdentity.runId); else f.controller.abort();
    scan.resolve({ target: target(), truncated: false, axTree: 'Late AXWindow', axTreeTruncated: false });
    await failure;
    expect(f.dependencies.capture).toHaveBeenCalledOnce();
    expect(f.images.import).not.toHaveBeenCalled();
    expect(f.images.bind).not.toHaveBeenCalled();
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it.each([
    ['not-dispatched', new AgentComputerInputError('permission denied', 'not-dispatched'), 'uncommitted'],
    ['unknown', new AgentComputerInputError('receipt lost', 'unknown'), 'commit_unknown'],
    ['unknown', new Error('helper vanished'), 'commit_unknown'],
  ] as const)('settles %s input failures and prevents a second dispatch', async (state, error, commitState) => {
    const f = fixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepareClick(screenshot.observationId);
    f.dependencies.click.mockRejectedValueOnce(error);
    const result = await f.runtime.click(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: false, data: { dispatchState: state, mutationCommitState: commitState, operationId: 'tool-click' } });
    expect(f.commit.begin).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dispatchState: 'unknown', mutationCommitState: 'commit_unknown' }) }));
    expect(f.commit.settle).toHaveBeenCalledWith(result);
    await expect(f.runtime.click(prepared, f.controller.signal, f.commit)).rejects.toThrow('过期');
    expect(f.dependencies.click).toHaveBeenCalledTimes(1);
  });

  it('preserves a dispatch receipt after cancellation crosses the input boundary', async () => {
    const f = fixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepareClick(screenshot.observationId);
    const dispatch = deferred<void>();
    const started = deferred<void>();
    f.dependencies.click.mockImplementationOnce(async () => { started.resolve(); return dispatch.promise; });
    const pending = f.runtime.click(prepared, f.controller.signal, f.commit);
    await started.promise;
    f.controller.abort();
    dispatch.resolve();
    const result = await pending;
    expect(result).toMatchObject({ ok: true, data: { dispatchState: 'dispatched', mutationCommitState: 'committed' } });
    expect(f.commit.settle).toHaveBeenCalledWith(result);
  });

  it.each(['geometry', 'expired', 'release'] as const)('rechecks %s changes after awaiting input permission and before dispatch', async change => {
    const f = fixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepareClick(screenshot.observationId);
    const status = deferred<{ available: boolean }>();
    const started = deferred<void>();
    f.dependencies.clickStatus.mockImplementationOnce(async () => { started.resolve(); return status.promise; });
    const pending = f.runtime.click(prepared, f.controller.signal, f.commit);
    const failure = expect(pending).rejects.toThrow();
    await started.promise;
    if (change === 'geometry') f.setWindows([{ ...f.window, bounds: { ...f.window.bounds, x: 100 } }]);
    else if (change === 'expired') f.advance(60_001);
    else f.runtime.releaseRun(f.runIdentity.runId);
    status.resolve({ available: true });
    await failure;
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });

  it.each(['expired', 'release'] as const)('rechecks %s after the final awaited window snapshot and before dispatch', async change => {
    const f = fixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepareClick(screenshot.observationId);
    const snapshot = deferred<Awaited<ReturnType<AgentComputerRuntimeDependencies['windows']>>>();
    const started = deferred<void>();
    f.dependencies.windows.mockResolvedValueOnce({ windows: [f.window], truncated: false })
      .mockImplementationOnce(async () => { started.resolve(); return snapshot.promise; });
    const pending = f.runtime.click(prepared, f.controller.signal, f.commit);
    const failure = expect(pending).rejects.toThrow();
    await started.promise;
    if (change === 'expired') f.advance(60_001);
    else f.runtime.releaseRun(f.runIdentity.runId);
    snapshot.resolve({ windows: [f.window], truncated: false });
    await failure;
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
  });
});

describe('first-party controls stay separate from AX and consume observations once', () => {
  function firstPartyFixture() {
    const registrationId = '11111111-1111-4111-8111-111111111111';
    const documentGeneration = '22222222-2222-4222-8222-222222222222';
    const controls: FirstPartyBoundControl[] = [{
      registrationId, documentGeneration, bounds: { x: 480, y: 300, width: 960, height: 150 },
      snapshot: { controlId: 'agent-composer', instanceId: '33333333-3333-4333-8333-333333333333', revision: 1,
        bounds: { x: 450, y: 280, width: 900, height: 140 }, operations: ['replaceText', 'insertText'],
        state: { kind: 'text', selectionStart: 0, selectionEnd: 0, textLength: 0 } },
    }, {
      registrationId, documentGeneration, bounds: { x: 480, y: 480, width: 960, height: 600 },
      snapshot: { controlId: 'agent-conversation', instanceId: '33333333-3333-4333-8333-333333333333', revision: 2,
        bounds: { x: 450, y: 450, width: 900, height: 560 },
        operations: ['scrollUpPage', 'scrollDownPage', 'scrollUpStep', 'scrollDownStep', 'scrollUpFraction', 'scrollDownFraction'],
        state: { kind: 'scroll', top: 0, clientHeight: 560, scrollHeight: 1500 } },
    }];
    type Bridge = NonNullable<AgentComputerRuntimeDependencies['firstPartyControls']>;
    const observation = () => ({ registrationId, documentGeneration, controls: structuredClone(controls) });
    const bridge = {
      observe: vi.fn<Bridge['observe']>(async () => observation()),
      verify: vi.fn<Bridge['verify']>(async () => undefined),
      dispatch: vi.fn<Bridge['dispatch']>(async () => undefined),
    };
    const f = fixture(bridge);
    f.dependencies.targets.mockResolvedValue({ target: { ...target(), candidates: [] }, truncated: false });
    const prepareText = async (observationId: string, elementId: string, text = ' 中文😀\n', mode: 'replace' | 'insert' = 'replace') => {
      const runIdentity = identity({ callId: 'call-first-party-text', toolName: 'computer.setText',
        toolRegistrationId: 'builtin:computer.setText@1', toolRunId: 'tool-first-party-text', preparedActionId: 'prepared-first-party-text' });
      const prepared = await f.runtime.prepareSetText({ observationId, elementId, text, mode }, context(runIdentity, f.controller.signal));
      return execution(prepared, runIdentity);
    };
    const prepareScroll = async (observationId: string, elementId: string, unit: 'page' | 'step' | 'fraction' = 'fraction') => {
      const runIdentity = identity({ callId: 'call-first-party-scroll', toolName: 'computer.scroll',
        toolRegistrationId: 'builtin:computer.scroll@1', toolRunId: 'tool-first-party-scroll', preparedActionId: 'prepared-first-party-scroll' });
      const prepared = await f.runtime.prepareScroll({ observationId, elementId, direction: 'down', unit }, context(runIdentity, f.controller.signal));
      return execution(prepared, runIdentity);
    };
    const assertNoAXMutation = () => {
      expect(f.dependencies.click).not.toHaveBeenCalled();
      expect(f.dependencies.setText).not.toHaveBeenCalled();
      expect(f.dependencies.scroll).not.toHaveBeenCalled();
    };
    return { ...f, bridge, controls, registrationId, documentGeneration, observation, prepareText, prepareScroll, assertNoAXMutation };
  }

  it('rejects first-party IDs as native region anchors and excludes whole-window first-party controls from local scans', async () => {
    const f = firstPartyFixture();
    f.dependencies.targets.mockImplementation(async (window, _signal, scope) => ({ target: target(window), truncated: false,
      ...(scope ? { scope: { path: [0] } } : {}) }));
    const wholeWindow = await f.takeScreenshot({ mode: 'ax' });
    const firstParty = wholeWindow.elements.find(element => element.label === 'Agent 输入')!;
    const native = wholeWindow.elements.find(element => element.label === 'Fixture button')!;
    await expect(f.runtime.prepareObserve({ mode: 'ax', focus: { observationId: wholeWindow.observationId,
      elementId: firstParty.elementId } }, f.prepareContext)).rejects.toThrow('不支持第一方');
    f.bridge.observe.mockClear();
    const local = await f.takeScreenshot({ mode: 'ax', focus: { observationId: wholeWindow.observationId, elementId: native.elementId } });
    expect(f.bridge.observe).not.toHaveBeenCalled();
    expect(local.elements.map(element => element.label)).toEqual(['Fixture button']);
    expect(local).toMatchObject({ scope: { kind: 'element-ancestor', ancestorLevels: 0 }, elementsScope: 'stable-AX-controls' });
    f.assertNoAXMutation();
  });

  it('publishes screenshot-relative geometry and a first-party source without exposing transport identities', async () => {
    const f = firstPartyFixture();
    const observed = await f.takeScreenshot();
    expect(observed).toMatchObject({ clickReady: false, coordinateClickReady: false, textReady: true, scrollReady: true,
      elementsScope: 'stable-window-controls', elements: [
        { role: 'textbox', label: 'Agent 输入', source: 'omniflow-control', operations: ['replaceText', 'insertText'],
          screenshotBounds: { x: 512, y: 320, width: 1024, height: 160 } },
        { role: 'scroll-region', label: 'Agent 对话区域', source: 'omniflow-control',
          screenshotBounds: { x: 512, y: 512, width: 1024, height: 640 } },
      ] });
    expect(f.bridge.observe).toHaveBeenCalledTimes(2);
    expect(f.bridge.observe.mock.invocationCallOrder[0]).toBeLessThan(f.dependencies.capture.mock.invocationCallOrder[0]);
    expect(f.bridge.observe.mock.invocationCallOrder[1]).toBeGreaterThan(f.dependencies.capture.mock.invocationCallOrder[0]);
    expect(JSON.stringify(observed)).not.toMatch(/registrationId|documentGeneration|instanceId|snapshot|revision|selectionStart/);
    expect(JSON.stringify(observed)).not.toContain(f.registrationId);
    expect(JSON.stringify(observed)).not.toContain(f.documentGeneration);
    await expect(f.prepareClick(observed.observationId, { x: undefined, y: undefined, elementId: observed.elements[0].elementId }))
      .rejects.toThrow('控件标识');
    await expect(f.prepareClick(observed.observationId)).rejects.toThrow('坐标');
    expect(f.commit.begin).not.toHaveBeenCalled();
    f.assertNoAXMutation();
  });

  it('keeps named first-party controls visible on a full native AX page and supports AX-only input', async () => {
    const f = firstPartyFixture();
    const controls = target();
    controls.candidates = Array.from({ length: 128 }, (_, index) => ({ ...controls.candidates[0], path: [index], title: `Button ${index}` }));
    f.dependencies.targets.mockResolvedValue({ target: controls, truncated: true });
    const observed = await f.takeScreenshot({ mode: 'ax' });
    expect(observed).toMatchObject({ totalMatched: 130, hasMore: true });
    expect(observed.elements.slice(0, 2).map(element => element.label)).toEqual(['Agent 输入', 'Agent 对话区域']);
    expect(observed.elements[0]).not.toHaveProperty('screenshotBounds');
    const prepared = await f.prepareText(observed.observationId, observed.elements[0].elementId);
    await f.runtime.setText(prepared, f.controller.signal, f.commit);
    expect(f.bridge.dispatch).toHaveBeenCalledOnce();
    expect(f.dependencies.capture).not.toHaveBeenCalled();
    expect(f.images.import).not.toHaveBeenCalled();
  });

  it.each(['text', 'scroll'] as const)('prepares and dispatches one verified first-party %s operation without AX permission', async kind => {
    const f = firstPartyFixture();
    f.dependencies.clickStatus.mockResolvedValue({ available: false });
    const observed = await f.takeScreenshot();
    const elementId = observed.elements[kind === 'text' ? 0 : 1].elementId;
    const prepared = kind === 'text' ? await f.prepareText(observed.observationId, elementId)
      : await f.prepareScroll(observed.observationId, elementId);
    expect(f.bridge.verify).toHaveBeenCalledOnce();
    expect(prepared.binding.target).toEqual({ firstPartyControl: f.controls[kind === 'text' ? 0 : 1] });
    expect(JSON.stringify(prepared.publicAction)).not.toMatch(/registrationId|documentGeneration|instanceId|snapshot|revision/);
    const result = await (kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit);
    expect(f.bridge.verify).toHaveBeenCalledTimes(2);
    expect(f.bridge.dispatch).toHaveBeenCalledOnce();
    expect(f.bridge.dispatch).toHaveBeenCalledWith(f.window, prepared.identity, f.controls[kind === 'text' ? 0 : 1],
      kind === 'text' ? 'replaceText' : 'scrollDownFraction', kind === 'text' ? ' 中文😀\n' : undefined, f.controller.signal);
    expect(f.bridge.verify.mock.invocationCallOrder[1]).toBeLessThan(f.commit.begin.mock.invocationCallOrder[0]);
    expect(f.commit.begin.mock.invocationCallOrder[0]).toBeLessThan(f.bridge.dispatch.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ ok: true, data: { inputMethod: 'omniflow-control', dispatchState: 'dispatched',
      mutationCommitState: 'committed', retryAllowed: false, nextAction: 'observe' } });
    expect(f.dependencies.targets).not.toHaveBeenCalled();
    f.assertNoAXMutation();
    await expect((kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit)).rejects.toThrow('重复');
    expect(f.bridge.dispatch).toHaveBeenCalledOnce();
  });

  it.each(['page', 'step', 'fraction'] as const)('preserves the explicitly selected first-party %s unit', async unit => {
    const f = firstPartyFixture();
    const observed = await f.takeScreenshot();
    const prepared = await f.prepareScroll(observed.observationId, observed.elements[1].elementId, unit);
    await f.runtime.scroll(prepared, f.controller.signal, f.commit);
    expect(f.bridge.dispatch.mock.calls[0][3]).toBe(`scrollDown${unit[0].toUpperCase()}${unit.slice(1)}`);
    expect(f.bridge.dispatch).toHaveBeenCalledOnce();
    f.assertNoAXMutation();
  });

  it.each(['registration', 'document', 'instance', 'revision', 'screen-bounds', 'css-bounds', 'selection', 'operations'] as const)(
    'withholds a text ID when its %s drifts across the exact capture', async field => {
      const f = firstPartyFixture();
      const before = f.observation();
      const after = structuredClone(before);
      if (field === 'registration') {
        after.registrationId = '77777777-7777-4777-8777-777777777777';
        after.controls.forEach(control => { control.registrationId = after.registrationId; });
      }
      if (field === 'document') {
        after.documentGeneration = '77777777-7777-4777-8777-777777777777';
        after.controls.forEach(control => { control.documentGeneration = after.documentGeneration; });
      }
      if (field === 'instance') after.controls[0].snapshot.instanceId = '77777777-7777-4777-8777-777777777777';
      if (field === 'revision') after.controls[0].snapshot.revision += 1;
      if (field === 'screen-bounds') after.controls[0].bounds.x += 1;
      if (field === 'css-bounds') after.controls[0].snapshot.bounds.x += 1;
      if (field === 'selection') after.controls[0].snapshot.state = { kind: 'text', selectionStart: 1, selectionEnd: 1, textLength: 1 };
      if (field === 'operations') after.controls[0].snapshot.operations = ['replaceText'];
      f.bridge.observe.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
      const observed = await f.takeScreenshot();
      expect(observed.elements.some(element => element.role === 'textbox')).toBe(false);
      expect(f.bridge.verify).not.toHaveBeenCalled();
      f.assertNoAXMutation();
    });

  it.each(['absent', 'failed', 'outside', 'invalid-token', 'mismatched-document', 'duplicate'] as const)(
    'keeps an %s first-party observation from becoming an AX element', async scenario => {
      const f = firstPartyFixture();
      const observedControls = f.observation();
      if (scenario === 'absent') f.bridge.observe.mockResolvedValue(undefined);
      if (scenario === 'failed') f.bridge.observe.mockRejectedValue(new Error('private renderer data'));
      if (scenario === 'outside') observedControls.controls[0].bounds.x = f.window.bounds.width;
      if (scenario === 'invalid-token') observedControls.documentGeneration = 'invalid';
      if (scenario === 'mismatched-document') observedControls.controls[0].documentGeneration = '77777777-7777-4777-8777-777777777777';
      if (scenario === 'duplicate') observedControls.controls[1] = structuredClone(observedControls.controls[0]);
      if (scenario !== 'absent' && scenario !== 'failed') f.bridge.observe.mockResolvedValue(observedControls);
      const observed = await f.takeScreenshot();
      expect(observed.elements).toEqual([]);
      expect(observed).toMatchObject({ clickReady: false, textReady: false, scrollReady: false });
      expect(JSON.stringify(observed)).not.toContain('private renderer data');
      expect(f.bridge.dispatch).not.toHaveBeenCalled();
      f.assertNoAXMutation();
    });

  it.each([
    { runId: 'other-run' }, { sessionId: 'other-session' }, { libraryId: 4 }, { ownerWebContentsId: 18 },
    { ownerScope: { accountScope: 'other-user', backendScope: 'http://localhost:9000' } },
    { ownerScope: { accountScope: 'user:7', backendScope: 'http://other.test' } },
    { aiDestinationIdentity: `v1:${'f'.repeat(64)}` }, { runCapabilityIdentity: `v2:${'f'.repeat(64)}` },
  ])('rejects first-party observation reuse under a different execution identity: %j', async changes => {
    const f = firstPartyFixture();
    const observed = await f.takeScreenshot();
    await expect(f.runtime.prepareSetText({ observationId: observed.observationId, elementId: observed.elements[0].elementId,
      text: 'fixture', mode: 'replace' }, context(identity(changes), f.controller.signal))).rejects.toThrow('过期');
    expect(f.bridge.verify).not.toHaveBeenCalled();
    expect(f.bridge.dispatch).not.toHaveBeenCalled();
    f.assertNoAXMutation();
  });

  it('does not lend an old element ID to a new observation or an expired observation to preparation', async () => {
    const f = firstPartyFixture();
    const old = await f.takeScreenshot();
    const current = await f.takeScreenshot();
    expect(current.elements[0].elementId).not.toBe(old.elements[0].elementId);
    await expect(f.prepareText(current.observationId, old.elements[0].elementId)).rejects.toThrow('操作能力');
    f.advance(60_001);
    await expect(f.prepareText(current.observationId, current.elements[0].elementId)).rejects.toThrow('过期');
    expect(f.bridge.verify).not.toHaveBeenCalled();
    expect(f.bridge.dispatch).not.toHaveBeenCalled();
  });

  it.each(['registration', 'document', 'instance', 'revision', 'bounds', 'selection', 'operations'] as const)(
    'rejects tampered sealed first-party %s before final verify or commit', async field => {
      const f = firstPartyFixture();
      const observed = await f.takeScreenshot();
      const prepared = structuredClone(await f.prepareText(observed.observationId, observed.elements[0].elementId));
      const control = (prepared.binding.target as { firstPartyControl: FirstPartyBoundControl }).firstPartyControl;
      if (field === 'registration') control.registrationId = '77777777-7777-4777-8777-777777777777';
      if (field === 'document') control.documentGeneration = '77777777-7777-4777-8777-777777777777';
      if (field === 'instance') control.snapshot.instanceId = '77777777-7777-4777-8777-777777777777';
      if (field === 'revision') control.snapshot.revision += 1;
      if (field === 'bounds') control.bounds.height -= 1;
      if (field === 'selection') control.snapshot.state = { kind: 'text', selectionStart: 1, selectionEnd: 1, textLength: 1 };
      if (field === 'operations') control.snapshot.operations = ['insertText'];
      await expect(f.runtime.setText(prepared, f.controller.signal, f.commit)).rejects.toThrow('不匹配');
      expect(f.bridge.verify).toHaveBeenCalledOnce();
      expect(f.commit.begin).not.toHaveBeenCalled();
      expect(f.bridge.dispatch).not.toHaveBeenCalled();
      f.assertNoAXMutation();
    });

  it.each(['prepare', 'final'] as const)('rejects first-party %s verify failure without entering AX or a commit', async phase => {
    const f = firstPartyFixture();
    const observed = await f.takeScreenshot();
    if (phase === 'prepare') {
      f.bridge.verify.mockRejectedValueOnce(new Error('control revision changed'));
      await expect(f.prepareText(observed.observationId, observed.elements[0].elementId)).rejects.toThrow('revision changed');
    } else {
      const prepared = await f.prepareText(observed.observationId, observed.elements[0].elementId);
      f.bridge.verify.mockRejectedValueOnce(new Error('control revision changed'));
      await expect(f.runtime.setText(prepared, f.controller.signal, f.commit)).rejects.toThrow('revision changed');
    }
    expect(f.bridge.dispatch).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
    f.assertNoAXMutation();
  });

  it.each(['release', 'abort'] as const)('stops a first-party final verify crossed by Run %s before dispatch', async stop => {
    const f = firstPartyFixture();
    const observed = await f.takeScreenshot();
    const prepared = await f.prepareText(observed.observationId, observed.elements[0].elementId);
    const verified = deferred<void>();
    const started = deferred<void>();
    f.bridge.verify.mockImplementationOnce(async () => { started.resolve(); return verified.promise; });
    const pending = f.runtime.setText(prepared, f.controller.signal, f.commit);
    const rejection = expect(pending).rejects.toThrow();
    await started.promise;
    if (stop === 'release') f.runtime.releaseRun(f.runIdentity.runId); else f.controller.abort();
    verified.resolve();
    await rejection;
    expect(f.bridge.dispatch).not.toHaveBeenCalled();
    expect(f.commit.begin).not.toHaveBeenCalled();
    f.assertNoAXMutation();
  });

  it.each([
    ['unknown', new AgentComputerInputError('private renderer state', 'unknown'), 'commit_unknown'],
    ['unknown', new Error('private renderer state'), 'commit_unknown'],
    ['not-dispatched', new AgentComputerInputError('private renderer state', 'not-dispatched'), 'uncommitted'],
  ] as const)('settles %s once, consumes the observation, and never falls back or repeats', async (dispatchState, error, mutationCommitState) => {
    const f = firstPartyFixture();
    const observed = await f.takeScreenshot();
    const prepared = await f.prepareText(observed.observationId, observed.elements[0].elementId);
    f.bridge.dispatch.mockRejectedValueOnce(error);
    const result = await f.runtime.setText(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: false, data: { inputMethod: 'omniflow-control', dispatchState,
      mutationCommitState, retryAllowed: false, nextAction: 'observe' } });
    expect(JSON.stringify(result)).not.toContain('private renderer state');
    expect(f.commit.begin).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dispatchState: 'unknown', mutationCommitState: 'commit_unknown' }) }));
    expect(f.commit.settle).toHaveBeenCalledOnce();
    await expect(f.runtime.setText(prepared, f.controller.signal, f.commit)).rejects.toThrow('重复');
    await expect(f.prepareText(observed.observationId, observed.elements[0].elementId)).rejects.toThrow('重复');
    expect(f.bridge.dispatch).toHaveBeenCalledOnce();
    f.assertNoAXMutation();
  });

  it('retains a definitive first-party dispatch receipt when cancellation crosses the commit boundary', async () => {
    const f = firstPartyFixture();
    const observed = await f.takeScreenshot();
    const prepared = await f.prepareText(observed.observationId, observed.elements[0].elementId);
    const dispatched = deferred<void>();
    const started = deferred<void>();
    f.bridge.dispatch.mockImplementationOnce(async () => { started.resolve(); return dispatched.promise; });
    const pending = f.runtime.setText(prepared, f.controller.signal, f.commit);
    await started.promise;
    f.controller.abort();
    dispatched.resolve();
    expect(await pending).toMatchObject({ ok: true, data: { dispatchState: 'dispatched', mutationCommitState: 'committed' } });
    expect(f.commit.settle).toHaveBeenCalledOnce();
    expect(f.bridge.dispatch).toHaveBeenCalledOnce();
    f.assertNoAXMutation();
  });

  it('does not turn an unknown AX text action into a first-party control dispatch', async () => {
    const f = firstPartyFixture();
    const native = target();
    native.candidates = [{ ...native.candidates[0], role: 'AXTextArea', title: 'Native text',
      operations: ['replaceText'], textState: { subrole: null }, enabledState: 'enabled' }];
    f.dependencies.targets.mockResolvedValue({ target: native, truncated: false });
    const observed = await f.takeScreenshot();
    const elementId = observed.elements.find(element => element.label === 'Native text')!.elementId;
    const prepared = await f.prepareText(observed.observationId, elementId);
    f.dependencies.setText.mockRejectedValueOnce(new AgentComputerInputError('unknown native callback', 'unknown'));
    expect(await f.runtime.setText(prepared, f.controller.signal, f.commit)).toMatchObject({ data: { dispatchState: 'unknown', retryAllowed: false } });
    expect(f.dependencies.setText).toHaveBeenCalledOnce();
    expect(f.bridge.verify).not.toHaveBeenCalled();
    expect(f.bridge.dispatch).not.toHaveBeenCalled();
  });
});

describe('semantic text and scroll runtime', () => {
  function fractionFixture(orientation: 'vertical' | 'horizontal' = 'vertical') {
    const f = fixture();
    const operations: ComputerElementOperation[] = orientation === 'vertical'
      ? ['scrollUpFraction', 'scrollDownFraction', 'scrollDownStep']
      : ['scrollLeftFraction', 'scrollRightFraction'];
    const nativeTarget: AgentComputerTarget = { ...target(f.window), candidates: [{
      path: [0], role: 'AXScrollBar', title: '已确认滚动条', orientation, operations, enabledState: 'enabled',
      scrollState: { value: 0.5, minValue: 0, maxValue: 1 }, bounds: { ...f.window.bounds },
    }] };
    f.dependencies.targets.mockResolvedValue({ target: nativeTarget, truncated: false });
    const scrollIdentity = identity({ toolName: 'computer.scroll', toolRegistrationId: 'builtin:computer.scroll@1',
      toolRunId: '83fc584b-037d-4c82-8883-a609846ea0d4' });
    const prepare = async (observationId: string, elementId: string, direction: 'up' | 'down' | 'left' | 'right' = 'down') =>
      execution(await f.runtime.prepareScroll({ observationId, elementId, direction, unit: 'fraction' },
        context(scrollIdentity, f.controller.signal)), scrollIdentity);
    return { ...f, nativeTarget, prepare };
  }

  it.each([
    ['vertical', 'up', 'scrollUpFraction'], ['vertical', 'down', 'scrollDownFraction'],
    ['horizontal', 'left', 'scrollLeftFraction'], ['horizontal', 'right', 'scrollRightFraction'],
  ] as const)('dispatches only the observed %s %s fraction operation with private numeric state', async (orientation, direction, operation) => {
    const f = fractionFixture(orientation);
    const observed = await f.takeScreenshot();
    const prepared = await f.prepare(observed.observationId, observed.elements[0].elementId, direction);
    expect(prepared.binding.target).toMatchObject({ candidate: { orientation,
      scrollState: { value: 0.5, minValue: 0, maxValue: 1 } } });
    const result = await f.runtime.scroll(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: true, data: { unit: 'fraction', direction,
      dispatchState: 'dispatched', mutationCommitState: 'committed', nextAction: 'observe', retryAllowed: false } });
    expect(f.dependencies.scroll).toHaveBeenCalledWith({ operation, target: prepared.binding.target }, f.controller.signal);
    expect(f.dependencies.scroll).toHaveBeenCalledOnce();
    for (const publicValue of [observed, prepared.publicAction, result]) {
      expect(JSON.stringify(publicValue)).not.toMatch(/"scrollState"|"minValue"|"maxValue"|"value"/);
    }
  });

  it.each(['value', 'minValue', 'maxValue', 'missing'] as const)('rejects fraction IDs when private %s drifts across capture', async field => {
    const f = fractionFixture();
    const after = structuredClone(f.nativeTarget);
    if (field === 'missing') delete after.candidates[0].scrollState;
    else after.candidates[0].scrollState![field] += 0.1;
    f.dependencies.targets.mockResolvedValueOnce({ target: f.nativeTarget, truncated: false })
      .mockResolvedValueOnce({ target: after, truncated: false });
    expect((await f.takeScreenshot()).elements).toEqual([]);
    expect(f.dependencies.scroll).not.toHaveBeenCalled();
  });

  it.each([['vertical', 'left'], ['horizontal', 'up']] as const)('refuses undeclared fraction directions for the %s axis', async (orientation, direction) => {
    const f = fractionFixture(orientation);
    const observed = await f.takeScreenshot();
    await expect(f.prepare(observed.observationId, observed.elements[0].elementId, direction)).rejects.toThrow('操作能力');
    expect(f.dependencies.scroll).not.toHaveBeenCalled();
  });

  it.each(['value', 'minValue', 'maxValue'] as const)('rejects a forged prepared fraction %s before the commit boundary', async field => {
    const f = fractionFixture();
    const observed = await f.takeScreenshot();
    const prepared = await f.prepare(observed.observationId, observed.elements[0].elementId);
    const forged = structuredClone(prepared);
    (forged.binding.target as AgentComputerScrollRequest['target']).candidate.scrollState![field] += 0.1;
    await expect(f.runtime.scroll(forged, f.controller.signal, f.commit)).rejects.toThrow('已准备的后台控件身份不匹配');
    expect(f.commit.begin).not.toHaveBeenCalled();
    expect(f.dependencies.scroll).not.toHaveBeenCalled();
  });

  it('keeps the previous eleven-operation grant limited and requires new sharing for fraction', async () => {
    const f = fractionFixture();
    const initial = await f.runtime.prepareObserve({}, f.prepareContext);
    if (initial.publicAction.kind !== 'computer.observe' || initial.publicAction.version !== 2) throw new Error('invalid fixture');
    const operations = COMPUTER_ELEMENT_OPERATIONS.filter(operation => !operation.endsWith('Fraction'));
    expect(operations).toHaveLength(11);
    const result = await f.runtime.observe(execution({ ...initial,
      publicAction: { ...initial.publicAction, operations }, binding: { ...initial.binding, operations } }, f.runIdentity), f.controller.signal);
    const observed = result.data as Awaited<ReturnType<typeof f.takeScreenshot>>;
    expect(observed.elements).toMatchObject([{ operations: ['scrollDownStep'] }]);
    await expect(f.prepare(observed.observationId, observed.elements[0].elementId)).rejects.toThrow('操作能力');
    expect((await f.runtime.prepareObserve({}, f.prepareContext)).decision.behavior).toBe('ask');
    expect(f.dependencies.scroll).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'not-dispatched'] as const)('settles fraction %s without changing to a callback or replaying', async state => {
    const f = fractionFixture();
    const observed = await f.takeScreenshot();
    const prepared = await f.prepare(observed.observationId, observed.elements[0].elementId);
    f.dependencies.scroll.mockRejectedValueOnce(new AgentComputerInputError('private native error', state));
    const result = await f.runtime.scroll(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: false, data: { unit: 'fraction', dispatchState: state,
      mutationCommitState: state === 'unknown' ? 'commit_unknown' : 'uncommitted', nextAction: 'observe', retryAllowed: false } });
    expect(JSON.stringify(result)).not.toContain('private native error');
    await expect(f.runtime.prepareScroll({ observationId: observed.observationId,
      elementId: observed.elements[0].elementId, direction: 'down', unit: 'step' }, f.prepareContext)).rejects.toThrow('过期');
    expect(f.dependencies.scroll).toHaveBeenCalledOnce();
    expect(f.dependencies.scroll.mock.calls[0][0].operation).toBe('scrollDownFraction');
    expect(f.commit.settle).toHaveBeenCalledWith(result);
  });

  function semanticFixture(operations: ComputerElementOperation[] = ['replaceText', 'insertText', 'scrollDownStep', 'scrollUpStep']) {
    const f = fixture();
    f.dependencies.targets.mockImplementation(async window => ({ target: { ...target(window), candidates: [{
      path: [0], role: 'AXTextArea', title: '测试输入区', operations, textState: { subrole: null, selection: { location: 0, length: 0 } },
      bounds: { ...window.bounds },
    }] }, truncated: false }));
    async function prepare(kind: 'text' | 'scroll', observationId: string, elementId: string) {
      const runIdentity = identity({ toolName: kind === 'text' ? 'computer.setText' : 'computer.scroll',
        toolRegistrationId: `builtin:computer.${kind === 'text' ? 'setText' : 'scroll'}@1`, toolRunId: `tool-${kind}` });
      const ctx = context(runIdentity, f.controller.signal);
      const prepared = kind === 'text'
        ? await f.runtime.prepareSetText({ observationId, elementId, text: '原样 中文👩🏽‍💻\n', mode: 'insert' }, ctx)
        : await f.runtime.prepareScroll({ observationId, elementId, direction: 'down', unit: 'step' }, ctx);
      return execution(prepared, runIdentity);
    }
    return { ...f, prepare };
  }
  it('advertises separately granted text/scroll capabilities and refuses clicking a non-press ID or coordinates', async () => {
    const f = semanticFixture();
    const prepared = await f.runtime.prepareObserve({}, f.prepareContext);
    expect(prepared.publicAction).toMatchObject({ operations: COMPUTER_ELEMENT_OPERATIONS });
    const screenshot = await f.takeScreenshot();
    expect(screenshot).toMatchObject({ clickReady: false, coordinateClickReady: false, textReady: true, scrollReady: true,
      elements: [{ label: '测试输入区', operations: ['replaceText', 'insertText', 'scrollDownStep', 'scrollUpStep'] }] });
    await expect(f.prepareClick(screenshot.observationId, { elementId: screenshot.elements[0].elementId, x: undefined, y: undefined })).rejects.toThrow('点击能力');
    await expect(f.prepareClick(screenshot.observationId)).rejects.toThrow('后台点击');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });
  it.each(['text', 'scroll'] as const)('dispatches %s once from the sealed ID and returns an audit receipt without text', async kind => {
    const f = semanticFixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepare(kind, screenshot.observationId, screenshot.elements[0].elementId);
    expect(JSON.stringify(prepared.publicAction)).not.toContain('原样');
    const result = await (kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: true, data: { operationId: `tool-${kind}`, dispatchState: 'dispatched', mutationCommitState: 'committed',
      elementId: screenshot.elements[0].elementId, retryAllowed: false, nextAction: 'observe' } });
    expect(JSON.stringify(result)).not.toContain('原样');
    if (kind === 'text') expect(f.dependencies.setText).toHaveBeenCalledWith(expect.objectContaining({ operation: 'insertText', text: '原样 中文👩🏽‍💻\n' }), f.controller.signal);
    else expect(f.dependencies.scroll).toHaveBeenCalledWith(expect.objectContaining({ operation: 'scrollDownStep' }), f.controller.signal);
    await expect((kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit)).rejects.toThrow('过期');
    expect(f.commit.begin).toHaveBeenCalledOnce();
    expect(f.commit.settle).toHaveBeenCalledWith(result);
  });
  it('does not silently enlarge a historical click-only window grant', async () => {
    const f = semanticFixture();
    const initial = await f.runtime.prepareObserve({}, f.prepareContext);
    if (initial.publicAction.kind !== 'computer.observe' || initial.publicAction.version !== 2) throw new Error('invalid fixture');
    const historical = { ...initial.publicAction };
    delete historical.operations;
    const historicalBinding = { ...initial.binding };
    delete historicalBinding.operations;
    const observed = await f.runtime.observe(execution({ ...initial, publicAction: historical, binding: historicalBinding }, f.runIdentity), f.controller.signal);
    expect(observed.data).toMatchObject({ operations: ['press'], elements: [], textReady: false, scrollReady: false });
    expect((await f.runtime.prepareObserve({}, f.prepareContext)).decision.behavior).toBe('ask');
  });
  it('refuses undeclared page scrolling and empty insertion, and allows clearing via replace', async () => {
    const f = semanticFixture();
    const screenshot = await f.takeScreenshot();
    const common = { observationId: screenshot.observationId, elementId: screenshot.elements[0].elementId };
    await expect(f.runtime.prepareScroll({ ...common, direction: 'down', unit: 'page' }, f.prepareContext)).rejects.toThrow('操作能力');
    await expect(f.runtime.prepareSetText({ ...common, text: '', mode: 'insert' }, f.prepareContext)).rejects.toThrow('文字输入无效');
    const prepared = await f.runtime.prepareSetText({ ...common, text: '', mode: 'replace' }, f.prepareContext);
    expect(prepared.publicAction).toMatchObject({ textLength: 0, textBytes: 0 });
    await f.runtime.setText(execution(prepared, f.runIdentity), f.controller.signal, f.commit);
    expect(f.dependencies.setText).toHaveBeenCalledWith(expect.objectContaining({ operation: 'replaceText', text: '' }), f.controller.signal);
  });
  it.each(['operations', 'selection', 'subrole', 'orientation', 'enabledState', 'enabledStateMissing'] as const)('drops IDs when %s drifts during capture', async field => {
    const f = semanticFixture();
    const before = { ...target(), candidates: [{ ...target().candidates[0], title: '文本', operations: ['insertText'] as ComputerElementOperation[],
      textState: { subrole: null as string | null, selection: { location: 0, length: 0 } }, enabledState: 'absent' as const }] };
    const after = structuredClone(before);
    if (field === 'operations') after.candidates[0].operations = ['replaceText'];
    if (field === 'selection') after.candidates[0].textState.selection.location = 1;
    if (field === 'subrole') after.candidates[0].textState.subrole = 'AXTextField';
    if (field === 'orientation') Reflect.set(after.candidates[0], 'orientation', 'horizontal');
    if (field === 'enabledState') Reflect.set(after.candidates[0], 'enabledState', 'enabled');
    if (field === 'enabledStateMissing') Reflect.deleteProperty(after.candidates[0], 'enabledState');
    f.dependencies.targets.mockResolvedValueOnce({ target: before, truncated: false }).mockResolvedValueOnce({ target: after, truncated: false });
    expect((await f.takeScreenshot()).elements).toEqual([]);
  });
  it('keeps confirmed enabled absence in the private semantic binding without publishing it', async () => {
    const f = semanticFixture(['replaceText']);
    f.dependencies.targets.mockImplementation(async window => ({ target: { ...target(window), candidates: [{
      path: [0], role: 'AXTextArea', title: '原生文本', operations: ['replaceText'], enabledState: 'absent',
      textState: { subrole: null }, bounds: { ...window.bounds },
    }] }, truncated: false }));
    const screenshot = await f.takeScreenshot();
    expect(screenshot).toMatchObject({ textReady: true });
    expect(screenshot.elements[0]).not.toHaveProperty('enabledState');
    const prepared = await f.runtime.prepareSetText({ observationId: screenshot.observationId,
      elementId: screenshot.elements[0].elementId, text: '', mode: 'replace' }, f.prepareContext);
    expect(prepared.binding.target).toMatchObject({ candidate: { enabledState: 'absent' } });
    expect(prepared.publicAction).not.toHaveProperty('enabledState');
  });
  it.each(['text', 'scroll'] as const)('settles unknown %s without leaking a helper exception or replaying', async kind => {
    const f = semanticFixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepare(kind, screenshot.observationId, screenshot.elements[0].elementId);
    const input = kind === 'text' ? f.dependencies.setText : f.dependencies.scroll;
    input.mockRejectedValueOnce(new Error('原样 private error'));
    const result = await (kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: false, data: { dispatchState: 'unknown', mutationCommitState: 'commit_unknown' } });
    expect(JSON.stringify(result)).not.toContain('private error');
    await expect((kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit)).rejects.toThrow('过期');
    expect(input).toHaveBeenCalledOnce();
  });
  it.each(['text', 'scroll'] as const)('rechecks expiry before %s dispatch after waiting for AX permission', async kind => {
    const f = semanticFixture();
    const screenshot = await f.takeScreenshot();
    const prepared = await f.prepare(kind, screenshot.observationId, screenshot.elements[0].elementId);
    const status = deferred<{ available: boolean }>();
    const started = deferred<void>();
    f.dependencies.clickStatus.mockImplementationOnce(async () => { started.resolve(); return status.promise; });
    const pending = (kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit);
    const failure = expect(pending).rejects.toThrow('过期');
    await started.promise;
    f.advance(60_001);
    status.resolve({ available: true });
    await failure;
    expect(f.commit.begin).not.toHaveBeenCalled();
    expect(f.dependencies.setText).not.toHaveBeenCalled();
    expect(f.dependencies.scroll).not.toHaveBeenCalled();
  });
  it.each(['complete', 'partial', 'multiple', 'drift'] as const)('only labels an anonymous scrollbar with proven unique stable axis: %s', async scenario => {
    const f = fixture();
    const first: AgentComputerTarget = { ...target(), candidates: [{ path: [0], role: 'AXScrollBar', title: '',
      orientation: 'vertical', operations: ['scrollDownStep'], bounds: { ...f.window.bounds } }] };
    if (scenario === 'multiple') first.candidates.push({ ...first.candidates[0], path: [1] });
    const second = structuredClone(first);
    if (scenario === 'drift') second.candidates.push({ ...first.candidates[0], path: [1] });
    f.dependencies.targets.mockResolvedValueOnce({ target: first, truncated: scenario === 'partial' })
      .mockResolvedValueOnce({ target: second, truncated: scenario === 'partial' });
    const observed = await f.takeScreenshot();
    if (scenario === 'complete') {
      expect(observed.elements).toMatchObject([{ role: 'AXScrollBar', label: '本窗口唯一可操作的垂直滚动条', operations: ['scrollDownStep'] }]);
      const prepared = await f.runtime.prepareScroll({ observationId: observed.observationId, elementId: observed.elements[0].elementId, direction: 'down', unit: 'step' }, f.prepareContext);
      expect(prepared.binding.target).toMatchObject({ candidate: { title: '', orientation: 'vertical' } });
    } else expect(observed.elements).toEqual([]);
  });

  function identifierTextTarget(f: ReturnType<typeof fixture>): AgentComputerTarget {
    return { ...target(), candidates: [{ path: [0], role: 'AXTextArea', title: '',
      identifier: 'private native text identity', identityProfile: 'native-text-identifier-v1', descriptionDeclared: true,
      operations: ['replaceText', 'insertText'], textState: { subrole: null, selection: { location: 0, length: 0 } },
      enabledState: 'absent', bounds: { ...f.window.bounds } }] };
  }

  it('binds a unique native text profile privately and dispatches replace once without granting clicks', async () => {
    const f = fixture();
    f.dependencies.targets.mockResolvedValue({ target: identifierTextTarget(f), truncated: false });
    const observed = await f.takeScreenshot();
    expect(observed.elements).toMatchObject([{ label: '本窗口唯一可操作的原生文本区域',
      labelSource: 'unique-actionable-native-textarea', operations: ['replaceText', 'insertText'] }]);
    expect(JSON.stringify(observed)).not.toContain('private native text identity');
    expect(JSON.stringify(observed)).not.toContain('identityProfile');
    expect(JSON.stringify(observed)).not.toContain('descriptionDeclared');
    await expect(f.prepareClick(observed.observationId, { elementId: observed.elements[0].elementId,
      x: undefined, y: undefined })).rejects.toThrow('点击能力');
    const prepared = await f.runtime.prepareSetText({ observationId: observed.observationId,
      elementId: observed.elements[0].elementId, text: '合成测试😀\n第二行', mode: 'replace' }, f.prepareContext);
    expect(prepared.binding.target).toMatchObject({ candidate: { identityProfile: 'native-text-identifier-v1',
      descriptionDeclared: true, identifier: 'private native text identity' } });
    expect(JSON.stringify(prepared.publicAction)).not.toContain('identityProfile');
    const result = await f.runtime.setText(execution(prepared, f.runIdentity), f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: true, data: { dispatchState: 'dispatched', mutationCommitState: 'committed' } });
    expect(f.dependencies.setText).toHaveBeenCalledOnce();
    expect(f.dependencies.click).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private native text identity');
    await expect(f.runtime.setText(execution(prepared, f.runIdentity), f.controller.signal, f.commit)).rejects.toThrow('过期');
  });

  it.each(['partial', 'multiple', 'named-second', 'set-drift', 'profile-drift', 'declaration-drift', 'identifier-drift',
    'selection-drift', 'no-profile', 'blank-identifier', 'press'] as const)('refuses to derive native text labels for %s', async scenario => {
    const f = fixture();
    const first = identifierTextTarget(f);
    if (scenario === 'multiple' || scenario === 'named-second') first.candidates.push({ ...first.candidates[0], path: [1],
      ...(scenario === 'named-second' ? { title: '另一个文本区域' } : {}) });
    if (scenario === 'no-profile') delete first.candidates[0].identityProfile;
    if (scenario === 'blank-identifier') first.candidates[0].identifier = '   ';
    if (scenario === 'press') first.candidates[0].operations?.push('press');
    const second = structuredClone(first);
    if (scenario === 'set-drift') second.candidates.push({ ...second.candidates[0], path: [1] });
    if (scenario === 'profile-drift') delete second.candidates[0].identityProfile;
    if (scenario === 'declaration-drift') second.candidates[0].descriptionDeclared = false;
    if (scenario === 'identifier-drift') second.candidates[0].identifier = 'different private identity';
    if (scenario === 'selection-drift') second.candidates[0].textState!.selection!.location = 1;
    f.dependencies.targets.mockResolvedValueOnce({ target: first, truncated: scenario === 'partial' })
      .mockResolvedValueOnce({ target: second, truncated: scenario === 'partial' });
    const observed = await f.takeScreenshot();
    expect(observed.elements.filter(element => element.label === '本窗口唯一可操作的原生文本区域')).toEqual([]);
  });

  it.each(['identityProfile', 'descriptionDeclared', 'identifier'] as const)('rejects modified sealed native text %s before dispatch', async field => {
    const f = fixture();
    const original = identifierTextTarget(f);
    f.dependencies.targets.mockResolvedValue({ target: original, truncated: false });
    const observed = await f.takeScreenshot();
    const prepared = await f.runtime.prepareSetText({ observationId: observed.observationId,
      elementId: observed.elements[0].elementId, text: '测试', mode: 'replace' }, f.prepareContext);
    const changed = execution(prepared, f.runIdentity);
    const changedCandidate = (changed.binding.target as { candidate: AgentComputerTarget['candidates'][number] }).candidate;
    if (field === 'identityProfile') delete changedCandidate.identityProfile;
    if (field === 'descriptionDeclared') changedCandidate.descriptionDeclared = false;
    if (field === 'identifier') changedCandidate.identifier = 'different private identity';
    await expect(f.runtime.setText(changed, f.controller.signal, f.commit)).rejects.toThrow('不匹配');
    expect(f.dependencies.setText).not.toHaveBeenCalled();
  });

  it.each([{ width: 2000, height: 1200, expected: { x: 200, y: 120, width: 800, height: 600 } },
    { width: 1000, height: 600, expected: { x: 100, y: 60, width: 400, height: 300 } }])(
    'locates an independently stable text profile in the actual $width pixel capture during a partial scan', async image => {
      const f = fixture();
      const window = sharedWindow({ bounds: { x: -1200, y: 400, width: 1000, height: 600 } });
      f.setWindows([window]);
      f.attachment.width = image.width;
      f.attachment.height = image.height;
      const nativeTarget = identifierTextTarget(f);
      nativeTarget.bounds = { ...window.bounds };
      nativeTarget.candidates[0].bounds = { x: -1100, y: 460, width: 400, height: 300 };
      f.dependencies.targets.mockResolvedValue({ target: nativeTarget, truncated: true });
      const observed = await f.takeScreenshot();
      expect(observed).toMatchObject({ candidateScanComplete: false, coordinateClickReady: false, clickReady: false, textReady: true,
        screenshotWidth: image.width, screenshotHeight: image.height,
        elements: [{ label: '原生文本区域', labelSource: 'native-text-screenshot-bounds', screenshotBounds: image.expected }] });
      const prepared = await f.runtime.prepareSetText({ observationId: observed.observationId,
        elementId: observed.elements[0].elementId, text: '后台位置测试', mode: 'replace' }, f.prepareContext);
      expect(prepared.publicAction).not.toHaveProperty('screenshotBounds');
      expect(prepared.binding.target).toMatchObject({ candidate: { bounds: nativeTarget.candidates[0].bounds } });
      await f.runtime.setText(execution(prepared, f.runIdentity), f.controller.signal, f.commit);
      expect(f.dependencies.setText).toHaveBeenCalledOnce();
      expect(f.dependencies.click).not.toHaveBeenCalled();
    });

  it('keeps the full text control covered when capture geometry needs pixel rounding', async () => {
    const f = fixture();
    const window = sharedWindow({ bounds: { x: -3000, y: -500, width: 1440, height: 900 } });
    f.setWindows([window]);
    f.attachment.width = 720;
    f.attachment.height = 450;
    const nativeTarget = identifierTextTarget(f);
    nativeTarget.bounds = { ...window.bounds };
    nativeTarget.candidates[0].bounds = { x: -2899.4, y: -400.6, width: 600.8, height: 400.8 };
    f.dependencies.targets.mockResolvedValue({ target: nativeTarget, truncated: true });
    expect((await f.takeScreenshot()).elements).toMatchObject([{ screenshotBounds: { x: 50, y: 49, width: 301, height: 202 } }]);
  });

  it.each(['bounds', 'identifier', 'profile', 'declaration', 'selection'] as const)(
    'does not publish positional text identity when its own %s changes during capture', async field => {
      const f = fixture();
      const before = identifierTextTarget(f);
      const after = structuredClone(before);
      if (field === 'bounds') after.candidates[0].bounds.height -= 20;
      if (field === 'identifier') after.candidates[0].identifier = 'different private identity';
      if (field === 'profile') delete after.candidates[0].identityProfile;
      if (field === 'declaration') after.candidates[0].descriptionDeclared = false;
      if (field === 'selection') after.candidates[0].textState!.selection!.location = 1;
      f.dependencies.targets.mockResolvedValueOnce({ target: before, truncated: true })
        .mockResolvedValueOnce({ target: after, truncated: true });
      expect((await f.takeScreenshot()).elements).toEqual([]);
    });

  it('locates separate text controls without claiming either is unique', async () => {
    const f = fixture();
    const first = identifierTextTarget(f);
    first.candidates[0].bounds = { x: 0, y: 0, width: 500, height: 500 };
    first.candidates.push({ ...first.candidates[0], path: [1], title: '第二个文本区域',
      bounds: { x: 800, y: 0, width: 500, height: 500 } });
    f.dependencies.targets.mockResolvedValue({ target: first, truncated: false });
    expect((await f.takeScreenshot()).elements).toMatchObject([{ label: '原生文本区域',
      labelSource: 'native-text-screenshot-bounds', screenshotBounds: { x: 0, y: 0, width: 534, height: 534 } },
    { label: '第二个文本区域' }]);
  });

  it('refuses positional input labels for known overlapping text controls', async () => {
    const f = fixture();
    const first = identifierTextTarget(f);
    first.candidates.push({ ...first.candidates[0], path: [1] });
    f.dependencies.targets.mockResolvedValue({ target: first, truncated: true });
    expect((await f.takeScreenshot()).elements).toEqual([]);
  });

  it.each(['appears', 'disappears', 'selection-drift', 'identity-drift'] as const)(
    'refuses positional input labels when an overlapping control %s during capture', async scenario => {
      const f = fixture();
      const before = identifierTextTarget(f);
      const other = { ...structuredClone(before.candidates[0]), path: [1] };
      if (scenario !== 'appears') before.candidates.push(other);
      const after = structuredClone(before);
      if (scenario === 'appears') after.candidates.push(other);
      if (scenario === 'disappears') after.candidates.pop();
      if (scenario === 'selection-drift') after.candidates[1].textState!.selection!.location = 1;
      if (scenario === 'identity-drift') after.candidates[1].identifier = 'another private identity';
      f.dependencies.targets.mockResolvedValueOnce({ target: before, truncated: true })
        .mockResolvedValueOnce({ target: after, truncated: true });
      expect((await f.takeScreenshot()).elements).toEqual([]);
    });

  it('does not route a coordinate click through a nonpress child to an AXPress parent', async () => {
    const f = fixture();
    const first = target();
    first.candidates[0].operations = ['press'];
    first.candidates.push({ ...first.candidates[0], path: [0, 1], role: 'AXTextArea', title: '子输入区', operations: ['replaceText'] });
    f.dependencies.targets.mockResolvedValue({ target: first, truncated: false });
    const observed = await f.takeScreenshot();
    expect(observed.coordinateClickReady).toBe(true);
    await expect(f.prepareClick(observed.observationId)).rejects.toThrow('没有点击能力');
    expect(f.dependencies.click).not.toHaveBeenCalled();
  });

  it.each(['text', 'scroll'] as const)('preserves the %s receipt when cancellation crosses the AX dispatch boundary', async kind => {
    const f = semanticFixture();
    const observed = await f.takeScreenshot();
    const prepared = await f.prepare(kind, observed.observationId, observed.elements[0].elementId);
    const dispatch = deferred<void>();
    const started = deferred<void>();
    const input = kind === 'text' ? f.dependencies.setText : f.dependencies.scroll;
    input.mockImplementationOnce(async () => { started.resolve(); return dispatch.promise; });
    const pending = (kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit);
    await started.promise;
    f.controller.abort();
    dispatch.resolve();
    expect(await pending).toMatchObject({ ok: true, data: { dispatchState: 'dispatched', mutationCommitState: 'committed' } });
    expect(input).toHaveBeenCalledOnce();
    expect(f.commit.settle).toHaveBeenCalledOnce();
  });
  it.each(['text', 'scroll'] as const)('keeps explicit native pre-dispatch rejection uncommitted for %s', async kind => {
    const f = semanticFixture();
    const observed = await f.takeScreenshot();
    const prepared = await f.prepare(kind, observed.observationId, observed.elements[0].elementId);
    const input = kind === 'text' ? f.dependencies.setText : f.dependencies.scroll;
    input.mockRejectedValueOnce(new AgentComputerInputError('private rejection', 'not-dispatched'));
    const result = await (kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit);
    expect(result).toMatchObject({ ok: false, data: { dispatchState: 'not-dispatched', mutationCommitState: 'uncommitted' } });
    expect(JSON.stringify(result)).not.toContain('private rejection');
    await expect((kind === 'text' ? f.runtime.setText : f.runtime.scroll)(prepared, f.controller.signal, f.commit)).rejects.toThrow('过期');
    expect(input).toHaveBeenCalledOnce();
  });

});
