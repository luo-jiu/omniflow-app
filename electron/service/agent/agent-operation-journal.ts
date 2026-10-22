import type { AgentSessionSnapshot, AgentToolActivitySnapshot, AgentToolResult } from '../../../src/shared/agent/agent.types';
import { normalizeAgentMutationCommitState, type AgentMutationCommitState } from '../../../src/shared/agent/agent-mutation-commit-state';

export interface AgentOperationJournalEntry {
  operationId: string;
  toolName: string;
  status: AgentMutationCommitState['status'];
  receiptIssue?: AgentMutationCommitState['receiptIssue'];
  result?: AgentToolResult;
}

function resultData(result: AgentToolResult | undefined): Record<string, unknown> | undefined {
  return result?.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? result.data as Record<string, unknown> : undefined;
}

/** Tool success and its persisted lifecycle do not prove a filesystem mutation. */
export function projectAgentOperationJournalEntry(operationId: string, activity: AgentToolActivitySnapshot): AgentOperationJournalEntry {
  return { operationId, toolName: activity.call.name, ...normalizeAgentMutationCommitState(activity.result?.data),
    ...(activity.result ? { result: activity.result } : {}) };
}

/** The caller binds the owner/library/session; neither the model nor a plugin chooses it. */
export async function readAgentOperationJournal(input: {
  operationId: string;
  signal: AbortSignal;
  readSession: () => Promise<AgentSessionSnapshot | null>;
}): Promise<AgentOperationJournalEntry | undefined> {
  input.signal.throwIfAborted();
  const session = await input.readSession();
  input.signal.throwIfAborted();
  const activity = session?.toolActivities.find(candidate => {
    const data = resultData(candidate.result);
    return candidate.id === input.operationId
      || !!data && Object.prototype.hasOwnProperty.call(data, 'operationId') && data.operationId === input.operationId;
  });
  return activity ? projectAgentOperationJournalEntry(input.operationId, activity) : undefined;
}
