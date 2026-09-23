import type { PluginCommandExecution, PluginCommandStatus } from '@/shared/plugins/manual-command.types';
import { normalizeAgentPreparedActionPublic } from '@/shared/agent/agent-prepared-action';

export const commandIsActive = (status: PluginCommandStatus) => ['preparing', 'awaiting-approval', 'executing'].includes(status);

/** This is a projection of main's committed receipt, not an execution state machine. */
export function commandCommittedMutation(execution: PluginCommandExecution): {
  parentIds: number[];
  renamed: Array<{ nodeId: number; parentId: number; name: string; ext: string }>;
} | null {
  if (execution.status !== 'completed' || !execution.result?.ok) return null;
  try {
    const action = normalizeAgentPreparedActionPublic(execution.action);
    if ((action.kind !== 'plugin.rename' && action.kind !== 'plugin.file-output') || action.libraryId !== execution.libraryId
      || action.pluginId !== execution.source.pluginId || action.packageFingerprint !== execution.source.packageFingerprint
      || action.pluginVersion !== execution.source.pluginVersion) return null;
    const data = execution.result.data as Record<string, unknown> | undefined;
    if (!data || data.operationId !== action.operationId) return null;
    if (action.kind === 'plugin.file-output') {
      const destination = data.destination as Record<string, unknown> | undefined;
      return data.uploadCommitState === 'committed' && destination?.kind === 'library' && destination.parentId === action.parentId
        && data.fileName === action.fileName && data.sha256 === action.sha256 && data.sizeBytes === action.sizeBytes
        ? { parentIds: [action.parentId], renamed: [] } : null;
    }
    if (data.mutationCommitState !== 'committed') return null;
    const parentIds = [...new Set(action.items.map(item => item.parentId))];
    // A historical receipt proves a write, not that its old filename remains current.
    if (execution.receiptChecks?.length) return { parentIds, renamed: [] };
    if (!Array.isArray(data.items) || data.items.length !== action.items.length) return null;
    const renamed: Array<{ nodeId: number; parentId: number; name: string; ext: string }> = [];
    const seen = new Set<number>();
    for (const item of data.items) {
      const approved = action.items.find(candidate => candidate.nodeId === item.nodeId);
      if (!approved || seen.has(item.nodeId) || approved.parentId !== item.parentId || typeof item.name !== 'string' || typeof item.ext !== 'string'
        || (item.ext ? `${item.name}.${item.ext}` : item.name) !== approved.newName) return null;
      seen.add(item.nodeId);
      renamed.push({ nodeId: item.nodeId, parentId: item.parentId, name: item.name, ext: item.ext });
    }
    return { parentIds, renamed };
  } catch { return null; }
}

export function mergeCommandProjection(current: PluginCommandExecution[], next: PluginCommandExecution): PluginCommandExecution[] {
  const previous = current.find(item => item.id === next.id);
  if (previous && previous.revision >= next.revision) return current;
  return [...current.filter(item => item.id !== next.id), next].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
