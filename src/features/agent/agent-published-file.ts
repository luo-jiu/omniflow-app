import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { AGENT_LIBRARY_MUTATION_TOOLS } from '@/shared/agent/agent-library-actions';

export function committedAgentFileParents(activity: AgentToolActivitySnapshot): number[] {
  if ([...AGENT_LIBRARY_MUTATION_TOOLS, 'tag.update'].includes(activity.call.name)) {
    if (activity.status !== 'completed' || activity.result?.ok !== true) return [];
    const data = activity.result.data as { mutationCommitState?: unknown; affectedParentIds?: unknown } | undefined;
    if (data?.mutationCommitState !== 'committed' || !Array.isArray(data.affectedParentIds) || data.affectedParentIds.length > 128) return [];
    return Array.from(new Set(data.affectedParentIds.filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0)));
  }
  const parent = committedAgentFileParent(activity);
  return parent === null ? [] : [parent];
}

export function committedAgentFileParent(activity: AgentToolActivitySnapshot): number | null {
  if (!['file.publish', 'file.upload', 'file.write', 'file.delete'].includes(activity.call.name)
    || activity.status !== 'completed' || activity.result?.ok !== true) return null;
  const data = activity.result.data as { deleteCommitState?: unknown; uploadCommitState?: unknown; writeCommitState?: unknown; destination?: { kind?: unknown; nodeId?: unknown; parentId?: unknown } } | undefined;
  const destination = data?.destination;
  const state = activity.call.name === 'file.delete' ? data?.deleteCommitState : activity.call.name === 'file.write' ? data?.writeCommitState : data?.uploadCommitState;
  if (state !== 'committed' || destination?.kind !== 'library') return null;
  const parentId = destination.parentId;
  return Number.isSafeInteger(parentId) && Number(parentId) > 0
    && Number.isSafeInteger(destination.nodeId) && Number(destination.nodeId) > 0 ? Number(parentId) : null;
}
