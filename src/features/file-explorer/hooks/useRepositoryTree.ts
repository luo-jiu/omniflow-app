import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getChildrenByNodeId, getFileLink } from '../services/file.api';
import { fileCache } from '@/utils/fileCache.ts';
import { buildTreeNodeLabel } from '@/utils/fileTreeSettings';
import imageIcon from '@/assets/icons/material/image.svg';
import audioIcon from '@/assets/icons/material/audio.svg';
import videoIcon from '@/assets/icons/material/video.svg';
import pdfIcon from '@/assets/icons/material/pdf.svg';

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
    [key: string]: any; // 以后还可以加别的
  };
  icon?: React.ReactNode;
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
}

export function useRepositoryTree(libraryId: number, onFileOpen?: (fileUrl: string, fileName: string, fileType: 'image' | 'video' | 'audio' | 'other') => void) {
  // const [repositories, setRepositories] = useState<{ id: string | number; name: string }[]>([]);
  const [selectedRepository, setSelectedRepository] = useState<string>('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [treesCache, setTreesCache] = useState<Record<string, Node[]>>({});

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

  // 初次加载目录树
  useEffect(() => {
    (async () => {
      await selectRepository(String(libraryId));
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

  // 按key找节点
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

  // 更新节点名称
  const updateNodeName = useCallback((nodeKey: string, newName: string) => {
    setTreesCache(prev => {
      const current = prev[selectedRepository] || [];
      if (!current.length) return prev;

      const updateNameInTree = (nodes: Node[]): Node[] => {
        return nodes.map(node => {
          if (node.key === nodeKey) {
            return {
              ...node,
              name: newName,
              label: buildTreeNodeLabel({ name: newName, type: node.type, ext: node.ext }),
              data: { ...node.data, rawName: newName }
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

  // 在某个父节点下追加一个子节点（上传成功后用）
  const appendNodeUnderParent = useCallback(
    (parentNodeKey: string, newNodeDTO: NodeRespDTO) => {
      const mapped = mapToTreeNode(newNodeDTO);

      setTreesCache(prev => {
        const current = prev[selectedRepository] || [];
        
        // 如果是根目录（parentNodeKey === 'root' 或 parentId === 1），直接添加到根节点列表
        if (parentNodeKey === 'root' || newNodeDTO.parentId === 1) {
          return {
            ...prev,
            [selectedRepository]: [...current, mapped],
          };
        }
        
        if (!current.length) return prev;
        const parent = findNodeByKey(current, parentNodeKey);
        if (!parent) {
          // 父节点还没在当前树里（例如还没展开），那就先不改
          return prev;
        }
        const newChildren = parent.children ? [...parent.children, mapped] : [mapped];
        return {
          ...prev,
          [selectedRepository]: updateNodeChildren(current, parentNodeKey, newChildren),
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

  // 加载子节点，加载完成后下一帧展开（保证动画）
  const loadChildren = useCallback(async (node: Node): Promise<void> => {
    if (node.loaded || node.type !== 'dir') return;
    if (loadingNodes.current.has(node.key)) return;

    loadingNodes.current.add(node.key);

    try {
      const children = await getChildrenByNodeId(node.id, Number(selectedRepository));
      const mapped = children.map(mapToTreeNode);

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
      // 双击文件：获取文件临时访问链接
      console.log('📄 双击文件:', node.name);
      try {
        const fileName = node.name;
        const nodeId = node.id;
        const libraryId = Number(selectedRepository);
        
        // 1. 尝试从缓存获取
        let fileUrl = fileCache.getLink(nodeId, libraryId);
        
        if (!fileUrl) {
          // 2. 缓存失效或不存在，请求后端
          console.log('🚀 缓存失效，请求后端获取新链接');
          // 请求后端生成 60 分钟有效期的链接，但我们本地只缓存 30 分钟以确保安全
          fileUrl = await getFileLink(nodeId, libraryId, 60);
          
          // 3. 存储到缓存，设置 30 分钟过期
          if (fileUrl) {
            fileCache.setLink(nodeId, libraryId, fileUrl, 30);
          }
        } else {
          console.log('✅ 使用本地缓存的链接');
        }

        if (!fileUrl) {
          throw new Error('无法获取文件访问链接');
        }
        
        // 判断文件类型
        let fileType: 'image' | 'video' | 'audio' | 'other' = 'other';
        const mimeType = node.mimeType;
        const ext = node.ext;

        if (mimeType) {
          if (mimeType.startsWith('image/')) fileType = 'image';
          else if (mimeType.startsWith('video/')) fileType = 'video';
          else if (mimeType.startsWith('audio/')) fileType = 'audio';
        } 
        
        // 如果 mimeType 没判断出来，或者没有 mimeType，用扩展名兜底
        if (fileType === 'other' && ext) {
          const e = ext.toLowerCase().replace('.', '');
          const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
          const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
          const audioExtensions = ['mp3', 'wav', 'aac', 'flac', 'm4a'];
          
          if (imageExtensions.includes(e)) fileType = 'image';
          else if (videoExtensions.includes(e)) fileType = 'video';
          else if (audioExtensions.includes(e)) fileType = 'audio';
        }

        // 通知父组件或 Context 打开文件
        if (onFileOpen) {
          onFileOpen(fileUrl, fileName, fileType);
        }
      } catch (error) {
        console.error('获取文件链接失败:', error);
      }
    }
  }, [loadChildren, onFileOpen]);

  // 节点转换
  function mapToTreeNode(item: NodeRespDTO): Node {
    return {
      ...item,
      key: `${item.parentId}:${item.id}`,
      isLeaf: item.type === 'file',
      label: buildTreeNodeLabel({ name: item.name, type: item.type, ext: item.ext }),
      data: { rawName: item.name },
      icon: item.type === 'file' ? getFileNodeIcon(item.ext) : undefined,
      children: item.type === 'dir' ? [] : undefined,
      loaded: false,
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
  };
}
  function getFileNodeIcon(ext?: string): React.ReactNode | undefined {
    if (!ext) return undefined;
    const normalized = ext.toLowerCase().replace('.', '');

    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif'];
    if (imageExtensions.includes(normalized)) {
      return React.createElement('img', {
        src: imageIcon,
        alt: 'image',
        className: 'tree-file-type-icon',
      });
    }

    if (normalized === 'mp3') {
      return React.createElement('img', {
        src: audioIcon,
        alt: 'audio',
        className: 'tree-file-type-icon',
      });
    }

    if (normalized === 'mp4') {
      return React.createElement('img', {
        src: videoIcon,
        alt: 'video',
        className: 'tree-file-type-icon',
      });
    }

    if (normalized === 'pdf') {
      return React.createElement('img', {
        src: pdfIcon,
        alt: 'pdf',
        className: 'tree-file-type-icon',
      });
    }

    return undefined;
  }
