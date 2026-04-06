import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getChildrenByNodeId, getFileLink } from '../services/file.api';
import { fileCache } from '@/utils/fileCache.ts';
import { buildTreeNodeLabel } from '@/utils/fileTreeSettings';
import { getDirectoryBuiltInIcon, getFileNodeIconByParentBuiltInType } from '../utils/file-node-icon';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { resolvePreviewFileType } from '@/utils/preview-file-type';

// 目录节点信息
interface Node {
  id: number;
  name: string;
  type: string;      // dir=文件夹, file=文件
  parentId: number;
  libraryId: number;
  label: string;
  isLeaf: boolean;
  children?: Node[];
  key: string;       // 唯一标识，用于树组件
  loaded?: boolean;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
  data?: {
    rawName: string; // 保留未截断的原始名称
    rawExt?: string;
    parentArchiveMode?: number;
    [key: string]: any; // 以后还可以加别的
  };
  icon?: React.ReactNode;
  builtInType?: string;
  archiveMode?: number;
}

function normalizeArchiveMode(mode?: number): 0 | 1 {
  return Number(mode ?? 0) === 1 ? 1 : 0;
}

export interface NodeRespDTO {
  id: number;
  name: string;
  type: 'dir' | 'file';
  parentId: number;
  libraryId: number;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
  builtInType?: string;
  archiveMode?: number;
}

interface RepositoryTreeSnapshot {
  selectedRepository: string;
  expandedKeys: string[];
  treesCache: Record<string, Node[]>;
}

const REPOSITORY_TREE_SNAPSHOT_MAX_ENTRIES = 20;
const repositoryTreeSnapshotStore = new Map<number, RepositoryTreeSnapshot>();
const repositoryTreeDirtyLibraries = new Set<number>();
function resolveFileType(
  mimeType?: string,
  ext?: string,
): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
  return resolvePreviewFileType(mimeType, ext);
}

function isImageFileNode(item: Pick<NodeRespDTO, 'mimeType' | 'ext'>): boolean {
  return resolveFileType(item.mimeType, item.ext) === 'image';
}

function isFileNodeType(type: unknown): boolean {
  return String(type) === 'file' || Number(type) === 1;
}

export function invalidateRepositoryTreeSnapshot(libraryId: number) {
  repositoryTreeSnapshotStore.delete(libraryId);
}

export function markRepositoryTreeSnapshotDirty(libraryId: number) {
  repositoryTreeDirtyLibraries.add(libraryId);
}

function setRepositoryTreeSnapshot(libraryId: number, snapshot: RepositoryTreeSnapshot) {
  if (repositoryTreeSnapshotStore.has(libraryId)) {
    repositoryTreeSnapshotStore.delete(libraryId);
  }
  repositoryTreeSnapshotStore.set(libraryId, snapshot);
  if (repositoryTreeSnapshotStore.size > REPOSITORY_TREE_SNAPSHOT_MAX_ENTRIES) {
    const oldestLibraryId = repositoryTreeSnapshotStore.keys().next().value;
    if (oldestLibraryId !== undefined) {
      repositoryTreeSnapshotStore.delete(oldestLibraryId);
    }
  }
}

function findNodeByKey(nodes: Node[], key: string): Node | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeByKey(node.children, key);
      if (found) return found;
    }
  }
  return null;
}

function findNodeById(nodes: Node[], id: number): Node | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function mergeRootNodesPreservingLoadedState(previousRoots: Node[], nextRoots: Node[]): Node[] {
  const previousById = new Map<number, Node>(previousRoots.map(node => [node.id, node]));
  return nextRoots.map((node) => {
    const previous = previousById.get(node.id);
    if (!previous) {
      return node;
    }
    if (node.type !== 'dir' || previous.type !== 'dir') {
      return node;
    }
    if (previous.loaded !== true) {
      return node;
    }
    return {
      ...node,
      loaded: true,
      children: previous.children || [],
    };
  });
}

