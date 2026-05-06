import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  getChildrenByNodeId,
  getFileLink,
  getLibraryRootNodeId,
  updateNodeFileContent,
} from '../services/file.api';
import { fileCache } from '@/utils/fileCache.ts';
import { buildFileFullName, buildTreeNodeLabel } from '@/utils/fileTreeSettings';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { getDirectoryBuiltInIcon, getFileNodeIconByParentBuiltInType } from '../utils/file-node-icon';
import type { AppendNodeBatchItem, Node, NodeRespDTO } from './use-repository-tree/types';
import {
  findNodeById,
  findNodeByKey,
  isFileNodeType,
  isHiddenNodeName,
  isImageFileNode,
  isVideoFileNode,
  mapChildrenToTreeNodes,
  mergeNodesPreservingLoadedState,
  normalizeArchiveMode,
  removeTreeNodeByKey,
  replaceNodeChildren,
  resolveFileType,
} from './use-repository-tree/tree-utils';
import {
  clearRepositoryTreeSnapshotDirty,
  getRepositoryTreeSnapshot,
  invalidateRepositoryTreeSnapshot as invalidateRepositoryTreeSnapshotStore,
  isRepositoryTreeSnapshotDirty,
  markRepositoryTreeSnapshotDirty as markRepositoryTreeSnapshotDirtyStore,
  saveRepositoryTreeSnapshot,
  hasRepositoryTreeSnapshot,
} from './use-repository-tree/snapshot-store';
import type { FileViewerFileType } from '@/shared/file-viewer-types';
import type { FileViewerOpenOptions } from '@/contexts/file-viewer.context';

const PENDING_APPEND_RETRY_INTERVAL_MS = 420;
const PENDING_APPEND_MAX_RETRY = 40;
const PENDING_APPEND_MAX_AGE_MS = 2 * 60 * 1000;

export type { Node, NodeRespDTO, AppendNodeBatchItem } from './use-repository-tree/types';

export function invalidateRepositoryTreeSnapshot(libraryId: number) {
  invalidateRepositoryTreeSnapshotStore(libraryId);
}

export function markRepositoryTreeSnapshotDirty(libraryId: number) {
  markRepositoryTreeSnapshotDirtyStore(libraryId);
}

