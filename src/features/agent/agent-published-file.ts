import type { AgentPluginRenamePreparedActionPublicV1, AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { AGENT_LIBRARY_MUTATION_TOOLS } from '@/shared/agent/agent-library-actions';
import { normalizeAgentPreparedActionPublic, normalizeAgentPluginRenamePreparedActionPublicV1 } from '@/shared/agent/agent-prepared-action';

export function committedAgentFileParents(activity: AgentToolActivitySnapshot, libraryId?: number): number[] {
  const action = getPluginOperationPreparedAction(activity, libraryId);
  if (action?.kind === 'plugin.file-output') {
    const data = activity.result?.data as Record<string, unknown> | undefined;
    const destination = data?.destination as Record<string, unknown> | undefined;
    return activity.status === 'completed' && activity.result?.ok === true && data?.uploadCommitState === 'committed'
      && data.operationId === action.operationId && data.libraryId === action.libraryId
      && destination?.kind === 'library' && Number.isSafeInteger(destination.nodeId) && Number(destination.nodeId) > 0
      && destination.parentId === action.parentId && data.fileName === action.fileName && data.sha256 === action.sha256
      && data.sizeBytes === action.sizeBytes ? [action.parentId] : [];
  }
  if (activity.pluginSource && activity.preparation?.action.kind === 'plugin.rename') {
    return [...new Set(committedPluginRenameItems(activity, libraryId).map(item => item.parentId))];
  }
  if ([...AGENT_LIBRARY_MUTATION_TOOLS, 'node.configure', 'tag.update', 'library.batch'].includes(activity.call.name)) {
    if (activity.status !== 'completed' || activity.result?.ok !== true) return [];
    const data = activity.result.data as { mutationCommitState?: unknown; affectedParentIds?: unknown } | undefined;
    if (data?.mutationCommitState !== 'committed' || !Array.isArray(data.affectedParentIds) || data.affectedParentIds.length > 128) return [];
    return Array.from(new Set(data.affectedParentIds.filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0)));
  }
  const parent = committedAgentFileParent(activity);
  return parent === null ? [] : [parent];
}

export function getPluginOperationPreparedAction(activity: AgentToolActivitySnapshot, libraryId?: number) {
  const source = activity.pluginSource;
  try {
    const action = normalizeAgentPreparedActionPublic(activity.preparation?.action);
    if (!source || (action.kind !== 'plugin.rename' && action.kind !== 'plugin.file-output') || source.toolId !== activity.call.name
      || source.pluginId !== action.pluginId || source.pluginVersion !== action.pluginVersion || source.packageFingerprint !== action.packageFingerprint
      || (libraryId !== undefined && action.libraryId !== libraryId)) return undefined;
    return action;
  } catch { return undefined; }
}

export function getPluginRenamePreparedAction(activity: AgentToolActivitySnapshot, libraryId?: number): AgentPluginRenamePreparedActionPublicV1 | undefined {
  const source = activity.pluginSource;
  const input = activity.preparation?.action;
  if (!source || input?.kind !== 'plugin.rename' || source.toolId !== activity.call.name
    || input.pluginId !== source.pluginId || input.pluginVersion !== source.pluginVersion
    || input.packageFingerprint !== source.packageFingerprint || (libraryId !== undefined && input.libraryId !== libraryId)) return undefined;
  try { return normalizeAgentPluginRenamePreparedActionPublicV1(input); } catch { return undefined; }
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

/** Only the host's committed rename receipt may update existing file labels. */
export function committedPluginRenameItems(activity: AgentToolActivitySnapshot, libraryId?: number): Array<{ nodeId: number; parentId: number; name: string; ext: string }> {
  const action = getPluginRenamePreparedAction(activity, libraryId);
  if (!action || activity.status !== 'completed' || activity.result?.ok !== true) return [];
  const data = activity.result.data as { mutationCommitState?: unknown; operationId?: unknown; items?: unknown } | undefined;
  if (data?.mutationCommitState !== 'committed' || data.operationId !== action.operationId || !Array.isArray(data.items) || data.items.length !== action.items.length) return [];
  const result: Array<{ nodeId: number; parentId: number; name: string; ext: string }> = [];
  const ids = new Set<number>();
  for (const raw of data.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const approved = action.items.find(value => value.nodeId === item.nodeId);
    if (!approved || ids.has(approved.nodeId) || item.parentId !== approved.parentId || typeof item.name !== 'string' || typeof item.ext !== 'string'
      || (item.ext ? `${item.name}.${item.ext}` : item.name) !== approved.newName) return [];
    ids.add(approved.nodeId); result.push({ nodeId: approved.nodeId, parentId: approved.parentId, name: item.name, ext: item.ext });
  }
  return result;
}
