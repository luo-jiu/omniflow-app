import crypto from 'node:crypto';
import type { WebContents, WebFrameMain } from 'electron';
import type { AgentFileDiffCancelRequest, AgentFileDiffRequest, AgentFileDiffResult } from '../../../src/shared/agent/agent-file-changes';

interface Pending {
  frame: WebFrameMain;
  processId: number;
  routingId: number;
  scope: string;
  controller: AbortController;
  done: Promise<AgentFileDiffResult>;
}
const REQUEST_ID = /^[a-f0-9-]{36}$/u;
function scopeKey(input: AgentFileDiffRequest | AgentFileDiffCancelRequest) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('差异请求范围无效');
  return JSON.stringify([input.ownerScope?.backendScope, input.ownerScope?.accountScope, input.libraryId, input.sessionId]);
}

/** Read lifetimes only: does not own or mutate Run/ToolRun state. */
export function createAgentFileDiffRequests() {
  const owners = new Map<WebContents, { pending: Map<string, Pending>; detach: () => void }>();
  function detachIfEmpty(sender: WebContents) {
    const owner = owners.get(sender);
    if (owner && !owner.pending.size) { owner.detach(); owners.delete(sender); }
  }
  async function releaseOwner(sender: WebContents) {
    const owner = owners.get(sender);
    if (!owner) return;
    for (const request of owner.pending.values()) request.controller.abort();
    await Promise.allSettled([...owner.pending.values()].map(request => request.done));
    detachIfEmpty(sender);
  }
  function ownerFor(sender: WebContents) {
    let owner = owners.get(sender);
    if (!owner) {
      const release = () => { void releaseOwner(sender); };
      const navigation = (...args: unknown[]) => { if (args[3] === true) release(); };
      sender.on('destroyed', release);
      sender.on('render-process-gone', release);
      sender.on('did-start-navigation', navigation);
      owner = { pending: new Map(), detach: () => {
        sender.removeListener('destroyed', release);
        sender.removeListener('render-process-gone', release);
        sender.removeListener('did-start-navigation', navigation);
      } };
      owners.set(sender, owner);
    }
    return owner;
  }
  return {
    read(sender: WebContents, frame: WebFrameMain, input: AgentFileDiffRequest,
      execute: (signal: AbortSignal) => Promise<AgentFileDiffResult>): Promise<AgentFileDiffResult> {
      // Resolve request metadata before scheduling work or attaching owner listeners.
      // A failed registration must never leave an unreturned, untracked read promise.
      let metadata: Pick<Pending, 'frame' | 'processId' | 'routingId' | 'scope'>;
      try { metadata = { frame, processId: frame.processId, routingId: frame.routingId, scope: scopeKey(input) }; }
      catch { return Promise.reject(new Error('差异请求范围无效')); }
      const id = input?.requestId ?? crypto.randomUUID();
      if (typeof id !== 'string' || !REQUEST_ID.test(id)) return Promise.reject(new Error('差异请求引用无效'));
      const owner = ownerFor(sender);
      if (owner.pending.has(id)) return Promise.reject(new Error('差异请求引用已在使用'));
      const total = [...owners.values()].reduce((sum, value) => sum + value.pending.size, 0);
      if (owner.pending.size >= 4 || total >= 8) { detachIfEmpty(sender); return Promise.reject(new Error('差异请求过多，请稍后重试')); }
      const controller = new AbortController();
      const done = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return execute(controller.signal);
      }).finally(() => { if (owner.pending.get(id)?.controller === controller) owner.pending.delete(id); detachIfEmpty(sender); });
      owner.pending.set(id, { ...metadata, controller, done });
      return done;
    },
    async cancel(sender: WebContents, frame: WebFrameMain, input: AgentFileDiffCancelRequest): Promise<boolean> {
      if (typeof input?.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) throw new Error('差异请求引用无效');
      const pending = owners.get(sender)?.pending.get(input.requestId);
      if (!pending || pending.frame !== frame || pending.processId !== frame.processId || pending.routingId !== frame.routingId
        || pending.scope !== scopeKey(input)) return false;
      pending.controller.abort();
      await pending.done.catch(() => undefined);
      return true;
    },
    releaseOwner,
  };
}
