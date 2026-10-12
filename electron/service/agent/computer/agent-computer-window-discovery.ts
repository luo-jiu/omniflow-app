import crypto from 'node:crypto';

import { normalizeAgentComputerWindowsPreparedActionPublicV1 } from '../../../../src/shared/agent/agent-prepared-action';
import type { AgentComputerSharedWindow } from '../../../platform/computer-use';
import type { AgentToolMainPreparationIdentity } from '../agent-tool-registry';

const MAX_WINDOWS_PER_RUN = 64;
const MAX_RUNS = 32;
const DISCOVERY_TTL_MS = 10 * 60_000;

export interface AgentComputerWindowDiscoveryDependencies {
  /** Metadata only: this must not capture pixels, scan AX, or request permissions. */
  windows(signal: AbortSignal): Promise<{ windows: AgentComputerSharedWindow[]; truncated: boolean }>;
  now?: () => number;
}

export interface AgentComputerWindowDiscoveryContext {
  identity: AgentToolMainPreparationIdentity;
  signal: AbortSignal;
}

export interface AgentComputerWindowDiscoveryInput {
  /** Case-insensitive substring of the application or window label. */
  query?: string;
  /** Case-insensitive substring of the application label. */
  application?: string;
}

export interface AgentComputerDiscoveredWindow {
  windowRef: string;
  applicationLabel: string;
  windowLabel: string;
}

export interface AgentComputerWindowDiscoveryResult {
  windows: AgentComputerDiscoveredWindow[];
  truncated: boolean;
}

interface WindowReference {
  ref: string;
  key: string;
  window: AgentComputerSharedWindow;
}

interface RunDiscovery {
  active: boolean;
  identity: string;
  updatedAt: number;
  pending: number;
  references: Map<string, WindowReference>;
}

function identityKey(identity: AgentToolMainPreparationIdentity): string {
  return JSON.stringify([identity.runId, identity.sessionId, identity.libraryId, identity.ownerWebContentsId,
    identity.ownerScope.accountScope, identity.ownerScope.backendScope, identity.aiDestinationIdentity, identity.runCapabilityIdentity]);
}

function windowKey(window: AgentComputerSharedWindow): string {
  return JSON.stringify([window.windowId, window.pid, window.processStartedAt, window.layer,
    window.bounds.x, window.bounds.y, window.bounds.width, window.bounds.height, window.title ?? null,
    window.applicationLabel, window.windowLabel]);
}

function shareable(window: AgentComputerSharedWindow): boolean {
  return Number.isSafeInteger(window.windowId) && window.windowId > 0
    && Number.isSafeInteger(window.pid) && window.pid > 0
    && Number.isSafeInteger(window.processStartedAt) && window.processStartedAt > 0 && window.layer === 0
    && Object.values(window.bounds).every(Number.isFinite) && window.bounds.width > 0 && window.bounds.height > 0
    && !!window.applicationLabel && !!window.windowLabel;
}