export function useRepositoryTree(
  libraryId: number,
  onFileOpen?: (
    fileUrl: string,
    fileName: string,
    fileType: FileViewerFileType,
    nodeId: number,
    options?: FileViewerOpenOptions,
  ) => void,
) {
  const cachedSnapshot = getRepositoryTreeSnapshot(libraryId);
  const defaultRepositoryId = String(libraryId);

  // const [repositories, setRepositories] = useState<{ id: string | number; name: string }[]>([]);
  const [selectedRepository, setSelectedRepository] = useState<string>(
    cachedSnapshot?.selectedRepository || defaultRepositoryId,
  );
  const [rootNodeId, setRootNodeId] = useState<number | null>(cachedSnapshot?.rootNodeId ?? null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>(cachedSnapshot?.expandedKeys || []);
  const [treesCache, setTreesCache] = useState<Record<string, Node[]>>(cachedSnapshot?.treesCache || {});

  // ref 追踪状态
  const loadingNodes = useRef<Set<string>>(new Set());
  const rootNodeIdRef = useRef<number | null>(cachedSnapshot?.rootNodeId ?? null);
  const expandedKeysRef = useRef<string[]>([]);
  const treesCacheRef = useRef<Record<string, Node[]>>({});
  const pendingAppendByRepositoryRef = useRef<Map<string, AppendNodeBatchItem[]>>(new Map());
  const pendingAppendRetryTimerRef = useRef<number | null>(null);
  const appendNodesByRepositoryRef = useRef<(repositoryId: string | number, items: AppendNodeBatchItem[]) => void>(() => { /* noop */ });
  const audioArchiveShownDirectoryIdsRef = useRef<Set<number>>(new Set());
  const audioArchiveShownAudioNodeIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    rootNodeIdRef.current = rootNodeId;
  }, [rootNodeId]);

  // 同步 treesCache 到 ref
  useEffect(() => {
    treesCacheRef.current = treesCache;
  }, [treesCache]);

  // 同步 expandedKeys
  useEffect(() => {
    expandedKeysRef.current = expandedKeys;
  }, [expandedKeys]);

  const schedulePendingAppendRetry = useCallback(() => {
    if (pendingAppendRetryTimerRef.current !== null) {
      return;
    }
    pendingAppendRetryTimerRef.current = window.setTimeout(() => {
      pendingAppendRetryTimerRef.current = null;
      const pendingEntries = Array.from(pendingAppendByRepositoryRef.current.entries());
      pendingAppendByRepositoryRef.current.clear();
      pendingEntries.forEach(([repositoryId, items]) => {
        if (!items.length) return;
        appendNodesByRepositoryRef.current(repositoryId, items);
      });
    }, PENDING_APPEND_RETRY_INTERVAL_MS);
  }, []);

  const mergePendingAppendItems = useCallback((repositoryId: string, items: AppendNodeBatchItem[]) => {
    const now = Date.now();
    const existing = pendingAppendByRepositoryRef.current.get(repositoryId) || [];
    const merged = new Map<string, AppendNodeBatchItem>();

    [...existing, ...items].forEach((item) => {
      const retryCount = Number(item.retryCount ?? 0);
      const firstQueuedAt = Number(item.firstQueuedAt ?? now);
      if (retryCount > PENDING_APPEND_MAX_RETRY) {
        return;
      }
      if (now - firstQueuedAt > PENDING_APPEND_MAX_AGE_MS) {
        return;
      }
      const dedupeKey = `${item.parentNodeKey}:${item.newNodeDTO.id}`;
      const previous = merged.get(dedupeKey);
      if (!previous || (retryCount > Number(previous.retryCount ?? 0))) {
        merged.set(dedupeKey, {
          ...item,
          retryCount,
          firstQueuedAt,
        });
      }
    });

    if (merged.size > 0) {
      pendingAppendByRepositoryRef.current.set(repositoryId, Array.from(merged.values()));
      schedulePendingAppendRetry();
      return;
    }
    pendingAppendByRepositoryRef.current.delete(repositoryId);
  }, [schedulePendingAppendRetry]);

  const resolveLibraryRootNodeId = useCallback(async (repoLibraryId: number): Promise<number> => {
    const remoteRootNodeId = Number(await getLibraryRootNodeId(repoLibraryId));
    if (!Number.isFinite(remoteRootNodeId) || remoteRootNodeId <= 0) {
      throw new Error(`Invalid root node id for library ${repoLibraryId}: ${remoteRootNodeId}`);
    }
    return remoteRootNodeId;
  }, []);

  // 切换仓库
  const selectRepository = useCallback(async (id: string, options?: { resetExpanded?: boolean }) => {
    setSelectedRepository(id);
    if (options?.resetExpanded ?? true) {
      setExpandedKeys([]);
      expandedKeysRef.current = [];
    }

    const repoLibraryId = Number(id);
    const nextRootNodeId = await resolveLibraryRootNodeId(repoLibraryId);
    setRootNodeId(nextRootNodeId);
    rootNodeIdRef.current = nextRootNodeId;

    const rootNodes = (await getChildrenByNodeId(nextRootNodeId, repoLibraryId)) as NodeRespDTO[];
    const mappedRoots = mapChildrenToTreeNodes(rootNodes);
    setTreesCache(prev => {
      const current = prev[id] || [];
      return {
        ...prev,
        [id]: mergeNodesPreservingLoadedState(current, mappedRoots),
      };
    });
  }, [resolveLibraryRootNodeId]);

  // 快照保存：切走页面后可恢复
  useEffect(() => {
    saveRepositoryTreeSnapshot(libraryId, {
      selectedRepository,
      rootNodeId,
      expandedKeys,
      treesCache,
    });
  }, [libraryId, selectedRepository, rootNodeId, expandedKeys, treesCache]);

  // 当前树数据（保持引用稳定）
  const currentTreeData = treesCache[selectedRepository] || [];

  // 深度更新子节点
  const updateNodeChildren = useCallback((
    nodes: Node[],
    key: string,
    children: Node[],
    options?: { markLoaded?: boolean },
  ): Node[] => {
    const markLoaded = options?.markLoaded ?? true;
    return replaceNodeChildren(nodes, key, children, { markLoaded });
  }, []);

  // 脏标记重建：保留展开状态，按可见展开分支重拉数据，避免“恢复后整树折叠”
  const rebuildTreeByExpandedState = useCallback(async (
    repoId: string,
    rootId: number,
    sourceExpandedKeys: string[],
  ) => {
    let rebuiltTree = mapChildrenToTreeNodes(
      (await getChildrenByNodeId(rootId, Number(repoId))) as NodeRespDTO[],
    );
    let pendingKeys = Array.from(new Set(sourceExpandedKeys));

    while (pendingKeys.length > 0) {
      const nextPending: string[] = [];
      let progressed = false;

      for (const key of pendingKeys) {
        const target = findNodeByKey(rebuiltTree, key);
        if (!target) {
          // 目标节点可能在上层目录加载后出现，放到下一轮重试
          nextPending.push(key);
          continue;
        }
        if (target.type !== 'dir') {
          continue;
        }
        const children = (await getChildrenByNodeId(target.id, Number(repoId))) as NodeRespDTO[];
        rebuiltTree = updateNodeChildren(
          rebuiltTree,
          key,
          mapChildrenToTreeNodes(children, target, {
            showAllSubtitles: audioArchiveShownDirectoryIdsRef.current.has(target.id),
            expandedAudioNodeIds: audioArchiveShownAudioNodeIdsRef.current,
          }),
        );
        progressed = true;
      }

      if (!progressed) {
        break;
      }
      pendingKeys = nextPending;
    }

    const filteredExpandedKeys = sourceExpandedKeys.filter(key => findNodeByKey(rebuiltTree, key));
    return { rebuiltTree, filteredExpandedKeys };
  }, [updateNodeChildren]);

  // 初次加载目录树（支持缓存恢复）
  useEffect(() => {
    const repoId = String(libraryId);
    const hasSnapshot = hasRepositoryTreeSnapshot(libraryId);
    const shouldRebuildTree = isRepositoryTreeSnapshotDirty(libraryId);

    const bootstrap = async () => {
      await selectRepository(repoId, { resetExpanded: !hasSnapshot });

      if (!shouldRebuildTree) {
        return;
      }

      clearRepositoryTreeSnapshotDirty(libraryId);
      try {
        const currentRootNodeId = rootNodeIdRef.current ?? await resolveLibraryRootNodeId(Number(repoId));
        const { rebuiltTree, filteredExpandedKeys } = await rebuildTreeByExpandedState(
          repoId,
          currentRootNodeId,
          expandedKeysRef.current,
        );
        setTreesCache(prev => ({
          ...prev,
          [repoId]: rebuiltTree,
        }));
        setExpandedKeys(filteredExpandedKeys);
        expandedKeysRef.current = filteredExpandedKeys;
      } catch (error) {
        runtimeLogger.warn('目录树脏重建失败，保留现有快照', error);
      }
    };

    void bootstrap();
  }, [libraryId, rebuildTreeByExpandedState, resolveLibraryRootNodeId, selectRepository]);

  // 更新节点名称
  const updateNodeName = useCallback((nodeKey: string, payload: { name: string; ext?: string }) => {
    const newName = payload.name;
    const nextExt = payload.ext ?? '';

    setTreesCache(prev => {
      const current = prev[selectedRepository] || [];
      if (!current.length) return prev;

      const updateNameInTree = (nodes: Node[]): Node[] => {
        return nodes.map(node => {
          if (node.key === nodeKey) {
            return {
              ...node,
              name: newName,
              ext: node.type === 'file' ? nextExt : node.ext,
              label: buildTreeNodeLabel({
                name: newName,
                type: node.type,
                ext: node.type === 'file' ? nextExt : node.ext,
              }),
              data: {
                ...node.data,
                rawName: newName,
                rawExt: node.type === 'file' ? nextExt : node.data?.rawExt,
              },
              icon: node.type === 'file'
                ? getFileNodeIconByParentBuiltInType(
                  nextExt,
                  node.data?.parentBuiltInType,
                  node.data?.parentArchiveMode,
                  newName,
                  {
                    hasAudioSubtitle: node.data?.audioArchiveHasSubtitle === true,
                    audioArchiveSubtitle: node.data?.audioArchiveSubtitle === true,
                  },
                )
                : node.icon,
            };
          }
          if (node.children && node.children.length > 0) {
            const updatedChildren = updateNameInTree(node.children);
            if (updatedChildren !== node.children) {
              return { ...node, children: updatedChildren };
            }
          }
          return node;
        });
      };

      return {
        ...prev,
        [selectedRepository]: updateNameInTree(current),
      };
    });
  }, [selectedRepository]);

  // 更新节点内置配置（内置类型/归档模式）
  const updateNodeBuiltInConfig = useCallback((nodeKey: string, payload: {
    builtInType?: string;
    archiveMode?: number;
  }) => {
    const nextBuiltInType = payload.builtInType ? payload.builtInType.toUpperCase() : undefined;

    setTreesCache(prev => {
      const current = prev[selectedRepository] || [];
      if (!current.length) return prev;

      const updateConfigInTree = (nodes: Node[]): Node[] => {
        return nodes.map(node => {
          if (node.key === nodeKey) {
            const mergedBuiltInType = nextBuiltInType ?? node.builtInType ?? 'DEF';
            const mergedArchiveMode = mergedBuiltInType === 'DEF'
              ? 0
              : normalizeArchiveMode(payload.archiveMode ?? node.archiveMode);
            const mergedChildren: Node[] | undefined = node.children?.map((child: Node): Node => {
              if (child.type !== 'file') {
                return child;
              }
              return {
                ...child,
                icon: getFileNodeIconByParentBuiltInType(child.ext, mergedBuiltInType, mergedArchiveMode),
                data: {
                  ...(child.data || { rawName: child.name, rawExt: child.ext || '' }),
                  rawName: child.data?.rawName || child.name,
                  rawExt: child.data?.rawExt ?? child.ext ?? '',
                  parentBuiltInType: mergedBuiltInType,
                  parentArchiveMode: mergedArchiveMode,
                  audioArchiveAudio: false,
                  audioArchiveHasSubtitle: false,
                  audioArchiveSubtitle: false,
                  audioArchiveSubtitleOwnerId: undefined,
                },
              };
            });
            return {
              ...node,
              builtInType: mergedBuiltInType,
              archiveMode: mergedArchiveMode,
              icon: node.type === 'dir' ? getDirectoryBuiltInIcon(mergedBuiltInType, mergedArchiveMode) : node.icon,
              children: mergedChildren ?? node.children,
            };
          }
          if (node.children && node.children.length > 0) {
            const updatedChildren = updateConfigInTree(node.children);
            if (updatedChildren !== node.children) {
              return { ...node, children: updatedChildren };
            }
          }
          return node;
        });
      };

      return {
        ...prev,
        [selectedRepository]: updateConfigInTree(current),
      };
    });
  }, [selectedRepository]);

  const appendNodesByRepository = useCallback((
    repositoryId: string | number,
    items: AppendNodeBatchItem[],
  ) => {
    if (!items.length) {
      return;
    }
    const repositoryKey = String(repositoryId);
    const pendingRetryItems: AppendNodeBatchItem[] = [];

    setTreesCache(prev => {
      const current = prev[repositoryKey] || [];
      const rootItems: NodeRespDTO[] = [];
      const parentGroups = new Map<string, AppendNodeBatchItem[]>();

      items.forEach((item) => {
        if (item.parentNodeKey === 'root') {
          rootItems.push(item.newNodeDTO);
          return;
        }
        const group = parentGroups.get(item.parentNodeKey) || [];
        group.push(item);
        parentGroups.set(item.parentNodeKey, group);
      });

      let nextCurrent = current;
      let changed = false;

      if (rootItems.length > 0) {
        const mappedRoots = mapChildrenToTreeNodes(rootItems);
        nextCurrent = [...nextCurrent, ...mappedRoots];
        changed = true;
      }

      const unresolvedItems: AppendNodeBatchItem[] = [];

      parentGroups.forEach((groupItems, parentNodeKey) => {
        if (!nextCurrent.length) return;
        const parent = findNodeByKey(nextCurrent, parentNodeKey);
        if (!parent) {
          groupItems.forEach((item) => {
            unresolvedItems.push({
              parentNodeKey,
              newNodeDTO: item.newNodeDTO,
              retryCount: Number(item.retryCount ?? 0),
              firstQueuedAt: Number(item.firstQueuedAt ?? Date.now()),
            });
          });
          return;
        }
        const mappedChildren = mapChildrenToTreeNodes(
          groupItems.map(item => item.newNodeDTO),
          parent,
          {
            showAllSubtitles: audioArchiveShownDirectoryIdsRef.current.has(parent.id),
            expandedAudioNodeIds: audioArchiveShownAudioNodeIdsRef.current,
          },
        );
        const newChildren = parent.children ? [...parent.children, ...mappedChildren] : mappedChildren;
        nextCurrent = updateNodeChildren(
          nextCurrent,
          parentNodeKey,
          newChildren,
          { markLoaded: parent.loaded === true },
        );
        changed = true;
      });

      if (unresolvedItems.length > 0) {
        pendingRetryItems.push(...unresolvedItems.map((item) => ({
          ...item,
          retryCount: Number(item.retryCount ?? 0) + 1,
          firstQueuedAt: Number(item.firstQueuedAt ?? Date.now()),
        })));
      }

      if (!changed) {
        return prev;
      }

      return {
        ...prev,
        [repositoryKey]: nextCurrent,
      };
    });

    if (pendingRetryItems.length > 0) {
      mergePendingAppendItems(repositoryKey, pendingRetryItems);
    }
  }, [mergePendingAppendItems, updateNodeChildren]);

  appendNodesByRepositoryRef.current = appendNodesByRepository;

  // 在某个父节点下追加一个子节点（上传成功后用）
  const appendNodeUnderParent = useCallback(
    (parentNodeKey: string, newNodeDTO: NodeRespDTO) => {
      appendNodesByRepository(selectedRepository, [{ parentNodeKey, newNodeDTO }]);
    },
    [appendNodesByRepository, selectedRepository],
  );

  const appendNodesUnderParents = useCallback(
    (items: AppendNodeBatchItem[]) => {
      appendNodesByRepository(selectedRepository, items);
    },
    [appendNodesByRepository, selectedRepository],
  );

  const appendNodesUnderParentsByRepository = useCallback(
    (repositoryId: number, items: AppendNodeBatchItem[]) => {
      appendNodesByRepository(repositoryId, items);
    },
    [appendNodesByRepository],
  );

  useEffect(() => () => {
    if (pendingAppendRetryTimerRef.current !== null) {
      window.clearTimeout(pendingAppendRetryTimerRef.current);
      pendingAppendRetryTimerRef.current = null;
    }
    pendingAppendByRepositoryRef.current.clear();
  }, []);

  // 递归删除节点及其所有子节点
  const removeNodeFromTree = useCallback((nodes: Node[], targetKey: string): Node[] => {
    return removeTreeNodeByKey(nodes, targetKey);
  }, []);

  // 删除节点（删除成功后调用）
  const removeNode = useCallback((nodeKey: string) => {
    setTreesCache(prev => {
      const current = prev[selectedRepository] || [];
      if (!current.length) return prev;
      
      const updated = removeNodeFromTree(current, nodeKey);
      return {
        ...prev,
        [selectedRepository]: updated,
      };
    });
  }, [selectedRepository, removeNodeFromTree]);

  // 刷新某个父节点下的直接子节点（用于移动后同步排序/归属）
  const refreshParentChildren = useCallback(async (parentId: number) => {
    const children = (await getChildrenByNodeId(parentId, Number(selectedRepository))) as NodeRespDTO[];
    const currentRootNodeId = rootNodeIdRef.current;
    const current = treesCacheRef.current[selectedRepository] || [];
    const parentNode = currentRootNodeId !== null && parentId === currentRootNodeId
      ? undefined
      : findNodeById(current, parentId) || undefined;
    const mapped = mapChildrenToTreeNodes(children, parentNode, {
      showAllSubtitles: audioArchiveShownDirectoryIdsRef.current.has(parentId),
      expandedAudioNodeIds: audioArchiveShownAudioNodeIdsRef.current,
    });

    setTreesCache(prev => {
      const current = prev[selectedRepository] || [];

      // 根目录：直接替换根列表
      if (currentRootNodeId !== null && parentId === currentRootNodeId) {
        return {
          ...prev,
          [selectedRepository]: mergeNodesPreservingLoadedState(current, mapped),
        };
      }

      if (!current.length) return prev;
      const parentNode = findNodeById(current, parentId);
      if (!parentNode) return prev;
      const mergedChildren = mergeNodesPreservingLoadedState(current, mapped);

      return {
        ...prev,
        [selectedRepository]: updateNodeChildren(current, parentNode.key, mergedChildren),
      };
    });
  }, [selectedRepository, updateNodeChildren]);

  const refreshAfterMove = useCallback(async (affectedParentIds: number[]) => {
    const normalizedParentIds = Array.from(
      new Set(
        (affectedParentIds || [])
          .map(item => Number(item))
          .filter(item => Number.isFinite(item) && item > 0),
      ),
    );
    for (const parentId of normalizedParentIds) {
      await refreshParentChildren(parentId);
    }
  }, [refreshParentChildren]);

  const collectRefreshSubtreeIds = useCallback((parentId: number): number[] => {
    const current = treesCacheRef.current[selectedRepository] || [];
    const expandedKeySet = new Set(expandedKeysRef.current);
    const currentRootNodeId = rootNodeIdRef.current;

    const collectExpandedDescendantIds = (node: Node): number[] => {
      const result = [node.id];
      if (!node.children || node.children.length === 0) {
        return result;
      }
      node.children.forEach((child) => {
        if (child.type !== 'dir' || child.loaded !== true || !expandedKeySet.has(child.key)) {
          return;
        }
        result.push(...collectExpandedDescendantIds(child));
      });
      return result;
    };

    if (currentRootNodeId !== null && parentId === currentRootNodeId) {
      const result = [currentRootNodeId];
      current.forEach((child) => {
        if (child.type !== 'dir' || child.loaded !== true || !expandedKeySet.has(child.key)) {
          return;
        }
        result.push(...collectExpandedDescendantIds(child));
      });
      return result;
    }

    const targetNode = findNodeById(current, parentId);
    if (!targetNode || targetNode.type !== 'dir') {
      return [];
    }

    return collectExpandedDescendantIds(targetNode);
  }, [selectedRepository]);

  // 刷新当前目录，并继续刷新其下已展开的子目录，避免局部刷新后可见树状态过旧。
  const refreshNodeSubtree = useCallback(async (parentId: number) => {
    const normalizedParentId = Number(parentId);
    if (!Number.isFinite(normalizedParentId) || normalizedParentId <= 0) {
      return;
    }

    const refreshTargets = collectRefreshSubtreeIds(normalizedParentId);
    const currentRootNodeId = rootNodeIdRef.current;
    const fallbackTargets = refreshTargets.length > 0 ? refreshTargets : [normalizedParentId];

    for (const targetId of fallbackTargets) {
      const currentTree = treesCacheRef.current[selectedRepository] || [];
      if (currentRootNodeId !== null && targetId === currentRootNodeId) {
        await refreshParentChildren(targetId);
        continue;
      }

      const targetNode = findNodeById(currentTree, targetId);
      if (!targetNode || targetNode.type !== 'dir') {
        continue;
      }
      await refreshParentChildren(targetId);
    }
  }, [collectRefreshSubtreeIds, refreshParentChildren, selectedRepository]);

  // 加载子节点，加载完成后下一帧展开（保证动画）
  const loadChildren = useCallback(async (node: Node): Promise<void> => {
    if (node.loaded || node.type !== 'dir') return;
    if (loadingNodes.current.has(node.key)) return;

    loadingNodes.current.add(node.key);

    try {
      const children = await getChildrenByNodeId(node.id, Number(selectedRepository));
      const mapped = mapChildrenToTreeNodes(children as NodeRespDTO[], node, {
        showAllSubtitles: audioArchiveShownDirectoryIdsRef.current.has(node.id),
        expandedAudioNodeIds: audioArchiveShownAudioNodeIdsRef.current,
      });

      // 第一步：先把子节点数据写入树（此时节点仍然是收起状态）
      setTreesCache(prev => ({
        ...prev,
        [selectedRepository]: updateNodeChildren(prev[selectedRepository], node.key, mapped),
      }));

      // 第二步：等 React 渲染完子节点后，下一帧再展开 → 触发动画
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          if (!expandedKeysRef.current.includes(node.key)) {
            const newKeys = [...expandedKeysRef.current, node.key];
            setExpandedKeys(newKeys);
            expandedKeysRef.current = newKeys;
          }
          resolve();
        });
      });
    } finally {
      loadingNodes.current.delete(node.key);
    }
  }, [selectedRepository, updateNodeChildren]);

  // 处理展开事件（点击三角箭头）
  const handleExpand = useCallback((keys: string[]) => {
    // 找出新展开的 key，如果节点未加载则拦截（由 loadData 处理）
    const prevKeys = new Set(expandedKeysRef.current);
    const newlyExpanded = keys.filter(k => !prevKeys.has(k));

    if (newlyExpanded.length > 0) {
      const tree = treesCacheRef.current[selectedRepository] || [];
      const unloadedKeys = new Set<string>();
      for (const key of newlyExpanded) {
        const node = findNodeByKey(tree, key);
        if (node && node.type === 'dir' && !node.loaded) {
          unloadedKeys.add(key);
        }
      }
      // 过滤掉未加载的节点，不要立即展开它们
      if (unloadedKeys.size > 0) {
        const filtered = keys.filter(k => !unloadedKeys.has(k));
        setExpandedKeys(filtered);
        expandedKeysRef.current = filtered;
        return;
      }
    }

    setExpandedKeys(keys);
    expandedKeysRef.current = keys;
  }, [selectedRepository]);

  // 双击事件
  const handleDoubleClick = useCallback(async (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    e.stopPropagation();

    const isExpanded = expandedKeysRef.current.includes(node.key);
    const selectedLibraryId = Number(selectedRepository);
    const openFileByNodeInfo = async (payload: Pick<NodeRespDTO, 'id' | 'name' | 'ext' | 'mimeType'> & {
      displayName?: string;
      tabNodeId?: number;
      linkNodeId?: number;
      tabTypeLabel?: string | null;
    }) => {
      const linkNodeId = Number(payload.linkNodeId ?? payload.id);
      const tabNodeId = Number(payload.tabNodeId ?? payload.id);
      const fileName = payload.displayName ?? buildFileFullName(payload.name, payload.ext);
      const fileType = resolveFileType(payload.mimeType, payload.ext, payload.name);

      let fileUrl = fileType === 'text'
        ? ''
        : fileCache.getLink(linkNodeId, selectedLibraryId);
      if (!fileUrl) {
        runtimeLogger.debug('🚀 缓存失效，请求后端获取新链接');
        try {
          fileUrl = await getFileLink(linkNodeId, selectedLibraryId, 60);
        } catch (error) {
          if (fileType !== 'text') {
            throw error;
          }
          runtimeLogger.warn('文本文件缺少存储对象，尝试初始化为空文件:', error);
          await updateNodeFileContent({
            nodeId: linkNodeId,
            libraryId: selectedLibraryId,
            content: '',
            contentType: payload.mimeType || 'text/plain; charset=utf-8',
          });
          fileUrl = await getFileLink(linkNodeId, selectedLibraryId, 60);
        }
        if (fileUrl) {
          fileCache.setLink(linkNodeId, selectedLibraryId, fileUrl, 30);
        }
      } else {
        runtimeLogger.debug('✅ 使用本地缓存的链接');
      }

      if (!fileUrl) {
        throw new Error('无法获取文件访问链接');
      }

      if (onFileOpen) {
        onFileOpen(fileUrl, fileName, fileType, tabNodeId, {
          tabTypeLabel: payload.tabTypeLabel ?? null,
        });
      }
    };

    if (node.type === 'dir') {
      const builtInType = String(node.builtInType || 'DEF').toUpperCase();
      const archiveMode = normalizeArchiveMode(node.archiveMode);

      const toggleDirectoryNodeExpand = async () => {
        if (!node.loaded) {
          await loadChildren(node);
        } else {
          const newKeys = isExpanded
            ? expandedKeysRef.current.filter(k => k !== node.key)
            : [...expandedKeysRef.current, node.key];
          setExpandedKeys(newKeys);
          expandedKeysRef.current = newKeys;
        }
      };

      if (archiveMode === 1 && builtInType === 'ASMR') {
        if (onFileOpen) {
          onFileOpen(
            `asmr-archive://library/${selectedLibraryId}/node/${node.id}`,
            node.name,
            'asmr_archive',
            node.id,
            { tabTypeLabel: 'ASMR-ARCHIVE' },
          );
        }
        return;
      }

      if (archiveMode === 1 && builtInType === 'COMIC') {
        if (onFileOpen) {
          onFileOpen(
            `comic-archive://library/${selectedLibraryId}/node/${node.id}`,
            node.name,
            'comic_archive',
            node.id,
            { tabTypeLabel: 'COMIC-ARCHIVE' },
          );
        }
        return;
      }

      if (archiveMode === 1 && builtInType === 'VIDEO') {
        if (onFileOpen) {
          onFileOpen(
            `video-archive://library/${selectedLibraryId}/node/${node.id}`,
            node.name,
            'video_archive',
            node.id,
            { tabTypeLabel: 'VIDEO-ARCHIVE' },
          );
        }
        return;
      }

      if (archiveMode === 1 && builtInType === 'AUDIO') {
        if (onFileOpen) {
          onFileOpen(
            `audio-archive://library/${selectedLibraryId}/node/${node.id}`,
            node.name,
            'audio_archive',
            node.id,
            { tabTypeLabel: 'AUDIO-ARCHIVE' },
          );
        }
        return;
      }

      if (archiveMode === 1) {
        await toggleDirectoryNodeExpand();
        return;
      }

      if (builtInType === 'COMIC') {
        if (onFileOpen) {
          onFileOpen(
            `comic://library/${selectedLibraryId}/node/${node.id}`,
            node.name,
            'comic',
            node.id,
            { tabTypeLabel: builtInType },
          );
        }
        return;
      }

      if (builtInType === 'ASMR') {
        if (onFileOpen) {
          onFileOpen(
            `asmr://library/${selectedLibraryId}/node/${node.id}`,
            node.name,
            'asmr',
            node.id,
            { tabTypeLabel: builtInType },
          );
        }
        return;
      }

      if (builtInType === 'VIDEO') {
        try {
          const children = (await getChildrenByNodeId(node.id, selectedLibraryId)) as NodeRespDTO[];
          const firstVideoNode = children.find(item => (
            isFileNodeType(item.type)
            && !isHiddenNodeName(item.name, item.ext)
            && isVideoFileNode(item)
          ));
          if (!firstVideoNode) {
            runtimeLogger.warn('视频目录无可打开视频:', node.name);
            return;
          }
          await openFileByNodeInfo({
            ...firstVideoNode,
            displayName: node.name,
            tabNodeId: node.id,
            tabTypeLabel: builtInType,
          });
        } catch (error) {
          runtimeLogger.error('打开视频目录内容失败:', error);
        }
        return;
      }

      if (builtInType !== 'DEF') {
        try {
          const children = (await getChildrenByNodeId(node.id, selectedLibraryId)) as NodeRespDTO[];
          const firstImageNode = children.find(item => (
            isFileNodeType(item.type)
            && !isHiddenNodeName(item.name, item.ext)
            && isImageFileNode(item)
          ));
          if (!firstImageNode) {
            runtimeLogger.warn('内置目录无可打开图片:', node.name);
            return;
          }
          await openFileByNodeInfo({
            ...firstImageNode,
            displayName: node.name,
            tabNodeId: node.id,
            tabTypeLabel: builtInType,
          });
        } catch (error) {
          runtimeLogger.error('打开内置目录内容失败:', error);
        }
        return;
      }

      await toggleDirectoryNodeExpand();
    } else {
      // 双击文件：获取文件临时访问链接
      runtimeLogger.debug('📄 双击文件:', node.name);
      try {
        await openFileByNodeInfo({
          id: node.id,
          name: node.name,
          ext: node.ext,
          mimeType: node.mimeType,
        });
      } catch (error) {
        runtimeLogger.error('获取文件链接失败:', error);
      }
    }
  }, [loadChildren, onFileOpen, selectedRepository]);

  const toggleAudioArchiveSubtitles = useCallback(async (node: Node, visible: boolean) => {
    const nodeId = Number(node?.id);
    if (!Number.isFinite(nodeId) || nodeId <= 0) {
      return;
    }

    if (node.type === 'dir') {
      if (visible) {
        audioArchiveShownDirectoryIdsRef.current.add(nodeId);
      } else {
        audioArchiveShownDirectoryIdsRef.current.delete(nodeId);
      }
      await refreshParentChildren(nodeId);
      return;
    }

    const parentId = Number(node.parentId);
    if (!Number.isFinite(parentId) || parentId <= 0) {
      return;
    }
    if (visible) {
      audioArchiveShownAudioNodeIdsRef.current.add(nodeId);
    } else {
      audioArchiveShownAudioNodeIdsRef.current.delete(nodeId);
    }
    await refreshParentChildren(parentId);
  }, [refreshParentChildren]);

  const isAudioArchiveSubtitlesVisible = useCallback((node: Node): boolean => {
    const nodeId = Number(node?.id);
    if (!Number.isFinite(nodeId) || nodeId <= 0) {
      return false;
    }
    if (node.type === 'dir') {
      return audioArchiveShownDirectoryIdsRef.current.has(nodeId);
    }
    return audioArchiveShownAudioNodeIdsRef.current.has(nodeId);
  }, []);

  return {
    selectedRepository,
    rootNodeId,
    expandedKeys,
    currentTreeData,
    selectRepository,
    handleExpand,
    handleDoubleClick,
    loadChildren,
    appendNodeUnderParent,
    appendNodesUnderParents,
    appendNodesUnderParentsByRepository,
    removeNode,
    updateNodeName,
    updateNodeBuiltInConfig,
    refreshAfterMove,
    refreshNodeSubtree,
    toggleAudioArchiveSubtitles,
    isAudioArchiveSubtitlesVisible,
  };
}
