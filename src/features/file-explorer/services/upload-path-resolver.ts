import { createNode, getChildrenByNodeId } from './file.api';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface UploadPathResolverOptions {
  libraryId: number;
  rootParentId: number;
  onDirectoryCreated?: (payload: { parentId: number; newDirectoryNode: any; directoryName: string }) => void;
}

const DIR_TYPE_VALUES = new Set(['dir', '0', 'folder']);

function normalizeSegment(input: string): string {
  return String(input || '');
}

function normalizeRelativePath(input: string): string {
  return String(input || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(normalizeSegment)
    .filter(Boolean)
    .join('/');
}

function isDirectoryNode(node: any): boolean {
  const type = String(node?.type ?? '').toLowerCase();
  return DIR_TYPE_VALUES.has(type) || Number(node?.type) === 0;
}

export class UploadPathResolver {
  private libraryId: number;
  private rootParentId: number;
  private onDirectoryCreated?: UploadPathResolverOptions['onDirectoryCreated'];
  private directoryIndexCache = new Map<number, Map<string, any>>();
  private inFlightEnsureDirectory = new Map<string, Promise<number>>();

  constructor(options: UploadPathResolverOptions) {
    this.libraryId = options.libraryId;
    this.rootParentId = options.rootParentId;
    this.onDirectoryCreated = options.onDirectoryCreated;
  }

  async resolveParentId(relativePath: string): Promise<number> {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) {
      return this.rootParentId;
    }
    const segments = normalized.split('/');
    if (segments.length <= 1) {
      return this.rootParentId;
    }
    const directorySegments = segments.slice(0, -1);
    return this.ensureDirectoryPath(directorySegments);
  }

  private async ensureDirectoryPath(directorySegments: string[]): Promise<number> {
    let currentParentId = this.rootParentId;
    for (const segment of directorySegments) {
      currentParentId = await this.ensureSingleDirectory(currentParentId, segment);
    }
    return currentParentId;
  }

  private async loadDirectoryIndex(parentId: number, forceRefresh = false): Promise<Map<string, any>> {
    if (!forceRefresh && this.directoryIndexCache.has(parentId)) {
      return this.directoryIndexCache.get(parentId)!;
    }
    const children = await getChildrenByNodeId(parentId, this.libraryId);
    const nextIndex = new Map<string, any>();
    (children || []).forEach((child: any) => {
      if (!isDirectoryNode(child)) {
        return;
      }
      const key = normalizeSegment(child?.name);
      if (!key) {
        return;
      }
      if (!nextIndex.has(key)) {
        nextIndex.set(key, child);
      }
    });
    this.directoryIndexCache.set(parentId, nextIndex);
    return nextIndex;
  }

  private async ensureSingleDirectory(parentId: number, directoryName: string): Promise<number> {
    const normalizedName = normalizeSegment(directoryName);
    if (!normalizedName) {
      return parentId;
    }

    const inFlightKey = `${parentId}::${normalizedName}`;
    const inFlight = this.inFlightEnsureDirectory.get(inFlightKey);
    if (inFlight) {
      return inFlight;
    }

    const ensurePromise = (async () => {
      const index = await this.loadDirectoryIndex(parentId);
      const existing = index.get(normalizedName);
      if (existing?.id) {
        return Number(existing.id);
      }

      try {
        const newDir = await createNode({
          name: normalizedName,
          parentId,
          libraryId: this.libraryId,
          type: 'dir',
        });
        index.set(normalizedName, newDir);
        this.directoryIndexCache.set(parentId, index);
        this.directoryIndexCache.set(Number(newDir.id), new Map());
        this.onDirectoryCreated?.({
          parentId,
          newDirectoryNode: newDir,
          directoryName: normalizedName,
        });
        return Number(newDir.id);
      } catch (error) {
        runtimeLogger.warn(`创建目录失败，尝试刷新重查: ${normalizedName}`, error);
        const refreshedIndex = await this.loadDirectoryIndex(parentId, true);
        const refreshed = refreshedIndex.get(normalizedName);
        if (refreshed?.id) {
          return Number(refreshed.id);
        }
        throw error;
      }
    })();

    this.inFlightEnsureDirectory.set(inFlightKey, ensurePromise);
    try {
      return await ensurePromise;
    } finally {
      this.inFlightEnsureDirectory.delete(inFlightKey);
    }
  }
}

export function normalizeUploadRelativePath(input: string): string {
  return normalizeRelativePath(input);
}