/** Run-bound discovery references select windows; they never authorize observation or input. */
export function createAgentComputerWindowDiscovery(dependencies: AgentComputerWindowDiscoveryDependencies) {
  const runs = new Map<string, RunDiscovery>();
  const now = dependencies.now || Date.now;
  let disposed = false;

  function releaseRun(runId: string): void {
    const state = runs.get(runId);
    if (!state) return;
    state.active = false;
    state.references.clear();
    runs.delete(runId);
  }

  function pruneExpired(): void {
    const time = now();
    for (const [runId, state] of runs) {
      if (time - state.updatedAt >= DISCOVERY_TTL_MS) releaseRun(runId);
    }
  }

  function assertActive(state: RunDiscovery, key: string, context: AgentComputerWindowDiscoveryContext): void {
    context.signal.throwIfAborted();
    pruneExpired();
    if (disposed || !state.active || runs.get(context.identity.runId) !== state
      || state.identity !== key || identityKey(context.identity) !== key) {
      throw new Error('窗口发现引用已失效，请重新搜索应用窗口');
    }
  }

  function stateFor(context: AgentComputerWindowDiscoveryContext, create: boolean): RunDiscovery {
    context.signal.throwIfAborted();
    pruneExpired();
    if (disposed) throw new Error('窗口发现服务已结束');
    const key = identityKey(context.identity);
    let state = runs.get(context.identity.runId);
    if (state && state.identity !== key) throw new Error('窗口发现身份不匹配，请重新搜索应用窗口');
    if (!state) {
      if (!create) throw new Error('窗口发现引用已失效，请重新搜索应用窗口');
      if (runs.size >= MAX_RUNS) throw new Error('窗口发现任务已达上限，请结束其他任务后重试');
      state = { active: true, identity: key, updatedAt: now(), pending: 0, references: new Map() };
      runs.set(context.identity.runId, state);
    }
    return state;
  }

  async function list(input: AgentComputerWindowDiscoveryInput, context: AgentComputerWindowDiscoveryContext): Promise<AgentComputerWindowDiscoveryResult> {
    const action = normalizeAgentComputerWindowsPreparedActionPublicV1({ ...input,
      kind: 'computer.windows', version: 1, libraryId: context.identity.libraryId });
    const query = action.query?.toLowerCase() || '';
    const application = action.application?.toLowerCase() || '';
    const state = stateFor(context, true);
    const key = state.identity;
    state.pending++;
    try {
      const snapshot = await dependencies.windows(context.signal);
      assertActive(state, key, context);
      const available = snapshot.windows.filter(shareable);
      const current = new Map(available.map(window => [window.windowId, windowKey(window)]));
      for (const [ref, entry] of state.references) {
        const currentKey = current.get(entry.window.windowId);
        if ((currentKey !== undefined && currentKey !== entry.key) || (currentKey === undefined && !snapshot.truncated)) {
          state.references.delete(ref);
        }
      }
      const matches = available.filter(window => (!application || window.applicationLabel.toLowerCase().includes(application))
        && (!query || window.applicationLabel.toLowerCase().includes(query) || window.windowLabel.toLowerCase().includes(query)));
      const windows: AgentComputerDiscoveredWindow[] = [];
      const truncated = snapshot.truncated || matches.length > MAX_WINDOWS_PER_RUN;
      const selected = matches.slice(0, MAX_WINDOWS_PER_RUN);
      const selectedKeys = new Set(selected.map(windowKey));
      const byKey = new Map([...state.references.values()].map(entry => [entry.key, entry]));
      for (const window of selected) {
        const windowIdentity = windowKey(window);
        let entry = byKey.get(windowIdentity);
        if (!entry) {
          if (state.references.size >= MAX_WINDOWS_PER_RUN) {
            // Keep references selected by this query; retire the oldest unused
            // one so narrowing a search can discover a previously omitted window.
            const oldest = [...state.references.values()].find(reference => !selectedKeys.has(reference.key));
            if (!oldest) throw new Error('窗口发现引用容量无效，请重新搜索应用窗口');
            state.references.delete(oldest.ref);
            byKey.delete(oldest.key);
          }
          entry = { ref: crypto.randomUUID(), key: windowIdentity, window: structuredClone(window) };
          byKey.set(windowIdentity, entry);
        }
        state.references.delete(entry.ref);
        state.references.set(entry.ref, entry);
        windows.push({ windowRef: entry.ref, applicationLabel: window.applicationLabel, windowLabel: window.windowLabel });
      }
      state.updatedAt = now();
      return { windows, truncated };
    } finally {
      state.pending--;
      if (!state.pending && !state.references.size && runs.get(context.identity.runId) === state) releaseRun(context.identity.runId);
    }
  }

  async function resolve(windowRef: string, context: AgentComputerWindowDiscoveryContext): Promise<AgentComputerSharedWindow> {
    if (typeof windowRef !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(windowRef)) {
      throw new Error('窗口发现引用无效，请重新搜索应用窗口');
    }
    const state = stateFor(context, false);
    const key = state.identity;
    const entry = state.references.get(windowRef);
    if (!entry) throw new Error('窗口发现引用已失效，请重新搜索应用窗口');
    const snapshot = await dependencies.windows(context.signal);
    assertActive(state, key, context);
    const matches = snapshot.windows.filter(window => window.windowId === entry.window.windowId);
    if (state.references.get(windowRef) !== entry || matches.length !== 1 || !shareable(matches[0]) || windowKey(matches[0]) !== entry.key) {
      state.references.delete(windowRef);
      throw new Error('应用窗口已关闭、移动或变化，请重新搜索应用窗口');
    }
    state.references.delete(windowRef);
    state.references.set(windowRef, entry);
    state.updatedAt = now();
    return structuredClone(entry.window);
  }

  function dispose(): void {
    disposed = true;
    for (const runId of runs.keys()) releaseRun(runId);
  }

  return { list, resolve, releaseRun, dispose };
}
