import type {
  AgentAppContext,
  AgentDirectoryEntry,
  AgentPerceptionSnapshot,
} from '@/shared/agent/agent.types';
import {
  fetchNodeDetailById,
  getChildrenByNodeId,
} from '@/features/file-explorer/services/file.api';

function toPositiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeEntry(value: unknown): AgentDirectoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = toPositiveId(source.id);
  const type = source.type === 'dir' || source.type === 'file' ? source.type : null;
  const name = String(source.name || '').trim();
  if (!id || !type || !name) return null;

  const fileSize = Number(source.fileSize ?? source.file_size);
  return {
    ...(source.ext ? { ext: String(source.ext) } : {}),
    ...(Number.isFinite(fileSize) && fileSize >= 0 ? { fileSize } : {}),
    id,
    ...(source.mimeType || source.mime_type
      ? { mimeType: String(source.mimeType ?? source.mime_type) }
      : {}),
    name,
    type,
    ...(source.updatedAt || source.updated_at
      ? { updatedAt: String(source.updatedAt ?? source.updated_at) }
      : {}),
  };
}

export async function readAgentPerception(
  appContext: AgentAppContext,
): Promise<AgentPerceptionSnapshot> {
  const currentDirectoryId = toPositiveId(appContext.currentDirectory?.id);
  const libraryId = toPositiveId(appContext.libraryId);
  const selectedNodeIds = Array.from(new Set(
    (appContext.selectedNodeIds || [])
      .map(toPositiveId)
      .filter((id): id is number => id !== null),
  )).slice(0, 20);

  const currentDirectoryPromise = currentDirectoryId && libraryId
    ? getChildrenByNodeId(currentDirectoryId, libraryId)
    : Promise.resolve([]);
  const selectedNodePromises = selectedNodeIds.map(async (nodeId) => {
    try {
      return await fetchNodeDetailById(nodeId);
    } catch {
      return null;
    }
  });

  const [rawEntries, rawSelectedNodes] = await Promise.all([
    currentDirectoryPromise,
    Promise.all(selectedNodePromises),
  ]);

  const entries = rawEntries
    .map(normalizeEntry)
    .filter((entry): entry is AgentDirectoryEntry => entry !== null)
    .slice(0, 200)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-Hans-CN');
    });
  const selectedNodes = rawSelectedNodes
    .map(normalizeEntry)
    .filter((entry): entry is AgentDirectoryEntry => entry !== null);

  return {
    ...(currentDirectoryId && libraryId
      ? {
          currentDirectory: {
            entryCount: entries.length,
            entries,
            id: currentDirectoryId,
            name: appContext.currentDirectory?.name || '当前目录',
          },
        }
      : {}),
    selectedNodes,
    collectedAt: new Date().toISOString(),
  };
}
