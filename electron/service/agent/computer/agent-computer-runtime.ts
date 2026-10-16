import crypto from 'node:crypto';
import type { AgentAttachment, AgentAttachmentImport, AgentAttachmentScope } from '../../../../src/shared/agent/agent-attachments';
import type { AgentComputerClickPreparedActionPublicV2, AgentComputerClickPreparedActionPublicV3, AgentComputerSetTextPreparedActionPublicV1,
  AgentComputerScrollPreparedActionPublicV1, AgentToolResult } from '../../../../src/shared/agent/agent.types';
import { COMPUTER_ELEMENT_OPERATIONS, validateComputerText, type ComputerElementOperation,
  type ComputerTextMode, type ComputerScrollDirection, type ComputerScrollUnit } from '../../../../src/shared/computer-use/computer-use-contract';
import { normalizeAgentPreparedActionPublic } from '../../../../src/shared/agent/agent-prepared-action';
import type { AgentComputerCandidate, AgentComputerPoint, AgentComputerRect, AgentComputerSharedWindow,
  AgentComputerObservationScope, AgentComputerTarget, AgentComputerWindowIdentity, AgentComputerWindowTargetObservation } from '../../../platform/computer-use';
import { AgentComputerInputError, AgentComputerWindowInputError } from '../../../platform/computer-use';
import type { AgentMainCommitSettlement, AgentToolMainPreparationContext, AgentToolMainPreparationIdentity,
  AgentToolMainPreparationResult, AgentToolMainPreparedExecution } from '../agent-tool-registry';
import { createAgentComputerWindowDiscovery } from './agent-computer-window-discovery';
import { FIRST_PARTY_CONTROL_LABELS, normalizeFirstPartyControlSnapshot, normalizeFirstPartyRegistrationToken,
  type FirstPartyBoundControl } from '../../../../src/shared/computer-use/first-party-control-contract';
import { getObservationChanges, normalizeObservationQuery, projectObservationElements,
  type ComputerObservationDiffEntry } from './agent-computer-observation-query';
import { normalizeObservationFocus, type ComputerObservationFocus } from './agent-computer-observation-focus';
import { WINDOW_INPUT_OPERATIONS, type WindowInputOperation } from '../../../../src/shared/computer-use/window-input-contract';
import { WINDOW_MENU_OPERATIONS, type WindowMenuOperation } from '../../../../src/shared/computer-use/window-menu-contract';
import { AgentComputerMenuSessionCloseError, type AgentComputerMenuSessionLease,
  type AgentComputerMenuObservation } from '../../../platform/computer-use/window-menu';
import type { AgentComputerWindowInputStatus, AgentComputerWindowInputRequest, AgentComputerWindowInputReceipt,
  AgentComputerWindowInputPointerEvent } from '../../../platform/computer-use';
import { createWindowInputRequest, windowInputNotice } from './agent-computer-window-input';
import { AgentComputerWindowIndicatorCloseError, UNCONFIRMED_WINDOW_INDICATOR_CLOSE_NOTICE,
  type AgentComputerWindowIndicatorRequest, type AgentComputerWindowIndicatorLease } from '../../../platform/computer-use/window-indicator';
import { AgentComputerWindowInputSessionCloseError,
  type AgentComputerWindowInputSessionLease } from '../../../platform/computer-use/window-input-session';

