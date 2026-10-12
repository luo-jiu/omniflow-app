import crypto from 'node:crypto';
import type { AgentAttachment, AgentAttachmentImport, AgentAttachmentScope } from '../../../../src/shared/agent/agent-attachments';
import type { AgentComputerClickPreparedActionPublicV2, AgentComputerClickPreparedActionPublicV3, AgentComputerSetTextPreparedActionPublicV1,
  AgentComputerScrollPreparedActionPublicV1, AgentToolResult } from '../../../../src/shared/agent/agent.types';
import { COMPUTER_ELEMENT_OPERATIONS, validateComputerText, type ComputerElementOperation,
  type ComputerTextMode, type ComputerScrollDirection, type ComputerScrollUnit } from '../../../../src/shared/computer-use/computer-use-contract';
import { normalizeAgentPreparedActionPublic } from '../../../../src/shared/agent/agent-prepared-action';
import type { AgentComputerCandidate, AgentComputerPoint, AgentComputerRect, AgentComputerSharedWindow,
  AgentComputerObservationScope, AgentComputerTarget, AgentComputerWindowIdentity, AgentComputerWindowTargetObservation } from '../../../platform/computer-use';
import { AgentComputerInputError } from '../../../platform/computer-use';
import type { AgentMainCommitSettlement, AgentToolMainPreparationContext, AgentToolMainPreparationIdentity,
  AgentToolMainPreparationResult, AgentToolMainPreparedExecution } from '../agent-tool-registry';
import { createAgentComputerWindowDiscovery } from './agent-computer-window-discovery';
import { FIRST_PARTY_CONTROL_LABELS, normalizeFirstPartyControlSnapshot, normalizeFirstPartyRegistrationToken,
  type FirstPartyBoundControl } from '../../../../src/shared/computer-use/first-party-control-contract';
import { getObservationChanges, normalizeObservationQuery, projectObservationElements,
  type ComputerObservationDiffEntry } from './agent-computer-observation-query';
import { normalizeObservationFocus, type ComputerObservationFocus } from './agent-computer-observation-focus';

const OBSERVATION_TTL_MS = 60_000;
const MAX_RUN_SCREENSHOTS = 32;
const MAX_RUN_SCREENSHOT_BYTES = 64 * 1024 * 1024;
const MAX_RUN_OBSERVATIONS = 256;
type ObservationMode = 'ax' | 'screenshot' | 'both';

