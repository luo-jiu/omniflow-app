import {
  createSQLiteAgentMemoryStore,
  type AgentMemoryStore,
} from './agent-memory-store';
import { getAgentSessionDatabasePath } from './agent-session-store-runtime';

let storePromise: Promise<AgentMemoryStore> | null = null;

export function getAgentMemoryStore(): Promise<AgentMemoryStore> {
  if (!storePromise) {
    storePromise = createSQLiteAgentMemoryStore(getAgentSessionDatabasePath()).catch((error) => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

export async function disposeAgentMemoryStore(): Promise<void> {
  const current = storePromise;
  storePromise = null;
  if (current) await (await current).close();
}
