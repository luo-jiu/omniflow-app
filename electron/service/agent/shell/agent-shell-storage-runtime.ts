import { app } from 'electron';
import path from 'node:path';

import {
  createAgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaManager,
} from '../storage/agent-local-storage-quota-manager';
import { createSQLiteAgentLocalStorageQuotaPersistence } from '../storage/agent-local-storage-quota-sqlite';
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

let runtimePromise: Promise<AgentShellStorageRuntime> | null = null;

function getDatabasePath(): string {
  return path.join(app.getPath('userData'), AGENT_SESSION_DATABASE_FILENAME);
}

export function getAgentShellStorageRuntime(): Promise<AgentShellStorageRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const databasePath = getDatabasePath();
      const quotaPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
      const quotaManager = createAgentLocalStorageQuotaManager({
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
          rootPath: path.join(app.getPath('userData'), WORKSPACE_DIRECTORY_NAME),
        });
        await workspaceStore.ready;
        await quotaManager.sweep('startup-recovery');
        const initializedWorkspaceStore = workspaceStore;
        return {
          close: async () => {
            await initializedWorkspaceStore.dispose();
            await quotaManager.close();
          },
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
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

export async function disposeAgentShellStorageRuntime(): Promise<void> {
  const current = runtimePromise;
  runtimePromise = null;
  if (current) await (await current).close();
}
