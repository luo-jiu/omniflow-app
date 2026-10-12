import {
  normalizeFirstPartyControlContext,
  normalizeFirstPartyControlRequest,
  normalizeFirstPartyControlSnapshot,
  normalizeFirstPartyRegistrationToken,
  type FirstPartyControlContext,
  type FirstPartyControlId,
  type FirstPartyControlRequest,
  type FirstPartyControlResponse,
  type FirstPartyControlSnapshot,
  type FirstPartyRegistrationToken,
} from '@/shared/computer-use/first-party-control-contract';
import { firstPartyControlsAPI, type FirstPartyControlsBridge } from '@/service/computer-use/first-party-controls.api';

export interface FirstPartyLocalControl {
  getSnapshot(): FirstPartyControlSnapshot | null;
  /** Synchronous only. Call beginApply immediately before the actual owner mutation. */
  apply(request: Extract<FirstPartyControlRequest, { kind: 'verify' | 'dispatch' }>, beginApply: () => void): boolean;
}
interface RuntimeInput {
  context: FirstPartyControlContext;
  instanceId: string;
  token: FirstPartyRegistrationToken;
  controls: Partial<Record<FirstPartyControlId, FirstPartyLocalControl>>;
  isCurrent(runId?: string): boolean;
  now?: () => number;
}
export const FIRST_PARTY_REQUEST_TTL_MS = 60_000;
export const FIRST_PARTY_REQUEST_LIMIT = 128;

/** A narrow local dispatcher: neither DOM lookup nor renderer-authored execution requests. */
export function createFirstPartyControlsRuntime(input: RuntimeInput) {
  const context = normalizeFirstPartyControlContext(input.context);
  const token = normalizeFirstPartyRegistrationToken(input.token);
  const now = input.now || Date.now;
  const seen = new Map<string, number>();
  let closed = false;
  const snapshot = (id: FirstPartyControlId) => {
    const candidate = input.controls[id]?.getSnapshot();
    if (!candidate) return null;
    const current = normalizeFirstPartyControlSnapshot(candidate);
    return current.controlId === id && current.instanceId === input.instanceId ? current : null;
  };
  return {
    close() { closed = true; seen.clear(); },
    handle(raw: unknown): FirstPartyControlResponse | undefined {
      let request: FirstPartyControlRequest;
      try { request = normalizeFirstPartyControlRequest(raw); } catch { return; }
      if (request.registrationId !== token.registrationId || request.documentGeneration !== token.documentGeneration) return;
      const base = { ...token, requestId: request.requestId };
      const reject = (): FirstPartyControlResponse => ({ ...base, status: 'rejected' });
      const time = now();
      for (const [id, expiry] of seen) if (expiry <= time) seen.delete(id);
      if (closed || !input.isCurrent(request.runId) || context.ownerScope.accountScope !== request.context.ownerScope.accountScope
        || context.ownerScope.backendScope !== request.context.ownerScope.backendScope
        || context.libraryId !== request.context.libraryId || context.sessionId !== request.context.sessionId
        || request.expiresAt <= time || request.expiresAt > time + FIRST_PARTY_REQUEST_TTL_MS
        || seen.has(request.requestId) || seen.size >= FIRST_PARTY_REQUEST_LIMIT) return reject();
      // Keep every live nonce; evicting one early would permit a replay within its original TTL.
      seen.set(request.requestId, time + FIRST_PARTY_REQUEST_TTL_MS);
      let started = false;
      try {
        if (request.kind === 'observe') {
          const controls = (['agent-composer', 'agent-conversation'] as const).flatMap(id => {
            const current = snapshot(id);
            return current ? [current] : [];
          });
          return input.isCurrent(request.runId) && now() < request.expiresAt
            ? { ...base, status: 'observed', controls } : reject();
        }
        const current = snapshot(request.snapshot.controlId);
        if (!current || JSON.stringify(current) !== JSON.stringify(request.snapshot)
          || !input.isCurrent(request.runId) || now() >= request.expiresAt) return reject();
        if (request.kind === 'verify') return { ...base, status: 'verified' };
        const applied = input.controls[current.controlId]!.apply(request, () => {
          if (started || !input.isCurrent(request.runId) || now() >= request.expiresAt) throw new Error('第一方控件执行失效');
          started = true;
        });
        return { ...base, status: started ? (applied ? 'applied' : 'unknown') : 'rejected' };
      } catch {
        return { ...base, status: started ? 'unknown' : 'rejected' };
      }
    },
  };
}

/** StrictMode, a changed Session and late registration replies all release their exact token. */
export function registerFirstPartyLocalControls(input: Omit<RuntimeInput, 'token'> & { bridge?: FirstPartyControlsBridge }): () => void {
  const bridge = input.bridge || firstPartyControlsAPI;
  let closed = false;
  let token: FirstPartyRegistrationToken | undefined;
  let runtime: ReturnType<typeof createFirstPartyControlsRuntime> | undefined;
  let unsubscribe: () => void = () => undefined;
  const release = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    runtime?.close();
    if (token) void bridge.unregister(token).catch(() => undefined);
  };
  let registration: Promise<FirstPartyRegistrationToken>;
  try {
    unsubscribe = bridge.onRequest(request => {
      if (closed) return;
      const response = runtime?.handle(request);
      if (response) void bridge.complete(response).catch(() => undefined);
    });
    registration = bridge.register({ context: input.context, instanceId: input.instanceId });
  } catch {
    release();
    return release;
  }
  void registration.then(registered => {
    token = normalizeFirstPartyRegistrationToken(registered);
    if (closed) {
      void bridge.unregister(token).catch(() => undefined);
      return;
    }
    runtime = createFirstPartyControlsRuntime({ ...input, token });
  }).catch(release);
  return release;
}
