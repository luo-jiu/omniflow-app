import type { AgentRunSnapshot } from '@/shared/agent/agent.types';

function isTerminal(status: AgentRunSnapshot['status']): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted';
}

export function mergeAgentRun(
  current: AgentRunSnapshot,
  next: AgentRunSnapshot,
): AgentRunSnapshot {
  if (current.id !== next.id) return current;
  if (isTerminal(current.status) && !isTerminal(next.status)) return current;
  if (next.revision <= current.revision) return current;
  return next;
}

export function upsertAgentRun(
  current: AgentRunSnapshot[],
  next: AgentRunSnapshot,
): AgentRunSnapshot[] {
  const index = current.findIndex(run => run.id === next.id);
  if (index < 0) {
    return [...current, next].sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    ));
  }
  const merged = mergeAgentRun(current[index], next);
  return current.map((run, runIndex) => runIndex === index ? merged : run);
}
