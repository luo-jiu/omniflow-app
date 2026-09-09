import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';

export function committedAgentFileParent(activity: AgentToolActivitySnapshot): number | null {
  if (!['file.publish', 'file.upload', 'file.write'].includes(activity.call.name)
    || activity.status !== 'completed' || activity.result?.ok !== true) return null;
  const data = activity.result.data as { uploadCommitState?: unknown; writeCommitState?: unknown; destination?: { kind?: unknown; nodeId?: unknown; parentId?: unknown } } | undefined;
  const destination = data?.destination;
  if ((activity.call.name === 'file.write' ? data?.writeCommitState : data?.uploadCommitState) !== 'committed' || destination?.kind !== 'library') return null;
  const parentId = destination.parentId;
  return Number.isSafeInteger(parentId) && Number(parentId) > 0
    && Number.isSafeInteger(destination.nodeId) && Number(destination.nodeId) > 0 ? Number(parentId) : null;
}
