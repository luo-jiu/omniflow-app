import crypto from 'node:crypto';
import { app, screen } from 'electron';
import type { BrowserWindow } from 'electron';
import { AgentComputerInputError, getAgentComputerParentActivity } from '../../../platform/computer-use';
import type { AgentComputerSharedWindow } from '../../../platform/computer-use';
import type { AgentToolMainPreparationIdentity } from '../agent-tool-registry';
import type { ComputerElementOperation } from '../../../../src/shared/computer-use/computer-use-contract';
import { normalizeFirstPartyControlContext, normalizeFirstPartyControlRequest, normalizeFirstPartyControlResponse,
  normalizeFirstPartyRegistration, normalizeFirstPartyRegistrationToken,
  type FirstPartyBoundControl, type FirstPartyControlContext, type FirstPartyControlRequest,
  type FirstPartyControlResponse, type FirstPartyControlSnapshot, type FirstPartyRegistrationToken } from '../../../../src/shared/computer-use/first-party-control-contract';

const REQUEST_CHANNEL = 'agent:computer-controls:requested';
const REQUEST_TIMEOUT_MS = 5_000;

interface ControlFrame {
  processId: number;
  routingId: number;
  send(channel: string, request: FirstPartyControlRequest): void;
}
interface ControlContents {
  id: number;
  mainFrame: ControlFrame;
  isDestroyed(): boolean;
  getZoomFactor(): number;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}
interface ControlWindow {
  webContents: ControlContents;
  isDestroyed(): boolean;
  isFocused(): boolean;
  getMediaSourceId(): string;
  getContentBounds(): { x: number; y: number; width: number; height: number };
}
interface Registration extends FirstPartyRegistrationToken {
  instanceId: string;
  context: FirstPartyControlContext;
  frame: ControlFrame;
  frameProcessId: number;
  frameRoutingId: number;
}
interface Owner {
  contents: ControlContents;
  documentGeneration: string;
  registration?: Registration;
  cleanup: () => void;
}
interface Pending {
  owner: Owner;
  registration: Registration;
  request: FirstPartyControlRequest;
  sent: boolean;
  finish: (response?: FirstPartyControlResponse) => void;
}
interface Endpoint {
  targetFocused?: boolean;
  applicationFocused?: boolean;
  nativeApplicationFocused?: boolean;
  pointer?: { x: number; y: number };
}
interface ScrollGeometry {
  top: number;
  clientHeight: number;
  scrollHeight: number;
}
export interface FirstPartyVerifyRejectedDiagnostic {
  available: boolean;
  revisionChanged: boolean;
  boundsChanged: boolean;
  stateChanged: boolean;
  operationsChanged: boolean;
  registrationChanged: boolean;
  scrollBefore?: ScrollGeometry;
  scrollAfter?: ScrollGeometry;
}
export interface FirstPartyControlsDependencies {
  processId: number;
  getMainWindow(): ControlWindow | null | undefined;
  cursor(): { x: number; y: number };
  applicationFocused?(): boolean | undefined;
  /** Debug-only, read-only native query with its own bounded timeout. No cached fallback. */
  nativeApplicationFocused?(signal: AbortSignal): Promise<boolean | undefined>;
  log?(data: { focusKnownBefore: boolean; focusKnownAfter: boolean; targetFocusedBefore: boolean;
    targetFocusedAfter: boolean; applicationFocusKnownBefore: boolean; applicationFocusKnownAfter: boolean;
    applicationFocusedBefore: boolean; applicationFocusedAfter: boolean;
    nativeApplicationFocusKnownBefore: boolean; nativeApplicationFocusKnownAfter: boolean;
    nativeApplicationFocusedBefore: boolean; nativeApplicationFocusedAfter: boolean;
    pointerKnownBefore: boolean; pointerKnownAfter: boolean; pointerMoved: boolean }): void;
  verifyRejectedDiagnostic?(data: FirstPartyVerifyRejectedDiagnostic): void;
  now?: () => number;
  createId?: () => string;
  timeoutMs?: number;
}
function sameContext(left: FirstPartyControlContext, right: FirstPartyControlContext): boolean {
  return left.libraryId === right.libraryId && left.sessionId === right.sessionId
    && left.ownerScope.accountScope === right.ownerScope.accountScope && left.ownerScope.backendScope === right.ownerScope.backendScope;
}
function contextFor(identity: AgentToolMainPreparationIdentity): FirstPartyControlContext {
  return normalizeFirstPartyControlContext({ ownerScope: identity.ownerScope, libraryId: identity.libraryId, sessionId: identity.sessionId });
}
function sameFrame(left: ControlFrame, right: ControlFrame | null | undefined): boolean {
  return !!right && left === right && left.processId === right.processId && left.routingId === right.routingId;
}
function inputError(unknown: boolean): AgentComputerInputError {
  return new AgentComputerInputError(unknown ? '第一方控件操作结果不确定，请重新查看窗口，勿重复操作' : '第一方控件引用已失效，此次操作未发送',
    unknown ? 'unknown' : 'not-dispatched');
}

