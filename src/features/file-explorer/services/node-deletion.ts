import {
  clearRecycleBin,
  deleteNodeAndChildren,
  getAllDescendantsByNodeId,
  hardDeleteNodeAndChildren,
  type RecycleBinItem,
} from './file.api';
import {
  createViewerResourceKey,
  viewerSessionRuntime,
  viewerDraftStore,
  type ViewerResourceKey,
} from '@/features/file-viewer/session';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface NodeDeletionOptions {
  accountScope: string | null;
  ancestorId: number;
  expectedDescendantCount?: number;
  libraryId: number;
}

interface ClearRecycleBinOptions {
  accountScope: string | null;
  items: Array<Pick<RecycleBinItem, 'id' | 'deletedDescendantCount'>>;
  libraryId: number;
}

export interface NodeDeletionResult {
  deletedNodeIds: number[];
  draftCleanupFailed: boolean;
  viewerSessionCleanupFailed: boolean;
  subtreeCollectionFailed: boolean;
}

export interface ClearRecycleBinResult extends NodeDeletionResult {
  clearedCount: number;
}

interface NodeDeletionDependencies {
  clearRecycleBin: (libraryId: number) => Promise<number>;
  deleteNodeAndChildren: (ancestorId: number, libraryId: number) => Promise<unknown>;
  discardDrafts: (identities: ViewerResourceKey[]) => Promise<void>;
  discardViewerSessions: (
    accountScope: string,
    libraryId: number,
    nodeIds: number[],
  ) => Promise<void>;
  getAllDescendantsByNodeId: (nodeId: number, libraryId: number) => Promise<unknown[]>;
  hardDeleteNodeAndChildren: (ancestorId: number, libraryId: number) => Promise<boolean>;
  reportCollectionFailure?: (error: unknown) => void;
  reportDraftCleanupFailure?: (error: unknown) => void;
  reportViewerSessionCleanupFailure?: (error: unknown) => void;
}

