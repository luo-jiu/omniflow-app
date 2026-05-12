import { registerAuthSessionRuntime } from '@/service/auth-session-release';
import {
  fetchResourceMonitorProbes,
  type ResourceMonitorProbeTarget,
  type ResourceMonitorSnapshot,
} from './resource-monitor.api';

const PROBE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PROBE_HISTORY_LIMIT = 60;

export interface ResourceProbeHistoryEntry {
  checkedAt: string;
  error?: string;
  latencyMs: number;
  status: ResourceMonitorProbeTarget['status'];
}

export interface ResourceProbeHistoryItem {
  entries: ResourceProbeHistoryEntry[];
  target: ResourceMonitorProbeTarget;
}

export type ResourceProbeHistoryMap = Record<string, ResourceProbeHistoryItem>;

export interface ResourceMonitorProbeRuntimeState {
  error: string;
  history: ResourceProbeHistoryMap;
  loading: boolean;
  snapshot: ResourceMonitorSnapshot | null;
}

type ResourceMonitorProbeRuntimeListener = () => void;

function appendProbeHistory(
  history: ResourceProbeHistoryMap,
  nextProbes: ResourceMonitorProbeTarget[],
): ResourceProbeHistoryMap {
  if (nextProbes.length === 0) {
    return history;
  }
  const next: ResourceProbeHistoryMap = { ...history };
  nextProbes.forEach((target) => {
    const checkedAt = target.checkedAt || new Date().toISOString();
    const entry: ResourceProbeHistoryEntry = {
      checkedAt,
      error: target.error,
      latencyMs: target.latencyMs,
      status: target.status,
    };
    const existing = next[target.key]?.entries || [];
    const last = existing[existing.length - 1];
    const entries = last?.checkedAt === checkedAt
      ? [...existing.slice(0, -1), entry]
      : [...existing, entry].slice(-PROBE_HISTORY_LIMIT);
    next[target.key] = { entries, target };
  });
  return next;
}

class ResourceMonitorProbeRuntime {
  private listeners = new Set<ResourceMonitorProbeRuntimeListener>();
  private refreshPromise: Promise<void> | null = null;
  private sessionVersion = 0;
  private timer: number | null = null;
  private state: ResourceMonitorProbeRuntimeState = {
    error: '',
    history: {},
    loading: false,
    snapshot: null,
  };

  getState = () => this.state;

  subscribe = (listener: ResourceMonitorProbeRuntimeListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start = () => {
    if (typeof window === 'undefined') {
      return;
    }
    if (this.timer == null) {
      this.timer = window.setInterval(() => {
        void this.refresh({ silent: true });
      }, PROBE_REFRESH_INTERVAL_MS);
    }
    if (!this.state.snapshot) {
      void this.refresh({ silent: true });
    }
  };

  dispose = () => {
    this.sessionVersion += 1;
    if (this.timer != null && typeof window !== 'undefined') {
      window.clearInterval(this.timer);
    }
    this.timer = null;
    this.refreshPromise = null;
    this.setState({
      error: '',
      history: {},
      loading: false,
      snapshot: null,
    });
  };

  refresh = (options: { silent?: boolean } = {}) => {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    const version = this.sessionVersion;
    this.setState({ loading: true, error: '' });
    this.refreshPromise = fetchResourceMonitorProbes()
      .then((nextSnapshot) => {
        if (version !== this.sessionVersion) {
          return;
        }
        this.setState({
          history: appendProbeHistory(this.state.history, nextSnapshot.probes || []),
          snapshot: nextSnapshot,
        });
      })
      .catch((err: any) => {
        if (version !== this.sessionVersion) {
          return;
        }
        this.setState({ error: err?.message || '加载资源探针失败' });
        if (!options.silent) {
          throw err;
        }
      })
      .finally(() => {
        if (version === this.sessionVersion) {
          this.refreshPromise = null;
          this.setState({ loading: false });
        }
      });
    return this.refreshPromise;
  };

  private setState(nextState: Partial<ResourceMonitorProbeRuntimeState>) {
    this.state = {
      ...this.state,
      ...nextState,
    };
    this.listeners.forEach((listener) => listener());
  }
}

export const resourceMonitorProbeRuntime = new ResourceMonitorProbeRuntime();

registerAuthSessionRuntime(resourceMonitorProbeRuntime);
