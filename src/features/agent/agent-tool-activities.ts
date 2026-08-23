import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';

function activityKey(activity: Pick<AgentToolActivitySnapshot, 'runId' | 'call'>): string {
  return `${activity.runId}\u0000${activity.call.id}`;
}

function isTerminal(status: AgentToolActivitySnapshot['status']): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted';
}

function approvalRank(activity: AgentToolActivitySnapshot): number {
  switch (activity.approval?.status) {
    case 'pending': return 1;
    case 'approved': return 2;
    case 'denied':
    case 'expired':
    case 'cancelled':
    case 'interrupted': return 3;
    default: return 0;
  }
}

function interactionRank(activity: AgentToolActivitySnapshot): number {
  switch (activity.interaction?.status) {
    case 'pending': return 1;
    case 'submitted': return 2;
    case 'expired':
    case 'cancelled':
    case 'interrupted': return 3;
    default: return 0;
  }
}

export function mergeAgentToolActivity(
  current: AgentToolActivitySnapshot,
  next: AgentToolActivitySnapshot,
): AgentToolActivitySnapshot {
  if (next.revision < current.revision) return current;
  if (next.revision > current.revision) return next;
  if (isTerminal(current.status) && !isTerminal(next.status)) return current;
  const merged = { ...current, ...next };
  if (
    current.progress
    && (!next.progressUpdatedAt
      || String(current.progressUpdatedAt || '') > String(next.progressUpdatedAt))
  ) {
    merged.progress = current.progress;
    merged.progressUpdatedAt = current.progressUpdatedAt;
  }
  if (current.approval && approvalRank(current) > approvalRank(next)) {
    merged.approval = current.approval;
  }
  if (current.interaction && interactionRank(current) > interactionRank(next)) {
    merged.interaction = current.interaction;
  }
  return merged;
}

export function upsertAgentToolActivity(
  current: AgentToolActivitySnapshot[],
  next: AgentToolActivitySnapshot,
): AgentToolActivitySnapshot[] {
  const key = activityKey(next);
  const index = current.findIndex(item => item.id === next.id || activityKey(item) === key);
  if (index < 0) return [...current, next];
  const merged = mergeAgentToolActivity(current[index], next);
  return current.map((item, itemIndex) => itemIndex === index ? merged : item);
}

export function reconcileCanonicalAgentRunActivities(
  current: AgentToolActivitySnapshot[],
  runId: string,
  canonical: AgentToolActivitySnapshot[],
): AgentToolActivitySnapshot[] {
  const firstRunIndex = current.findIndex(activity => activity.runId === runId);
  if (firstRunIndex < 0) return [...current, ...canonical];
  return [
    ...current.slice(0, firstRunIndex),
    ...canonical,
    ...current.slice(firstRunIndex).filter(activity => activity.runId !== runId),
  ];
}
