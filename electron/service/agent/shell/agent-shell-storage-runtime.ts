import { app } from 'electron';
import path from 'node:path';

import {
  createAgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaManager,
} from '../storage/agent-local-storage-quota-manager';
import { createSQLiteAgentLocalStorageQuotaPersistence } from '../storage/agent-local-storage-quota-sqlite';
import {
  AGENT_LOCAL_STORAGE_DEFAULT_MIN_FREE_BYTES,
  createAgentLocalStorageAvailableDiskBytesReader,
} from '../storage/agent-local-storage-disk-space';
import { AGENT_SESSION_DATABASE_FILENAME } from '../agent-session-store-runtime';
import {
  createAgentShellWorkspaceStore,
  type AgentShellWorkspaceStore,
} from './agent-shell-workspace-store';
import { createSQLiteAgentShellWorkspacePersistence } from './agent-shell-workspace-sqlite';

const WORKSPACE_DIRECTORY_NAME = 'agent-shell-workspaces';
const WORKSPACE_ADAPTER_ID = 'shell-workspace';

export interface AgentShellStorageRuntime {
  quotaManager: AgentLocalStorageQuotaManager;
  workspaceStore: AgentShellWorkspaceStore;
  close: () => Promise<void>;
}

interface AgentShellStorageRuntimeManagerOptions {
  createRuntime: () => Promise<AgentShellStorageRuntime>;
}

export function createAgentShellStorageRuntimeCloser(
  workspaceStore: Pick<AgentShellWorkspaceStore, 'dispose'>,
  quotaManager: Pick<AgentLocalStorageQuotaManager, 'close'>,
): () => Promise<void> {
  let closePromise: Promise<void> | null = null;
  return () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      const errors: unknown[] = [];
      try {
        await workspaceStore.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        await quotaManager.close();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        const error = new Error('Agent Shell 存储资源关闭失败');
        Object.assign(error, { causes: errors });
        throw error;
      }
    })();
    return closePromise;
  };
}

export function createAgentShellStorageRuntimeManager(
  options: AgentShellStorageRuntimeManagerOptions,
) {
  let runtimePromise: Promise<AgentShellStorageRuntime> | null = null;
  let lifecycleBarrier = Promise.resolve();
  let lifecycleFailure: unknown = null;

  function get(): Promise<AgentShellStorageRuntime> {
    if (!runtimePromise) {
      const previousBarrier = lifecycleBarrier;
      const generation = (async () => {
        await previousBarrier;
        if (lifecycleFailure) {
          const error = new Error('Agent Shell 存储上一次关闭未完整收口');
          Object.assign(error, { cause: lifecycleFailure });
          throw error;
        }
        return options.createRuntime();
      })();
      runtimePromise = generation;
      lifecycleBarrier = generation.then(() => undefined, () => undefined);
      void generation.catch(() => {
        if (runtimePromise === generation) runtimePromise = null;
      });
    }
    return runtimePromise;
  }

  async function dispose(): Promise<void> {
    const current = runtimePromise;
    if (!current) {
      await lifecycleBarrier;
      if (lifecycleFailure) throw lifecycleFailure;
      return;
    }
    if (runtimePromise === current) runtimePromise = null;
    const previousBarrier = lifecycleBarrier;
    const closing = (async () => {
      await previousBarrier;
      let runtime: AgentShellStorageRuntime;
      try {
        runtime = await current;
      } catch {
        if (lifecycleFailure) throw lifecycleFailure;
        return;
      }
      try {
        await runtime.close();
      } catch (error) {
        lifecycleFailure = error;
        throw error;
      }
    })();
    lifecycleBarrier = closing.then(() => undefined, () => undefined);
    await closing;
  }

  return { dispose, get };
}

async function createAgentShellStorageRuntime(): Promise<AgentShellStorageRuntime> {
  const userDataPath = app.getPath('userData');
  const databasePath = path.join(userDataPath, AGENT_SESSION_DATABASE_FILENAME);
  const quotaPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
  const quotaManager = createAgentLocalStorageQuotaManager({
    getAvailableDiskBytes: createAgentLocalStorageAvailableDiskBytesReader(userDataPath),
    minFreeBytes: AGENT_LOCAL_STORAGE_DEFAULT_MIN_FREE_BYTES,
    persistence: quotaPersistence,
  });
  let workspaceStore: AgentShellWorkspaceStore | null = null;
  let workspacePersistence: Awaited<ReturnType<
    typeof createSQLiteAgentShellWorkspacePersistence
  >> | null = null;
  try {
    await quotaManager.ready;
    workspacePersistence = await createSQLiteAgentShellWorkspacePersistence(databasePath);
    workspaceStore = createAgentShellWorkspaceStore({
      adapterId: WORKSPACE_ADAPTER_ID,
      persistence: workspacePersistence,
      quotaManager,
      rootPath: path.join(userDataPath, WORKSPACE_DIRECTORY_NAME),
    });
    await workspaceStore.ready;
    await quotaManager.sweep('startup-recovery');
    const initializedWorkspaceStore = workspaceStore;
    return {
      close: createAgentShellStorageRuntimeCloser(initializedWorkspaceStore, quotaManager),
      quotaManager,
      workspaceStore: initializedWorkspaceStore,
    };
  } catch (error) {
    if (workspaceStore) {
      await workspaceStore.dispose().catch(() => undefined);
    } else {
      await workspacePersistence?.close?.().catch(() => undefined);
    }
    await quotaManager.close().catch(() => undefined);
    throw error;
  }
}

const agentShellStorageRuntimeManager = createAgentShellStorageRuntimeManager({
  createRuntime: createAgentShellStorageRuntime,
});

export const getAgentShellStorageRuntime = agentShellStorageRuntimeManager.get;
export const disposeAgentShellStorageRuntime = agentShellStorageRuntimeManager.dispose;
