import React, { useState, useCallback, useEffect, useRef } from 'react';
import { fetchRepositories, getChildrenByNodeId } from '@/service/directory-sidebar.api.ts';

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
}

export interface NodeRespDTO {
  id: number;
  name: string;
  type: 'dir' | 'file';
  parentId: number;
  libraryId: number;
}

export function useRepositoryTree() {
  const [repositories, setRepositories] = useState<{ id: string | number; name: string }[]>([]);
  const [selectedRepository, setSelectedRepository] = useState<string>('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [treesCache, setTreesCache] = useState<Record<string, Node[]>>({});

  // ref 追踪状态
  const loadingNodes = useRef<Set<string>>(new Set());
  const expandedKeysRef = useRef<string[]>([]);
  const isUpdatingTree = useRef(false);
  const preservedExpandedKeys = useRef<string[]>([]);

  // 同步 expandedKeys
  useEffect(() => {
    expandedKeysRef.current = expandedKeys;
  }, [expandedKeys]);

  // 初次加载仓库列表
  useEffect(() => {
    (async () => {
      const list = await fetchRepositories();
      setRepositories(list);
      if (list.length > 0) {
        await selectRepository(String(list[0].id));
      }
    })();
  }, []);

  // 切换仓库
  const selectRepository = useCallback(async (id: string) => {
    setSelectedRepository(id);
    setExpandedKeys([]);
    expandedKeysRef.current = [];

    if (!treesCache[id]) {
      const rootNodes = await getChildrenByNodeId(1, Number(id));
      setTreesCache(prev => ({
        ...prev,
        [id]: rootNodes.map(mapToTreeNode),
      }));
    }
  }, [treesCache]);

  // 当前树数据（保持引用稳定）
  const currentTreeData = treesCache[selectedRepository] || [];

  // 深度更新子节点
  const updateNodeChildren = useCallback((nodes: Node[], key: string, children: Node[]): Node[] => {
    return nodes.map(node => {
      if (node.key === key) {
        return { ...node, children, loaded: true };
      }
      if (node.children && node.children.length > 0) {
        const updated = updateNodeChildren(node.children, key, children);
        if (updated === node.children) return node;
        return { ...node, children: updated };
      }
      return node;
    });
  }, []);

  // 加载子节点
  const loadChildren = useCallback(async (node: Node) => {
    if (node.loaded || node.type !== 'dir') return;
    if (loadingNodes.current.has(node.key)) return;

    loadingNodes.current.add(node.key);
    isUpdatingTree.current = true;
    preservedExpandedKeys.current = [...expandedKeysRef.current];

    try {
      const children = await getChildrenByNodeId(node.id, Number(selectedRepository));
      const mapped = children.map(mapToTreeNode);

      setTreesCache(prev => ({
        ...prev,
        [selectedRepository]: updateNodeChildren(prev[selectedRepository], node.key, mapped),
      }));

      // 恢复展开状态
      setTimeout(() => {
        const finalKeys = preservedExpandedKeys.current.includes(node.key)
          ? preservedExpandedKeys.current
          : [...preservedExpandedKeys.current, node.key];

        setExpandedKeys(finalKeys);
        expandedKeysRef.current = finalKeys;
        isUpdatingTree.current = false;
      }, 0);
    } finally {
      loadingNodes.current.delete(node.key);
    }
  }, [selectedRepository, updateNodeChildren]);

  // 处理展开事件
  const handleExpand = useCallback((keys: string[]) => {
    if (isUpdatingTree.current) return; // 更新过程中屏蔽 Tree 的事件
    setExpandedKeys(keys);
    expandedKeysRef.current = keys;
  }, []);

  // 双击事件
  const handleDoubleClick = useCallback(async (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    e.stopPropagation();

    const isExpanded = expandedKeysRef.current.includes(node.key);

    if (node.type === 'dir') {
      if (!node.loaded) {
        await loadChildren(node);
      } else {
        const newKeys = isExpanded
          ? expandedKeysRef.current.filter(k => k !== node.key)
          : [...expandedKeysRef.current, node.key];
        setExpandedKeys(newKeys);
        expandedKeysRef.current = newKeys;
      }
    } else {
      console.log('📄 双击文件:', node.name);
    }
  }, [loadChildren]);

  // 节点转换
  function mapToTreeNode(item: NodeRespDTO): Node {
    return {
      ...item,
      key: `${item.parentId}:${item.id}`,
      isLeaf: item.type === 'file',
      label: item.name,
      children: item.type === 'dir' ? [] : undefined,
      loaded: false,
    };
  }

  return {
    repositories,
    selectedRepository,
    expandedKeys,
    currentTreeData,
    selectRepository,
    handleExpand,
    handleDoubleClick,
  };
}