/** Ephemeral transport only. Run authorization and commit settlement stay in computer runtime. */
export function createAgentFirstPartyControls(dependencies: FirstPartyControlsDependencies) {
  const now = dependencies.now || Date.now;
  const createId = dependencies.createId || crypto.randomUUID;
  const timeoutMs = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, dependencies.timeoutMs || REQUEST_TIMEOUT_MS));
  const owners = new Map<number, Owner>();
  const pending = new Map<string, Pending>();

  function trustedOwner(contentsId: number): ControlWindow | undefined {
    const window = dependencies.getMainWindow();
    return window && !window.isDestroyed() && !window.webContents.isDestroyed()
      && window.webContents.id === contentsId ? window : undefined;
  }
  function invalidate(owner: Owner): void {
    owner.registration = undefined;
    owner.documentGeneration = createId();
    for (const entry of [...pending.values()]) if (entry.owner === owner) entry.finish();
  }
  function releaseOwner(contentsId: number): void {
    const owner = owners.get(contentsId);
    if (!owner) return;
    invalidate(owner);
    owner.cleanup();
    owners.delete(contentsId);
  }
  function ensureOwner(contents: ControlContents): Owner {
    const existing = owners.get(contents.id);
    if (existing && existing.contents === contents) return existing;
    if (existing) releaseOwner(contents.id);
    const navigation = (...args: unknown[]) => {
      const details = args[0] as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined;
      const isMainFrame = details?.isMainFrame ?? args[3];
      const isSameDocument = details?.isSameDocument ?? args[2];
      // HashRouter/pushState retains the document; renderer context cleanup still releases scope/session changes.
      if (isMainFrame === true && isSameDocument !== true) invalidate(owner);
    };
    const destroyed = () => releaseOwner(contents.id);
    const gone = () => invalidate(owner);
    const owner: Owner = { contents, documentGeneration: createId(), cleanup: () => {
      contents.removeListener('did-start-navigation', navigation);
      contents.removeListener('render-process-gone', gone);
      contents.removeListener('destroyed', destroyed);
    } };
    contents.on('did-start-navigation', navigation);
    contents.on('render-process-gone', gone);
    contents.on('destroyed', destroyed);
    owners.set(contents.id, owner);
    return owner;
  }
  function register(sender: ControlContents, frame: ControlFrame | null, input: unknown): FirstPartyRegistrationToken {
    const window = trustedOwner(sender.id);
    if (!window || window.webContents !== sender || !sameFrame(sender.mainFrame, frame)) throw inputError(false);
    const data = normalizeFirstPartyRegistration(input);
    const owner = ensureOwner(sender);
    invalidate(owner);
    owner.registration = { ...data, registrationId: createId(), documentGeneration: owner.documentGeneration,
      frame: sender.mainFrame, frameProcessId: sender.mainFrame.processId, frameRoutingId: sender.mainFrame.routingId };
    return { registrationId: owner.registration.registrationId, documentGeneration: owner.documentGeneration };
  }
  function matchingRegistration(owner: Owner, token: FirstPartyRegistrationToken): Registration {
    const registration = owner.registration;
    const window = trustedOwner(owner.contents.id);
    if (!registration || !window || window.webContents !== owner.contents
      || registration.registrationId !== token.registrationId || registration.documentGeneration !== token.documentGeneration
      || owner.documentGeneration !== token.documentGeneration || !sameFrame(registration.frame, owner.contents.mainFrame)
      || registration.frameProcessId !== owner.contents.mainFrame.processId || registration.frameRoutingId !== owner.contents.mainFrame.routingId) throw inputError(false);
    return registration;
  }
  function unregister(senderId: number, frame: ControlFrame | null, input: unknown): boolean {
    const token = normalizeFirstPartyRegistrationToken(input);
    const owner = owners.get(senderId);
    if (!owner || !sameFrame(owner.contents.mainFrame, frame)) throw inputError(false);
    // StrictMode cleanup may arrive after a replacement registration. It cannot release that replacement.
    if (owner.registration?.registrationId !== token.registrationId || owner.documentGeneration !== token.documentGeneration) return false;
    matchingRegistration(owner, token);
    invalidate(owner);
    return true;
  }
  function complete(senderId: number, frame: ControlFrame | null, input: unknown): boolean {
    const response = normalizeFirstPartyControlResponse(input);
    const entry = pending.get(response.requestId);
    if (!entry || entry.owner.contents.id !== senderId || !sameFrame(entry.registration.frame, frame)
      || matchingRegistration(entry.owner, response) !== entry.registration) throw inputError(false);
    if (now() >= entry.request.expiresAt) { entry.finish(); throw inputError(false); }
    const allowed = entry.request.kind === 'observe' ? ['observed', 'rejected']
      : entry.request.kind === 'verify' ? ['verified', 'rejected'] : ['applied', 'rejected', 'unknown'];
    if (!allowed.includes(response.status)) throw inputError(false);
    entry.finish(response);
    return true;
  }
  function ownWindow(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity): ControlWindow | undefined {
    if (window.pid !== dependencies.processId || window.layer !== 0) return undefined;
    const owner = trustedOwner(identity.ownerWebContentsId);
    const nativeId = owner && /^window:([1-9][0-9]*):[0-9]+$/u.exec(owner.getMediaSourceId());
    return owner && nativeId && Number(nativeId[1]) === window.windowId ? owner : undefined;
  }
  function mappedBounds(window: AgentComputerSharedWindow, owner: ControlWindow, snapshot: FirstPartyControlSnapshot) {
    const content = owner.getContentBounds();
    const zoom = owner.webContents.getZoomFactor();
    const rect = snapshot.bounds;
    if (![content.x, content.y, content.width, content.height, zoom].every(Number.isFinite)
      || zoom <= 0 || content.width <= 0 || content.height <= 0 || rect.x * zoom + rect.width * zoom > content.width
      || rect.y * zoom + rect.height * zoom > content.height) throw inputError(false);
    const bounds = { x: content.x + rect.x * zoom, y: content.y + rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom };
    const frozen = window.bounds;
    if (bounds.x < frozen.x || bounds.y < frozen.y || bounds.x + bounds.width > frozen.x + frozen.width
      || bounds.y + bounds.height > frozen.y + frozen.height) throw inputError(false);
    return bounds;
  }
  function request(owner: Owner, registration: Registration, identity: AgentToolMainPreparationIdentity,
    operation: { kind: 'observe' } | { kind: 'verify' | 'dispatch'; snapshot: FirstPartyControlSnapshot; operation: ComputerElementOperation; text?: string },
    signal: AbortSignal): Promise<FirstPartyControlResponse> {
    if (signal.aborted || !sameContext(registration.context, contextFor(identity))) return Promise.reject(inputError(false));
    const payload = normalizeFirstPartyControlRequest({ ...operation, requestId: createId(), registrationId: registration.registrationId,
      documentGeneration: registration.documentGeneration, context: contextFor(identity), runId: identity.runId, expiresAt: now() + timeoutMs });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (response?: FirstPartyControlResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        pending.delete(payload.requestId);
        if (response) resolve(response);
        else reject(inputError(entry.sent && payload.kind === 'dispatch'));
      };
      const cancelled = () => finish();
      const entry: Pending = { owner, registration, request: payload, sent: false, finish };
      const timer = setTimeout(cancelled, timeoutMs);
      timer.unref?.();
      pending.set(payload.requestId, entry);
      signal.addEventListener('abort', cancelled, { once: true });
      try {
        if (signal.aborted || matchingRegistration(owner, registration) !== registration) { finish(); return; }
        // A throw from send does not prove the renderer did not receive a mutation.
        entry.sent = true;
        registration.frame.send(REQUEST_CHANNEL, payload);
      } catch { finish(); }
    });
  }
  async function observe(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity, signal: AbortSignal): Promise<{
    registrationId: string; documentGeneration: string; controls: FirstPartyBoundControl[];
  } | undefined> {
    const target = ownWindow(window, identity);
    const owner = target && owners.get(identity.ownerWebContentsId);
    const registration = owner?.registration;
    if (!target || !owner || !registration || !sameContext(registration.context, contextFor(identity))) return undefined;
    matchingRegistration(owner, registration);
    const response = await request(owner, registration, identity, { kind: 'observe' }, signal);
    if (response.status !== 'observed') throw inputError(false);
    matchingRegistration(owner, registration);
    if (ownWindow(window, identity) !== target) throw inputError(false);
    return { registrationId: registration.registrationId, documentGeneration: registration.documentGeneration,
      controls: response.controls.map(snapshot => ({ registrationId: registration.registrationId, documentGeneration: registration.documentGeneration,
        snapshot, bounds: mappedBounds(window, target, snapshot) })) };
  }
  function boundRegistration(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity, bound: FirstPartyBoundControl) {
    const target = ownWindow(window, identity);
    const owner = target && owners.get(identity.ownerWebContentsId);
    if (!target || !owner) throw inputError(false);
    const registration = matchingRegistration(owner, bound);
    if (!sameContext(registration.context, contextFor(identity))
      || JSON.stringify(mappedBounds(window, target, bound.snapshot)) !== JSON.stringify(bound.bounds)) throw inputError(false);
    return { target, owner, registration };
  }
  async function diagnoseRejectedVerification(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity,
    bound: FirstPartyBoundControl, signal: AbortSignal): Promise<void> {
    if (!dependencies.verifyRejectedDiagnostic) return;
    let current: FirstPartyBoundControl | undefined;
    try {
      const observed = await observe(window, identity, signal);
      current = observed?.controls.find(control => control.snapshot.controlId === bound.snapshot.controlId);
    } catch { /* One read-only diagnostic failure cannot change the original rejection. */ }
    const before = bound.snapshot;
    const after = current?.snapshot;
    const registration = owners.get(identity.ownerWebContentsId)?.registration;
    const scrollGeometry = (snapshot: FirstPartyControlSnapshot | undefined): ScrollGeometry | undefined =>
      snapshot?.state.kind === 'scroll' ? { top: snapshot.state.top, clientHeight: snapshot.state.clientHeight,
        scrollHeight: snapshot.state.scrollHeight } : undefined;
    const scrollBefore = scrollGeometry(before);
    const scrollAfter = scrollGeometry(after);
    const data: FirstPartyVerifyRejectedDiagnostic = { available: !!current,
      revisionChanged: !!after && after.revision !== before.revision,
      boundsChanged: !!current && (JSON.stringify(current.bounds) !== JSON.stringify(bound.bounds)
        || JSON.stringify(after?.bounds) !== JSON.stringify(before.bounds)),
      stateChanged: !!after && JSON.stringify(after.state) !== JSON.stringify(before.state),
      operationsChanged: !!after && JSON.stringify(after.operations) !== JSON.stringify(before.operations),
      registrationChanged: registration?.registrationId !== bound.registrationId
        || registration?.documentGeneration !== bound.documentGeneration || !!after && after.instanceId !== before.instanceId,
      ...(scrollBefore ? { scrollBefore } : {}), ...(scrollAfter ? { scrollAfter } : {}) };
    try { dependencies.verifyRejectedDiagnostic(data); }
    catch { /* Diagnostics cannot replace the authoritative rejection. */ }
  }
  async function verify(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity, bound: FirstPartyBoundControl,
    operation: ComputerElementOperation, signal: AbortSignal): Promise<void> {
    const { owner, registration } = boundRegistration(window, identity, bound);
    const response = await request(owner, registration, identity, { kind: 'verify', snapshot: bound.snapshot, operation }, signal);
    if (response.status !== 'verified') {
      if (response.status === 'rejected') {
        try { await diagnoseRejectedVerification(window, identity, bound, signal); }
        catch { /* The diagnostic cannot change a definite rejection, including while formatting it. */ }
      }
      throw inputError(false);
    }
    boundRegistration(window, identity, bound);
  }
  function endpoint(target: ControlWindow): Endpoint {
    let targetFocused: boolean | undefined;
    let applicationFocused: boolean | undefined;
    let pointer: Endpoint['pointer'];
    try { targetFocused = target.isFocused(); } catch { /* diagnostics only */ }
    try { applicationFocused = dependencies.applicationFocused?.(); } catch { /* diagnostics only */ }
    try { pointer = dependencies.cursor(); } catch { /* diagnostics only */ }
    return { targetFocused, applicationFocused, pointer };
  }
  async function nativeActivity(signal: AbortSignal): Promise<boolean | undefined> {
    try { return await dependencies.nativeApplicationFocused?.(signal); }
    catch { return undefined; /* Optional diagnostics cannot change the authoritative dispatch. */ }
  }
  async function dispatch(window: AgentComputerSharedWindow, identity: AgentToolMainPreparationIdentity, bound: FirstPartyBoundControl,
    operation: ComputerElementOperation, text: string | undefined, signal: AbortSignal): Promise<void> {
    let { target, owner, registration } = boundRegistration(window, identity, bound);
    let nativeBefore: boolean | undefined;
    if (dependencies.nativeApplicationFocused) {
      nativeBefore = await nativeActivity(signal);
      // Diagnostic latency cannot retain a stale window, frame or registration capability.
      ({ target, owner, registration } = boundRegistration(window, identity, bound));
    }
    const before = endpoint(target);
    before.nativeApplicationFocused = nativeBefore;
    try {
      const response = await request(owner, registration, identity,
        { kind: 'dispatch', snapshot: bound.snapshot, operation, ...(text === undefined ? {} : { text }) }, signal);
      if (response.status !== 'applied') throw inputError(response.status !== 'rejected');
    } finally {
      const after = endpoint(target);
      if (dependencies.nativeApplicationFocused) {
        // A cancelled Run still gets a bounded read-only endpoint; never reuse its aborted signal.
        after.nativeApplicationFocused = await nativeActivity(new AbortController().signal);
      }
      try { dependencies.log?.({ focusKnownBefore: before.targetFocused !== undefined, focusKnownAfter: after.targetFocused !== undefined,
        targetFocusedBefore: before.targetFocused === true, targetFocusedAfter: after.targetFocused === true,
        applicationFocusKnownBefore: before.applicationFocused !== undefined, applicationFocusKnownAfter: after.applicationFocused !== undefined,
        applicationFocusedBefore: before.applicationFocused === true, applicationFocusedAfter: after.applicationFocused === true,
        nativeApplicationFocusKnownBefore: before.nativeApplicationFocused !== undefined,
        nativeApplicationFocusKnownAfter: after.nativeApplicationFocused !== undefined,
        nativeApplicationFocusedBefore: before.nativeApplicationFocused === true,
        nativeApplicationFocusedAfter: after.nativeApplicationFocused === true,
        pointerKnownBefore: !!before.pointer, pointerKnownAfter: !!after.pointer,
        pointerMoved: !!before.pointer && !!after.pointer && (before.pointer.x !== after.pointer.x || before.pointer.y !== after.pointer.y) }); }
      catch { /* Diagnostics cannot replace the authoritative receipt. */ }
    }
  }
  function releaseRun(runId: string): void {
    for (const entry of [...pending.values()]) if (entry.request.runId === runId) entry.finish();
  }
  return Object.freeze({ register, unregister, complete, releaseOwner, observe, verify, dispatch, releaseRun });
}

let getTrustedMainWindow: () => BrowserWindow | null = () => null;
let observedApplicationFocus: boolean | undefined;
try {
  // App activity has no isFocused getter in Electron; absence of an event remains unknown.
  app.on('did-become-active', () => { observedApplicationFocus = true; });
  app.on('did-resign-active', () => { observedApplicationFocus = false; });
} catch { /* Optional diagnostics cannot prevent startup in a non-Electron test environment. */ }
export function configureAgentFirstPartyControls(getMainWindow: () => BrowserWindow | null): void {
  getTrustedMainWindow = getMainWindow;
}
export const agentFirstPartyControls = createAgentFirstPartyControls({ processId: process.pid,
  getMainWindow: () => getTrustedMainWindow(), cursor: () => screen.getCursorScreenPoint(), applicationFocused: () => observedApplicationFocus,
  log: data => console.info('first-party-control-dispatch', data),
  ...(process.env.OMNIFLOW_COMPUTER_CONTROLS_DEBUG === '1'
    ? { nativeApplicationFocused: getAgentComputerParentActivity,
      verifyRejectedDiagnostic: (data: FirstPartyVerifyRejectedDiagnostic) => console.info('first-party-control-verify-rejected', data) } : {}) });
