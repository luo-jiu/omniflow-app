import crypto from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { normalizeWorkspaceRenderingRegistration, normalizeWorkspaceRenderingRegistrationToken,
  type WorkspaceRenderingRegistrationInput, type WorkspaceRenderingRegistrationToken } from '../../../../src/shared/computer-use/workspace-rendering-contract';
import { agentRenderingLeases } from './agent-computer-rendering-service-runtime';

interface WorkspaceFrame { processId: number; routingId: number }
interface WorkspaceContents {
  id: number;
  mainFrame: WorkspaceFrame;
  isDestroyed(): boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}
interface WorkspaceWindow { webContents: WorkspaceContents; isDestroyed(): boolean }
interface Registration extends WorkspaceRenderingRegistrationInput, WorkspaceRenderingRegistrationToken {
  frame: WorkspaceFrame;
  frameProcessId: number;
  frameRoutingId: number;
  releaseRendering: () => void;
}
interface Owner {
  contents: WorkspaceContents;
  documentRevision: number;
  registration?: Registration;
  cleanup: () => void;
}
interface WorkspaceRenderingDependencies {
  getMainWindow(): WorkspaceWindow | null | undefined;
  keepOwnerRendering(contentsId: number): () => void;
  createId?: () => string;
}
function invalidOwner(): Error { return new Error('Agent 工作区绘制窗口已失效'); }
function sameFrame(left: WorkspaceFrame, right: WorkspaceFrame | null | undefined): boolean {
  return !!right && left === right && left.processId === right.processId && left.routingId === right.routingId;
}
function releaseOnce(release: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { release(); }
    catch { /* Local drawing cleanup cannot interrupt owner or application cleanup. */ }
  };
}

/** Trusted visible Workspace policy only, independent of controls and Session/Run authorization. */
export function createAgentWorkspaceRendering(dependencies: WorkspaceRenderingDependencies) {
  const createId = dependencies.createId ?? crypto.randomUUID;
  const owners = new Map<number, Owner>();
  let shuttingDown = false;
  function trustedOwner(sender: WorkspaceContents): boolean {
    const window = dependencies.getMainWindow();
    return !!window && !window.isDestroyed() && !sender.isDestroyed()
      && window.webContents === sender && window.webContents.id === sender.id;
  }
  function invalidate(owner: Owner): void {
    owner.documentRevision += 1;
    const registration = owner.registration;
    owner.registration = undefined;
    registration?.releaseRendering();
  }
  function releaseOwner(contentsId: number): void {
    const owner = owners.get(contentsId);
    if (!owner) return;
    owners.delete(contentsId);
    invalidate(owner);
    owner.cleanup();
  }
  function ensureOwner(contents: WorkspaceContents): Owner {
    const previous = owners.get(contents.id);
    if (previous?.contents === contents) return previous;
    if (previous) releaseOwner(contents.id);
    const navigation = (...args: unknown[]) => {
      const details = args[0] as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined;
      const isMainFrame = details?.isMainFrame ?? args[3];
      const isSameDocument = details?.isSameDocument ?? args[2];
      if (isMainFrame === true && isSameDocument !== true) invalidate(owner);
    };
    const gone = () => invalidate(owner);
    const destroyed = () => { if (owners.get(contents.id) === owner) releaseOwner(contents.id); };
    const owner: Owner = { contents, documentRevision: 0, cleanup: () => {
      for (const [event, listener] of [['did-start-navigation', navigation], ['render-process-gone', gone],
        ['destroyed', destroyed]] as const) {
        try { contents.removeListener(event, listener); }
        catch { /* A closing contents cannot interrupt the remaining owner cleanup. */ }
      }
    } };
    try {
      contents.on('did-start-navigation', navigation);
      contents.on('render-process-gone', gone);
      contents.on('destroyed', destroyed);
      if (contents.isDestroyed()) throw invalidOwner();
      owners.set(contents.id, owner);
      return owner;
    } catch (error) {
      owner.cleanup();
      throw error;
    }
  }
  function register(sender: WorkspaceContents, frame: WorkspaceFrame | null, input: unknown): WorkspaceRenderingRegistrationToken {
    if (shuttingDown || !trustedOwner(sender) || !sameFrame(sender.mainFrame, frame)) throw invalidOwner();
    const data = normalizeWorkspaceRenderingRegistration(input);
    const token = normalizeWorkspaceRenderingRegistrationToken({ registrationId: createId(), documentGeneration: createId() });
    const owner = ensureOwner(sender);
    const boundFrame = sender.mainFrame;
    const frameProcessId = boundFrame.processId;
    const frameRoutingId = boundFrame.routingId;
    const documentRevision = owner.documentRevision;
    let releaseRendering: (() => void) | undefined;
    try {
      releaseRendering = releaseOnce(dependencies.keepOwnerRendering(sender.id));
      if (shuttingDown || owners.get(sender.id) !== owner || !trustedOwner(sender)
        || owner.documentRevision !== documentRevision
        || !sameFrame(sender.mainFrame, boundFrame) || boundFrame.processId !== frameProcessId
        || boundFrame.routingId !== frameRoutingId) throw invalidOwner();
      const previous = owner.registration;
      const registration: Registration = { ...data, ...token, frame: boundFrame, frameProcessId, frameRoutingId, releaseRendering };
      owner.registration = registration;
      // Acquire first so replacement/StrictMode never restores false as the original setting.
      previous?.releaseRendering();
      if (owner.registration !== registration) throw invalidOwner();
      return token;
    } catch (error) {
      releaseRendering?.();
      if (owners.get(sender.id) === owner && !owner.registration) releaseOwner(sender.id);
      throw error;
    }
  }
  function unregister(senderId: number, frame: WorkspaceFrame | null, input: unknown): boolean {
    const token = normalizeWorkspaceRenderingRegistrationToken(input);
    const owner = owners.get(senderId);
    if (!owner || !trustedOwner(owner.contents) || !sameFrame(owner.contents.mainFrame, frame)) throw invalidOwner();
    const registration = owner.registration;
    if (!registration || registration.registrationId !== token.registrationId
      || registration.documentGeneration !== token.documentGeneration) return false;
    if (!sameFrame(registration.frame, owner.contents.mainFrame)
      || registration.frameProcessId !== owner.contents.mainFrame.processId
      || registration.frameRoutingId !== owner.contents.mainFrame.routingId) throw invalidOwner();
    invalidate(owner);
    return true;
  }
  function shutdown(): void {
    shuttingDown = true;
    for (const id of [...owners.keys()]) releaseOwner(id);
  }
  return Object.freeze({ register, unregister, releaseOwner, shutdown });
}

let getTrustedMainWindow: () => BrowserWindow | null = () => null;
export function configureAgentWorkspaceRendering(getMainWindow: () => BrowserWindow | null): void {
  getTrustedMainWindow = getMainWindow;
}
export const agentWorkspaceRendering = createAgentWorkspaceRendering({
  getMainWindow: () => getTrustedMainWindow(), keepOwnerRendering: agentRenderingLeases.keepOwnerRendering,
});