const OBSERVATION_TTL_MS = 60_000;
const MAX_RUN_SCREENSHOTS = 32;
const MAX_RUN_SCREENSHOT_BYTES = 64 * 1024 * 1024;
const MAX_RUN_OBSERVATIONS = 256;
const UNCONFIRMED_INPUT_RELEASE_NOTICE = '释放事件未确认，本次任务的后台定向输入已关闭；仍可观察窗口和使用已声明的 AX 操作。';
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
  inputOperations: readonly WindowInputOperation[];
  availableInputOperations: readonly WindowInputOperation[];
  inputProfile?: string;
  inputFocusToken?: string;
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
  menu?: { session: AgentComputerMenuSessionLease; nativeObservationId: string;
    elements: Array<{ elementId: string; item: AgentComputerMenuObservation['items'][number] }> };
}
interface RunShare {
  active: boolean;
  identity: string;
  targetId: string;
  window: AgentComputerSharedWindow;
  operations: readonly ComputerElementOperation[];
  inputOperations: readonly WindowInputOperation[];
  menuOperations: readonly WindowMenuOperation[];
  screenshotCount: number;
  screenshotBytes: number;
  observationCount: number;
  permissionRequested: boolean;
  observation?: Observation;
  releaseRendering?: () => void;
  menuSession?: { lease: AgentComputerMenuSessionLease; windowKey: string };
  inputSession?: { lease: AgentComputerWindowInputSessionLease; windowKey: string };
}
export interface AgentComputerRuntimeDependencies {
  windows(signal: AbortSignal): Promise<{ windows: AgentComputerSharedWindow[]; truncated: boolean }>;
  ownerWindowId(ownerWebContentsId: number): number;
  capture(window: AgentComputerSharedWindow, signal: AbortSignal): Promise<Buffer>;
  captureWithPointer?(window: AgentComputerSharedWindow, signal: AbortSignal,
    pointerWindow: AgentComputerWindowIdentity): Promise<{ png: Buffer; cursorIncluded: boolean }>;
  targets(window: AgentComputerSharedWindow, signal: AbortSignal, scope?: AgentComputerObservationScope): Promise<AgentComputerWindowTargetObservation>;
  click(point: AgentComputerPoint, signal: AbortSignal): Promise<void>;
  setText(input: { target: AgentComputerPoint['target']; operation: 'replaceText' | 'insertText'; text: string }, signal: AbortSignal): Promise<void>;
  scroll(input: { target: AgentComputerPoint['target']; operation: ComputerElementOperation }, signal: AbortSignal): Promise<void>;
  inputStatus?(window: AgentComputerSharedWindow, signal: AbortSignal): Promise<AgentComputerWindowInputStatus>;
  input?(request: AgentComputerWindowInputRequest, signal: AbortSignal,
    onPointerEvent?: (event: AgentComputerWindowInputPointerEvent) => void): Promise<AgentComputerWindowInputReceipt>;
  inputSession?(window: AgentComputerSharedWindow, signal: AbortSignal): Promise<AgentComputerWindowInputSessionLease>;
  menuSession?(window: AgentComputerSharedWindow, signal: AbortSignal): Promise<AgentComputerMenuSessionLease>;
  indicatePointer?(request: AgentComputerWindowIndicatorRequest, signal: AbortSignal): Promise<AgentComputerWindowIndicatorLease>;
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
  // This revocation belongs to the Run, so replacing or reapproving its window cannot clear it.
  const inputBlockedRuns = new Set<string>();
  interface PointerLease {
    request: AgentComputerWindowIndicatorRequest;
    lease?: AgentComputerWindowIndicatorLease;
    stop(mode?: 'normal' | 'immediate'): void;
    closed: Promise<boolean>;
  }
  const activeIndicators = new Map<RunShare, PointerLease>();
  const closingIndicators = new Set<Promise<boolean>>();
  const closingMenus = new Set<Promise<boolean>>();
  const openingMenus = new Set<Promise<void>>();
  let unconfirmedMenuClose = false;
  const closingInputs = new Set<Promise<boolean>>();
  const openingInputs = new Set<Promise<void>>();
  let unconfirmedInputClose = false;
  // A possibly remaining native surface belongs to this main runtime, not a
  // Run. New observations, permissions, Run release and late exit cannot clear it.
  let unconfirmedIndicatorExit = false;
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
  function requireConfirmedInputRelease(runId: string): void {
    if (inputBlockedRuns.has(runId)) throw new Error(UNCONFIRMED_INPUT_RELEASE_NOTICE);
  }
  function requireConfirmedIndicatorExit(): void {
    if (unconfirmedIndicatorExit) throw new AgentComputerWindowIndicatorCloseError();
  }
  function releaseShareRendering(share: RunShare): void {
    const release = share.releaseRendering;
    share.releaseRendering = undefined;
    try { release?.(); }
    catch { /* Rendering restoration must not replace the authoritative Run result. */ }
  }
  function deactivateShare(share: RunShare, mode: 'normal' | 'immediate' = 'immediate'): void {
    share.active = false;
    activeIndicators.get(share)?.stop(mode);
    closeMenuSession(share);
    closeInputSession(share);
    releaseShareRendering(share);
  }
  function requireConfirmedInputSessionExit(): void {
    if (unconfirmedInputClose) throw new Error('后台输入会话关闭未确认，不能继续定向输入；请重启应用后重新观察');
  }
  function trackInputClose(lease: AgentComputerWindowInputSessionLease): Promise<boolean> {
    const closed = Promise.resolve(lease.closed).then(confirmed => {
      if (!confirmed) unconfirmedInputClose = true;
      return confirmed;
    }, () => { unconfirmedInputClose = true; return false; }).finally(() => closingInputs.delete(closed));
    closingInputs.add(closed);
    try { lease.close(); } catch { unconfirmedInputClose = true; }
    return closed;
  }
  function closeInputSession(share: RunShare): void {
    const session = share.inputSession;
    share.inputSession = undefined;
    if (session) void trackInputClose(session.lease);
  }
  async function inputSessionFor(share: RunShare, window: AgentComputerSharedWindow,
    signal: AbortSignal): Promise<AgentComputerWindowInputSessionLease> {
    if (!dependencies.inputSession) throw new Error('当前平台未提供后台输入会话');
    if (share.inputSession?.windowKey !== windowKey(window)) closeInputSession(share);
    // The queue serializes individual actions, but a synthetic focus owner
    // survives between them. Hand over that owner before another Run starts a
    // native session; overlapping focus enforcers could redirect user input.
    // This helper is reached only from input's serial operation below, so an
    // opening session cannot race a second opening through this handover.
    for (const other of shares.values()) if (other !== share) closeInputSession(other);
    await Promise.all(closingInputs);
    signal.throwIfAborted();
    requireConfirmedInputSessionExit();
    if (!share.active) throw new Error('窗口共享已结束');
    if (share.inputSession) return share.inputSession.lease;
    let finishOpening!: () => void;
    const opening = new Promise<void>(resolve => { finishOpening = resolve; });
    openingInputs.add(opening);
    try {
      const lease = await dependencies.inputSession(window, signal);
      if (signal.aborted || !share.active) {
        await trackInputClose(lease);
        signal.throwIfAborted();
        throw new Error('窗口共享已结束');
      }
      share.inputSession = { lease, windowKey: windowKey(window) };
      void lease.closed.then(confirmed => {
        if (!confirmed) unconfirmedInputClose = true;
        if (share.inputSession?.lease === lease) share.inputSession = undefined;
      }, () => {
        unconfirmedInputClose = true;
        if (share.inputSession?.lease === lease) share.inputSession = undefined;
      });
      return lease;
    } catch (error) {
      if (error instanceof AgentComputerWindowInputSessionCloseError) unconfirmedInputClose = true;
      throw error;
    } finally { openingInputs.delete(opening); finishOpening(); }
  }
  function trackMenuClose(lease: AgentComputerMenuSessionLease): Promise<boolean> {
    const closed = Promise.resolve(lease.closed).then(confirmed => {
      if (!confirmed) unconfirmedMenuClose = true;
      return confirmed;
    }, () => { unconfirmedMenuClose = true; return false; }).finally(() => closingMenus.delete(closed));
    closingMenus.add(closed);
    try { lease.close(); } catch { unconfirmedMenuClose = true; }
    return closed;
  }
  function closeMenuSession(share: RunShare): void {
    const session = share.menuSession;
    share.menuSession = undefined;
    if (share.observation?.menu) share.observation = undefined;
    if (session) void trackMenuClose(session.lease);
  }
  async function menuSessionFor(share: RunShare, window: AgentComputerSharedWindow,
    signal: AbortSignal): Promise<AgentComputerMenuSessionLease> {
    if (!dependencies.menuSession) throw new Error('当前平台未提供关联菜单操作');
    if (share.menuSession?.windowKey !== windowKey(window)) closeMenuSession(share);
    await Promise.all(closingMenus);
    signal.throwIfAborted();
    if (!share.active || unconfirmedMenuClose) throw new Error('关联菜单会话已结束或关闭未确认，不能继续菜单操作');
    if (share.menuSession) return share.menuSession.lease;
    let finishOpening!: () => void;
    const opening = new Promise<void>(resolve => { finishOpening = resolve; });
    openingMenus.add(opening);
    try {
      const lease = await dependencies.menuSession(window, signal);
      if (signal.aborted || !share.active) {
        await trackMenuClose(lease);
        signal.throwIfAborted();
        throw new Error('窗口共享已结束');
      }
      share.menuSession = { lease, windowKey: windowKey(window) };
      void lease.closed.then(confirmed => {
        if (!confirmed) unconfirmedMenuClose = true;
        if (share.menuSession?.lease === lease) {
          share.menuSession = undefined;
          if (share.observation?.menu?.session === lease) share.observation = undefined;
        }
      }, () => {
        unconfirmedMenuClose = true;
        if (share.menuSession?.lease === lease) share.menuSession = undefined;
        if (share.observation?.menu?.session === lease) share.observation = undefined;
      });
      return lease;
    } catch (error) {
      if (error instanceof AgentComputerMenuSessionCloseError) unconfirmedMenuClose = true;
      throw error;
    } finally { openingMenus.delete(opening); finishOpening(); }
  }
  async function awaitIndicatorClosures(): Promise<void> {
    await Promise.all(closingIndicators);
    requireConfirmedIndicatorExit();
  }
  async function closePointer(share: RunShare, mode: 'normal' | 'immediate' = 'immediate'): Promise<boolean> {
    const active = activeIndicators.get(share);
    if (!active) return !unconfirmedIndicatorExit;
    active.stop(mode);
    return await active.closed;
  }
  /** A new exact observation can refresh visual geometry, never an input binding. */
  async function syncPointerTarget(share: RunShare, window: AgentComputerWindowIdentity,
    signal: AbortSignal): Promise<PointerLease | undefined> {
    const active = activeIndicators.get(share);
    if (!active) return undefined;
    if (closingIndicators.has(active.closed)) {
      if (!await active.closed) throw new AgentComputerWindowIndicatorCloseError();
      signal.throwIfAborted();
      if (!share.active) throw new Error('窗口共享已结束');
      return undefined;
    }
    if (windowKey(active.request.window) === windowKey(window)) return active;
    const abortSync = () => active.stop();
    signal.addEventListener('abort', abortSync, { once: true });
    try {
      signal.throwIfAborted();
      if (!share.active) throw new Error('窗口共享已结束');
      const synced = sameWindow(active.request.window, window) && active.lease?.syncTarget
        ? await active.lease.syncTarget(window) : false;
      signal.throwIfAborted();
      if (!share.active) throw new Error('窗口共享已结束');
      // Release/hide may have started while the native acknowledgement was pending.
      // A late true receipt must not resurrect the surface or publish new geometry.
      if (!synced || activeIndicators.get(share) !== active || closingIndicators.has(active.closed)) {
        active.stop();
        if (!await active.closed) throw new AgentComputerWindowIndicatorCloseError();
        signal.throwIfAborted();
        if (!share.active) throw new Error('窗口共享已结束');
        return undefined;
      }
      active.request = { ...active.request, window: structuredClone(window) };
      return active;
    } catch (error) {
      active.stop();
      const confirmed = await active.closed;
      signal.throwIfAborted();
      if (!share.active) throw new Error('窗口共享已结束');
      if (!confirmed) throw new AgentComputerWindowIndicatorCloseError();
      throw error;
    } finally { signal.removeEventListener('abort', abortSync); }
  }
  /** Visual intent only, owned by the share rather than an individual Tool. */
  async function previewPointer(share: RunShare, request: AgentComputerWindowIndicatorRequest, signal: AbortSignal): Promise<() => void> {
    if (!dependencies.indicatePointer) return () => undefined;
    await awaitIndicatorClosures();
    signal.throwIfAborted();
    let active = activeIndicators.get(share);
    if (active && !active.lease?.update) {
      if (!await closePointer(share)) throw new AgentComputerWindowIndicatorCloseError();
      active = undefined;
    } else if (active) active = await syncPointerTarget(share, request.window, signal);
    signal.throwIfAborted();
    if (!share.active) throw new Error('窗口共享已结束');
    if (!active) {
      const controller = new AbortController();
      let resolveClosed!: (confirmed: boolean) => void;
      const closed = new Promise<boolean>(resolve => { resolveClosed = resolve; });
      let stopMode: 'normal' | 'immediate' | undefined;
      const stopLease = () => {
        if (stopMode === 'immediate') {
          controller.abort();
          created.lease?.dispose();
        } else if (created.lease) {
          if (created.lease.hide) created.lease.hide();
          else created.lease.dispose();
        }
      };
      const created: PointerLease = { request, closed, stop: (mode = 'immediate') => {
        // A cancellation can upgrade an in-progress normal fade, never the reverse.
        if (stopMode === 'immediate' || stopMode === mode) return;
        stopMode = mode;
        closingIndicators.add(closed);
        try { stopLease(); } catch {
          if (mode === 'normal') created.stop('immediate');
          // Actual closed receipt remains authoritative.
        }
      } };
      activeIndicators.set(share, created);
      // This handler is installed before native startup so Run release and
      // late readiness cannot orphan a surface or escape the serial barrier.
      void closed.then(confirmed => {
        if (!confirmed) unconfirmedIndicatorExit = true;
        closingIndicators.delete(closed);
        if (activeIndicators.get(share) === created) activeIndicators.delete(share);
      });
      const abortStartup = () => created.stop();
      signal.addEventListener('abort', abortStartup, { once: true });
      if (signal.aborted || !share.active) created.stop();
      try {
        created.lease = await dependencies.indicatePointer(request, controller.signal);
        void created.lease.closed.then(resolveClosed, () => resolveClosed(false));
        if (stopMode || !created.lease.shown) {
          const stoppedBeforeReady = stopMode;
          if (!stopMode) created.stop();
          // A close can precede readiness; apply its final mode to the late lease.
          if (stoppedBeforeReady) stopLease();
          if (!await closed) throw new AgentComputerWindowIndicatorCloseError();
        }
        signal.throwIfAborted();
        if (!share.active) throw new Error('窗口共享已结束');
      } catch (error) {
        created.stop();
        if (!created.lease) resolveClosed(controller.signal.aborted && error === controller.signal.reason);
        await closed;
        signal.throwIfAborted();
        if (!share.active) throw new Error('窗口共享已结束');
        throw error;
      } finally { signal.removeEventListener('abort', abortStartup); }
      active = created;
    } else {
      const abortUpdate = () => active!.stop();
      signal.addEventListener('abort', abortUpdate, { once: true });
      try {
        if (signal.aborted) active.stop();
        const shown = await active.lease!.update!(request);
        if (!shown) {
          active.stop();
          if (!await active.closed) throw new AgentComputerWindowIndicatorCloseError();
        }
        active.request = request;
        signal.throwIfAborted();
        if (!share.active) throw new Error('窗口共享已结束');
      } catch (error) {
        active.stop();
        await active.closed;
        throw error;
      } finally { signal.removeEventListener('abort', abortUpdate); }
    }
    const pointer = active;
    const abortAction = () => pointer.stop();
    signal.addEventListener('abort', abortAction, { once: true });
    if (signal.aborted || !share.active) pointer.stop();
    // The action signal is temporary. The persistent lease keeps its separate
    // Run-owned controller until explicit hide, replacement or Run release.
    return () => signal.removeEventListener('abort', abortAction);
  }
  async function withPointerPreview<T>(preparation: AgentToolMainPreparedExecution, observation: Observation,
    request: AgentComputerWindowIndicatorRequest | undefined, signal: AbortSignal, dispatch: () => Promise<T>): Promise<T> {
    if (request) requireConfirmedIndicatorExit();
    if (!request || !dependencies.indicatePointer) return dispatch();
    const share = shareFor(preparation.identity);
    if (!share) throw new Error('窗口共享已结束');
    const detach = await previewPointer(share, request, signal);
    let dispatchStarted = false;
    try {
      if (!share.active) throw new Error('窗口共享已结束');
      await boundWindow(preparation, signal);
      signal.throwIfAborted();
      if (observationFor(preparation.identity, observation.id) !== observation) throw new Error('窗口观察已变化，此次操作未发送');
      requireConfirmedIndicatorExit();
      if (closingIndicators.size) throw new Error('上一鼠标图案仍在收起，请重新观察后再操作');
      dispatchStarted = true;
      return await dispatch();
    } finally {
      detach();
      if (!dispatchStarted || signal.aborted) await closePointer(share);
    }
  }
  async function hidePointerForRun(identity: AgentToolMainPreparationIdentity, signal: AbortSignal): Promise<{ closeConfirmed: boolean }> {
    return serial(signal, async () => {
      const existing = shares.get(identity.runId);
      if (existing && existing.identity !== identityKey(identity)) throw new Error('鼠标图案不属于当前任务身份');
      const cancel = () => { if (existing) activeIndicators.get(existing)?.stop(); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        if (signal.aborted) cancel();
        // A replaced/released share may still own a native surface while its
        // exit is pending. Never report hidden before these closures settle.
        await Promise.all(closingIndicators);
        signal.throwIfAborted();
        const closeConfirmed = existing ? await closePointer(existing, 'normal') : !unconfirmedIndicatorExit;
        signal.throwIfAborted();
        return { closeConfirmed };
      } finally { signal.removeEventListener('abort', cancel); }
    });
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
  async function prepareObserve(input: { application?: string; windowTitle?: string; windowRef?: string; mode?: ObservationMode; scope?: 'menu';
    query?: string; role?: string; operation?: ComputerElementOperation; offset?: number; limit?: number; includeChanges?: boolean;
    focus?: { observationId: string; elementId: string; ancestorLevels?: number } }, context: AgentToolMainPreparationContext): Promise<AgentToolMainPreparationResult> {
    context.signal.throwIfAborted();
    const mode = input.mode ?? (input.scope === 'menu' ? 'ax' : 'both');
    if (!['ax', 'screenshot', 'both'].includes(mode)) throw new Error('应用窗口观察模式无效');
    if (input.scope !== undefined && input.scope !== 'menu') throw new Error('应用窗口观察范围无效');
    if (input.scope === 'menu' && (!dependencies.menuSession || input.focus !== undefined
      || input.operation !== undefined || input.includeChanges !== undefined)) throw new Error('菜单观察当前不可用或混用了普通控件范围参数');
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
    const inputOperations = dependencies.input && dependencies.inputStatus && !inputBlockedRuns.has(context.preparationIdentity.runId)
      ? [...WINDOW_INPUT_OPERATIONS] : [];
    const menuOperations = dependencies.menuSession ? [...WINDOW_MENU_OPERATIONS] : [];
    const granted = share && sameWindow(share.window, window)
      && operations.every(operation => share.operations.includes(operation))
      && inputOperations.every(operation => share.inputOperations.includes(operation))
      && menuOperations.every(operation => share.menuOperations.includes(operation));
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
      ...(inputOperations.length ? { inputOperations } : {}),
      ...(menuOperations.length ? { menuOperations } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.mode !== undefined || input.scope === 'menu' ? { mode } : {}) });
    return { publicAction, binding: { window, targetId, operations, inputOperations, menuOperations, mode, query, includeChanges: input.includeChanges === true,
      ...(input.scope ? { observationScope: input.scope } : {}),
      ...(focused ? { focus, scope: focused.scope } : {}) },
      decision: granted ? { behavior: 'allow', risk: 'read' } : {
        behavior: 'ask', risk: 'read', preview: { title: '共享应用窗口并允许操作', risk: 'read',
          description: `允许本次任务查看「${window.applicationLabel} / ${window.windowLabel}」并点击控件、输入文字和滚动。${menuOperations.length ? '也允许查看和操作经原生身份确认的此应用菜单。' : ''}${inputOperations.length ? '还允许经当前接收条件确认的后台单击、文字输入、滚轮、快捷键、右键、双击及窗内拖拽；只向目标进程投递，不主动置前，效果仍需观察确认。' : ''}仅此窗口及此应用菜单的图像和界面控件信息会发送给当前 AI 服务并保存到本机会话；不采集其他普通窗口、其他应用或整个显示器。切换共享窗口需重新允许，停止或任务结束后停止共享。操作不会移动系统鼠标。`,
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
    requireConfirmedIndicatorExit();
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
  async function observeMenu(preparation: AgentToolMainPreparedExecution, share: RunShare,
    window: AgentComputerSharedWindow, mode: ObservationMode, capturedAt: number, signal: AbortSignal): Promise<AgentToolResult> {
    const session = await menuSessionFor(share, window, signal);
    try {
      const native = await session.observe(signal);
      signal.throwIfAborted();
      if (!share.active || share.menuSession?.lease !== session) throw new Error('关联菜单会话已结束');
      let capture: Awaited<ReturnType<AgentComputerMenuSessionLease['capture']>> | undefined;
      if (mode !== 'ax') {
        const pointer = activeIndicators.get(share);
        let pointerWindow: AgentComputerWindowIdentity | undefined;
        if (!unconfirmedIndicatorExit && pointer?.lease?.shown && pointer.lease.snapshot
          && windowKey(pointer.request.window) === windowKey(window)) {
          try { pointerWindow = await pointer.lease.snapshot(); } catch { signal.throwIfAborted(); }
        }
        if (!share.active) throw new Error('窗口共享已结束');
        capture = await session.capture({ observationId: native.observationId,
          ...(pointerWindow && activeIndicators.get(share) === pointer && pointer?.lease?.shown ? { pointerWindow } : {}) }, signal);
      }
      await boundWindow(preparation, signal);
      signal.throwIfAborted();
      if (!share.active || share.menuSession?.lease !== session) throw new Error('关联菜单会话已结束');
      const menuElements = mode === 'screenshot' ? [] : native.items.map(item => ({ elementId: crypto.randomUUID(), item: structuredClone(item) }));
      const observation: Observation = { id: crypto.randomUUID(), targetId: share.targetId, window,
        operations: [], inputOperations: [], availableInputOperations: [], mode, capturedAt, consumed: false,
        coordinateClickReady: false, candidates: [], elements: [], firstPartyElements: [], diffEntries: [],
        candidateScanComplete: false, scopeScanComplete: !native.truncated, scopeKey: 'menu',
        ...(mode !== 'screenshot' ? { axTree: native.axTree } : {}),
        menu: { session, nativeObservationId: native.observationId, elements: menuElements } };
      const elements = menuElements.map(({ elementId, item }) => ({ elementId, role: item.role, label: item.label,
        operations: [] as ComputerElementOperation[], menuOperations: item.operations.filter(operation => share.menuOperations.includes(operation)) }));
      const page = projectObservationElements(elements, normalizeObservationQuery(preparation.binding.query ?? { limit: 128 }));
      const publish = (attachment?: AgentAttachment): AgentToolResult => {
        signal.throwIfAborted();
        if (!share.active || share.menuSession?.lease !== session) throw new Error('关联菜单会话已结束');
        share.observation = observation;
        share.window = window;
        share.observationCount += 1;
        if (attachment) { share.screenshotCount += 1; share.screenshotBytes += attachment.sizeBytes; }
        return { ok: true, message: mode === 'ax' ? '已读取关联菜单 AX'
          : !attachment ? mode === 'both' ? '已读取关联菜单 AX；菜单图片暂不可用' : '关联菜单图片暂不可用'
            : '已查看关联菜单', data: {
          captureScope: 'window', targetId: share.targetId, applicationLabel: window.applicationLabel, windowLabel: window.windowLabel,
          mode, observationId: observation.id, capturedAt: new Date(capturedAt).toISOString(),
          expiresInMs: Math.max(0, OBSERVATION_TTL_MS - (now() - capturedAt)), scope: { kind: 'menu' },
          scopeScanComplete: !native.truncated, candidateScanComplete: false, coordinateClickReady: false,
          clickReady: false, textReady: false, scrollReady: false, inputReady: false,
          operations: [], inputOperations: [], availableInputOperations: [], menuOperations: [...share.menuOperations],
          menuReady: elements.some(element => element.menuOperations.length > 0),
          observationSource: mode === 'ax' ? 'ax' : 'screenshot', elementsScope: 'application-menu-controls', ...page,
          ...(mode !== 'screenshot' ? { axTree: native.axTree, axTreeTruncated: native.truncated } : {}),
          ...(attachment && capture?.available ? { imageId: attachment.id, screenshotWidth: attachment.width, screenshotHeight: attachment.height,
            cursorPresentation: 'native-window', cursorIncluded: capture.cursorIncluded, menuCapture: capture.menuCapture }
            : capture && !capture.available ? { menuCapture: 'unavailable', imageUnavailableReason: capture.reason } : {}),
          notice: mode === 'screenshot'
            ? '本次只提供关联菜单图片，不签发操作 ID；需要菜单操作时重新以 ax 或 both 观察。'
            : '仅操作本次 elements 明确声明的 menuOperations；本范围包含当前应用的菜单上下文，以原窗口为任务锚点，不读取其他普通窗口。菜单可能在主窗口外，不能把菜单位置用于普通点击。每步后重新观察菜单；选择完成后观察原窗口核对结果。',
        } };
      };
      if (!capture?.available) return publish();
      const images = dependencies.images();
      const attachmentScope = { ownerScope: preparation.identity.ownerScope, libraryId: preparation.identity.libraryId };
      const attachment = await images.import({ ...attachmentScope, name: '关联菜单截图.png', base64: capture.png.toString('base64') });
      let bound = false;
      try {
        if (attachment.kind !== 'image' || !attachment.width || !attachment.height
          || Math.max(attachment.width, attachment.height) > 2048) throw new Error('关联菜单截图格式无效');
        if (share.screenshotBytes + attachment.sizeBytes > MAX_RUN_SCREENSHOT_BYTES) throw new Error('本次任务截图已达 64 MiB，请结束任务后再继续');
        await images.bind(attachmentScope, [attachment.id], preparation.identity.sessionId);
        bound = true;
        return publish(attachment);
      } catch (error) {
        if (bound) await images.rollbackBinding(attachmentScope, [attachment.id], preparation.identity.sessionId);
        await images.discard(attachmentScope, attachment.id);
        throw error;
      }
    } catch (error) { closeMenuSession(share); throw error; }
  }
  async function prepareMenu(input: { observationId: string; elementId: string; operation: WindowMenuOperation },
    context: AgentToolMainPreparationContext): Promise<AgentToolMainPreparationResult> {
    context.signal.throwIfAborted();
    const observation = observationFor(context.preparationIdentity, input.observationId);
    const share = shareFor(context.preparationIdentity);
    const element = observation.menu?.elements.find(item => item.elementId === input.elementId);
    if (!share || !observation.menu || !element || share.menuSession?.lease !== observation.menu.session
      || !share.menuOperations.includes(input.operation) || !element.item.operations.includes(input.operation)) {
      throw new Error('菜单项不属于本次有效观察或未声明此操作，请重新观察关联菜单');
    }
    const publicAction = normalizeAgentPreparedActionPublic({ kind: 'computer.menu', version: 1,
      ...semanticActionIdentity(observation, context.preparationIdentity.libraryId, input.elementId),
      elementLabel: element.item.label, operation: input.operation });
    return { publicAction, binding: { window: observation.window, targetId: observation.targetId,
      menu: { nativeObservationId: observation.menu.nativeObservationId, itemId: element.item.itemId, operation: input.operation } },
    decision: { behavior: 'allow', risk: 'write' } };
  }
  async function menu(preparation: AgentToolMainPreparedExecution, signal: AbortSignal, commit?: AgentMainCommitSettlement): Promise<AgentToolResult> {
    return serial(signal, async () => {
      const action = preparation.publicAction;
      if (action.kind !== 'computer.menu' || !commit) throw new Error('菜单操作缺少当前受控执行身份');
      const observation = observationFor(preparation.identity, action.observationId);
      const share = shareFor(preparation.identity);
      const element = observation.menu?.elements.find(item => item.elementId === action.elementId);
      if (!share || !observation.menu || !element || share.menuSession?.lease !== observation.menu.session
        || !share.menuOperations.includes(action.operation) || !element.item.operations.includes(action.operation)
        || action.elementLabel !== element.item.label || action.libraryId !== preparation.identity.libraryId
        || action.targetId !== observation.targetId || action.targetId !== preparation.binding.targetId
        || action.applicationLabel !== observation.window.applicationLabel || action.windowLabel !== observation.window.windowLabel) {
        throw new Error('菜单操作与当前共享窗口或菜单项身份不匹配');
      }
      const menuSession = observation.menu.session;
      const request = { observationId: observation.menu.nativeObservationId, itemId: element.item.itemId, operation: action.operation };
      if (JSON.stringify(preparation.binding.menu) !== JSON.stringify({ nativeObservationId: request.observationId,
        itemId: request.itemId, operation: request.operation })) throw new Error('菜单操作与已准备的私有绑定不匹配');
      if (windowKey(await boundWindow(preparation, signal)) !== windowKey(observation.window)) {
        throw new Error('菜单操作与已准备的原窗口身份不匹配');
      }
      let pointerRequest: AgentComputerWindowIndicatorRequest | undefined;
      if (dependencies.indicatePointer) {
        try {
          const visual = await menuSession.resolvePointer(request, signal);
          signal.throwIfAborted();
          if (visual.available) {
            if (visual.observationId !== request.observationId || visual.itemId !== request.itemId) {
              throw new Error('菜单视觉位置与当前操作身份不匹配');
            }
            pointerRequest = { window: observation.window, operation: 'click', point: { ...visual.point },
              ...(visual.menuSurface ? { menuSurface: structuredClone(visual.menuSurface) } : {}) };
          } else if (!await closePointer(share)) {
            // An unavailable position does not revoke the AX action. Remove a
            // previous intent first so it cannot falsely point at another item.
            throw new AgentComputerWindowIndicatorCloseError();
          }
        } catch (error) {
          await closePointer(share);
          closeMenuSession(share);
          throw error;
        }
      }
      const receipt = (state: 'dispatched' | 'not-dispatched' | 'unknown'): AgentToolResult => ({
        ok: state === 'dispatched', message: state === 'dispatched' ? '已发送菜单操作，请重新观察确认结果'
          : state === 'not-dispatched' ? '菜单操作未发送，请重新观察后再判断' : '菜单操作结果不确定，请重新观察，勿直接重复操作',
        data: { operation: 'computer.menu', operationId: preparation.identity.toolRunId, menuOperation: action.operation,
          libraryId: action.libraryId, targetId: action.targetId, applicationLabel: action.applicationLabel, windowLabel: action.windowLabel,
          observationId: action.observationId, elementId: action.elementId, elementLabel: action.elementLabel,
          dispatchState: state, mutationCommitState: state === 'dispatched' ? 'committed' : state === 'not-dispatched' ? 'uncommitted' : 'commit_unknown',
          nextAction: 'observe', retryAllowed: false },
      });
      return withPointerPreview(preparation, observation, pointerRequest, signal, async () => {
        // Position resolution and animation are read-only and can outlive the
        // original snapshot. Neither their ACK nor geometry authorizes input.
        await boundWindow(preparation, signal);
        signal.throwIfAborted();
        if (observationFor(preparation.identity, action.observationId) !== observation || share.menuSession?.lease !== menuSession) {
          throw new Error('菜单观察已变化，请重新观察关联菜单');
        }
        // The native acknowledgement can be lost after AX dispatch. Reserve the
        // unknown settlement before IPC, never infer non-dispatch from a missing ACK.
        commit.begin(receipt('unknown'));
        observation.consumed = true;
        let result: AgentToolResult;
        try { await menuSession.action(request, signal, () => undefined); result = receipt('dispatched'); }
        catch (error) {
          const state = error instanceof AgentComputerInputError && error.dispatchState === 'not-dispatched' ? 'not-dispatched' : 'unknown';
          result = receipt(state);
          if (state === 'unknown') closeMenuSession(share);
        }
        commit.settle(result);
        return result;
      });
    });
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
      const inputOperations = action.inputOperations ?? [];
      const menuOperations = action.menuOperations ?? [];
      const mode = action.mode ?? 'both';
      if (mode !== (preparation.binding.mode ?? 'both')) throw new Error('窗口观察模式与准备动作不匹配');
      const hasScreenshot = mode !== 'ax';
      const readsControls = mode !== 'screenshot';
      const boundOperations = preparation.binding.operations ?? ['press'];
      if (JSON.stringify(operations) !== JSON.stringify(boundOperations)) throw new Error('窗口共享操作许可不匹配');
      if (JSON.stringify(inputOperations) !== JSON.stringify(preparation.binding.inputOperations ?? [])) throw new Error('窗口后台输入许可不匹配');
      if (JSON.stringify(menuOperations) !== JSON.stringify(preparation.binding.menuOperations ?? [])) throw new Error('窗口菜单许可不匹配');
      if (action.scope !== preparation.binding.observationScope) throw new Error('窗口菜单观察范围与准备动作不匹配');
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
        || JSON.stringify(share.operations) !== JSON.stringify(operations)
        || JSON.stringify(share.inputOperations) !== JSON.stringify(inputOperations)
        || JSON.stringify(share.menuOperations) !== JSON.stringify(menuOperations)) {
        const previous = shares.get(identity.runId);
        if (previous) deactivateShare(previous);
        share = { active: true, identity: identityKey(identity), targetId: action.targetId, window, operations: [...operations], inputOperations: [...inputOperations], menuOperations: [...menuOperations],
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
      if (share.menuSession && share.menuSession.windowKey !== windowKey(window)) closeMenuSession(share);
      await syncPointerTarget(share, window, signal);
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
      if (action.scope === 'menu') {
        if (!menuOperations.length || !accessibilityAvailable && readsControls) throw new Error('关联菜单观察需要已允许的菜单权限和辅助功能');
        return observeMenu(preparation, share, window, mode, capturedAt, signal);
      }
      const inputBlocked = inputBlockedRuns.has(identity.runId);
      const observedOperations = unconfirmedIndicatorExit ? operations.filter(operation => operation !== 'press') : operations;
      const checkInput = async (): Promise<AgentComputerWindowInputStatus | undefined> => {
        if (inputBlocked || scope || !readsControls || !accessibilityAvailable || !inputOperations.length || !dependencies.inputStatus) return undefined;
        try { return await dependencies.inputStatus(window, signal); }
        catch { signal.throwIfAborted(); return undefined; }
      };
      const inputBefore = await checkInput();
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
      let bytes: Buffer | undefined;
      let cursorIncluded = false;
      if (hasScreenshot) {
        // A menu capture leaves native SCK state in its persistent process.
        // Keep subsequent ordinary captures on that same owner; never race a
        // closing helper or silently start a second capture after a failure.
        await Promise.all(closingMenus);
        signal.throwIfAborted();
        if (!share.active || unconfirmedMenuClose) throw new Error('截图会话已结束或关闭未确认，请重新开始任务');
        const captureSession = share.menuSession;
        const pointer = activeIndicators.get(share);
        let surface: AgentComputerWindowIdentity | undefined;
        if (!unconfirmedIndicatorExit && pointer?.lease?.shown && pointer.lease.snapshot
          && !pointer.request.menuSurface && windowKey(pointer.request.window) === windowKey(window)
          && (captureSession || dependencies.captureWithPointer)) {
          try { surface = await pointer.lease.snapshot(); }
          catch { signal.throwIfAborted(); }
          signal.throwIfAborted();
        }
        if (!share.active) throw new Error('窗口共享已结束');
        if (captureSession) {
          const capture = await captureSession.lease.captureWindow(
            surface && pointer?.lease?.shown && activeIndicators.get(share) === pointer ? { pointerWindow: surface } : {}, signal);
          if (!share.active || share.menuSession !== captureSession) throw new Error('截图会话已结束，请重新观察窗口');
          bytes = capture.png;
          cursorIncluded = capture.cursorIncluded;
        } else if (surface && pointer?.lease?.shown && activeIndicators.get(share) === pointer && dependencies.captureWithPointer) {
          const capture = await dependencies.captureWithPointer(window, signal, surface);
          bytes = capture.png;
          cursorIncluded = capture.cursorIncluded;
        } else bytes = await dependencies.capture(window, signal);
      }
      signal.throwIfAborted();
      if (!share.active) throw new Error('窗口共享已结束');
      let candidates: AgentComputerCandidate[] = [];
      let knownCandidates: AgentComputerCandidate[] = [];
      let firstPartyCandidates: FirstPartyBoundControl[] = [];
      let candidateScanComplete = false;
      let scopeScanComplete = false;
      let candidateSetsStable = false;
      let summary: Pick<AgentComputerWindowTargetObservation, 'axTree' | 'axTreeTruncated'> = {};
      let targetNotice = '未能确认可供 AX 工具操作的窗口控件；computer.input 以 availableInputOperations 为准。';
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
                ? '控件扫描不完整；AX 工具仅使用本次确认的 elementId，computer.click 不能按坐标推断 AX 目标，未列出不代表不存在；computer.input 以 availableInputOperations 为准。'
                : !candidateSetsStable
                  ? '部分控件在截图期间变化；AX 工具仅使用本次确认的 elementId，computer.click 不能按坐标推断 AX 目标；computer.input 以 availableInputOperations 为准。'
                  : '此窗口没有可供 AX 工具操作的控件；画布等区域的 computer.input 以 availableInputOperations 为准。';
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
      const coordinateClickReady = hasScreenshot && accessibilityAvailable && observedOperations.includes('press')
        && candidates.some(candidate => candidateOperations(candidate).includes('press')) && candidateScanComplete && candidateSetsStable;
      // A role-only label cannot identify a requested control. Keep all native
      // candidates for complete coordinate hit-testing, but never issue a
      // semantic ID for an anonymous control without a proven unique profile,
      // or expose its private identifier.
      const semanticCandidates = candidates.flatMap(candidate => {
        const label = observedLabel(candidate, candidates, knownCandidates, candidateScanComplete && candidateSetsStable, hasScreenshot);
        return label && candidateOperations(candidate).some(operation => observedOperations.includes(operation)) ? [{ candidate, label }] : [];
      });
      const clickReady = coordinateClickReady || semanticCandidates.some(({ candidate }) => observedOperations.includes('press') && candidateOperations(candidate).includes('press'));
      const usableFirstParty = firstPartyCandidates.filter(control => control.snapshot.operations.some(operation => observedOperations.includes(operation)));
      const textReady = semanticCandidates.some(({ candidate }) => candidateOperations(candidate).some(operation => observedOperations.includes(operation) && (operation === 'replaceText' || operation === 'insertText')))
        || usableFirstParty.some(control => control.snapshot.operations.some(operation => observedOperations.includes(operation) && (operation === 'replaceText' || operation === 'insertText')));
      const scrollReady = semanticCandidates.some(({ candidate }) => candidateOperations(candidate).some(operation => observedOperations.includes(operation) && operation.startsWith('scroll')))
        || usableFirstParty.some(control => control.snapshot.operations.some(operation => observedOperations.includes(operation) && operation.startsWith('scroll')));
      if (!clickReady && !textReady && !scrollReady && candidates.length > 0) targetNotice = '本次没有可辨认标签的 AX 操作控件，请勿按 AX 树或列表位置猜测 elementId；computer.input 以 availableInputOperations 为准。';
      const inputAfter = await checkInput();
      signal.throwIfAborted();
      if (!share.active) throw new Error('窗口共享已结束');
      const availableInputOperations = !inputBlocked && inputBefore?.ready && inputAfter?.ready && inputBefore.profile && inputBefore.profile === inputAfter.profile
        ? inputAfter.operations.filter(operation => inputOperations.includes(operation) && inputBefore.operations.includes(operation)
          && (operation !== 'typeText' || typeof inputBefore.focusToken === 'string'
            && /^[a-f0-9]{64}$/u.test(inputBefore.focusToken) && inputBefore.focusToken === inputAfter.focusToken)
          && (mode === 'both' || operation === 'shortcut' || operation === 'typeText')
          && (!unconfirmedIndicatorExit || operation === 'shortcut' || operation === 'typeText')) : [];
      const publish = (attachment?: AgentAttachment): AgentToolResult => {
        const observation: Observation = { id: crypto.randomUUID(), targetId: action.targetId, window, operations: [...observedOperations],
          inputOperations: [...inputOperations], availableInputOperations,
          ...(availableInputOperations.length ? { inputProfile: inputAfter!.profile } : {}), mode,
          ...(availableInputOperations.includes('typeText') ? { inputFocusToken: inputAfter!.focusToken } : {}),
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
            operations: candidateOperations(candidate).filter(operation => observedOperations.includes(operation)),
            ...(candidate.description ? { description: candidate.description } : {}),
            ...(candidate.subrole ? { subrole: candidate.subrole } : {}) };
        }),
        ...observation.firstPartyElements.map(({ elementId, control }) => ({ elementId, role: control.snapshot.state.kind === 'text' ? 'textbox' : 'scroll-region',
          label: FIRST_PARTY_CONTROL_LABELS[control.snapshot.controlId], source: 'omniflow-control',
          ...(attachment ? { screenshotBounds: screenshotBounds(control, window, attachment.width!, attachment.height!) } : {}),
          operations: control.snapshot.operations.filter(operation => observedOperations.includes(operation)) }))];
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
            notice: '差异仅描述两次有界观察；未再观察到不等于控件已删除，差异记录不能用于操作。AX 操作只使用本次 elements；computer.input 以 availableInputOperations 为准。',
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
          ...(attachment ? { imageId: attachment.id, screenshotWidth: attachment.width, screenshotHeight: attachment.height,
            cursorPresentation: 'native-window', cursorIncluded } : {}),
          observationId: observation.id, capturedAt: new Date(capturedAt).toISOString(),
          expiresInMs: Math.max(0, OBSERVATION_TTL_MS - (now() - capturedAt)),
          clickReady, textReady, scrollReady, operations: [...observedOperations], coordinateClickReady, candidateScanComplete, scopeScanComplete,
          inputReady: availableInputOperations.length > 0, inputOperations: [...inputOperations], availableInputOperations,
          ...(unconfirmedIndicatorExit ? { inputNotice: UNCONFIRMED_WINDOW_INDICATOR_CLOSE_NOTICE }
            : inputBlocked ? { inputNotice: UNCONFIRMED_INPUT_RELEASE_NOTICE }
            : inputOperations.length ? { inputNotice: windowInputNotice(availableInputOperations.length ? inputAfter : inputAfter?.ready ? undefined : inputAfter) } : {}),
          scope: scope ? { kind: 'element-ancestor', ancestorLevels: scope.ancestorLevels } : { kind: 'window' },
          clickMethod: 'AXPress', observationSource: mode === 'ax' ? 'ax' : 'screenshot', ...page,
          elementsScope: observation.firstPartyElements.length ? 'stable-window-controls' : 'stable-AX-controls', ...summary, ...changeData,
          ...(unconfirmedIndicatorExit ? { notice: UNCONFIRMED_WINDOW_INDICATOR_CLOSE_NOTICE }
            : !coordinateClickReady ? { notice: scope
            ? `本次只读取原生控件${scope.ancestorLevels ? `向上 ${scope.ancestorLevels} 级的父区域` : '自身区域'}的 AX；${scopeScanComplete ? '区域内控件扫描完整' : '区域内控件扫描不完整'}，不代表全窗口完整或唯一。${hasScreenshot ? '截图仍是获准整窗口。' : ''}AX 工具只使用本次明确标签的 elementId 和 operations；computer.click 不提供坐标点击。`
            : mode === 'screenshot'
            ? '本次仅取得窗口图片，没有读取控件或签发动作 ID。需要操作时重新以 ax 或 both 模式观察。'
            : usableFirstParty.length
              ? hasScreenshot
                ? '第一方控件仅支持各自 operations 中列出的文字或滚动操作；请核对固定标签与截图。AX 扫描与坐标点击能力独立。'
                : '第一方控件按固定标签辨认，只支持各自 operations。其他没有明确名称的区域须用 both 模式结合截图确认。'
              : accessibilityAvailable
                ? mode === 'ax'
                  ? `${!candidateScanComplete ? '控件扫描不完整，未列出不代表不存在。' : ''}AX 工具仅使用本次 elements 中准确标签的 elementId 和声明操作；computer.click 不提供坐标点击。computer.input 以 availableInputOperations 为准；匿名或对应不明的区域请用 both 模式核对截图。`
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
      return withPointerPreview(preparation, observation,
        { window: observation.window, operation: 'click', point: { x: point.x, y: point.y } }, signal, async () => {
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
  async function prepareInput(input: { observationId: string; operation: WindowInputOperation; shortcut?: unknown;
    point?: unknown; endPoint?: unknown; durationMs?: number; text?: string; deltaX?: number; deltaY?: number }, context: AgentToolMainPreparationContext): Promise<AgentToolMainPreparationResult> {
    context.signal.throwIfAborted();
    requireConfirmedInputRelease(context.preparationIdentity.runId);
    requireConfirmedInputSessionExit();
    const observation = observationFor(context.preparationIdentity, input.observationId);
    const validatedText = input.operation === 'typeText' ? validateComputerText(input.text, 'insert') : undefined;
    const { text: _text, ...publicInput } = input;
    void _text;
    if (input.operation !== 'typeText' && Object.prototype.hasOwnProperty.call(input, 'text')) throw new Error('后台输入包含不适用的文字字段');
    const publicAction = normalizeAgentPreparedActionPublic({ ...publicInput, ...(validatedText
      ? { textLength: validatedText.textLength, textBytes: validatedText.textBytes } : {}), kind: 'computer.input', version: 1,
      libraryId: context.preparationIdentity.libraryId, targetId: observation.targetId,
      applicationLabel: observation.window.applicationLabel, windowLabel: observation.window.windowLabel });
    if (publicAction.kind === 'computer.input' && publicAction.operation !== 'shortcut' && publicAction.operation !== 'typeText') requireConfirmedIndicatorExit();
    if (publicAction.kind !== 'computer.input' || !dependencies.input || !dependencies.inputStatus
      || !observation.inputOperations.includes(publicAction.operation)
      || !observation.availableInputOperations.includes(publicAction.operation)) throw new Error('本次观察未提供且未获准此后台输入能力');
    const request = createWindowInputRequest(publicAction, observation, validatedText?.text);
    return { publicAction, binding: { window: structuredClone(observation.window), targetId: observation.targetId, request },
      decision: { behavior: 'allow', risk: 'write' } };
  }
  async function input(preparation: AgentToolMainPreparedExecution, signal: AbortSignal,
    commit?: AgentMainCommitSettlement): Promise<AgentToolResult> {
    return serial(signal, async () => {
      const action = normalizeAgentPreparedActionPublic(preparation.publicAction);
      if (action.kind !== 'computer.input' || !commit || !dependencies.inputStatus || !dependencies.input) throw new Error('后台输入缺少当前受控执行身份');
      if (action.operation !== 'shortcut' && action.operation !== 'typeText') requireConfirmedIndicatorExit();
      requireConfirmedInputRelease(preparation.identity.runId);
      requireConfirmedInputSessionExit();
      const observation = observationFor(preparation.identity, action.observationId);
      const inputShare = shares.get(preparation.identity.runId);
      await boundWindow(preparation, signal);
      if (action.libraryId !== preparation.identity.libraryId || action.targetId !== observation.targetId
        || action.targetId !== preparation.binding.targetId || action.applicationLabel !== observation.window.applicationLabel
        || action.windowLabel !== observation.window.windowLabel || !observation.inputOperations.includes(action.operation)
        || !observation.availableInputOperations.includes(action.operation)) throw new Error('后台输入与本次窗口许可不匹配');
      const request = createWindowInputRequest(action, observation,
        action.operation === 'typeText' ? (preparation.binding.request as AgentComputerWindowInputRequest | undefined)?.text : undefined);
      if (JSON.stringify(request) !== JSON.stringify(preparation.binding.request)) throw new Error('后台输入与已准备的窗口、坐标或接收者不匹配');
      const status = await dependencies.inputStatus(observation.window, signal);
      signal.throwIfAborted();
      if (!status.ready || status.profile !== request.profile || !status.operations.includes(action.operation)) throw new Error(windowInputNotice(status));
      if (action.operation === 'typeText' && status.focusToken !== request.focusToken) throw new Error('获准窗口的文字接收控件已变化，请重新观察后再输入');
      await boundWindow(preparation, signal);
      signal.throwIfAborted();
      if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口观察已变化，后台输入未发送');
      const { kind: _kind, version: _version, operation: inputOperation, ...publicIdentity } = action;
      void _kind; void _version;
      const receipt = (state: 'dispatched' | 'not-dispatched' | 'unknown', releaseState: 'confirmed' | 'unconfirmed' | 'not-required', eventCount?: number): AgentToolResult => ({
        ok: state === 'dispatched', message: state === 'dispatched' ? '后台输入已投递，请重新观察确认结果'
          : state === 'not-dispatched' ? '后台输入未发送，请重新观察' : '后台输入结果未知，请重新观察，勿重复操作',
        data: { ...publicIdentity, operation: 'computer.input', inputOperation, operationId: preparation.identity.toolRunId,
          dispatchState: state, mutationCommitState: state === 'dispatched' ? 'committed' : state === 'not-dispatched' ? 'uncommitted' : 'commit_unknown',
          inputMethod: 'CGEventPostToPid', releaseState, ...(eventCount === undefined ? {} : { eventCount }), nextAction: 'observe', retryAllowed: false },
      });
      const hasPoint = request.operation !== 'shortcut' && request.operation !== 'typeText';
      return withPointerPreview(preparation, observation, !hasPoint ? undefined : {
        window: observation.window, operation: request.operation === 'scroll' ? 'click' : request.operation as 'click' | 'rightClick' | 'doubleClick' | 'drag', point: request.point!,
        ...(request.endPoint ? { endPoint: request.endPoint } : {}),
      }, signal, async () => {
        if (hasPoint && dependencies.indicatePointer) {
          const current = await dependencies.inputStatus!(observation.window, signal);
          signal.throwIfAborted();
          if (!current.ready || current.profile !== request.profile || !current.operations.includes(action.operation)) throw new Error(windowInputNotice(current));
          await boundWindow(preparation, signal);
          if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口观察已变化，此次操作未发送');
        }
        if (hasPoint) {
          requireConfirmedIndicatorExit();
          if (closingIndicators.size) throw new Error('上一鼠标图案仍在收起，请重新观察后再操作');
        }
        // All generic input shares the focus owner's process identity. A new
        // helper's keyboard events would look foreign to the retained owner's
        // theft filter and could be redirected to the user's foreground app.
        // Open before the mutation boundary; never fall back after failure.
        const useSession = request.profile === 'directed-v1' && dependencies.inputSession;
        const session = useSession
          ? inputShare && await inputSessionFor(inputShare, observation.window, signal) : undefined;
        if (!useSession) {
          // Legacy receivers still use their dedicated one-shot route. It
          // must not overlap another Run's retained synthetic focus owner.
          for (const share of shares.values()) closeInputSession(share);
          await Promise.all(closingInputs);
        }
        signal.throwIfAborted();
        requireConfirmedInputSessionExit();
        if (useSession && !session) {
          throw new Error('后台输入缺少当前窗口会话');
        }
        await boundWindow(preparation, signal);
        if (observationFor(preparation.identity, action.observationId) !== observation) throw new Error('窗口观察已变化，后台输入未发送');
        commit.begin(receipt('unknown', 'unconfirmed'));
        observation.consumed = true;
        let result: AgentToolResult;
        const visual = hasPoint && inputShare ? activeIndicators.get(inputShare) : undefined;
        let inputActive = true;
        try {
          const onPointerEvent = visual?.lease?.pointerEvent && hasPoint && request.operation !== 'scroll'
            ? (event: AgentComputerWindowInputPointerEvent) => {
              if (!inputActive || signal.aborted || !inputShare?.active || activeIndicators.get(inputShare) !== visual || !visual.lease?.shown) return;
              // The native input runner reports only after posting; this is a
              // visual projection, never authorization or a consumption ACK.
              try { visual.lease.pointerEvent?.({ phase: event.phase, point: event.point }); }
              catch { visual.stop(); }
            } : undefined;
          const sent = session ? onPointerEvent ? await session.input(request, signal, onPointerEvent) : await session.input(request, signal)
            : onPointerEvent ? await dependencies.input!(request, signal, onPointerEvent)
              : await dependencies.input!(request, signal);
          result = receipt('dispatched', 'confirmed', sent.eventCount);
        } catch (error) {
          const state = error instanceof AgentComputerInputError && error.dispatchState === 'not-dispatched' ? 'not-dispatched' : 'unknown';
          const releaseState = error instanceof AgentComputerWindowInputError ? error.releaseState : state === 'not-dispatched' ? 'not-required' : 'unconfirmed';
          result = receipt(state, releaseState);
          if (releaseState === 'unconfirmed') {
            // releaseRun may have already disposed this share while the helper was finishing.
            if (shares.get(preparation.identity.runId) === inputShare) inputBlockedRuns.add(preparation.identity.runId);
            result.message += `；${UNCONFIRMED_INPUT_RELEASE_NOTICE}`;
            if (inputShare) await closePointer(inputShare);
          }
        } finally {
          inputActive = false;
          if (visual?.lease?.shown && inputShare?.active && activeIndicators.get(inputShare) === visual) {
            // Best-effort feedback may lose an up. Restore only drawing state;
            // the authoritative dispatch/release receipt above stays unchanged.
            try { visual.lease.inputSettled?.(); } catch { visual.stop(); }
          }
        }
        commit.settle(result);
        return result;
      });
    });
  }
  function releaseRun(runId: string, mode: 'normal' | 'immediate' = 'immediate'): Promise<void> {
    const share = shares.get(runId);
    if (share) deactivateShare(share, mode);
    const pointer = share && activeIndicators.get(share);
    // Execution is revoked synchronously. Retain only the inactive share's
    // existing cleanup reference so abort can upgrade a normal fade to dispose.
    if (mode === 'immediate' || !pointer) shares.delete(runId);
    pendingTargets.delete(runId);
    inputBlockedRuns.delete(runId);
    discovery.releaseRun(runId);
    // A replaced share can still own a closing surface even when the current
    // share has no pointer. Await the existing global cleanup barrier too.
    // These receipts resolve to booleans; unknown exits stay blocked separately.
    return Promise.all([...closingIndicators, ...closingMenus, ...openingMenus, ...closingInputs, ...openingInputs]).then(() => {
      if (shares.get(runId) === share) shares.delete(runId);
    });
  }
  return { prepareWindows, windows, prepareObserve, prepareClick, prepareSetText, prepareScroll, prepareInput, prepareMenu, observe, click, setText, scroll, input, menu, hidePointerForRun, releaseRun };
}