function normalizePositiveId(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function collectIds(ancestorId: number, descendants: unknown[]): number[] {
  const ids = new Set<number>([ancestorId]);
  descendants.forEach((item) => {
    const candidate = item && typeof item === 'object'
      ? Number((item as { id?: unknown }).id)
      : Number.NaN;
    const nodeId = normalizePositiveId(candidate);
    if (nodeId != null) ids.add(nodeId);
  });
  return Array.from(ids);
}

export function createNodeDeletionService(dependencies: NodeDeletionDependencies) {
  const collectSubtreeNodeIds = async (ancestorId: number, libraryId: number) => {
    const normalizedAncestorId = normalizePositiveId(ancestorId);
    const normalizedLibraryId = normalizePositiveId(libraryId);
    if (normalizedAncestorId == null || normalizedLibraryId == null) {
      throw new TypeError('Node deletion requires positive ancestor and library ids');
    }
    const descendants = await dependencies.getAllDescendantsByNodeId(
      normalizedAncestorId,
      normalizedLibraryId,
    );
    return collectIds(normalizedAncestorId, descendants);
  };

  const collectSubtreeNodeIdsBestEffort = async (
    ancestorId: number,
    libraryId: number,
    expectedDescendantCount?: number,
  ) => {
    try {
      const nodeIds = await collectSubtreeNodeIds(ancestorId, libraryId);
      const normalizedExpectedCount = Number.isSafeInteger(expectedDescendantCount)
        && Number(expectedDescendantCount) >= 0
        ? Number(expectedDescendantCount)
        : null;
      return {
        nodeIds,
        failed: normalizedExpectedCount != null
          && nodeIds.length < normalizedExpectedCount + 1,
      };
    } catch (error) {
      dependencies.reportCollectionFailure?.(error);
      const normalizedAncestorId = normalizePositiveId(ancestorId);
      return {
        nodeIds: normalizedAncestorId == null ? [] : [normalizedAncestorId],
        failed: true,
      };
    }
  };

  const discardDeletedNodeDrafts = async (
    accountScope: string | null,
    libraryId: number,
    nodeIds: number[],
  ) => {
    if (!accountScope || nodeIds.length === 0) return nodeIds.length > 0;
    const identities = nodeIds
      .map((nodeId) => createViewerResourceKey({
        accountScope,
        libraryId,
        nodeId,
        viewerKind: 'text',
      }))
      .filter((identity): identity is ViewerResourceKey => identity !== null);
    if (identities.length !== nodeIds.length) return true;
    try {
      await dependencies.discardDrafts(identities);
      return false;
    } catch (error) {
      dependencies.reportDraftCleanupFailure?.(error);
      return true;
    }
  };

  const discardDeletedNodeViewerSessions = async (
    accountScope: string | null,
    libraryId: number,
    nodeIds: number[],
  ) => {
    if (!accountScope || nodeIds.length === 0) return nodeIds.length > 0;
    try {
      await dependencies.discardViewerSessions(accountScope, libraryId, nodeIds);
      return false;
    } catch (error) {
      dependencies.reportViewerSessionCleanupFailure?.(error);
      return true;
    }
  };

  const discardDeletedNodeLocalState = async (
    accountScope: string | null,
    libraryId: number,
    nodeIds: number[],
  ) => {
    const [draftCleanupFailed, viewerSessionCleanupFailed] = await Promise.all([
      discardDeletedNodeDrafts(accountScope, libraryId, nodeIds),
      discardDeletedNodeViewerSessions(accountScope, libraryId, nodeIds),
    ]);
    return { draftCleanupFailed, viewerSessionCleanupFailed };
  };

  const softDeleteNodeSubtree = async (
    options: NodeDeletionOptions,
  ): Promise<NodeDeletionResult> => {
    const collected = await collectSubtreeNodeIdsBestEffort(
      options.ancestorId,
      options.libraryId,
      options.expectedDescendantCount,
    );
    await dependencies.deleteNodeAndChildren(options.ancestorId, options.libraryId);
    const cleanup = await discardDeletedNodeLocalState(
      options.accountScope,
      options.libraryId,
      collected.nodeIds,
    );
    return {
      deletedNodeIds: collected.nodeIds,
      ...cleanup,
      subtreeCollectionFailed: collected.failed,
    };
  };

  const hardDeleteNodeSubtree = async (
    options: NodeDeletionOptions,
  ): Promise<NodeDeletionResult> => {
    const collected = await collectSubtreeNodeIdsBestEffort(
      options.ancestorId,
      options.libraryId,
      options.expectedDescendantCount,
    );
    await dependencies.hardDeleteNodeAndChildren(options.ancestorId, options.libraryId);
    const cleanup = await discardDeletedNodeLocalState(
      options.accountScope,
      options.libraryId,
      collected.nodeIds,
    );
    return {
      deletedNodeIds: collected.nodeIds,
      ...cleanup,
      subtreeCollectionFailed: collected.failed,
    };
  };

  const clearRecycleBinWithViewerCleanup = async (
    options: ClearRecycleBinOptions,
  ): Promise<ClearRecycleBinResult> => {
    const collected = await Promise.all(
      options.items.map((item) => (
        collectSubtreeNodeIdsBestEffort(
          item.id,
          options.libraryId,
          item.deletedDescendantCount,
        )
      )),
    );
    const deletedNodeIds = Array.from(new Set(collected.flatMap((item) => item.nodeIds)));
    const clearedCount = await dependencies.clearRecycleBin(options.libraryId);
    const cleanup = await discardDeletedNodeLocalState(
      options.accountScope,
      options.libraryId,
      deletedNodeIds,
    );
    return {
      clearedCount,
      deletedNodeIds,
      ...cleanup,
      subtreeCollectionFailed: collected.some((item) => item.failed),
    };
  };

  return {
    clearRecycleBinWithViewerCleanup,
    collectSubtreeNodeIds,
    hardDeleteNodeSubtree,
    softDeleteNodeSubtree,
  };
}

const nodeDeletionService = createNodeDeletionService({
  clearRecycleBin,
  deleteNodeAndChildren,
  discardDrafts: (identities) => viewerDraftStore.discardDrafts(identities),
  discardViewerSessions: (accountScope, libraryId, nodeIds) => (
    viewerSessionRuntime.disposeNodeResources(accountScope, libraryId, nodeIds)
  ),
  getAllDescendantsByNodeId,
  hardDeleteNodeAndChildren,
  reportCollectionFailure: (error) => {
    runtimeLogger.warn('收集删除节点子树失败，将只清理已知节点:', error);
  },
  reportDraftCleanupFailure: (error) => {
    runtimeLogger.error('清理已删除节点的文本草稿失败:', error);
  },
  reportViewerSessionCleanupFailure: (error) => {
    runtimeLogger.warn('清理已删除节点的 Viewer Cold 快照失败:', error);
  },
});

export const {
  clearRecycleBinWithViewerCleanup,
  collectSubtreeNodeIds,
  hardDeleteNodeSubtree,
  softDeleteNodeSubtree,
} = nodeDeletionService;