export function useRepositoryTree(
  libraryId: number,
  onFileOpen?: (
    fileUrl: string,
    fileName: string,
    fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'other',
    nodeId: number,
    options?: {
      tabTypeLabel?: string | null;
      returnTarget?: {
        fileUrl: string;
        fileName: string | null;
        fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'other';
        nodeId: number | null;
        tabTypeLabel?: string | null;
      } | null;
    },
  ) => void,
) {
  const cachedSnapshot = repositoryTreeSnapshotStore.get(libraryId);
  const defaultRepositoryId = String(libraryId);

  // const [repositories, setRepositories] = useState<{ id: string | number; name: string }[]>([]);
  const [selectedRepository, setSelectedRepository] = useState<string>(
    cachedSnapshot?.selectedRepository || defaultRepositoryId,
  );
  const [expandedKeys, setExpandedKeys] = useState<string[]>(cachedSnapshot?.expandedKeys || []);
  const [treesCache, setTreesCache] = useState<Record<string, Node[]>>(cachedSnapshot?.treesCache || {});

  // ref 追踪状态
  const loadingNodes = useRef<Set<string>>(new Set());
  const expandedKeysRef = useRef<string[]>([]);
  const treesCacheRef = useRef<Record<string, Node[]>>({});

  // 同步 treesCache 到 ref
  useEffect(() => {
    treesCacheRef.current = treesCache;
  }, [treesCache]);

  // 同步 expandedKeys
  useEffect(() => {
    expandedKeysRef.current = expandedKeys;
  }, [expandedKeys]);

  // 切换仓库
  const selectRepository = useCallback(async (id: string, options?: { resetExpanded?: boolean }) => {
    setSelectedRepository(id);
    if (options?.resetExpanded ?? true) {
      setExpandedKeys([]);
      expandedKeysRef.current = [];
    }

    if (!treesCacheRef.current[id]) {
      const rootNodes = (await getChildrenByNodeId(1, Number(id))) as NodeRespDTO[];
      setTreesCache(prev => ({
        ...prev,
        [id]: rootNodes.map((item: NodeRespDTO) => mapToTreeNode(item)),
      }));
    }
  }, []);

  // 快照保存：切走页面后可恢复
  useEffect(() => {
    setRepositoryTreeSnapshot(libraryId, {
      selectedRepository,
      expandedKeys,
      treesCache,
    });
  }, [libraryId, selectedRepository, expandedKeys, treesCache]);

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
    return nodes.map(node => {
      if (node.key === key) {
        return {
          ...node,
          children,
          loaded: markLoaded ? true : node.loaded,
        };
      }
      if (node.children && node.children.length > 0) {
        const updated = updateNodeChildren(node.children, key, children, options);
        if (updated === node.children) return node;
        return { ...node, children: updated };
      }
      return node;
    });
  }, []);

  // 脏标记重建：保留展开状态，按可见展开分支重拉数据，避免“恢复后整树折叠”
  const rebuildTreeByExpandedState = useCallback(async (repoId: string, sourceExpandedKeys: string[]) => {
    let rebuiltTree = ((await getChildrenByNodeId(1, Number(repoId))) as NodeRespDTO[])
      .map((item: NodeRespDTO) => mapToTreeNode(item));
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
          children.map((item: NodeRespDTO) => mapToTreeNode(item, target)),
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
    const hasSnapshot = repositoryTreeSnapshotStore.has(libraryId);
    const shouldRebuildTree = repositoryTreeDirtyLibraries.has(libraryId);

    const bootstrap = async () => {
      await selectRepository(repoId, { resetExpanded: !hasSnapshot });

      if (!shouldRebuildTree) {
        return;
      }

      repositoryTreeDirtyLibraries.delete(libraryId);
      try {
        const { rebuiltTree, filteredExpandedKeys } = await rebuildTreeByExpandedState(
          repoId,
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
  }, [libraryId, rebuildTreeByExpandedState, selectRepository]);

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

  // 在某个父节点下追加一个子节点（上传成功后用）
  const appendNodeUnderParent = useCallback(
    (parentNodeKey: string, newNodeDTO: NodeRespDTO) => {
      setTreesCache(prev => {
        const current = prev[selectedRepository] || [];
        
        // 如果是根目录（parentNodeKey === 'root' 或 parentId === 1），直接添加到根节点列表
        if (parentNodeKey === 'root' || newNodeDTO.parentId === 1) {
          const mappedRootNode = mapToTreeNode(newNodeDTO);
          return {
            ...prev,
            [selectedRepository]: [...current, mappedRootNode],
          };
        }
        
        if (!current.length) return prev;
        const parent = findNodeByKey(current, parentNodeKey);
        if (!parent) {
          // 父节点还没在当前树里（例如还没展开），那就先不改
          return prev;
        }
        const mappedForParent = mapToTreeNode(newNodeDTO, parent);
        const newChildren = parent.children ? [...parent.children, mappedForParent] : [mappedForParent];
        const shouldMarkLoaded = parent.loaded === true;
        return {
          ...prev,
          [selectedRepository]: updateNodeChildren(
            current,
            parentNodeKey,
            newChildren,
            { markLoaded: shouldMarkLoaded },
          ),
        };
      });
    },
    [selectedRepository, updateNodeChildren],
  );

  // 递归删除节点及其所有子节点
  const removeNodeFromTree = useCallback((nodes: Node[], targetKey: string): Node[] => {
    return nodes
      .filter(node => {
        // 如果当前节点就是要删除的节点，直接过滤掉（包括其所有子节点）
        return node.key !== targetKey;
      })
      .map(node => {
        // 如果有子节点，递归处理子节点
        if (node.children && node.children.length > 0) {
          const filteredChildren = removeNodeFromTree(node.children, targetKey);
          // 如果子节点被删除，返回新的节点对象（不可变更新）
          if (filteredChildren.length !== node.children.length) {
            return { ...node, children: filteredChildren };
          }
        }
        return node;
      });
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
    const mapped = children.map((item: NodeRespDTO) => {
      if (parentId === 1) {
        return mapToTreeNode(item);
      }
      const current = treesCacheRef.current[selectedRepository] || [];
      const parentNode = findNodeById(current, parentId);
      return mapToTreeNode(item, parentNode || undefined);
    });

    setTreesCache(prev => {
      const current = prev[selectedRepository] || [];

      // 根目录 parentId 为 1，直接替换根列表
      if (parentId === 1) {
        return {
          ...prev,
          [selectedRepository]: mergeRootNodesPreservingLoadedState(current, mapped),
        };
      }

      if (!current.length) return prev;
      const parentNode = findNodeById(current, parentId);
      if (!parentNode) return prev;

      return {
        ...prev,
        [selectedRepository]: updateNodeChildren(current, parentNode.key, mapped),
      };
    });
  }, [selectedRepository, updateNodeChildren]);

  const refreshAfterMove = useCallback(async (oldParentId: number, newParentId: number) => {
    await refreshParentChildren(oldParentId);
    if (newParentId !== oldParentId) {
      await refreshParentChildren(newParentId);
    }
  }, [refreshParentChildren]);

  // 加载子节点，加载完成后下一帧展开（保证动画）
  const loadChildren = useCallback(async (node: Node): Promise<void> => {
    if (node.loaded || node.type !== 'dir') return;
    if (loadingNodes.current.has(node.key)) return;

    loadingNodes.current.add(node.key);

    try {
      const children = await getChildrenByNodeId(node.id, Number(selectedRepository));
      const mapped = (children as NodeRespDTO[]).map((item: NodeRespDTO) => mapToTreeNode(item, node));

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
      const fileName = payload.displayName ?? payload.name;

      let fileUrl = fileCache.getLink(linkNodeId, selectedLibraryId);
      if (!fileUrl) {
        runtimeLogger.debug('🚀 缓存失效，请求后端获取新链接');
        fileUrl = await getFileLink(linkNodeId, selectedLibraryId, 60);
        if (fileUrl) {
          fileCache.setLink(linkNodeId, selectedLibraryId, fileUrl, 30);
        }
      } else {
        runtimeLogger.debug('✅ 使用本地缓存的链接');
      }

      if (!fileUrl) {
        throw new Error('无法获取文件访问链接');
      }

      const fileType = resolveFileType(payload.mimeType, payload.ext);
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

      if (builtInType !== 'DEF') {
        try {
          const children = (await getChildrenByNodeId(node.id, selectedLibraryId)) as NodeRespDTO[];
          const firstImageNode = children.find(item => isFileNodeType(item.type) && isImageFileNode(item));
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

  // 节点转换
  function mapToTreeNode(item: NodeRespDTO, parentNode?: Pick<Node, 'builtInType' | 'archiveMode'>): Node {
    const parentBuiltInType = String(parentNode?.builtInType || 'DEF').toUpperCase();
    const parentArchiveMode = normalizeArchiveMode(parentNode?.archiveMode);
    const nodeBuiltInType = String(item.builtInType || 'DEF').toUpperCase();
    const nodeArchiveMode = nodeBuiltInType === 'DEF'
      ? 0
      : normalizeArchiveMode(item.archiveMode);
    return {
      ...item,
      key: `${item.parentId}:${item.id}`,
      isLeaf: item.type === 'file',
      label: buildTreeNodeLabel({ name: item.name, type: item.type, ext: item.ext }),
      data: {
        rawName: item.name,
        rawExt: item.ext || '',
        parentBuiltInType,
        parentArchiveMode,
      },
      icon: item.type === 'file'
        ? getFileNodeIconByParentBuiltInType(item.ext, parentBuiltInType, parentArchiveMode)
        : getDirectoryBuiltInIcon(nodeBuiltInType, nodeArchiveMode),
      children: item.type === 'dir' ? [] : undefined,
      loaded: false,
      builtInType: nodeBuiltInType,
      archiveMode: nodeArchiveMode,
    };
  }

  return {
    selectedRepository,
    expandedKeys,
    currentTreeData,
    selectRepository,
    handleExpand,
    handleDoubleClick,
    loadChildren,
    appendNodeUnderParent,
    removeNode,
    updateNodeName,
    updateNodeBuiltInConfig,
    refreshAfterMove,
  };
}
