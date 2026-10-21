import path from 'node:path';
import { app } from 'electron';
import { createAgentFileChangeStore, type AgentFileChangeStore } from './agent-file-change-store';
import { getAgentSessionDatabasePath } from './agent-session-store-runtime';

let current: Promise<AgentFileChangeStore> | undefined;
export function getAgentFileChangeStore(): Promise<AgentFileChangeStore> {
  if (!current) current = createAgentFileChangeStore(getAgentSessionDatabasePath(), path.join(app.getPath('userData'), 'agent-file-changes'))
    .catch(error => { current = undefined; throw error; });
  return current;
}
export async function disposeAgentFileChangeStore(): Promise<void> {
  const closing = current;
  current = undefined;
  if (closing) await (await closing).close();
}
