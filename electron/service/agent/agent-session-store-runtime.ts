import path from 'node:path';
import { app } from 'electron';

import {
  createSQLiteAgentSessionStore,
  type AgentSessionStore,
} from './agent-session-store';

export const AGENT_SESSION_DATABASE_FILENAME = 'agent-sessions.sqlite3';

export function getAgentSessionDatabasePath(): string {
  return path.join(app.getPath('userData'), AGENT_SESSION_DATABASE_FILENAME);
}

let storePromise: Promise<AgentSessionStore> | null = null;

export function getAgentSessionStore(): Promise<AgentSessionStore> {
  if (!storePromise) {
    const databasePath = getAgentSessionDatabasePath();
    storePromise = createSQLiteAgentSessionStore(databasePath).catch((error) => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

export async function disposeAgentSessionStore(): Promise<void> {
  const current = storePromise;
  storePromise = null;
  if (current) {
    await (await current).close();
  }
}