interface ImageStore {
  import(input: AgentAttachmentImport): Promise<AgentAttachment>;
  bind(scope: AgentAttachmentScope, ids: readonly string[], sessionId: string): Promise<string[]>;
  rollbackBinding(scope: AgentAttachmentScope, ids: readonly string[], sessionId: string): Promise<void>;
  discard(scope: AgentAttachmentScope, id: string): Promise<void>;
}
interface Observation {
  id: string;
  targetId: string;
  window: AgentComputerSharedWindow;
  operations: readonly ComputerElementOperation[];
  mode: ObservationMode;
  width?: number;
  height?: number;
  capturedAt: number;
  consumed: boolean;
  coordinateClickReady: boolean;
  candidates: AgentComputerCandidate[];
  elements: Array<{ elementId: string; label: string; candidate: AgentComputerCandidate }>;
  firstPartyElements: Array<{ elementId: string; control: FirstPartyBoundControl }>;
  diffEntries: ComputerObservationDiffEntry[];
  candidateScanComplete: boolean;
  scopeScanComplete: boolean;
  scopeKey: string;
  axTree?: string;
}
interface RunShare {
  active: boolean;
  identity: string;
  targetId: string;
  window: AgentComputerSharedWindow;
  operations: readonly ComputerElementOperation[];
  screenshotCount: number;
  screenshotBytes: number;
  observationCount: number;
  permissionRequested: boolean;
  observation?: Observation;
  releaseRendering?: () => void;
}
export interface AgentComputerRuntimeDependencies {
  windows(signal: AbortSignal): Promise<{ windows: AgentComputerSharedWindow[]; truncated: boolean }>;
  ownerWindowId(ownerWebContentsId: number): number;
  capture(window: AgentComputerSharedWindow, signal: AbortSignal): Promise<Buffer>;
  targets(window: AgentComputerSharedWindow, signal: AbortSignal, scope?: AgentComputerObservationScope): Promise<AgentComputerWindowTargetObservation>;
  click(point: AgentComputerPoint, signal: AbortSignal): Promise<void>;
  setText(input: { target: AgentComputerPoint['target']; operation: 'replaceText' | 'insertText'; text: string }, signal: AbortSignal): Promise<void>;
  scroll(input: { target: AgentComputerPoint['target']; operation: ComputerElementOperation }, signal: AbortSignal): Promise<void>;
  clickStatus(signal: AbortSignal): Promise<{ available: boolean }>;
  requestClickPermission(signal: AbortSignal): Promise<void>;
  images(): ImageStore;
  keepWindowRendering?(window: AgentComputerSharedWindow, ownerWebContentsId: number): () => void;
  firstPartyControls?: {
    observe(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity, signal: AbortSignal): Promise<{
      registrationId: string; documentGeneration: string; controls: FirstPartyBoundControl[];
    } | undefined>;
    verify(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity, control: FirstPartyBoundControl,
      operation: ComputerElementOperation, signal: AbortSignal): Promise<void>;
    dispatch(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity, control: FirstPartyBoundControl,
      operation: ComputerElementOperation, text: string | undefined, signal: AbortSignal): Promise<void>;
  };
  now?: () => number;
}
function identityKey(identity: AgentToolMainPreparationIdentity): string {
  return JSON.stringify([identity.runId, identity.sessionId, identity.libraryId, identity.ownerWebContentsId,
    identity.ownerScope.accountScope, identity.ownerScope.backendScope, identity.aiDestinationIdentity, identity.runCapabilityIdentity]);
}
function sameWindow(left: AgentComputerWindowIdentity, right: AgentComputerWindowIdentity): boolean {
  return left.windowId === right.windowId && left.pid === right.pid && left.processStartedAt === right.processStartedAt
    && left.layer === right.layer;
}
function windowKey(target: AgentComputerWindowIdentity | AgentComputerTarget): string {
  return JSON.stringify([target.windowId, target.pid, target.processStartedAt, target.layer,
    target.bounds.x, target.bounds.y, target.bounds.width, target.bounds.height, target.title || '']);
}
function candidateKey(candidate: AgentComputerCandidate): string {
  return JSON.stringify([candidate.path, candidate.role, candidate.title,
    candidate.description, candidate.subrole, candidate.identifier,
    candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height,
    candidateOperations(candidate), candidate.textState, candidate.orientation, candidate.enabledState, candidate.scrollState,
    candidate.identityProfile, candidate.descriptionDeclared, candidate.documentBounds, candidate.scrollButtonState]);
}
function candidateOperations(candidate: AgentComputerCandidate): readonly ComputerElementOperation[] {
  return candidate.operations ?? ['press'];
}
function scrollOperation(direction: ComputerScrollDirection, unit: ComputerScrollUnit): ComputerElementOperation {
  const suffix = { page: 'Page', step: 'Step', fraction: 'Fraction' }[unit];
  return `scroll${direction[0].toUpperCase()}${direction.slice(1)}${suffix}` as ComputerElementOperation;
}
function targetFor(observation: Observation, candidate: AgentComputerCandidate): AgentComputerPoint['target'] {
  const window = observation.window;
  return { window: { windowId: window.windowId, pid: window.pid, processStartedAt: window.processStartedAt,
    layer: window.layer, bounds: structuredClone(window.bounds), ...(window.title ? { title: window.title } : {}) },
  candidate: structuredClone(candidate) };
}
function candidateLabel(candidate: AgentComputerCandidate): string | undefined {
  if (candidate.title.trim()) return candidate.title;
  if (candidate.description?.trim()) return candidate.description;
  return undefined;
}
function overlaps(left: AgentComputerRect, right: AgentComputerRect): boolean {
  return left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height;
}
const NATIVE_SCROLL_BUTTON_LABELS = {
  scrollUpPage: '向上滚动一页', scrollDownPage: '向下滚动一页',
  scrollLeftPage: '向左滚动一页', scrollRightPage: '向右滚动一页',
} as const;
function nativeScrollButtonOperation(candidate: AgentComputerCandidate): keyof typeof NATIVE_SCROLL_BUTTON_LABELS | undefined {
  if (candidate.identityProfile !== 'native-scroll-button-v1' || candidate.role !== 'AXButton'
    || candidate.enabledState !== 'absent' || !candidate.scrollButtonState || candidate.operations?.length !== 1) return undefined;
  const expected = candidate.subrole === 'AXIncrementPage'
    ? candidate.scrollButtonState.orientation === 'vertical' ? 'scrollDownPage' : 'scrollRightPage'
    : candidate.subrole === 'AXDecrementPage'
      ? candidate.scrollButtonState.orientation === 'vertical' ? 'scrollUpPage' : 'scrollLeftPage' : undefined;
  return candidate.operations[0] === expected ? expected : undefined;
}
function nativeScrollParents(candidates: AgentComputerCandidate[], axis: 'vertical' | 'horizontal'): Set<string> {
  return new Set(candidates.flatMap(item => {
    const buttonParent = item.scrollButtonState?.orientation === axis && nativeScrollButtonOperation(item)
      ? { path: item.path.slice(0, -1), bounds: item.scrollButtonState.parentBounds } : undefined;
    const parent = buttonParent ?? (item.role === 'AXScrollBar' && item.orientation === axis
      && candidateOperations(item).some(operation => operation.startsWith('scroll')) ? item : undefined);
    if (!parent) return [];
    return [JSON.stringify([parent.path, parent.bounds.x, parent.bounds.y, parent.bounds.width, parent.bounds.height])];
  }));
}
function observedLabel(candidate: AgentComputerCandidate, candidates: AgentComputerCandidate[], knownCandidates: AgentComputerCandidate[], completeAndStable: boolean, hasScreenshot: boolean): string | undefined {
  const label = candidateLabel(candidate);
  if (label) return label;
  const pageOperation = nativeScrollButtonOperation(candidate);
  if (pageOperation) {
    if (hasScreenshot) {
      const identity = candidateKey(candidate);
      if (knownCandidates.some(other => nativeScrollButtonOperation(other) === pageOperation
        && candidateKey(other) !== identity && overlaps(candidate.bounds, other.bounds))) return undefined;
      return NATIVE_SCROLL_BUTTON_LABELS[pageOperation];
    }
    // Direction is a semantic action label, not a name identifying one of
    // several scrolling regions. AX-only requires a complete unique parent.
    if (!completeAndStable) return undefined;
    const axis = candidate.scrollButtonState!.orientation;
    if (nativeScrollParents(candidates, axis).size !== 1
      || candidates.filter(item => nativeScrollButtonOperation(item) === pageOperation).length !== 1) return undefined;
    return NATIVE_SCROLL_BUTTON_LABELS[pageOperation];
  }
  // This native profile is selected before reading Description and requires a
  // confirmed Identifier. Uniqueness supplies a public label, never the ID.
  if (candidate.role === 'AXTextArea' && candidate.title === ''
    && candidate.identityProfile === 'native-text-identifier-v1' && typeof candidate.descriptionDeclared === 'boolean'
    && candidate.identifier?.trim() && candidate.description === undefined
    && candidateOperations(candidate).every(operation => operation === 'replaceText' || operation === 'insertText')) {
    const textAreas = candidates.filter(item => item.role === 'AXTextArea'
      && candidateOperations(item).some(operation => operation === 'replaceText' || operation === 'insertText'));
    if (completeAndStable && textAreas.length === 1) return '本窗口唯一可操作的原生文本区域';
    // Its own fingerprint was confirmed on both sides of this exact capture.
    // A partial scan cannot prove uniqueness; expose image geometry instead.
    if (!hasScreenshot) return undefined;
    const identity = candidateKey(candidate);
    if (knownCandidates.some(other => other.role === 'AXTextArea'
      && candidateOperations(other).some(operation => operation === 'replaceText' || operation === 'insertText')
      && candidateKey(other) !== identity && overlaps(candidate.bounds, other.bounds))) return undefined;
    return '原生文本区域';
  }
  if (hasScreenshot && candidate.role === 'AXScrollArea'
    && candidateOperations(candidate).every(operation => /^scroll(Up|Down|Left|Right)Page$/u.test(operation))) {
    const identity = candidateKey(candidate);
    if (knownCandidates.some(other => other.role === 'AXScrollArea'
      && candidateOperations(other).some(operation => operation.startsWith('scroll'))
      && candidateKey(other) !== identity && overlaps(candidate.bounds, other.bounds))) return undefined;
    return '原生滚动区域';
  }
  // Only a complete stable window scan can prove an unnamed axis is unique.
  // The derived label identifies a real scrollbar; its private AX fingerprint remains unchanged.
  if (!completeAndStable || candidate.role !== 'AXScrollBar' || !candidate.orientation
    || !candidateOperations(candidate).some(operation => operation.startsWith('scroll'))
    || nativeScrollParents(candidates, candidate.orientation).size !== 1
    || candidates.filter(item => item.role === 'AXScrollBar' && item.orientation === candidate.orientation).length !== 1) return undefined;
  return candidate.orientation === 'vertical' ? '本窗口唯一可操作的垂直滚动条' : '本窗口唯一可操作的水平滚动条';
}
function screenshotBounds(candidate: { bounds: AgentComputerRect }, window: AgentComputerWindowIdentity,
  width: number, height: number): AgentComputerRect {
  const left = Math.max(0, Math.min(width - 1, Math.floor((candidate.bounds.x - window.bounds.x) * width / window.bounds.width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor((candidate.bounds.y - window.bounds.y) * height / window.bounds.height)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil((candidate.bounds.x + candidate.bounds.width - window.bounds.x) * width / window.bounds.width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil((candidate.bounds.y + candidate.bounds.height - window.bounds.y) * height / window.bounds.height)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function firstPartyKey(control: FirstPartyBoundControl): string { return JSON.stringify(control); }
function firstPartyControlsFor(window: AgentComputerSharedWindow,
  observation: Awaited<ReturnType<NonNullable<AgentComputerRuntimeDependencies['firstPartyControls']>['observe']>>): FirstPartyBoundControl[] {
  if (!observation) return [];
  const registration = normalizeFirstPartyRegistrationToken({ registrationId: observation.registrationId, documentGeneration: observation.documentGeneration });
  if (!Array.isArray(observation.controls) || observation.controls.length > 2) throw new Error('第一方控件观察无效');
  const controls = observation.controls.map(control => {
    if (control.registrationId !== registration.registrationId || control.documentGeneration !== registration.documentGeneration) throw new Error('第一方控件文档身份不匹配');
    const bounds = control.bounds;
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0
      || bounds.x < window.bounds.x || bounds.y < window.bounds.y
      || bounds.x + bounds.width > window.bounds.x + window.bounds.width
      || bounds.y + bounds.height > window.bounds.y + window.bounds.height) throw new Error('第一方控件不在获准窗口中');
    return { ...registration, bounds: { ...bounds }, snapshot: normalizeFirstPartyControlSnapshot(control.snapshot) };
  });
  if (new Set(controls.map(control => control.snapshot.controlId)).size !== controls.length) throw new Error('第一方控件重复');
  return controls;
}
function contains(rect: AgentComputerRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}
function pointFor(observation: Observation, action: AgentComputerClickPreparedActionPublicV2 | AgentComputerClickPreparedActionPublicV3): AgentComputerPoint {
  if (action.button !== 'left' || action.clickCount !== 1) throw new Error('后台点击仅支持控件的左键单击');
  const window = observation.window;
  const semantic = action.elementId ? observation.elements.find(item => item.elementId === action.elementId)?.candidate : undefined;
  if (action.elementId && !semantic) throw new Error('控件标识不属于当前窗口观察，请重新查看窗口');
  if (!observation.operations.includes('press') || (semantic && !candidateOperations(semantic).includes('press'))) throw new Error('此控件没有获准的点击能力，请重新查看窗口');
  if (!semantic && (action.version === 3 || !observation.coordinateClickReady || !observation.width || !observation.height)) throw new Error('控件扫描不完整或无截图，无法后台点击坐标；请使用本次观察确认的 elementId');
  const x = semantic ? semantic.bounds.x + semantic.bounds.width / 2
    : window.bounds.x + ((action as AgentComputerClickPreparedActionPublicV2).x + 0.5) * window.bounds.width / observation.width!;
  const y = semantic ? semantic.bounds.y + semantic.bounds.height / 2
    : window.bounds.y + ((action as AgentComputerClickPreparedActionPublicV2).y + 0.5) * window.bounds.height / observation.height!;
  const matches = semantic ? [semantic] : observation.candidates.filter(candidate => contains(candidate.bounds, x, y));
  const leaves = matches.filter(candidate => !matches.some(other => other.path.length > candidate.path.length
    && candidate.path.every((step, index) => other.path[index] === step)));
  if (leaves.length !== 1) throw new Error('此位置的控件不可用或不唯一，无法后台点击，请重新查看窗口');
  if (!candidateOperations(leaves[0]).includes('press')) throw new Error('此位置的控件没有点击能力，请使用准确的控件标识');
  return { x, y, button: 'left', clickCount: 1, target: targetFor(observation, leaves[0]) };
}

/** One input queue. Each Run grant binds one window, never an entire display. */
export function createAgentComputerRuntime(dependencies: AgentComputerRuntimeDependencies) {
  const shares = new Map<string, RunShare>();
  const pendingTargets = new Map<string, { identity: string; window: string; targetId: string }>();
  const now = dependencies.now || Date.now;
  const discovery = createAgentComputerWindowDiscovery({ windows: dependencies.windows, now });
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const pending = queue.then(() => { signal.throwIfAborted(); return operation(); });
    queue = pending.catch(() => undefined);
    return pending;
  }
  function shareFor(identity: AgentToolMainPreparationIdentity): RunShare | undefined {
    const share = shares.get(identity.runId);
    return share?.active && share.identity === identityKey(identity) ? share : undefined;
  }
  function releaseShareRendering(share: RunShare): void {
    const release = share.releaseRendering;
    share.releaseRendering = undefined;
    try { release?.(); }
    catch { /* Rendering restoration must not replace the authoritative Run result. */ }
  }
  function deactivateShare(share: RunShare): void {
    share.active = false;
    releaseShareRendering(share);
  }
  function keepShareRendering(share: RunShare, window: AgentComputerSharedWindow, ownerWebContentsId: number, signal: AbortSignal): void {
    if (share.releaseRendering || !dependencies.keepWindowRendering) return;
    const release = dependencies.keepWindowRendering(window, ownerWebContentsId);
    let released = false;
    const cancel = () => deactivateShare(share);
    share.releaseRendering = () => {
      if (released) return;
      released = true;
      signal.removeEventListener('abort', cancel);
      release();
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    signal.throwIfAborted();
  }
  async function selectWindow(input: { application?: string; windowTitle?: string; windowRef?: string }, context: AgentToolMainPreparationContext): Promise<AgentComputerSharedWindow> {
    if (input.windowRef) {
      if (input.application || input.windowTitle) throw new Error('窗口引用不能与应用或窗口名称同时使用');
      return discovery.resolve(input.windowRef, { identity: context.preparationIdentity, signal: context.signal });
    }
    const snapshot = await dependencies.windows(context.signal);
    context.signal.throwIfAborted();
    const share = shareFor(context.preparationIdentity);
    const currentId = share?.window.windowId ?? dependencies.ownerWindowId(context.preparationIdentity.ownerWebContentsId);
    let matches: AgentComputerSharedWindow[];
    if (!input.application && !input.windowTitle) matches = snapshot.windows.filter(window => window.windowId === currentId);
    else {
      if (snapshot.truncated) throw new Error('窗口列表不完整，无法唯一选择应用窗口');
      const application = input.application || snapshot.windows.find(window => window.windowId === currentId)?.applicationLabel;
      matches = snapshot.windows.filter(window => window.applicationLabel === application
        && (!input.windowTitle || window.windowLabel === input.windowTitle));
    }
    if (matches.length !== 1) throw new Error(matches.length ? '该应用有多个窗口，请明确窗口名称后再共享' : '目标应用窗口当前不可用');
    const window = matches[0];
    if (!window.processStartedAt || window.layer !== 0) throw new Error('此窗口不支持共享和后台控件操作');
    return structuredClone(window);
  }
  async function boundWindow(preparation: AgentToolMainPreparedExecution, signal: AbortSignal): Promise<AgentComputerSharedWindow> {
    const window = preparation.binding.window as AgentComputerSharedWindow;
    if (!window) throw new Error('应用窗口共享准备动作无效');
    const snapshot = await dependencies.windows(signal);
    signal.throwIfAborted();
    const actual = snapshot.windows.find(item => item.windowId === window.windowId);
    if (!actual || windowKey(actual) !== windowKey(window)) throw new Error('应用窗口已关闭、移动或变化，请重新查看窗口');
    return window;
  }
  function observationFor(identity: AgentToolMainPreparationIdentity, id: string): Observation {
    const observation = shareFor(identity)?.observation;
    if (!observation || observation.id !== id) throw new Error('窗口截图已过期或不属于当前共享窗口；此次操作未发送。请调用 computer.observe({}) 并使用新观察的控件标识');
    if (observation.consumed) throw new Error('窗口截图已过期或已用于一次操作；先调用 computer.observe({}) 确认上次结果，勿直接重复操作');
    if (now() - observation.capturedAt > OBSERVATION_TTL_MS) throw new Error('窗口截图已过期；此次操作未发送。请调用 computer.observe({}) 重新定位控件，不复用旧坐标或控件标识');
    return observation;
  }
  function focusFor(identity: AgentToolMainPreparationIdentity, focus: ComputerObservationFocus): {
    observation: Observation; scope: AgentComputerObservationScope;
  } {
    const observation = observationFor(identity, focus.observationId);
    const candidate = observation.elements.find(element => element.elementId === focus.elementId)?.candidate;
    if (!candidate) throw new Error('局部 AX 观察只能使用当前观察签发的原生控件 ID，不支持第一方控件');
    if (focus.ancestorLevels > candidate.path.length) throw new Error('局部 AX 观察不能越过已共享窗口');
    return { observation, scope: { anchor: structuredClone(candidate), ancestorLevels: focus.ancestorLevels } };
  }
  async function prepareWindows(input: { query?: string; application?: string }, context: AgentToolMainPreparationContext): Promise<AgentToolMainPreparationResult> {
    const publicAction = normalizeAgentPreparedActionPublic({ kind: 'computer.windows', version: 1,
      libraryId: context.preparationIdentity.libraryId, ...input });
    const result = await discovery.list(input, { identity: context.preparationIdentity, signal: context.signal });
    return { publicAction, binding: { discoveryResult: result }, decision: { behavior: 'allow', risk: 'read' } };
  }
  async function windows(preparation: AgentToolMainPreparedExecution, signal: AbortSignal): Promise<AgentToolResult> {
    signal.throwIfAborted();
    if (preparation.publicAction.kind !== 'computer.windows') throw new Error('窗口查找缺少受控准备动作');
    return { ok: true, message: '已查找可共享的应用窗口', data: structuredClone(preparation.binding.discoveryResult) };
  }
  async function prepareObserve(input: { application?: string; windowTitle?: string; windowRef?: string; mode?: ObservationMode;
    query?: string; role?: string; operation?: ComputerElementOperation; offset?: number; limit?: number; includeChanges?: boolean;
    focus?: { observationId: string; elementId: string; ancestorLevels?: number } }, context: AgentToolMainPreparationContext): Promise<AgentToolMainPreparationResult> {
    context.signal.throwIfAborted();
    const mode = input.mode ?? 'both';
    if (!['ax', 'screenshot', 'both'].includes(mode)) throw new Error('应用窗口观察模式无效');
    if (input.includeChanges !== undefined && typeof input.includeChanges !== 'boolean') throw new Error('窗口观察差异参数无效');
    if (mode === 'screenshot' && input.includeChanges) throw new Error('纯截图不比较控件变化，请使用 ax 或 both 模式');
    const focus = input.focus === undefined ? undefined : normalizeObservationFocus(input.focus);
    if (focus && (mode === 'screenshot' || input.application !== undefined || input.windowTitle !== undefined || input.windowRef !== undefined)) {
      throw new Error('局部 AX 观察不能与纯截图或切换窗口参数同时使用');
    }
    const focused = focus ? focusFor(context.preparationIdentity, focus) : undefined;
    const queryInput = Object.fromEntries(['query', 'role', 'operation', 'offset', 'limit']
      .filter(key => Object.prototype.hasOwnProperty.call(input, key)).map(key => [key, input[key as keyof typeof input]]));
    if (!Object.keys(queryInput).length) queryInput.limit = 128;
    const query = normalizeObservationQuery(queryInput);
    if (mode === 'screenshot' && Object.keys(queryInput).some(key => key !== 'limit')) throw new Error('纯截图不查询控件，请使用 ax 或 both 模式');
    const window = focused ? structuredClone(focused.observation.window) : await selectWindow(input, context);
    const share = shareFor(context.preparationIdentity);
    const operations = [...COMPUTER_ELEMENT_OPERATIONS];
    const granted = share && sameWindow(share.window, window)
      && operations.every(operation => share.operations.includes(operation));
    const identity = context.preparationIdentity;
    const pendingIdentity = JSON.stringify([identityKey(identity), identity.callId, identity.toolRunId,
      identity.toolName, identity.toolRegistrationId, identity.toolInputHash]);
    const pendingWindow = JSON.stringify([windowKey(window), window.applicationLabel, window.windowLabel]);
    const pending = pendingTargets.get(identity.runId);
    const targetId = granted ? share.targetId
      : pending?.identity === pendingIdentity && pending.window === pendingWindow ? pending.targetId : crypto.randomUUID();
    if (!granted) pendingTargets.set(identity.runId, { identity: pendingIdentity, window: pendingWindow, targetId });
    const publicAction = normalizeAgentPreparedActionPublic({ kind: 'computer.observe', version: 2,
      libraryId: context.preparationIdentity.libraryId, targetId, applicationLabel: window.applicationLabel, windowLabel: window.windowLabel, operations,
      ...(input.mode !== undefined ? { mode } : {}) });
    return { publicAction, binding: { window, targetId, operations, mode, query, includeChanges: input.includeChanges === true,
      ...(focused ? { focus, scope: focused.scope } : {}) },
      decision: granted ? { behavior: 'allow', risk: 'read' } : {
        behavior: 'ask', risk: 'read', preview: { title: '共享应用窗口并允许操作', risk: 'read',
          description: `允许本次任务查看「${window.applicationLabel} / ${window.windowLabel}」并点击控件、输入文字和滚动。仅此窗口的图像和界面控件信息会发送给当前 AI 服务并保存到本机会话；不采集整个显示器。切换共享窗口需重新允许，停止或任务结束后停止共享。操作不会移动系统鼠标。`,
          details: [{ label: '应用', value: window.applicationLabel }, { label: '窗口', value: window.windowLabel }],
        },
      } };
  }
  type SemanticTarget = AgentComputerPoint['target'] | { firstPartyControl: FirstPartyBoundControl };
  function semanticTarget(observation: Observation, elementId: string, operation: ComputerElementOperation): SemanticTarget {
    const firstParty = observation.firstPartyElements.find(element => element.elementId === elementId)?.control;
    if (firstParty) {
      if (!firstParty.snapshot.operations.includes(operation) || !observation.operations.includes(operation)) throw new Error('此第一方控件没有本次获准的操作能力');
      return { firstPartyControl: structuredClone(firstParty) };
    }
    const candidate = observation.elements.find(element => element.elementId === elementId)?.candidate;
    if (!candidate || !candidateOperations(candidate).includes(operation) || !observation.operations.includes(operation)) {
      throw new Error('此控件没有本次观察确认且获准的操作能力，请重新查看窗口');
    }
    return targetFor(observation, candidate);
  }
  function semanticActionIdentity(observation: Observation, libraryId: number, elementId: string) {
    return { libraryId, targetId: observation.targetId, applicationLabel: observation.window.applicationLabel,
      windowLabel: observation.window.windowLabel, observationId: observation.id, elementId };
  }
  async function prepareSetText(input: { observationId: string; elementId: string; text: string; mode: ComputerTextMode }, context: AgentToolMainPreparationContext): Promise<AgentToolMainPreparationResult> {
    context.signal.throwIfAborted();
    const validated = validateComputerText(input.text, input.mode);
    const observation = observationFor(context.preparationIdentity, input.observationId);
    const publicAction = normalizeAgentPreparedActionPublic({ kind: 'computer.setText', version: 1,
      ...semanticActionIdentity(observation, context.preparationIdentity.libraryId, input.elementId),
      mode: input.mode, textLength: validated.textLength, textBytes: validated.textBytes });
    const operation = input.mode === 'replace' ? 'replaceText' : 'insertText';
    const target = semanticTarget(observation, input.elementId, operation);
    if ('firstPartyControl' in target) {
      if (!dependencies.firstPartyControls) throw new Error('第一方控件桥不可用');
      await dependencies.firstPartyControls.verify(observation.window, context.preparationIdentity, target.firstPartyControl, operation, context.signal);
      observationFor(context.preparationIdentity, input.observationId);
    }
    return { publicAction, binding: { window: observation.window, targetId: observation.targetId, target,
      operation, text: validated.text }, decision: { behavior: 'allow', risk: 'write' } };
  }
  async function prepareScroll(input: { observationId: string; elementId: string; direction: ComputerScrollDirection; unit: ComputerScrollUnit }, context: AgentToolMainPreparationContext): Promise<AgentToolMainPreparationResult> {
    context.signal.throwIfAborted();
    const observation = observationFor(context.preparationIdentity, input.observationId);
    const publicAction = normalizeAgentPreparedActionPublic({ kind: 'computer.scroll', version: 1,
      ...semanticActionIdentity(observation, context.preparationIdentity.libraryId, input.elementId), direction: input.direction, unit: input.unit });
    if (publicAction.kind !== 'computer.scroll') throw new Error('滚动准备动作无效');
    const operation = scrollOperation(publicAction.direction, publicAction.unit);
    const target = semanticTarget(observation, input.elementId, operation);
    if ('firstPartyControl' in target) {
      if (!dependencies.firstPartyControls) throw new Error('第一方控件桥不可用');
      await dependencies.firstPartyControls.verify(observation.window, context.preparationIdentity, target.firstPartyControl, operation, context.signal);
      observationFor(context.preparationIdentity, input.observationId);
    }
    return { publicAction, binding: { window: observation.window, targetId: observation.targetId, target, operation },
      decision: { behavior: 'allow', risk: 'write' } };
  }
  async function prepareClick(input: { observationId: string; elementId?: string; x?: number; y?: number; button?: 'left' | 'right'; clickCount?: 1 | 2 }, context: AgentToolMainPreparationContext): Promise<AgentToolMainPreparationResult> {
    context.signal.throwIfAborted();
    const observation = observationFor(context.preparationIdentity, input.observationId);
    const candidate = input.elementId ? observation.elements.find(item => item.elementId === input.elementId)?.candidate : undefined;
    if (input.elementId && (!candidate || input.x !== undefined || input.y !== undefined)) throw new Error('控件标识不属于当前窗口观察或混用了坐标');
    if (observation.mode === 'ax') {
      if (!input.elementId || !candidate) throw new Error('AX 观察只支持明确的 elementId 点击；坐标点击需要截图');
      const publicAction = normalizeAgentPreparedActionPublic({ kind: 'computer.click', version: 3,
        ...semanticActionIdentity(observation, context.preparationIdentity.libraryId, input.elementId),
        button: input.button || 'left', clickCount: input.clickCount || 1 });
      if (publicAction.kind !== 'computer.click' || publicAction.version !== 3) throw new Error('语义点击准备动作无效');
      const point = pointFor(observation, publicAction);
      return { publicAction, binding: { window: observation.window, targetId: observation.targetId, target: point.target },
        decision: { behavior: 'allow', risk: 'write' } };
    }
    if (!observation.width || !observation.height) throw new Error('此观察没有截图，无法按坐标点击');
    const x = candidate ? Math.min(observation.width - 1, Math.max(0, Math.floor((candidate.bounds.x + candidate.bounds.width / 2
      - observation.window.bounds.x) * observation.width / observation.window.bounds.width))) : input.x;
    const y = candidate ? Math.min(observation.height - 1, Math.max(0, Math.floor((candidate.bounds.y + candidate.bounds.height / 2
      - observation.window.bounds.y) * observation.height / observation.window.bounds.height))) : input.y;
    const publicAction = normalizeAgentPreparedActionPublic({ kind: 'computer.click', version: 2,
      libraryId: context.preparationIdentity.libraryId, targetId: observation.targetId,
      applicationLabel: observation.window.applicationLabel, windowLabel: observation.window.windowLabel,
      observationId: observation.id, screenshotWidth: observation.width, screenshotHeight: observation.height,
      x, y, ...(input.elementId ? { elementId: input.elementId } : {}), button: input.button || 'left', clickCount: input.clickCount || 1 });
    if (publicAction.kind !== 'computer.click' || publicAction.version !== 2) throw new Error('窗口点击准备动作无效');
    const point = pointFor(observation, publicAction);
    return { publicAction, binding: { window: observation.window, targetId: observation.targetId, target: point.target },
      decision: { behavior: 'allow', risk: 'write' } };
  }
  async function observe(preparation: AgentToolMainPreparedExecution, signal: AbortSignal): Promise<AgentToolResult> {
    let observedShare: RunShare | undefined;
    return serial(signal, async () => {
      const action = preparation.publicAction;
      if (action.kind !== 'computer.observe' || action.version !== 2 || action.targetId !== preparation.binding.targetId) {
        throw new Error('只支持当前已批准的应用窗口共享动作，请重新查看窗口');
      }
      const window = preparation.binding.window as AgentComputerSharedWindow;
      if (!window || action.applicationLabel !== window.applicationLabel || action.windowLabel !== window.windowLabel) throw new Error('应用窗口身份不匹配');
      const operations = action.operations ?? ['press'] as const;
      const mode = action.mode ?? 'both';
      if (mode !== (preparation.binding.mode ?? 'both')) throw new Error('窗口观察模式与准备动作不匹配');
      const hasScreenshot = mode !== 'ax';
      const readsControls = mode !== 'screenshot';
      const boundOperations = preparation.binding.operations ?? ['press'];
      if (JSON.stringify(operations) !== JSON.stringify(boundOperations)) throw new Error('窗口共享操作许可不匹配');
      const identity = preparation.identity;
      let share = shareFor(identity);
      const focus = preparation.binding.focus === undefined ? undefined : normalizeObservationFocus(preparation.binding.focus);
      const focused = focus ? focusFor(identity, focus) : undefined;
      const scope = focused?.scope;
      if (scope && (!share || share.targetId !== action.targetId || mode === 'screenshot'
        || windowKey(focused!.observation.window) !== windowKey(window)
        || JSON.stringify(preparation.binding.scope) !== JSON.stringify(scope))) throw new Error('局部 AX 观察目标已变化，请重新观察窗口');
      if (!scope && preparation.binding.scope !== undefined) throw new Error('局部 AX 观察缺少有效锚点');
      const scopePath = scope ? scope.anchor.path.slice(0, scope.anchor.path.length - scope.ancestorLevels) : undefined;
      const scopeKey = JSON.stringify(scopePath ?? null);
      const matchesScope = (receipt: AgentComputerWindowTargetObservation): boolean => scopePath
        ? JSON.stringify(receipt.scope?.path) === JSON.stringify(scopePath)
          && receipt.target.candidates.every(candidate => candidate.path.length >= scopePath.length
            && scopePath.every((index, depth) => candidate.path[depth] === index))
        : receipt.scope === undefined;
      if (!share || !sameWindow(share.window, window) || share.targetId !== action.targetId
        || JSON.stringify(share.operations) !== JSON.stringify(operations)) {
        const previous = shares.get(identity.runId);
        if (previous) deactivateShare(previous);
        share = { active: true, identity: identityKey(identity), targetId: action.targetId, window, operations: [...operations],
          screenshotCount: share?.screenshotCount || 0, screenshotBytes: share?.screenshotBytes || 0,
          observationCount: share?.observationCount || 0, permissionRequested: share?.permissionRequested || false };
        shares.set(identity.runId, share);
      }
      observedShare = share;
      if (share.observationCount >= MAX_RUN_OBSERVATIONS) throw new Error('本次任务观察已达 256 次，请结束任务后再继续');
      if (hasScreenshot && share.screenshotCount >= MAX_RUN_SCREENSHOTS) throw new Error('本次任务截图已达 32 张，请结束任务后再继续');
      const previous = share.observation;
      share.observation = undefined;
      await boundWindow(preparation, signal);
      if (!share.active) throw new Error('窗口共享已结束');
      keepShareRendering(share, window, identity.ownerWebContentsId, signal);
      let accessibilityAvailable = false;
      try {
        accessibilityAvailable = readsControls && (await dependencies.clickStatus(signal)).available;
        if (readsControls && !accessibilityAvailable && !share.permissionRequested) {
          share.permissionRequested = true;
          await dependencies.requestClickPermission(signal);
          accessibilityAvailable = (await dependencies.clickStatus(signal)).available;
        }
      } catch { signal.throwIfAborted(); }
      if (scope && !accessibilityAvailable) throw new Error('局部 AX 观察当前不可用，请重新观察窗口');
      const capturedAt = now();
      let firstPartyBefore: FirstPartyBoundControl[] = [];
      if (readsControls && !scope && dependencies.firstPartyControls) {
        try { firstPartyBefore = firstPartyControlsFor(window, await dependencies.firstPartyControls.observe(window, identity, signal)); }
        catch { signal.throwIfAborted(); }
      }
      let before: Awaited<ReturnType<AgentComputerRuntimeDependencies['targets']>> | undefined;
      if (accessibilityAvailable) {
        try {
          before = structuredClone(await dependencies.targets(window, signal, scope));
          if (scope && (!matchesScope(before) || windowKey(before.target) !== windowKey(window))) throw new Error('局部 AX 观察范围与获准窗口不匹配');
        }
        catch (error) { signal.throwIfAborted(); if (scope) throw error; }
      }
      if (!share.active) throw new Error('窗口共享已结束');
      const bytes = hasScreenshot ? await dependencies.capture(window, signal) : undefined;
      signal.throwIfAborted();
      if (!share.active) throw new Error('窗口共享已结束');
      let candidates: AgentComputerCandidate[] = [];
      let knownCandidates: AgentComputerCandidate[] = [];
      let firstPartyCandidates: FirstPartyBoundControl[] = [];
      let candidateScanComplete = false;
      let scopeScanComplete = false;
      let candidateSetsStable = false;
      let summary: Pick<AgentComputerWindowTargetObservation, 'axTree' | 'axTreeTruncated'> = {};
      let targetNotice = '未能确认窗口中的后台控件；此截图仅供查看，请重新查看窗口后再操作。';
      if (accessibilityAvailable) {
        try {
          const after = structuredClone(await dependencies.targets(window, signal, scope));
          if (scope && (!matchesScope(after) || windowKey(after.target) !== windowKey(window))) throw new Error('局部 AX 观察范围在采集期间变化');
          if (windowKey(after.target) === windowKey(window) && matchesScope(after)) {
            if (after.axTree !== undefined && after.axTreeTruncated !== undefined) {
              summary = { axTree: after.axTree, axTreeTruncated: after.axTreeTruncated };
            }
            if (before && windowKey(before.target) === windowKey(window) && matchesScope(before)) {
              // Semantic IDs bind a fully validated control path, not a hit-test
              // inferred from the absence of other controls in a partial scan.
              scopeScanComplete = !before.truncated && !after.truncated;
              candidateScanComplete = !scope && scopeScanComplete;
              const remaining = new Set(after.target.candidates.map(candidateKey));
              candidates = before.target.candidates.filter(candidate => remaining.has(candidateKey(candidate)));
              knownCandidates = [...before.target.candidates, ...after.target.candidates];
              candidateSetsStable = candidates.length === before.target.candidates.length
                && candidates.length === after.target.candidates.length;
              targetNotice = !candidateScanComplete
                ? '控件扫描不完整；仅可使用本次确认的 elementId，不能按坐标推断目标或认为未列出的控件不存在。'
                : !candidateSetsStable
                  ? '部分控件在截图期间变化；仅可使用本次确认的 elementId，不能按坐标推断目标。'
                  : '此窗口没有可后台点击的 AX 控件；不支持画布或未提供可访问性动作的位置。';
            }
          }
        } catch (error) { signal.throwIfAborted(); if (scope) throw error; }
      }
      if (readsControls && !scope && dependencies.firstPartyControls && firstPartyBefore.length) {
        try {
          const after = firstPartyControlsFor(window, await dependencies.firstPartyControls.observe(window, identity, signal));
          const remaining = new Set(after.map(firstPartyKey));
          firstPartyCandidates = firstPartyBefore.filter(control => remaining.has(firstPartyKey(control)));
        } catch { signal.throwIfAborted(); }
      }
      await boundWindow(preparation, signal);
      if (!share.active) throw new Error('窗口共享已结束');
      const coordinateClickReady = hasScreenshot && accessibilityAvailable && operations.includes('press')
        && candidates.some(candidate => candidateOperations(candidate).includes('press')) && candidateScanComplete && candidateSetsStable;
      // A role-only label cannot identify a requested control. Keep all native
      // candidates for complete coordinate hit-testing, but never issue a
      // semantic ID for an anonymous control without a proven unique profile,
      // or expose its private identifier.
      const semanticCandidates = candidates.flatMap(candidate => {
        const label = observedLabel(candidate, candidates, knownCandidates, candidateScanComplete && candidateSetsStable, hasScreenshot);
        return label && candidateOperations(candidate).some(operation => operations.includes(operation)) ? [{ candidate, label }] : [];
      });
      const clickReady = coordinateClickReady || semanticCandidates.some(({ candidate }) => operations.includes('press') && candidateOperations(candidate).includes('press'));
      const usableFirstParty = firstPartyCandidates.filter(control => control.snapshot.operations.some(operation => operations.includes(operation)));
      const textReady = semanticCandidates.some(({ candidate }) => candidateOperations(candidate).some(operation => operations.includes(operation) && (operation === 'replaceText' || operation === 'insertText')))
        || usableFirstParty.some(control => control.snapshot.operations.some(operation => operations.includes(operation) && (operation === 'replaceText' || operation === 'insertText')));
      const scrollReady = semanticCandidates.some(({ candidate }) => candidateOperations(candidate).some(operation => operations.includes(operation) && operation.startsWith('scroll')))
        || usableFirstParty.some(control => control.snapshot.operations.some(operation => operations.includes(operation) && operation.startsWith('scroll')));
      if (!clickReady && !textReady && !scrollReady && candidates.length > 0) targetNotice = '本次观察没有可辨认标签的可操作控件，且坐标点击不可用；请勿按 AX 树或列表位置猜测控件。';
      const publish = (attachment?: AgentAttachment): AgentToolResult => {
        const observation: Observation = { id: crypto.randomUUID(), targetId: action.targetId, window, operations: [...operations], mode,
          ...(attachment ? { width: attachment.width!, height: attachment.height! } : {}), capturedAt, consumed: false,
          coordinateClickReady, candidates: structuredClone(candidates),
          elements: semanticCandidates.map(({ candidate, label }) => ({ elementId: crypto.randomUUID(), label, candidate: structuredClone(candidate) })),
          firstPartyElements: usableFirstParty.map(control => ({ elementId: crypto.randomUUID(), control: structuredClone(control) })),
          diffEntries: [], candidateScanComplete, scopeScanComplete, scopeKey, ...summary };
        const elements = [...observation.elements.map(({ elementId, candidate, label }) => {
          const scrollButton = nativeScrollButtonOperation(candidate);
          return { elementId, role: candidate.role,
            label, ...(!candidateLabel(candidate) ? { labelSource: scrollButton ? 'native-scroll-button' : candidate.role === 'AXTextArea'
              ? label === '原生文本区域' ? 'native-text-screenshot-bounds' : 'unique-actionable-native-textarea'
              : candidate.role === 'AXScrollArea' ? 'native-scroll-screenshot-bounds' : 'unique-actionable-scrollbar' } : {}),
            ...((scrollButton || label === '原生文本区域' || label === '原生滚动区域') && attachment
              ? { screenshotBounds: screenshotBounds(candidate, window, attachment.width!, attachment.height!) } : {}),
            operations: candidateOperations(candidate).filter(operation => operations.includes(operation)),
            ...(candidate.description ? { description: candidate.description } : {}),
            ...(candidate.subrole ? { subrole: candidate.subrole } : {}) };
        }),
        ...observation.firstPartyElements.map(({ elementId, control }) => ({ elementId, role: control.snapshot.state.kind === 'text' ? 'textbox' : 'scroll-region',
          label: FIRST_PARTY_CONTROL_LABELS[control.snapshot.controlId], source: 'omniflow-control',
          ...(attachment ? { screenshotBounds: screenshotBounds(control, window, attachment.width!, attachment.height!) } : {}),
          operations: control.snapshot.operations.filter(operation => operations.includes(operation)) }))];
        const keys = [...observation.elements.map(({ candidate }) => JSON.stringify(['ax', candidate.path,
          candidate.role, candidate.identifier ?? null, candidate.identityProfile ?? null])),
        ...observation.firstPartyElements.map(({ control }) => JSON.stringify(['omniflow-control', control.registrationId,
          control.documentGeneration, control.snapshot.controlId]))];
        observation.diffEntries = elements.map((value, index) => ({ key: keys[index], value }));
        const baselineAvailable = !!previous && previous.mode === mode && previous.scopeKey === scopeKey
          && windowKey(previous.window) === windowKey(window);
        const changes = preparation.binding.includeChanges === true && baselineAvailable
          ? getObservationChanges(previous!.diffEntries, observation.diffEntries) : undefined;
        const changeData = preparation.binding.includeChanges === true ? {
          changeSummary: { baselineAvailable, searchScope: 'observed-controls', candidateScanComplete, scopeScanComplete,
            ...(baselineAvailable ? { previousObservationId: previous!.id,
              previousCandidateScanComplete: previous!.candidateScanComplete,
              previousScopeScanComplete: previous!.scopeScanComplete,
              ...(previous!.axTree !== undefined && summary.axTree !== undefined
                ? { axSummaryChanged: previous!.axTree !== summary.axTree } : {}) } : {}),
            ...(changes ? { added: changes.totalAdded, noLongerObserved: changes.totalRemoved, changed: changes.totalChanged,
              hasMore: changes.hasMore } : {}),
            notice: '差异仅描述两次有界观察；未再观察到不等于控件已删除，差异记录不能用于操作。新操作只使用本次 elements。',
          },
          ...(changes ? { changes: { added: changes.added, noLongerObserved: changes.removed, changed: changes.changed } } : {}),
        } : {};
        const query = normalizeObservationQuery(preparation.binding.query ?? { limit: 128 });
        // Fixed first-party controls remain discoverable when native AX fills
        // the page budget; their order never substitutes for identity.
        const pageElements = elements.length > 128 ? [...elements.filter(element => 'source' in element),
          ...elements.filter(element => !('source' in element))] : elements;
        const page = projectObservationElements(pageElements, query);
        share.observation = observation;
        share.window = window;
        share.observationCount += 1;
        if (attachment) {
          share.screenshotCount += 1;
          share.screenshotBytes += attachment.sizeBytes;
        }
        return { ok: true, message: mode === 'ax' ? '已读取窗口 AX' : '已查看窗口', data: { captureScope: 'window', targetId: action.targetId,
          applicationLabel: window.applicationLabel, windowLabel: window.windowLabel, mode,
          ...(attachment ? { imageId: attachment.id, screenshotWidth: attachment.width, screenshotHeight: attachment.height } : {}),
          observationId: observation.id, capturedAt: new Date(capturedAt).toISOString(),
          expiresInMs: Math.max(0, OBSERVATION_TTL_MS - (now() - capturedAt)),
          clickReady, textReady, scrollReady, operations: [...operations], coordinateClickReady, candidateScanComplete, scopeScanComplete,
          scope: scope ? { kind: 'element-ancestor', ancestorLevels: scope.ancestorLevels } : { kind: 'window' },
          clickMethod: 'AXPress', observationSource: mode === 'ax' ? 'ax' : 'screenshot', ...page,
          elementsScope: observation.firstPartyElements.length ? 'stable-window-controls' : 'stable-AX-controls', ...summary, ...changeData,
          ...(!coordinateClickReady ? { notice: scope
            ? `本次只读取原生控件${scope.ancestorLevels ? `向上 ${scope.ancestorLevels} 级的父区域` : '自身区域'}的 AX；${scopeScanComplete ? '区域内控件扫描完整' : '区域内控件扫描不完整'}，不代表全窗口完整或唯一。${hasScreenshot ? '截图仍是获准整窗口。' : ''}只使用本次明确标签的 elementId 和 operations；不提供坐标点击。`
            : mode === 'screenshot'
            ? '本次仅取得窗口图片，没有读取控件或签发动作 ID。需要操作时重新以 ax 或 both 模式观察。'
            : usableFirstParty.length
              ? hasScreenshot
                ? '第一方控件仅支持各自 operations 中列出的文字或滚动操作；请核对固定标签与截图。AX 扫描与坐标点击能力独立。'
                : '第一方控件按固定标签辨认，只支持各自 operations。其他没有明确名称的区域须用 both 模式结合截图确认。'
              : accessibilityAvailable
                ? mode === 'ax'
                  ? `${!candidateScanComplete ? '控件扫描不完整，未列出不代表不存在。' : ''}仅使用本次 elements 中准确标签的 elementId 和声明操作；AX 观察不提供坐标点击。匿名或对应不明的区域请用 both 模式核对截图。`
                  : targetNotice
                : '读取 AX 与原生操作需要辅助功能权限；请按系统提示允许后重新查看窗口。' } : {}) } };
      };
      if (!bytes) return publish();
      const images = dependencies.images();
      const attachmentScope = { ownerScope: identity.ownerScope, libraryId: identity.libraryId };
      const attachment = await images.import({ ...attachmentScope, name: '窗口截图.png', base64: bytes.toString('base64') });
      let bound = false;
      try {
        if (attachment.kind !== 'image' || !attachment.width || !attachment.height
          || Math.max(attachment.width, attachment.height) > 2048) throw new Error('窗口截图格式无效');
        if (share.screenshotBytes + attachment.sizeBytes > MAX_RUN_SCREENSHOT_BYTES) throw new Error('本次任务截图已达 64 MiB，请结束任务后再继续');
        await images.bind(attachmentScope, [attachment.id], identity.sessionId);
        bound = true;
        signal.throwIfAborted();
        if (!share.active) throw new Error('窗口共享已结束');
        return publish(attachment);
      } catch (error) {
        if (bound) await images.rollbackBinding(attachmentScope, [attachment.id], identity.sessionId);
        await images.discard(attachmentScope, attachment.id);
        throw error;
      }
    }).catch(error => {
      if (observedShare) releaseShareRendering(observedShare);
      throw error;
    });
  }
  async function click(preparation: AgentToolMainPreparedExecution, signal: AbortSignal, commit?: AgentMainCommitSettlement): Promise<AgentToolResult> {
    return serial(signal, async () => {
      const action = preparation.publicAction;
      if (action.kind !== 'computer.click' || (action.version !== 2 && action.version !== 3) || !commit) throw new Error('窗口点击缺少当前受控执行身份');
      const observation = observationFor(preparation.identity, action.observationId);
      await boundWindow(preparation, signal);
      if (!(await dependencies.clickStatus(signal)).available) throw new Error('请先在 macOS 辅助功能中允许 OmniFlow，然后重新查看窗口');
      signal.throwIfAborted();
      if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口截图已变化，请重新查看');
      await boundWindow(preparation, signal);
      signal.throwIfAborted();
      if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口截图已变化，请重新查看');
      if ((action.version === 2 && (action.screenshotWidth !== observation.width || action.screenshotHeight !== observation.height))
        || (action.version === 3 && observation.mode !== 'ax')
        || action.targetId !== observation.targetId || action.targetId !== preparation.binding.targetId
        || action.applicationLabel !== observation.window.applicationLabel || action.windowLabel !== observation.window.windowLabel) throw new Error('点击与窗口截图身份不匹配');
      const point = pointFor(observation, action);
      if (JSON.stringify(point.target) !== JSON.stringify(preparation.binding.target)) throw new Error('点击与已准备的后台控件身份不匹配');
      const receipt = (state: 'dispatched' | 'not-dispatched' | 'unknown'): AgentToolResult => ({
        ok: state === 'dispatched', message: state === 'dispatched' ? '已发送点击，请重新查看窗口确认结果'
          : state === 'not-dispatched' ? '点击未发送，请重新查看窗口后再操作' : '点击结果不确定，请重新查看窗口，勿直接重复点击',
        data: { operation: 'computer.click', operationId: preparation.identity.toolRunId, dispatchState: state,
          mutationCommitState: state === 'dispatched' ? 'committed' : state === 'not-dispatched' ? 'uncommitted' : 'commit_unknown',
          observationId: observation.id, targetId: action.targetId, ...(action.version === 2 ? { x: action.x, y: action.y } : {
            libraryId: action.libraryId, applicationLabel: action.applicationLabel, windowLabel: action.windowLabel,
          }),
          ...(action.elementId ? { elementId: action.elementId } : {}), nextAction: 'observe',
          retryAllowed: false },
      });
      commit.begin(receipt('unknown'));
      observation.consumed = true;
      let result: AgentToolResult;
      try { await dependencies.click(point, signal); result = receipt('dispatched'); }
      catch (error) {
        result = receipt(error instanceof AgentComputerInputError && error.dispatchState === 'not-dispatched' ? 'not-dispatched' : 'unknown');
        if (error instanceof Error) result.message = `${result.message}。${error.message}`;
      }
      commit.settle(result);
      return result;
    });
  }
  type SemanticAction = AgentComputerSetTextPreparedActionPublicV1 | AgentComputerScrollPreparedActionPublicV1;
  async function executeSemanticInput(kind: SemanticAction['kind'], preparation: AgentToolMainPreparedExecution,
    signal: AbortSignal, commit?: AgentMainCommitSettlement): Promise<AgentToolResult> {
    return serial(signal, async () => {
      const action = preparation.publicAction;
      if ((action.kind !== 'computer.setText' && action.kind !== 'computer.scroll') || action.kind !== kind || !commit) {
        throw new Error('窗口操作缺少当前受控执行身份');
      }
      const observation = observationFor(preparation.identity, action.observationId);
      await boundWindow(preparation, signal);
      const firstParty = observation.firstPartyElements.some(element => element.elementId === action.elementId);
      if (!firstParty && !(await dependencies.clickStatus(signal)).available) throw new Error('请先在 macOS 辅助功能中允许 OmniFlow，然后重新查看窗口');
      signal.throwIfAborted();
      if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口截图已变化，请重新查看');
      await boundWindow(preparation, signal);
      signal.throwIfAborted();
      if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口截图已变化，请重新查看');
      if (action.libraryId !== preparation.identity.libraryId || action.targetId !== observation.targetId
        || action.targetId !== preparation.binding.targetId || action.applicationLabel !== observation.window.applicationLabel
        || action.windowLabel !== observation.window.windowLabel) throw new Error('操作与窗口观察身份不匹配');
      const operation = action.kind === 'computer.setText' ? action.mode === 'replace' ? 'replaceText' : 'insertText'
        : scrollOperation(action.direction, action.unit);
      const target = semanticTarget(observation, action.elementId, operation);
      if (preparation.binding.operation !== operation || JSON.stringify(target) !== JSON.stringify(preparation.binding.target)) {
        throw new Error('操作与已准备的后台控件身份不匹配');
      }
      const text = action.kind === 'computer.setText' ? validateComputerText(preparation.binding.text, action.mode) : undefined;
      if (action.kind === 'computer.setText' && (!text || text.textLength !== action.textLength || text.textBytes !== action.textBytes)) {
        throw new Error('文字输入与已准备动作不匹配');
      }
      if ('firstPartyControl' in target) {
        if (!dependencies.firstPartyControls) throw new Error('第一方控件桥不可用');
        await dependencies.firstPartyControls.verify(observation.window, preparation.identity, target.firstPartyControl, operation, signal);
        signal.throwIfAborted();
        if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口截图已变化，请重新查看');
        await boundWindow(preparation, signal);
        if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口截图已变化，请重新查看');
      }
      const label = action.kind === 'computer.setText' ? '文本输入' : '滚动';
      const receipt = (state: 'dispatched' | 'not-dispatched' | 'unknown'): AgentToolResult => ({
        ok: state === 'dispatched', message: state === 'dispatched' ? `已发送${label}，请重新查看窗口确认结果`
          : state === 'not-dispatched' ? `${label}未发送，请重新查看窗口后再操作` : `${label}结果不确定，请重新查看窗口，勿直接重复操作`,
        data: { ...semanticActionIdentity(observation, action.libraryId, action.elementId),
          ...(action.kind === 'computer.setText' ? { mode: action.mode, textLength: action.textLength, textBytes: action.textBytes }
            : { direction: action.direction, unit: action.unit }),
          operation: action.kind, operationId: preparation.identity.toolRunId, dispatchState: state,
          ...('firstPartyControl' in target ? { inputMethod: 'omniflow-control' } : {}),
          mutationCommitState: state === 'dispatched' ? 'committed' : state === 'not-dispatched' ? 'uncommitted' : 'commit_unknown',
          nextAction: 'observe', retryAllowed: false },
      });
      commit.begin(receipt('unknown'));
      observation.consumed = true;
      let result: AgentToolResult;
      try {
        if ('firstPartyControl' in target) await dependencies.firstPartyControls!.dispatch(observation.window, preparation.identity,
          target.firstPartyControl, operation, text?.text, signal);
        else if (action.kind === 'computer.setText') await dependencies.setText({ target, operation: action.mode === 'replace' ? 'replaceText' : 'insertText', text: text!.text }, signal);
        else await dependencies.scroll({ target, operation }, signal);
        result = receipt('dispatched');
      } catch (error) {
        // Driver errors never enter text audit; an unknown dispatch has no replay path.
        result = receipt(error instanceof AgentComputerInputError && error.dispatchState === 'not-dispatched' ? 'not-dispatched' : 'unknown');
      }
      commit.settle(result);
      return result;
    });
  }
  const setText = (preparation: AgentToolMainPreparedExecution, signal: AbortSignal, commit?: AgentMainCommitSettlement) =>
    executeSemanticInput('computer.setText', preparation, signal, commit);
  const scroll = (preparation: AgentToolMainPreparedExecution, signal: AbortSignal, commit?: AgentMainCommitSettlement) =>
    executeSemanticInput('computer.scroll', preparation, signal, commit);
  function releaseRun(runId: string): void {
    const share = shares.get(runId);
    if (share) deactivateShare(share);
    shares.delete(runId);
    pendingTargets.delete(runId);
    discovery.releaseRun(runId);
  }
  return { prepareWindows, windows, prepareObserve, prepareClick, prepareSetText, prepareScroll, observe, click, setText, scroll, releaseRun };
}
