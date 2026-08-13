import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Tree, Toast, Input } from '@douyinfe/semi-ui';
import {
  batchSetArchiveChildrenBuiltInType,
  createNode,
  deleteNodeAndChildren,
  getAllDescendantsByNodeId,
  fetchNodeDetailById,
  getFileLink,
  hardDeleteNodeAndChildren,
  moveNodesBatch,
  renameNode,
  sortComicChildrenByName,
  updateNodeConfig,
  updateNodeFileContent,
} from "../../services/file.api";
import CreateNodeModal from './modals/CreateNodeModal.tsx';
import { buildFileFullName, splitFileBaseNameAndExt } from '@/utils/fileTreeSettings';
import { validateWindowsLikeFileName } from '@/utils/windowsFileName';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { useFileViewer } from '@/hooks/useFileViewer';
import { useViewerAccountScope } from '@/features/file-viewer/session';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import { softDeleteNodeSubtree } from '@/features/file-explorer/services/node-deletion';
import { getDirectoryBuiltInIcon } from '@/features/file-explorer/utils/file-node-icon';
import {
  downloadUrlToDesktopPath,
  ensureDesktopDirectory,
  normalizeDownloadRelativePath,
  pickDownloadDirectoryFromDesktop,
} from '@/features/file-explorer/services/desktop-download.api';
import { hasExternalUploadData } from '@/features/file-explorer/services/external-web-image-upload.api';
import { TREE_LOCATE_NODE_EVENT, type TreeLocateNodeDetail } from '@/features/file-explorer/services/tree-locate';
import { useDirectoryUpload } from './hooks/useDirectoryUpload';
import {
  type ExternalUploadResolution,
  type VisibleRowBounds,
  computeVisibleRowBounds,
  resolveExternalUpload,
  resolveVisibleTreeNodeByClientY,
} from './utils/external-upload';
import {
  buildNodeFileName,
  findNodeById,
  findNodeByKey,
  resolveNodeBaseName,
  resolveNodeExt,
  resolveNodeType,
} from './utils/tree-node';
import type { ContextMenuPosition, OverlayBoundaryRect } from '@/components/ui/context-menu';
import { openOverlay } from '@/service/overlay/overlay.api';
import type {
  DirectoryContextMenuNodeSnapshot,
  DirectoryContextMenuResult,
  OverlayContextMenuPosition,
  OverlayStorageProvider,
} from '@/service/overlay/types';
import { useNodePropertiesOverlay } from '@/features/file-explorer/hooks/useNodePropertiesOverlay';
import MigrationDialog from '@/features/file-explorer/components/migration-dialog';
import { fetchProviders } from '@/features/storage-config/services/storage-config.api';

interface DirectoryTreeProps {
  treeData: any[];
  expandedKeys: string[];
  onExpand: (keys: string[]) => void;
  onDoubleClick: (e: React.MouseEvent, node: any) => void;
  // 点击箭头时异步加载子节点
  loadData?: (node: any) => Promise<void>;
  // 上传成功后，通知父组件刷新某个节点
  onUploadSuccess?: (parentNode: any, newNode: any) => void;
  // 删除成功后，通知父组件刷新（通常刷新父节点或整树）
  // deletedNodeKey 是节点的 key，格式为 `${parentId}:${id}`
  onDeleteSuccess?: (parentNode: any, deletedNodeKey: string) => void;
  // 重命名成功后的回调
  onRenameSuccess?: (nodeKey: string, payload: { name: string; ext?: string }) => void;
  // 配置更新成功后的回调（内置类型/归档模式）
  onConfigSuccess?: (nodeKey: string, payload: { builtInType?: string; archiveMode?: number }) => void;
  // 拖拽移动成功后，通知父组件刷新受影响父目录
  onMoveSuccess?: (payload: { affectedParentIds: number[] }) => void | Promise<void>;
  onRefreshNode?: (node: any) => void | Promise<void>;
  onToggleAudioArchiveSubtitles?: (node: any, visible: boolean) => void | Promise<void>;
  isAudioArchiveSubtitlesVisible?: (node: any) => boolean;
  onOpenFileInBrowser?: (payload: {
    fileExt: string;
    fileName: string;
    nodeId: number;
  }) => void | Promise<void>;
  onOpenMediaTool?: (node: any) => void | Promise<void>;
  onSelectionChange?: (payload: {
    primaryNode: any | null;
    selectedNodeIds: number[];
  }) => void;
  libraryId: number; // 添加 libraryId prop
  rootNodeId: number | null;
  // 浏览器模式开关；决定右键菜单展开方向与 boundary
  // - 关闭：菜单延主工作区向右展开（用 window 作 boundary）
  // - 开启：菜单沿侧栏向左展开（用 tree 容器作 boundary，避开 BrowserView）
  browserModeOpen?: boolean;
}

interface DragPreviewNodeData {
  type?: string | number;
  isLeaf?: boolean;
  label?: string;
  name?: string;
  ext?: string;
  data?: {
    rawName?: string;
    rawExt?: string;
  };
}

const TREE_DRAG_PREVIEW_ATTR = 'data-omniflow-tree-drag-preview';

function removeStaleTreeDragPreviews() {
  document
    .querySelectorAll<HTMLElement>(`[${TREE_DRAG_PREVIEW_ATTR}]`)
    .forEach(element => element.remove());
}

function collectVisibleTreeNodes(nodes: any[], expandedKeySet: Set<string>, acc: any[]) {
  nodes.forEach((node) => {
    acc.push(node);
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) return;
    if (String(node.type) === 'file') return;
    if (!expandedKeySet.has(String(node.key))) return;
    collectVisibleTreeNodes(children, expandedKeySet, acc);
  });
}

/**
 * 计算目录树内容所需的最小宽度：
 * - 以整棵树中已经渲染的节点为准（不局限于当前可视范围）
 * - 使用真实文字宽度（而非容器）来决定 custom wrapper 的 min-width
 * - 一旦文字被遮挡，立刻提供横向滚动条，拖到最右刚好露出全部文字
 * - 分割线继续左拖时，文字宽度保持不动，仅拖拽条范围加大
 */
export default function DirectoryTree({
  treeData,
  expandedKeys,
  onExpand,
  onDoubleClick,
  onUploadSuccess,
  onDeleteSuccess,
  onRenameSuccess,
  onConfigSuccess,
  onMoveSuccess,
  onRefreshNode,
  onToggleAudioArchiveSubtitles,
  isAudioArchiveSubtitlesVisible,
  onOpenFileInBrowser,
  onOpenMediaTool,
  onSelectionChange,
  loadData,
  libraryId,
  rootNodeId,
  browserModeOpen = false,
}: DirectoryTreeProps) {
  const { closeTabByNodeId, tabs } = useFileViewer();
  const viewerAccountScope = useViewerAccountScope();

  // 外部文件拖拽：悬停高亮 & 延迟展开
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const expandTimerRef = useRef<number | null>(null);

  // 新建文件/文件夹 Modal 的状态
  const [createModal, setCreateModal] = useState<{
    visible: boolean;
    type: 'file' | 'dir' | null;
    parentNode: any | null; // 父节点，null 表示根目录
    name: string;
    loading: boolean;
    defaultProvider: string;
    providers: OverlayStorageProvider[];
    providerLoading: boolean;
    selectedProvider: string;
  }>({
    visible: false,
    type: null,
    parentNode: null,
    name: '',
    loading: false,
    defaultProvider: '',
    providers: [],
    providerLoading: false,
    selectedProvider: '',
  });
  const treeContainerRef = useRef<HTMLDivElement | null>(null);

  // 存储迁移 Dialog 状态
  const [migrationDialog, setMigrationDialog] = useState<{
    visible: boolean;
    rootNodeId: number;
    nodeName: string;
  }>({ visible: false, rootNodeId: 0, nodeName: '' });
  const [migrationProviders, setMigrationProviders] = useState<string[]>([]);

  // 内联编辑状态（重命名用）
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null);

  const resetCreateModalState = useCallback(() => {
    setCreateModal({
      visible: false,
      type: null,
      parentNode: null,
      name: '',
      loading: false,
      defaultProvider: '',
      providers: [],
      providerLoading: false,
      selectedProvider: '',
    });
  }, []);
  const dragSelectionNodeIdsRef = useRef<number[]>([]);
  const dragCollapsedKeysRef = useRef<string[]>([]);
  const dragExpandedKeysSnapshotRef = useRef<string[]>([]);
  const dragDropHandledRef = useRef(false);
  const dragDropPendingRef = useRef(false);
  const externalDragExpandedKeysSnapshotRef = useRef<string[] | null>(null);

  // Tree 内容容器（可滚动内容层在 wrapper 中）
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // 仅当用户通过“右键 -> 打开原始目录”授权后，才允许内置类型目录展开
  const rawOpenAllowedKeysRef = useRef<Set<string>>(new Set());
  const [rawOpenVersion, setRawOpenVersion] = useState(0);

  // 为每个“可见行”的 label 与其内部文字 span 保持引用
  type RowRefs = { label: HTMLElement | null; text: HTMLElement | null; option: HTMLElement | null };
  type ExternalUploadFallback = {
    clientY: number;
    createdAt: number;
    resolution: ExternalUploadResolution;
  };
  const rowRefs = useRef<Map<string, RowRefs>>(new Map());
  const visibleRowBoundsRef = useRef<VisibleRowBounds[]>([]);
  const lastExternalDropResolutionRef = useRef<ExternalUploadFallback | null>(null);
  const treeDataRef = useRef<any[]>(treeData);
  const expandClickGuardRef = useRef<{ key: string; targetExpanded: boolean; expiresAt: number } | null>(null);

  // 记录上一次应用到 wrapper 的 minWidth，避免 1px 抖动
  const lastAppliedWidthRef = useRef<number>(0);

  // 记录上一次的 expandedKeys
  const prevExpandedKeysRef = useRef<string[]>(expandedKeys);
  const expandedKeysRef = useRef<string[]>(expandedKeys);

  const H_REDUNDANCY_PX = 3;        // 极小冗余，避免边界像素抖动
  const FLOAT_EPS = 0.5;            // 浮点比较误差容忍
  const MAX_TEXT_WIDTH_CAP = 40000; // 兜底，避免异常节点导致极大宽度
  const ICON_BUFFER_PX = 16;        // 行内图标缓冲
  const ROOT_PARENT_ID = Number.isFinite(rootNodeId) && Number(rootNodeId) > 0 ? Number(rootNodeId) : null;

  const resolveRootParentId = () => {
    if (ROOT_PARENT_ID !== null) {
      return ROOT_PARENT_ID;
    }
    Toast.warning('目录根节点初始化中，请稍后重试');
    return null;
  };

  const {
    handleExternalDropOnFolder,
    handlePickUploadFromDesktop,
  } = useDirectoryUpload({
    libraryId,
    onUploadSuccess,
    resolveParentNodeForAppend: (parentId: number) => {
      if (ROOT_PARENT_ID !== null && parentId === ROOT_PARENT_ID) {
        return {
          id: ROOT_PARENT_ID,
          key: 'root',
          label: '根目录',
          libraryId,
        };
      }
      return findNodeById(treeDataRef.current || [], parentId);
    },
    resolveRootParentId,
    rootNodeId: ROOT_PARENT_ID,
  });

  const { showNodeProperties } = useNodePropertiesOverlay({
    libraryId,
    rootNodeId: ROOT_PARENT_ID,
  });

  const handleDownloadNode = async (node: any) => {
    if (!node) {
      Toast.warning('请选择要下载的节点');
      return;
    }

    const pickResult = await pickDownloadDirectoryFromDesktop();
    if (pickResult.canceled || !pickResult.directoryPath) {
      return;
    }

    const targetDirectory = pickResult.directoryPath;
    const nodeType = resolveNodeType(node);

    if (nodeType === 'file') {
      const fileName = buildNodeFileName(node) || `file-${node.id}`;
      const fileLink = await getFileLink(Number(node.id), libraryId);
      await downloadUrlToDesktopPath(fileLink, targetDirectory, fileName);
      Toast.success(`下载完成：${fileName}`);
      return;
    }

    const folderNameRaw = resolveNodeBaseName(node);
    const folderName = folderNameRaw === '' ? `folder-${node.id}` : folderNameRaw;
    const rootRelativePath = normalizeDownloadRelativePath(folderName);
    await ensureDesktopDirectory(targetDirectory, rootRelativePath);

    const descendants = await getAllDescendantsByNodeId(Number(node.id), libraryId);
    const rootNodeId = Number(node.id);
    const childrenByParent = new Map<number, any[]>();

    (descendants || []).forEach((item: any) => {
      const itemId = Number(item?.id);
      if (!Number.isFinite(itemId) || itemId <= 0 || itemId === rootNodeId) {
        return;
      }
      const parentId = Number(item?.parentId);
      if (!Number.isFinite(parentId) || parentId <= 0) {
        return;
      }
      const bucket = childrenByParent.get(parentId) || [];
      bucket.push(item);
      childrenByParent.set(parentId, bucket);
    });

    const downloadSubtree = async (parentId: number, parentRelativePath: string): Promise<void> => {
      const children = childrenByParent.get(parentId) || [];
      for (const child of children) {
        const childType = resolveNodeType(child);
        if (childType === 'dir') {
          const childNameRaw = String(child?.name ?? '');
          const childName = childNameRaw === '' ? `folder-${child.id}` : childNameRaw;
          const childRelativePath = normalizeDownloadRelativePath(`${parentRelativePath}/${childName}`);
          await ensureDesktopDirectory(targetDirectory, childRelativePath);
          await downloadSubtree(Number(child.id), childRelativePath);
          continue;
        }

        const fileName = buildFileFullName(String(child?.name || ''), String(child?.ext ?? '').replace(/^\./, '')) || `file-${child.id}`;
        const fileRelativePath = normalizeDownloadRelativePath(`${parentRelativePath}/${fileName}`);
        const fileLink = await getFileLink(Number(child.id), libraryId);
        await downloadUrlToDesktopPath(fileLink, targetDirectory, fileRelativePath);
      }
    };

    await downloadSubtree(rootNodeId, rootRelativePath);
    Toast.success(`下载完成：${folderName}`);
  };

  /** rAF 合并调度 */
  const rafIdRef = useRef<number | null>(null);
  useEffect(() => {
    treeDataRef.current = treeData;
  }, [treeData]);

  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    const handler = onSelectionChangeRef.current;
    if (!handler) {
      return;
    }
    const primaryNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
    const primaryNode = primaryNodeId
      ? findNodeById(treeDataRef.current || [], Number(primaryNodeId))
      : null;
    handler({
      primaryNode,
      selectedNodeIds,
    });
  }, [selectedNodeIds]);

  /** 基于当前已经渲染的所有节点，计算内容所需的最小宽度 */
  const recomputeRequiredWidth = useCallback(() => {
    const wrapper = wrapperRef.current;
    const container = wrapper?.parentElement;
    if (!wrapper || !container) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    let maxRightEdge = 0;

    rowRefs.current.forEach(({ label, text }) => {
      if (!label || !text) return;
      if (!label.isConnected || !text.isConnected) return;

      const labelRect = label.getBoundingClientRect();
      const leftInWrapper = labelRect.left - wrapperRect.left;

      // 文字天然宽度（不受容器 100% 影响），设置一个极端上限保险
      const contentWidth = Math.min(Math.ceil(text.scrollWidth) + ICON_BUFFER_PX, MAX_TEXT_WIDTH_CAP);

      // 给一点 label 的右侧 padding 余量（避免 1px 抖动）
      let padRight = 0;
      try {
        padRight = parseFloat(getComputedStyle(label).paddingRight || '0') || 0;
      } catch { /* empty */ }

      const rightEdge = leftInWrapper + contentWidth + padRight;
      if (rightEdge > maxRightEdge) {
        maxRightEdge = rightEdge;
      }
    });

    const needsHorizontalScroll = maxRightEdge > container.clientWidth + FLOAT_EPS;
    const desiredWidth = needsHorizontalScroll
      ? Math.ceil(maxRightEdge + H_REDUNDANCY_PX)
      : container.clientWidth;

    applyMinWidth(desiredWidth, container);
  }, []);

  const scheduleRecompute = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      recomputeRequiredWidth();
    });
  }, [recomputeRequiredWidth]);

  // 处理文件放置逻辑
  // 外部文件拖拽
  const isExternalFileDrag = (e: React.DragEvent) => {
    return hasExternalUploadData(e.dataTransfer);
  };

  const hasActiveInternalTreeDrag = () => dragSelectionNodeIdsRef.current.length > 0;

  const waitForNextFrame = useCallback(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  }), []);

  const buildAncestorPathByNodeId = useCallback(async (targetNodeId: number): Promise<number[]> => {
    const path: number[] = [];
    const visited = new Set<number>();
    let currentId = Number(targetNodeId);

    while (Number.isFinite(currentId) && currentId > 0 && !visited.has(currentId)) {
      visited.add(currentId);
      path.push(currentId);

      const detail = await fetchNodeDetailById(currentId);
      const detailLibraryId = Number(detail.libraryId);
      if (detailLibraryId !== libraryId) {
        throw new Error('节点不在当前资料库中');
      }

      const parentId = Number(detail.parentId || 0);
      if (!(Number.isFinite(parentId) && parentId > 0) || parentId === currentId) {
        break;
      }
      currentId = parentId;
    }

    return path.reverse();
  }, [libraryId]);

  const locateNodeInTreeById = useCallback(async (targetNodeId: number) => {
    if (!Number.isFinite(targetNodeId) || targetNodeId <= 0) {
      return;
    }

    const ancestorPath = await buildAncestorPathByNodeId(targetNodeId);
    if (ancestorPath.length === 0) {
      return;
    }

    const traversalPath = ROOT_PARENT_ID !== null
      ? ancestorPath.filter(id => id !== ROOT_PARENT_ID)
      : ancestorPath;
    if (traversalPath.length === 0) {
      return;
    }

    let expandedDraft = [...expandedKeys];
    let targetNode: any | null = null;

    for (let index = 0; index < traversalPath.length; index += 1) {
      const nodeId = traversalPath[index];
      const isTarget = index === traversalPath.length - 1;
      let currentNode = findNodeById(treeDataRef.current || [], nodeId);

      if (!currentNode && index > 0) {
        const parentId = traversalPath[index - 1];
        const parentNode = findNodeById(treeDataRef.current || [], parentId);
        if (parentNode && loadData) {
          await loadData(parentNode);
          await waitForNextFrame();
          currentNode = findNodeById(treeDataRef.current || [], nodeId);
        }
      }

      if (!currentNode) {
        throw new Error('目标节点暂未加载到目录树');
      }

      if (!isTarget && String(currentNode.type) !== 'file') {
        if (loadData && !currentNode.loaded) {
          await loadData(currentNode);
          await waitForNextFrame();
        }
        if (!expandedDraft.includes(currentNode.key)) {
          expandedDraft = [...expandedDraft, currentNode.key];
          onExpand(expandedDraft);
          await waitForNextFrame();
        }
      }

      targetNode = currentNode;
    }

    if (!targetNode) {
      return;
    }
    setSelectedNodeIds([Number(targetNode.id)]);
    setSelectionAnchorKey(String(targetNode.key || ''));
    window.requestAnimationFrame(() => {
      const wrapper = wrapperRef.current;
      const container = wrapper?.parentElement as HTMLElement | null;
      const row = rowRefs.current.get(targetNode.key);
      const label = row?.label;
      if (!label || !wrapper || !container) {
        return;
      }

      // Vertical: center the row for stable visibility.
      const containerRect = container.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const centerOffsetY = labelRect.top - (containerRect.top + (containerRect.height - labelRect.height) / 2);
      container.scrollTo({
        top: Math.max(0, container.scrollTop + centerOffsetY),
        behavior: 'smooth',
      });

      // Horizontal: only adjust when the left side is clipped.
      const wrapperRect = wrapper.getBoundingClientRect();
      const labelLeftInWrapper = labelRect.left - wrapperRect.left;
      const visibleLeftInWrapper = container.scrollLeft + 6;
      if (labelLeftInWrapper < visibleLeftInWrapper) {
        container.scrollTo({
          left: Math.max(0, Math.floor(labelLeftInWrapper - 8)),
          behavior: 'smooth',
        });
      }
    });
  }, [ROOT_PARENT_ID, buildAncestorPathByNodeId, expandedKeys, loadData, onExpand, waitForNextFrame]);

  const isBuiltInFolderNode = (node: any): boolean => {
    if (!node || String(node.type) === 'file') return false;
    const builtInType = String(node.builtInType || 'DEF').toUpperCase();
    const archiveMode = Number(node.archiveMode ?? 0) === 1 ? 1 : 0;
    return builtInType !== 'DEF' && archiveMode !== 1;
  };

  const isRawOpenAllowed = (nodeKey: string): boolean => rawOpenAllowedKeysRef.current.has(nodeKey);
  const allowRawOpen = (nodeKey: string) => {
    const beforeSize = rawOpenAllowedKeysRef.current.size;
    rawOpenAllowedKeysRef.current.add(nodeKey);
    if (rawOpenAllowedKeysRef.current.size !== beforeSize) {
      setRawOpenVersion(v => v + 1);
    }
  };
  const revokeRawOpen = (nodeKey: string) => {
    const changed = rawOpenAllowedKeysRef.current.delete(nodeKey);
    if (changed) {
      setRawOpenVersion(v => v + 1);
    }
  };

  const handleLoadData = async (node: any) => {
    if (!loadData) return;
    if (isBuiltInFolderNode(node) && !isRawOpenAllowed(node.key)) {
      return;
    }
    await loadData(node);
  };

  const renderTreeData = React.useMemo(() => {
    // 读取版本号用于触发重算（由 allow/revoke 更新）
    void rawOpenVersion;

    const patchNodes = (nodes: any[]): any[] => {
      return nodes.map(node => {
        const patchedChildren = node.children && node.children.length > 0
          ? patchNodes(node.children)
          : node.children;

        if (String(node.type) === 'file') {
          if (patchedChildren !== node.children) {
            return { ...node, children: patchedChildren };
          }
          return node;
        }

        const isExpanded = expandedKeys.includes(node.key);
        const directoryIcon = getDirectoryBuiltInIcon(node.builtInType, node.archiveMode, isExpanded);

        if (!isBuiltInFolderNode(node)) {
          // archive + DEF 等非法组合 directoryIcon 为 undefined，保留原 icon 让 Semi 兜底。
          const nextIcon = directoryIcon ?? node.icon;
          if (patchedChildren !== node.children || nextIcon !== node.icon) {
            return { ...node, icon: nextIcon, children: patchedChildren };
          }
          return node;
        }

        if (isRawOpenAllowed(node.key)) {
          return {
            ...node,
            icon: directoryIcon,
            isLeaf: false,
            children: patchedChildren,
          };
        }

        // 回锁时清空展示态：隐藏箭头并清空当前挂载子节点
        return {
          ...node,
          icon: directoryIcon,
          isLeaf: true,
          loaded: false,
          children: [],
        };
      });
    };

    return patchNodes(treeData);
  }, [expandedKeys, rawOpenVersion, treeData]);

  const visibleNodesLinear = React.useMemo(() => {
    const acc: any[] = [];
    collectVisibleTreeNodes(renderTreeData, new Set(expandedKeys), acc);
    return acc;
  }, [expandedKeys, renderTreeData]);

  const getVisibleNodesLinear = (): any[] => visibleNodesLinear;

  useEffect(() => {
    expandedKeysRef.current = expandedKeys;
  }, [expandedKeys]);

  const syncRenderedSelectionStyles = useCallback(() => {
    const selectedSet = new Set(
      selectedNodeIds.filter(id => Number.isFinite(id) && id > 0),
    );
    const visibleIds = visibleNodesLinear
      .map(node => Number(node?.id))
      .filter(id => Number.isFinite(id) && id > 0);

    rowRefs.current.forEach(({ option }) => {
      if (!option) return;
      option.classList.remove(
        'tree-row-selected',
        'tree-row-selected-single',
        'tree-row-selected-start',
        'tree-row-selected-middle',
        'tree-row-selected-end',
      );
    });

    visibleIds.forEach((nodeId, index) => {
      if (!selectedSet.has(nodeId)) return;
      const nodeKey = String(visibleNodesLinear[index]?.key || '');
      if (!nodeKey) return;
      const option = rowRefs.current.get(nodeKey)?.option;
      if (!option) return;

      const prevSelected = index > 0 && selectedSet.has(visibleIds[index - 1]);
      const nextSelected = index < visibleIds.length - 1 && selectedSet.has(visibleIds[index + 1]);

      option.classList.add('tree-row-selected');
      if (!prevSelected && !nextSelected) {
        option.classList.add('tree-row-selected-single');
      } else if (!prevSelected) {
        option.classList.add('tree-row-selected-start');
      } else if (!nextSelected) {
        option.classList.add('tree-row-selected-end');
      } else {
        option.classList.add('tree-row-selected-middle');
      }
    });

  }, [selectedNodeIds, visibleNodesLinear]);

  const refreshVisibleRowBounds = useCallback(() => {
    visibleRowBoundsRef.current = computeVisibleRowBounds(
      visibleNodesLinear,
      rowRefs.current,
      wrapperRef.current?.parentElement ?? null,
    );
  }, [visibleNodesLinear]);

  const buildParentIdMap = (nodes: any[]): Map<number, number> => {
    const parentMap = new Map<number, number>();
    const dfs = (currentNodes: any[]) => {
      currentNodes.forEach((node) => {
        const nodeId = Number(node?.id);
        if (Number.isFinite(nodeId) && nodeId > 0) {
          const parentId = Number(node?.parentId);
          parentMap.set(nodeId, Number.isFinite(parentId) && parentId > 0 ? parentId : 0);
        }
        if (Array.isArray(node?.children) && node.children.length > 0) {
          dfs(node.children);
        }
      });
    };
    dfs(nodes);
    return parentMap;
  };

  const isDescendantNodeById = (
    nodeId: number,
    maybeAncestorId: number,
    parentMap: Map<number, number>,
  ): boolean => {
    let current = Number(nodeId);
    const visited = new Set<number>();
    while (Number.isFinite(current) && current > 0 && !visited.has(current)) {
      if (current === maybeAncestorId) {
        return true;
      }
      visited.add(current);
      current = Number(parentMap.get(current) || 0);
    }
    return false;
  };

  const normalizeMoveSelection = (candidateNodeIds: number[]): any[] => {
    const deduped = Array.from(new Set(candidateNodeIds.filter(id => Number.isFinite(id) && id > 0)));
    if (deduped.length === 0) return [];

    const visibleNodes = getVisibleNodesLinear();
    const visibleIndexMap = new Map<number, number>();
    const nodeById = new Map<number, any>();
    visibleNodes.forEach((node, index) => {
      const nodeId = Number(node?.id);
      if (!Number.isFinite(nodeId) || nodeId <= 0) return;
      visibleIndexMap.set(nodeId, index);
      nodeById.set(nodeId, node);
    });

    const orderedNodeIds = deduped
      .map((id) => ({ id, index: visibleIndexMap.get(id) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.index - b.index || a.id - b.id)
      .map(item => item.id);

    const parentMap = buildParentIdMap(treeDataRef.current || []);
    const selectedSet = new Set(orderedNodeIds);
    return orderedNodeIds
      .filter((nodeId) => {
        let parentId = Number(parentMap.get(nodeId) || 0);
        const visited = new Set<number>();
        while (Number.isFinite(parentId) && parentId > 0 && !visited.has(parentId)) {
          if (selectedSet.has(parentId)) {
            return false;
          }
          visited.add(parentId);
          parentId = Number(parentMap.get(parentId) || 0);
        }
        return true;
      })
      .map(nodeId => nodeById.get(nodeId))
      .filter(Boolean);
  };

  const handleSelectionIntent = (treeNode: any, event: React.MouseEvent) => {
    if (!treeNode) return;
    const nodeId = Number(treeNode.id);
    if (!Number.isFinite(nodeId) || nodeId <= 0) return;

    const withToggle = event.metaKey || event.ctrlKey;
    const withRange = event.shiftKey;
    const targetKey = String(treeNode.key || '');
    const visibleNodes = getVisibleNodesLinear();
    const visibleKeys = visibleNodes.map(item => String(item.key || ''));
    const targetIndex = visibleKeys.indexOf(targetKey);
    const anchorKey = selectionAnchorKey;
    const anchorIndex = anchorKey ? visibleKeys.indexOf(anchorKey) : -1;

    if (withRange && targetIndex >= 0 && anchorIndex >= 0) {
      const [start, end] = anchorIndex <= targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];
      const rangeIds = visibleNodes
        .slice(start, end + 1)
        .map(item => Number(item?.id))
        .filter(id => Number.isFinite(id) && id > 0);
      if (withToggle) {
        const merged = Array.from(new Set([...selectedNodeIds, ...rangeIds]));
        setSelectedNodeIds(merged);
      } else {
        setSelectedNodeIds(rangeIds);
      }
      return;
    }

    if (withRange && targetIndex >= 0 && anchorIndex < 0) {
      setSelectedNodeIds([nodeId]);
      setSelectionAnchorKey(targetKey || null);
      return;
    }

    if (withToggle) {
      setSelectedNodeIds((prev) => {
        if (prev.includes(nodeId)) {
          return prev.filter(item => item !== nodeId);
        }
        return [...prev, nodeId];
      });
      if (!selectionAnchorKey) {
        setSelectionAnchorKey(targetKey || null);
      }
      return;
    }

    setSelectedNodeIds([nodeId]);
    setSelectionAnchorKey(targetKey || null);
  };

  const resolveDeleteSelection = (targetNode: any): any[] => {
    const targetNodeId = Number(targetNode?.id);
    if (!Number.isFinite(targetNodeId) || targetNodeId <= 0) {
      return [];
    }
    if (!selectedNodeIds.includes(targetNodeId)) {
      return [targetNode];
    }
    const normalizedSelection = normalizeMoveSelection(selectedNodeIds);
    return normalizedSelection.length > 0 ? normalizedSelection : [targetNode];
  };

  const applyTemporaryExpandedKeys = useCallback((keys: string[]) => {
    expandedKeysRef.current = keys;
    onExpand(keys);
    requestAnimationFrame(() => {
      scheduleRecompute();
    });
    prevExpandedKeysRef.current = keys;
  }, [onExpand, scheduleRecompute]);

  const collapseConfiguredDirectory = useCallback((targetNode: any) => {
    if (!targetNode || String(targetNode.type) === 'file' || !targetNode.key) {
      return;
    }

    const currentNode = findNodeByKey(treeDataRef.current || [], targetNode.key) || targetNode;
    const collapseKeys = new Set<string>();
    const collectKeys = (node: any) => {
      const key = String(node?.key || '');
      if (key) {
        collapseKeys.add(key);
      }
      (node?.children || []).forEach(collectKeys);
    };
    collectKeys(currentNode);

    if (collapseKeys.size === 0) {
      return;
    }

    collapseKeys.forEach(key => revokeRawOpen(key));
    const nextExpandedKeys = expandedKeysRef.current.filter(key => !collapseKeys.has(key));
    if (nextExpandedKeys.length !== expandedKeysRef.current.length) {
      applyTemporaryExpandedKeys(nextExpandedKeys);
    }
  }, [applyTemporaryExpandedKeys]);

  const resetDragCollapseTracking = () => {
    dragCollapsedKeysRef.current = [];
    dragExpandedKeysSnapshotRef.current = [];
    dragDropHandledRef.current = false;
    dragDropPendingRef.current = false;
  };

  const restoreDragCollapsedKeys = () => {
    const snapshot = dragExpandedKeysSnapshotRef.current;
    if (snapshot.length > 0) {
      applyTemporaryExpandedKeys(snapshot);
    }
    resetDragCollapseTracking();
  };

  const prepareDragCollapsedNodes = (candidateSelectionIds: number[]) => {
    const normalizedMoveNodes = normalizeMoveSelection(candidateSelectionIds);
    const expandedSnapshot = expandedKeysRef.current;
    const collapsibleKeys = normalizedMoveNodes
      .filter(node => String(node?.type) === 'dir' && expandedSnapshot.includes(String(node?.key || '')))
      .map(node => String(node.key || ''))
      .filter(Boolean);

    if (collapsibleKeys.length === 0) {
      resetDragCollapseTracking();
      return;
    }

    dragExpandedKeysSnapshotRef.current = expandedSnapshot;
    dragCollapsedKeysRef.current = collapsibleKeys;

    const collapseSet = new Set(collapsibleKeys);
    applyTemporaryExpandedKeys(expandedSnapshot.filter(key => !collapseSet.has(key)));
  };

  const beginExternalDragExpandSession = () => {
    if (externalDragExpandedKeysSnapshotRef.current !== null) {
      return;
    }
    externalDragExpandedKeysSnapshotRef.current = [...expandedKeysRef.current];
  };

  const resetExternalDragExpandSession = () => {
    externalDragExpandedKeysSnapshotRef.current = null;
  };

  const restoreExternalDragExpandedKeys = useCallback(() => {
    const snapshot = externalDragExpandedKeysSnapshotRef.current;
    if (snapshot !== null) {
      applyTemporaryExpandedKeys(snapshot);
    }
    if (expandTimerRef.current) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    resetExternalDragExpandSession();
  }, [applyTemporaryExpandedKeys]);

  const clearExternalUploadHover = (targetKey?: string | null) => {
    setDragOverKey(prev => {
      if (targetKey === undefined) {
        return null;
      }
      return prev === targetKey ? null : prev;
    });
    if (expandTimerRef.current) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };

  const applyExternalUploadHover = (resolution: ExternalUploadResolution) => {
    setDragOverKey(resolution.targetKey);
    beginExternalDragExpandSession();
  };

  const shouldShowExternalUploadHover = (hoveredNode: any | null, resolution: ExternalUploadResolution): boolean => {
    if (!hoveredNode || !resolution.targetNode || !resolution.targetKey) return false;
    if (String(hoveredNode.type) !== 'dir') return false;
    return String(hoveredNode.key || '') === resolution.targetKey;
  };

  const notifyExternalUploadBlocked = (reason: ExternalUploadResolution['blockedReason']) => {
    if (reason === 'archive') {
      Toast.warning('归档模式目录不支持拖拽上传，请使用右键上传');
    }
  };

  const handleExternalUploadDrop = (e: React.DragEvent, resolution: ExternalUploadResolution) => {
    if (resolution.blockedReason) {
      e.preventDefault();
      e.stopPropagation();
      notifyExternalUploadBlocked(resolution.blockedReason);
      restoreExternalDragExpandedKeys();
      return true;
    }

    if (!resolution.targetNode) {
      clearExternalUploadHover();
      restoreExternalDragExpandedKeys();
      return true;
    }

    e.preventDefault();
    e.stopPropagation();
    try {
      handleExternalDropOnFolder(resolution.targetNode, e);
    } finally {
      clearExternalUploadHover();
      restoreExternalDragExpandedKeys();
    }
    return true;
  };

  const getChildrenByParentId = (parentId: number): any[] => {
    if (ROOT_PARENT_ID !== null && parentId === ROOT_PARENT_ID) {
      return treeData;
    }
    const parentNode = findNodeById(treeData, parentId);
    return parentNode?.children || [];
  };

  const getNextSiblingId = (parentId: number, nodeId: number): number | null => {
    const siblings = getChildrenByParentId(parentId);
    const index = siblings.findIndex((item: any) => item.id === nodeId);
    if (index < 0) return null;
    const next = siblings[index + 1];
    return next?.id ?? null;
  };

  const handleTreeDrop = async (info: any) => {
    runtimeLogger.debug('放下节点', info);

    const cancelDragMove = () => {
      dragDropHandledRef.current = false;
      dragDropPendingRef.current = false;
      restoreDragCollapsedKeys();
      dragSelectionNodeIdsRef.current = [];
    };

    const finishDragMove = () => {
      dragDropHandledRef.current = true;
      dragDropPendingRef.current = false;
      resetDragCollapseTracking();
      dragSelectionNodeIdsRef.current = [];
    };

    const dragNode = info?.dragNode as any;
    const dropNode = info?.node as any;
    if (!dragNode || !dropNode) {
      Toast.error('拖拽数据异常');
      cancelDragMove();
      return;
    }

    const dropNodeId = Number(dropNode.id);
    if (!Number.isFinite(dropNodeId)) {
      Toast.error('拖拽节点数据异常');
      cancelDragMove();
      return;
    }

    const dropToGap = Boolean(info?.dropToGap);
    const dropPosition = Number(info?.dropPosition ?? 0);
    const dropNodeIndex = Number(String(dropNode.pos || '').split('-').pop() || 0);
    const relativeDropPosition = Number.isFinite(dropNodeIndex)
      ? dropPosition - dropNodeIndex
      : dropPosition;

    let newParentId = Number(dropNode.parentId || 0);
    let beforeNodeId: number | null = null;
    const parentMap = buildParentIdMap(treeDataRef.current || []);

    const draggedNodeId = Number(dragNode.id);
    const activeSelectionIds = normalizeMoveSelection(
      dragSelectionNodeIdsRef.current.length > 0
        ? dragSelectionNodeIdsRef.current
        : (Number.isFinite(draggedNodeId) && draggedNodeId > 0 ? [draggedNodeId] : selectedNodeIds),
    ).map(node => Number(node.id));
    if (activeSelectionIds.length === 0) {
      Toast.warning('请选择要移动的节点');
      cancelDragMove();
      return;
    }
    const movingNodeSet = new Set(activeSelectionIds);

    if (dropToGap) {
      const dropParentCandidate = Number(dropNode.parentId);
      newParentId = Number.isFinite(dropParentCandidate) && dropParentCandidate > 0
        ? dropParentCandidate
        : (ROOT_PARENT_ID ?? 0);
      if (relativeDropPosition < 0) {
        let probeId: number | null = dropNodeId;
        while (probeId && movingNodeSet.has(probeId)) {
          probeId = getNextSiblingId(newParentId, probeId);
        }
        beforeNodeId = probeId;
      } else {
        let probeId: number | null = getNextSiblingId(newParentId, dropNodeId);
        while (probeId && movingNodeSet.has(probeId)) {
          probeId = getNextSiblingId(newParentId, probeId);
        }
        beforeNodeId = probeId;
      }
    } else {
      const dropNodeIsFolder = dropNode.isLeaf !== true;
      if (!dropNodeIsFolder) {
        Toast.warning('请拖到文件夹上，或拖到节点间隙进行同级排序');
        cancelDragMove();
        return;
      }
      newParentId = dropNodeId;
      beforeNodeId = null;
    }

    if (!Number.isFinite(newParentId) || newParentId <= 0) {
      const rootParentId = resolveRootParentId();
      if (rootParentId === null) {
        cancelDragMove();
        return;
      }
      newParentId = rootParentId;
    }

    const normalizedMoveNodes = normalizeMoveSelection(activeSelectionIds);
    if (normalizedMoveNodes.length === 0) {
      Toast.warning('当前选中节点不可移动');
      cancelDragMove();
      return;
    }

    for (const moveNode of normalizedMoveNodes) {
      const moveNodeId = Number(moveNode.id);
      if (!Number.isFinite(moveNodeId) || moveNodeId <= 0) {
        continue;
      }
      if (newParentId === moveNodeId || isDescendantNodeById(newParentId, moveNodeId, parentMap)) {
        Toast.warning('不能移动到自身或其子节点下');
        cancelDragMove();
        return;
      }
    }

    const payloadItems = normalizedMoveNodes.map((node) => {
      const nodeName = String(node?.data?.rawName || node?.name || node?.label || '').trim();
      return {
        nodeId: Number(node.id),
        name: nodeName,
      };
    }).filter(item => Number.isFinite(item.nodeId) && item.nodeId > 0);
    if (payloadItems.length === 0) {
      Toast.error('节点名称异常，无法移动');
      cancelDragMove();
      return;
    }

    try {
      const result = await moveNodesBatch({
        items: payloadItems,
        newParentId,
        beforeNodeId,
        libraryId,
      });

      if (onMoveSuccess && result.affectedParentIds.length > 0) {
        await onMoveSuccess({ affectedParentIds: result.affectedParentIds });
      }
      Toast.success(payloadItems.length > 1 ? `已移动 ${payloadItems.length} 项` : '移动成功');
      finishDragMove();
    } catch (error: any) {
      runtimeLogger.error('移动节点失败:', error);
      Toast.error(error?.message || '移动失败');
      cancelDragMove();
    } finally {
      dragDropPendingRef.current = false;
    }
  };

  const createDragPreview = (label: string, textColor: string, previewWidth: number): HTMLElement => {
    const preview = document.createElement('div');
    preview.setAttribute(TREE_DRAG_PREVIEW_ATTR, 'true');
    preview.setAttribute('aria-hidden', 'true');
    preview.textContent = label;
    preview.style.boxSizing = 'border-box';
    preview.style.position = 'fixed';
    preview.style.top = '-10000px';
    preview.style.left = '-10000px';
    preview.style.zIndex = '-1';
    preview.style.maxWidth = `${previewWidth}px`;
    preview.style.padding = '6px 10px';
    preview.style.borderRadius = '8px';
    preview.style.border = '1px solid rgba(15, 23, 42, 0.18)';
    preview.style.background = 'rgba(255, 255, 255, 0.96)';
    preview.style.boxShadow = '0 10px 20px rgba(15, 23, 42, 0.16)';
    preview.style.color = textColor;
    preview.style.fontSize = '14px';
    preview.style.fontWeight = '600';
    preview.style.lineHeight = '20px';
    preview.style.whiteSpace = 'nowrap';
    preview.style.overflow = 'hidden';
    preview.style.textOverflow = 'ellipsis';
    preview.style.pointerEvents = 'none';
    preview.style.setProperty('contain', 'layout style paint');
    return preview;
  };

  const renderDraggingNode = (nodeInstance: HTMLElement, nodeData: unknown): HTMLElement => {
    removeStaleTreeDragPreviews();

    try {
      const selectedCount = dragSelectionNodeIdsRef.current.length;
      if (selectedCount > 1) {
        const containerWidth = wrapperRef.current?.parentElement?.clientWidth ?? 280;
        const previewWidth = Math.max(180, Math.min(360, Math.floor(containerWidth * 0.9)));
        const textColor = getComputedStyle(nodeInstance).color || '#1f2937';
        return createDragPreview(`${selectedCount} 项`, textColor, previewWidth);
      }

      const typedNodeData = (nodeData || {}) as DragPreviewNodeData;
      const nodeType = resolveNodeType(typedNodeData);
      const baseName = resolveNodeBaseName(typedNodeData);
      const ext = resolveNodeExt(typedNodeData);
      const fallbackLabel = typeof typedNodeData.label === 'string' ? typedNodeData.label : '';
      const displayName = (
        nodeType === 'file'
          ? buildFileFullName(baseName, ext)
          : baseName
      ) || fallbackLabel || '未命名节点';

      const containerWidth = wrapperRef.current?.parentElement?.clientWidth ?? 280;
      const previewWidth = Math.max(180, Math.min(360, Math.floor(containerWidth * 0.9)));
      const textColor = getComputedStyle(nodeInstance).color || '#1f2937';
      return createDragPreview(displayName, textColor, previewWidth);
    } catch {
      return createDragPreview('移动节点', '#1f2937', 220);
    }
  };

  /** 应用 minWidth 并夹紧 scrollLeft */
  const applyMinWidth = (targetWidth: number, container: HTMLElement) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // 不小于容器宽，否则可能出现反向闪烁
    const target = Math.max(container.clientWidth, targetWidth);
    if (Math.abs(target - lastAppliedWidthRef.current) < 1) return;

    lastAppliedWidthRef.current = target;
    wrapper.style.minWidth = `${Math.ceil(target)}px`;

    // 夹紧 scrollLeft，防止宽度缩小后残留在越界位置
    const maxScroll = Math.max(0, wrapper.scrollWidth - container.clientWidth);
    if (container.scrollLeft > maxScroll) {
      container.scrollLeft = maxScroll;
    }
  };

  /**
   * 进入重命名前，仅在“名称开头被左侧遮挡”时向前滚动。
   * 不做向后跳转，避免视觉抖动和定位丢失。
   */
  const alignNodeStartForRename = (nodeKey: string) => {
    requestAnimationFrame(() => {
      const wrapper = wrapperRef.current;
      const container = wrapper?.parentElement;
      const label = rowRefs.current.get(nodeKey)?.label;
      if (!wrapper || !container || !label || !label.isConnected) return;

      const wrapperRect = wrapper.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const labelLeftInWrapper = labelRect.left - wrapperRect.left;
      const currentScrollLeft = container.scrollLeft;

      if (labelLeftInWrapper < currentScrollLeft) {
        container.scrollLeft = Math.max(0, Math.floor(labelLeftInWrapper - 8));
      }
    });
  };

  /** 绑定 label & text 的 ref */
  const bindLabelRef = (key: string) => (el: HTMLElement | null) => {
    if (!el) {
      const prev = rowRefs.current.get(key);
      if (prev?.text || prev?.option) {
        rowRefs.current.set(key, {
          label: null,
          text: prev?.text ?? null,
          option: null,
        });
      }
      else rowRefs.current.delete(key);
      return;
    }
    const prev = rowRefs.current.get(key) ?? { label: null, text: null, option: null };
    rowRefs.current.set(key, {
      ...prev,
      label: el,
      // Selection background needs to cover the full tree row, so the visual
      // state is attached to Semi's outer option element instead of the label span.
      option: el.closest('.semi-tree-option') as HTMLElement | null,
    });
    scheduleRecompute();
  };
  const bindTextRef = (key: string) => (el: HTMLElement | null) => {
    if (!el) {
      const prev = rowRefs.current.get(key);
      if (prev?.label || prev?.option) {
        rowRefs.current.set(key, {
          label: prev?.label ?? null,
          text: null,
          option: prev?.option ?? null,
        });
      }
      else rowRefs.current.delete(key);
      return;
    }
    const prev = rowRefs.current.get(key) ?? { label: null, text: null, option: null };
    rowRefs.current.set(key, { ...prev, text: el });
    scheduleRecompute();
  };

  // 懒加载展开修复：先触发 onDoubleClick 再展开
  const ensureLazyLoadThenExpand = (treeNode: any) => {
    if (isBuiltInFolderNode(treeNode) && !isRawOpenAllowed(treeNode.key)) {
      return;
    }
    try {
      const native = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
      onDoubleClick(native as unknown as React.MouseEvent, treeNode);
    } catch (err) {
      runtimeLogger.warn('onDoubleClick 触发懒加载失败（已忽略）：', err);
    }
    if (!expandedKeys.includes(treeNode.key)) {
      onExpand(Array.from(new Set([...expandedKeys, treeNode.key])));
    }
  };

  // 包装后的 onExpand：触发父回调后，下一帧仅以视口重算
  const handleExpand = (keys: string[], expandInfo?: { expanded?: boolean; node?: any }) => {
    const infoNodeKey = String(expandInfo?.node?.key || '');
    const infoExpanded = expandInfo?.expanded;
    const now = performance.now();
    const guard = expandClickGuardRef.current;
    if (
      guard
      && infoNodeKey
      && guard.key === infoNodeKey
      && infoExpanded === !guard.targetExpanded
      && now < guard.expiresAt
    ) {
      return;
    }

    const blockedNewKeys = new Set<string>();
    for (const key of keys) {
      if (expandedKeys.includes(key)) {
        continue;
      }
      const node = findNodeByKey(renderTreeData, key);
      if (!node) {
        continue;
      }
      if (isBuiltInFolderNode(node) && !isRawOpenAllowed(key)) {
        blockedNewKeys.add(key);
      }
    }

    const filteredKeys = blockedNewKeys.size > 0
      ? keys.filter(key => !blockedNewKeys.has(key))
      : keys;

    if (blockedNewKeys.size > 0) {
      Toast.info('该目录为内置类型，请右键选择“打开原始目录”');
    }

    const collapsedKeys = expandedKeys.filter(key => !filteredKeys.includes(key));
    for (const key of collapsedKeys) {
      const node = findNodeByKey(renderTreeData, key);
      if (node && isBuiltInFolderNode(node) && isRawOpenAllowed(key)) {
        revokeRawOpen(key);
      }
    }

    onExpand(filteredKeys);
    if (infoNodeKey && typeof infoExpanded === 'boolean') {
      expandClickGuardRef.current = {
        key: infoNodeKey,
        targetExpanded: infoExpanded,
        expiresAt: now + 320,
      };
    }

    requestAnimationFrame(() => {
      scheduleRecompute(); // 只看视口，不会被未见内容影响
    });

    prevExpandedKeysRef.current = filteredKeys;
  };

  const handleTreeDoubleClick = (e: React.MouseEvent, node: any) => {
    onDoubleClick(e, node);
  };

  const resolveTreeBoundaryRect = (): OverlayBoundaryRect | null => {
    // 非浏览器模式：菜单可进入主工作区，以视口为边界
    if (!browserModeOpen) {
      return {
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight,
      };
    }
    // 浏览器模式：BrowserView 压在 DOM 之上，菜单必须呆在侧栏内
    const rect = treeContainerRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
  };

  const resolveMenuPosition = (
    clientX: number,
    clientY: number,
    boundaryRect: OverlayBoundaryRect | null,
  ): ContextMenuPosition => {
    const MENU_WIDTH = 280;
    const MENU_HEIGHT = 420;
    const MARGIN = 12;
    const boundaryLeft = boundaryRect?.left ?? 0;
    const boundaryRight = boundaryRect?.right ?? window.innerWidth;
    const boundaryBottom = boundaryRect?.bottom ?? window.innerHeight;

    const spaceLeft = clientX - boundaryLeft - MARGIN;
    const spaceRight = boundaryRight - clientX - MARGIN;

    // 非浏览器模式：优先向右（菜单落在 clientX 右侧，即 position 以 Left 结尾）
    // 浏览器模式：优先向左（菜单落在 clientX 左侧，即 position 以 Right 结尾）
    const horizontal = browserModeOpen
      ? (spaceLeft >= MENU_WIDTH ? 'Right' : 'Left')
      : (spaceRight >= MENU_WIDTH ? 'Left' : 'Right');

    const vertical = (boundaryBottom - clientY - MARGIN) >= MENU_HEIGHT ? 'bottom' : 'top';
    return `${vertical}${horizontal}` as ContextMenuPosition;
  };

  const createContextMenuNodeSnapshot = (node: any | null): DirectoryContextMenuNodeSnapshot | null => {
    if (!node) {
      return null;
    }

    const nodeId = Number(node.id);
    const parentId = Number(node.parentId);
    const rawName = String(node.data?.rawName ?? node.label ?? node.key ?? '').trim();
    const rawExt = String(node.data?.rawExt ?? node.ext ?? '').replace(/^\./, '');

    return {
      archiveMode: Number(node.archiveMode ?? 0) === 1 ? 1 : 0,
      builtInType: String(node.builtInType || 'DEF').toUpperCase(),
      data: {
        audioArchiveAudio: node.data?.audioArchiveAudio === true,
        audioArchiveSubtitlesVisible: isAudioArchiveSubtitlesVisible?.(node) === true,
        parentArchiveMode: Number(node.data?.parentArchiveMode ?? 0) === 1 ? 1 : 0,
        parentBuiltInType: String(node.data?.parentBuiltInType || 'DEF').toUpperCase(),
        rawExt,
        rawName,
      },
      ext: rawExt,
      id: Number.isFinite(nodeId) ? nodeId : undefined,
      isLeaf: node.isLeaf === true,
      key: String(node.key || ''),
      label: rawName,
      parentId: Number.isFinite(parentId) ? parentId : null,
      type: String(resolveNodeType(node) || node.type || ''),
    };
  };

  // 菜单行为
  const handleAction = async (action: string, node: any) => {
    if (action === '显示音频字幕文件' || action === '隐藏音频字幕文件') {
      if (!node || !onToggleAudioArchiveSubtitles) {
        return;
      }
      try {
        await onToggleAudioArchiveSubtitles(node, action === '显示音频字幕文件');
        Toast.success(action === '显示音频字幕文件' ? '已显示隐藏文件' : '已隐藏文件');
      } catch (error: any) {
        runtimeLogger.error('切换音频字幕文件显示失败:', error);
        Toast.error(error?.message || '切换隐藏文件失败');
      }
      return;
    }

    if (action === '打开原始目录') {
      if (!node || String(node.type) === 'file') {
        return;
      }
      allowRawOpen(node.key);
      try {
        await handleLoadData(node);
        if (!expandedKeys.includes(node.key)) {
          onExpand(Array.from(new Set([...expandedKeys, node.key])));
        }
        Toast.success('已打开原始目录');
      } catch (error: any) {
        runtimeLogger.error('打开原始目录失败:', error);
        Toast.error(error?.message || '打开原始目录失败');
      }
      return;
    }

    if (action === '按名称排序') {
      if (!node || String(node.type) === 'file') {
        return;
      }
      try {
        await sortComicChildrenByName(node.id);
        if (onMoveSuccess) {
          await onMoveSuccess({ affectedParentIds: [Number(node.id)] });
        }
        Toast.success('已按名称排序');
      } catch (error: any) {
        runtimeLogger.error('按名称排序失败:', error);
        Toast.error(error?.message || '按名称排序失败');
      }
      return;
    }

    if (action === '批量设置内置类型') {
      if (!node || String(node.type) === 'file') {
        Toast.warning('仅文件夹支持批量设置内置类型');
        return;
      }
      const currentBuiltInType = String(node?.builtInType || 'DEF').toUpperCase();
      const currentArchiveMode = Number(node?.archiveMode ?? 0) === 1 ? 1 : 0;
      if (currentArchiveMode !== 1 || currentBuiltInType === 'DEF') {
        Toast.warning('仅归档模式且非 DEF 的文件夹支持该操作');
        return;
      }
      try {
        const result = await batchSetArchiveChildrenBuiltInType(Number(node.id));
        const visibleChildren = Array.isArray(node.children) ? node.children : [];
        visibleChildren.forEach((child: any) => {
          const childIsDir = String(child?.type || '').toLowerCase() === 'dir' || child?.isLeaf !== true;
          if (!childIsDir || !child?.key) {
            return;
          }
          onConfigSuccess?.(child.key, {
            builtInType: currentBuiltInType,
          });
          collapseConfiguredDirectory(child);
        });
        if (onMoveSuccess) {
          await onMoveSuccess({ affectedParentIds: [Number(node.id)] });
        }
        Toast.success(
          `批量设置完成：共 ${result.dirChildren} 个子文件夹，实际更新 ${result.updatedCount} 个`,
        );
      } catch (error: any) {
        runtimeLogger.error('批量设置内置类型失败:', error);
        Toast.error(error?.message || '批量设置内置类型失败');
      }
      return;
    }

    if (action.startsWith('设置内置类型:')) {
      const nextBuiltInType = action.split(':')[1]?.trim()?.toUpperCase() || 'DEF';
      if ((nextBuiltInType === 'VIDEO' || nextBuiltInType === 'AUDIO' || nextBuiltInType === 'GALLERY') && node.type !== 'dir') {
        Toast.warning(`${nextBuiltInType} 内置类型仅支持文件夹`);
        return;
      }
      const currentArchiveMode = Number(node?.archiveMode ?? 0);
      const nextArchiveMode = nextBuiltInType === 'DEF'
        ? 0
        : (currentArchiveMode === 1 ? 1 : 0);
      try {
        await updateNodeConfig({
          id: node.id,
          builtInType: nextBuiltInType,
          archiveMode: nextArchiveMode,
        });
        onConfigSuccess?.(node.key, {
          builtInType: nextBuiltInType,
          archiveMode: nextArchiveMode,
        });
        if (String(node.type) === 'dir' && nextBuiltInType !== 'DEF') {
          collapseConfiguredDirectory(node);
        }
        Toast.success(
          nextBuiltInType === 'DEF' && currentArchiveMode === 1
            ? '已设置为 DEF，并自动关闭归档模式'
            : `已设置为 ${nextBuiltInType}`,
        );
      } catch (error: any) {
        runtimeLogger.error('设置内置类型失败:', error);
        Toast.error(error?.message || '设置内置类型失败');
      }
      return;
    }

    if (action.startsWith('设置归档模式:')) {
      const nextArchiveMode = Number(action.split(':')[1] || 0) === 1 ? 1 : 0;
      const currentBuiltInType = String(node?.builtInType || 'DEF').toUpperCase();
      if (nextArchiveMode === 1 && currentBuiltInType === 'DEF') {
        Toast.warning('请先设置内置类型，再开启归档模式');
        return;
      }
      try {
        await updateNodeConfig({
          id: node.id,
          builtInType: currentBuiltInType,
          archiveMode: nextArchiveMode,
        });
        onConfigSuccess?.(node.key, {
          builtInType: currentBuiltInType,
          archiveMode: nextArchiveMode,
        });
        if (String(node.type) === 'dir' && currentBuiltInType !== 'DEF') {
          collapseConfiguredDirectory(node);
        }
        Toast.success(nextArchiveMode === 1 ? '已开启归档模式' : '已关闭归档模式');
      } catch (error: any) {
        runtimeLogger.error('设置归档模式失败:', error);
        Toast.error(error?.message || '设置归档模式失败');
      }
      return;
    }

    if (action === '上传文件') {
      await handlePickUploadFromDesktop('file', node);
      return;
    }

    if (action === '上传文件夹') {
      await handlePickUploadFromDesktop('folder', node);
      return;
    }

    if (action === '迁移到其他存储') {
      const targetNodeId = Number(node?.id);
      if (!Number.isFinite(targetNodeId) || targetNodeId <= 0) {
        Toast.warning('当前节点不支持迁移');
        return;
      }
      try {
        const list = await fetchProviders();
        const providers = (list?.providers || []).map((p) => p.alias).filter(Boolean);
        if (providers.length === 0) {
          Toast.warning('未配置任何存储 provider');
          return;
        }
        setMigrationProviders(providers);
        setMigrationDialog({
          visible: true,
          rootNodeId: targetNodeId,
          nodeName: String(node?.name || ''),
        });
      } catch (error: any) {
        runtimeLogger.error('加载 provider 列表失败:', error);
        Toast.error(error?.message || '加载存储 provider 失败');
      }
      return;
    }

    if (action === '下载') {
      try {
        await handleDownloadNode(node);
      } catch (error: any) {
        runtimeLogger.error('下载节点失败:', error);
        Toast.error(error?.message || '下载失败');
      }
      return;
    }

    if (action === '在浏览器打开') {
      const nodeId = Number(node?.id);
      const fileExt = String(resolveNodeExt(node) || '').trim();
      const fileName = buildNodeFileName(node);
      if (!Number.isFinite(nodeId) || nodeId <= 0 || !fileName) {
        Toast.warning('当前文件暂时无法在浏览器中打开');
        return;
      }
      if (!fileExt) {
        Toast.warning('当前文件没有可用后缀，请先配置后再重试');
        return;
      }
      try {
        await onOpenFileInBrowser?.({
          fileExt,
          fileName,
          nodeId,
        });
      } catch (error: any) {
        runtimeLogger.error('在浏览器打开文件失败:', error);
        Toast.error(error?.message || '在浏览器打开失败');
      }
      return;
    }

    if (action === '在媒体工具打开') {
      if (!node || resolveNodeType(node) !== 'file') {
        Toast.warning('请选择媒体文件');
        return;
      }
      try {
        await onOpenMediaTool?.(node);
      } catch (error: any) {
        runtimeLogger.error('打开媒体工具失败:', error);
        Toast.error(error?.message || '打开媒体工具失败');
      }
      return;
    }

    if (action === '刷新') {
      if (!node || resolveNodeType(node) !== 'dir') {
        return;
      }
      try {
        await onRefreshNode?.(node);
        Toast.success('目录已刷新');
        scheduleRecompute();
      } catch (error: any) {
        runtimeLogger.error('刷新目录失败:', error);
        Toast.error(error?.message || '刷新目录失败');
      }
      return;
    }

    if (action === '新建文件') {
      setCreateModal({
        visible: true,
        type: 'file',
        parentNode: node,
        name: '',
        loading: false,
        defaultProvider: '',
        providers: [],
        providerLoading: true,
        selectedProvider: '',
      });
      try {
        const providerData = await fetchProviders();
        const providers = (providerData.providers || []).map((provider) => ({
          alias: provider.alias,
          type: provider.type,
          endpoint: provider.endpoint,
          bucket: provider.bucket,
          label: provider.label,
          useSSL: provider.useSSL,
        }));
        const defaultProvider = providerData.defaultProvider || providers[0]?.alias || '';
        setCreateModal(prev => (
          prev.visible && prev.type === 'file'
            ? {
              ...prev,
              defaultProvider,
              providers,
              providerLoading: false,
              selectedProvider: defaultProvider,
            }
            : prev
        ));
      } catch (error) {
        runtimeLogger.warn('加载存储 Provider 失败，新建文件将使用后端默认分配:', error);
        setCreateModal(prev => (
          prev.visible && prev.type === 'file'
            ? { ...prev, providerLoading: false }
            : prev
        ));
      }
    } else if (action === '新建文件夹') {
      setCreateModal({
        visible: true,
        type: 'dir',
        parentNode: node,
        name: '',
        loading: false,
        defaultProvider: '',
        providers: [],
        providerLoading: false,
        selectedProvider: '',
      });
    } else if (action === '重命名') {
      const currentBaseName = node.data?.rawName || node.label || '';
      const currentExt = node.data?.rawExt ?? node.ext ?? '';
      const editingFullName = node.isLeaf
        ? buildFileFullName(currentBaseName, currentExt)
        : currentBaseName;

      alignNodeStartForRename(node.key);
      setEditingKey(node.key);
      setEditingName(editingFullName);
    } else if (action === '属性') {
      showNodeProperties(node);
    } else if (action === 'delete') {
      try {
        const deleteTargets = resolveDeleteSelection(node);
        if (deleteTargets.length === 0) {
          return;
        }

        const firstTarget = deleteTargets[0];
        const firstName = String(firstTarget?.data?.rawName || firstTarget?.label || firstTarget?.key || '').trim();
        const firstExt = String(firstTarget?.data?.rawExt ?? firstTarget?.ext ?? '').trim();
        const deleteNodeName = deleteTargets.length > 1
          ? firstName
          : (resolveNodeType(firstTarget) === 'file'
            ? buildFileFullName(firstName, firstExt)
            : firstName);
        const confirmResult = await openOverlay('delete-confirm', {
          deleteCount: deleteTargets.length,
          isFolder: resolveNodeType(firstTarget) === 'dir',
          nodeName: deleteNodeName,
        });
        if (confirmResult.type !== 'confirm') {
          return;
        }

        runtimeLogger.debug('[删除]', deleteTargets);
        const affectedParentIds = new Set<number>();
        const deletedNodeKeys: string[] = [];
        const deletedNodeIds = new Set<number>();
        let deleteError: unknown = null;
        let draftCleanupFailed = false;

        for (const targetNode of deleteTargets) {
          try {
            const parentIdCandidate = Number(targetNode?.parentId);
            const parentId = Number.isFinite(parentIdCandidate) && parentIdCandidate > 0
              ? parentIdCandidate
              : (ROOT_PARENT_ID ?? 0);
            const result = await softDeleteNodeSubtree({
              accountScope: viewerAccountScope,
              ancestorId: Number(targetNode.id),
              libraryId,
            });
            result.deletedNodeIds.forEach((nodeId) => deletedNodeIds.add(nodeId));
            draftCleanupFailed = draftCleanupFailed
              || result.draftCleanupFailed
              || result.viewerSessionCleanupFailed
              || result.subtreeCollectionFailed;
            if (parentId > 0) {
              affectedParentIds.add(parentId);
            }
            if (targetNode?.key) {
              deletedNodeKeys.push(String(targetNode.key));
            }
          } catch (error) {
            deleteError = error;
            break;
          }
        }

        if (deletedNodeKeys.length > 0 && onDeleteSuccess) {
          deletedNodeKeys.forEach((deletedNodeKey) => {
            onDeleteSuccess(null, deletedNodeKey);
          });
        }

        if (deletedNodeKeys.length > 0 && onMoveSuccess && affectedParentIds.size > 0) {
          await onMoveSuccess({ affectedParentIds: Array.from(affectedParentIds) });
        }

        const playerState = globalAudioPlayer.getState();
        const shouldClearAudio = tabs.some(tab => (
          deletedNodeIds.has(Number(tab.nodeId)) &&
          tab.fileType === 'audio' &&
          tab.fileUrl === playerState.src
        ));

        deletedNodeIds.forEach((deletedNodeId) => {
          closeTabByNodeId(deletedNodeId);
        });
        if (shouldClearAudio) {
          globalAudioPlayer.clear();
        }
        setSelectedNodeIds((prev) => prev.filter(id => !deletedNodeIds.has(id)));
        const anchorNode = selectionAnchorKey
          ? findNodeByKey(treeDataRef.current || [], selectionAnchorKey)
          : null;
        if (anchorNode && deletedNodeIds.has(Number(anchorNode.id))) {
          setSelectionAnchorKey(null);
        }
        if (deleteError) {
          runtimeLogger.error('删除节点失败:', deleteError);
          if (deletedNodeKeys.length > 0) {
            Toast.error(`已移入回收站 ${deletedNodeKeys.length} 项，剩余删除失败`);
          } else {
            Toast.error('删除失败');
          }
          scheduleRecompute();
          return;
        }

        if (draftCleanupFailed) {
          Toast.warning('内容已移入回收站，但本地恢复数据可能未完整清理');
        } else {
          Toast.success(deleteTargets.length > 1 ? `已移入回收站 ${deleteTargets.length} 项` : '已移入回收站');
        }
        scheduleRecompute();
      } catch (error) {
        runtimeLogger.error('删除节点失败:', error);
        Toast.error('删除失败');
      }
    } else {
      // 其他操作暂时模拟
      runtimeLogger.debug(`👉 [${action}]`, node);
      Toast.info({ content: `模拟：${action}`, duration: 2 });
    }
  };

  // 确认创建文件/文件夹
  const handleConfirmCreate = async () => {
    const { type, parentNode, name, providerLoading, selectedProvider } = createModal;
    if (!type || !name.trim()) {
      Toast.warning('请输入名称');
      return;
    }
    if (type === 'file' && providerLoading) {
      Toast.warning('存储位置加载中，请稍后');
      return;
    }

    const resolvedRootParentId = ROOT_PARENT_ID;
    if (!parentNode && resolvedRootParentId === null) {
      Toast.warning('目录根节点初始化中，请稍后重试');
      return;
    }

    try {
      const nextCreateValue = type === 'file'
        ? splitFileBaseNameAndExt(name.trim())
        : { name: name.trim(), ext: '' };
      if (!nextCreateValue.name) {
        Toast.warning('名称不能为空');
        setCreateModal(prev => ({ ...prev, loading: false }));
        return;
      }

      const parentId = parentNode ? parentNode.id : Number(resolvedRootParentId);
      const storageProvider = type === 'file' ? selectedProvider : '';

      setCreateModal(prev => ({ ...prev, loading: true }));
      let newNode: any = await createNode({
        name: nextCreateValue.name,
        ext: type === 'file' ? nextCreateValue.ext : undefined,
        parentId,
        libraryId,
        type,
      });
      if (type === 'file') {
        try {
          newNode = await updateNodeFileContent({
            nodeId: Number(newNode.id),
            libraryId,
            content: '',
            contentType: 'text/plain; charset=utf-8',
            storageProvider,
          });
        } catch (error) {
          const cleanupNodeId = Number(newNode.id);
          await deleteNodeAndChildren(cleanupNodeId, libraryId).catch((deleteError) => {
            runtimeLogger.warn('新建文件首次写入失败后清理节点失败:', deleteError);
          });
          await hardDeleteNodeAndChildren(cleanupNodeId, libraryId).catch((hardDeleteError) => {
            runtimeLogger.warn('新建文件首次写入失败后彻底清理节点失败:', hardDeleteError);
          });
          throw error;
        }
      }
      
      Toast.success(`${type === 'dir' ? '文件夹' : '文件'}创建成功`);
      resetCreateModalState();
      
      // 通知父组件刷新
      if (onUploadSuccess) {
        if (parentNode) {
          onUploadSuccess(parentNode, newNode);
        } else if (resolvedRootParentId !== null) {
          onUploadSuccess({ id: resolvedRootParentId, key: 'root' }, newNode);
        }
      }
      
      scheduleRecompute();
    } catch (error: any) {
      runtimeLogger.error('创建节点失败:', error);
      Toast.error(error.message || '创建失败，请重试');
      setCreateModal(prev => ({ ...prev, loading: false }));
    }
  };

  // 取消创建
  const handleCancelCreate = () => {
    resetCreateModalState();
  };

  // 确认重命名
  const handleRenameConfirm = async (node: any) => {
    const inputName = editingName;
    if (inputName.trim() === '') {
      Toast.warning('名称不能为空');
      setEditingKey(null);
      return;
    }

    const isFileNode = node.isLeaf === true;
    const currentBaseName = String(node.data?.rawName || node.label || '');
    const currentExt = String(node.data?.rawExt ?? node.ext ?? '').replace(/^\./, '');
    const currentFullName = isFileNode
      ? buildFileFullName(currentBaseName, currentExt)
      : currentBaseName;

    // 如果名称没变，直接关闭
    if (inputName === currentFullName) {
      setEditingKey(null);
      setEditingName('');
      return;
    }

    const validation = validateWindowsLikeFileName(inputName);
    if (!validation.valid) {
      Toast.warning(validation.message);
      return;
    }

    const next = isFileNode
      ? splitFileBaseNameAndExt(inputName)
      : { name: inputName, ext: '' };

    if (!next.name) {
      Toast.warning('名称不能为空');
      return;
    }

    try {
      await renameNode({
        id: node.id,
        name: next.name,
        ext: isFileNode ? next.ext : undefined,
      });
      
      Toast.success('重命名成功');
      if (onRenameSuccess) {
        onRenameSuccess(node.key, {
          name: next.name,
          ext: isFileNode ? next.ext : undefined,
        });
      }
      setEditingKey(null);
      setEditingName('');
      scheduleRecompute();
    } catch (error: any) {
      runtimeLogger.error('重命名失败:', error);
      Toast.error(error.message || '重命名失败');
      // 失败了也不一定要关闭，可以让用户继续改或者手动取消
    }
  };

  const handleRenameCancel = () => {
    setEditingKey(null);
    setEditingName('');
  };

  // 打开菜单：记录坐标和节点
  const openMenu = (e: React.MouseEvent, node: any, isFolder: boolean) => {
    e.preventDefault();
    e.stopPropagation();

    const x = e.clientX;
    const y = e.clientY;
    const boundaryRect = resolveTreeBoundaryRect();
    const position = resolveMenuPosition(x, y, boundaryRect);
    const deleteCount = Math.max(1, resolveDeleteSelection(node).length);

    void (async () => {
      let result: DirectoryContextMenuResult;

      try {
        result = await openOverlay('directory-context-menu', {
          boundaryRect,
          deleteCount,
          isFolder,
          node: createContextMenuNodeSnapshot(node),
          position: position as OverlayContextMenuPosition,
          submenuPreferredHorizontal: browserModeOpen ? 'left' : 'right',
          x,
          y,
        });
      } catch (error: any) {
        runtimeLogger.error('打开目录右键菜单失败:', error);
        Toast.error(error?.message || '打开右键菜单失败');
        return;
      }

      if (result.type !== 'action') {
        return;
      }

      await handleAction(result.action, node);
    })();
  };

  // 行 label 渲染
  const renderLabel = (label?: ReactNode, treeNode?: any): ReactNode => {
    if (!treeNode) return label;
    const isFolder = String(treeNode.type) === 'dir';
    const isArchiveFolder = isFolder && Number(treeNode.archiveMode ?? 0) === 1;
    const externalUpload = resolveExternalUpload(treeNode, treeDataRef.current || []);

    // 拖拽悬停：外部文件和内部树节点都支持延时自动展开目录
    const onDragEnter = (e: React.DragEvent) => {
      const isExternalDrag = isExternalFileDrag(e);
      const isInternalTreeDrag = hasActiveInternalTreeDrag();
      if (!isExternalDrag && !isInternalTreeDrag) return;
      if (isExternalDrag && externalUpload.blockedReason) {
        return;
      }
      if (!isFolder && !externalUpload.targetNode) return;

      if (isExternalDrag) {
        e.preventDefault();
        e.stopPropagation();
        if (shouldShowExternalUploadHover(treeNode, externalUpload)) {
          applyExternalUploadHover(externalUpload);
        } else {
          clearExternalUploadHover();
        }
      }

      if (!isFolder || isArchiveFolder) {
        return;
      }

      if (!expandedKeys.includes(treeNode.key)) {
        if (expandTimerRef.current) {
          window.clearTimeout(expandTimerRef.current);
          expandTimerRef.current = null;
        }
        expandTimerRef.current = window.setTimeout(() => {
          ensureLazyLoadThenExpand(treeNode);
        }, 500);
      }
    };
    const onDragOver = (e: React.DragEvent) => {
      if (isExternalFileDrag(e)) {
        if (externalUpload.blockedReason) return;
        if (!isFolder && !externalUpload.targetNode) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDragLeave = (e: React.DragEvent) => {
      const isExternalDrag = isExternalFileDrag(e);
      const isInternalTreeDrag = hasActiveInternalTreeDrag();
      if (!isExternalDrag && !isInternalTreeDrag) return;
      if (isExternalDrag && externalUpload.blockedReason) return;
      if (!isFolder && !externalUpload.targetNode) return;
      if (isExternalDrag) {
        e.stopPropagation();
        return;
      }
      clearExternalUploadHover(externalUpload.targetKey);
    };
    const onDrop = (e: React.DragEvent) => {
      const isExternalDrag = isExternalFileDrag(e);
      const isInternalTreeDrag = hasActiveInternalTreeDrag();
      if (!isExternalDrag && !isInternalTreeDrag) return;
      clearExternalUploadHover(externalUpload.targetKey);
      if (!isExternalDrag) return;
      handleExternalUploadDrop(e, externalUpload);
    };

    if (editingKey === treeNode.key) {
      const renameInputWidthCh = Math.min(Math.max(editingName.length + 6, 24), 72);

      return (
        <div 
          className="tree-node-label editing" 
          ref={bindLabelRef(treeNode.key)}
          data-node-key={String(treeNode.key || '')}
          data-node-folder={isFolder ? 'true' : 'false'}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%' }}
        >
          <Input
            className="tree-node-rename-input"
            size="small"
            value={editingName}
            onChange={setEditingName}
            onBlur={() => handleRenameConfirm(treeNode)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                handleRenameCancel();
              }
            }}
            autoFocus
            style={{
              width: `${renameInputWidthCh}ch`,
              maxWidth: '100%',
            }}
            inputStyle={{
              height: 18,
              lineHeight: '18px',
              paddingTop: 0,
              paddingBottom: 0,
            }}
            onFocus={(e) => {
              const input = e.target as HTMLInputElement;
              const value = input.value;
              if (treeNode.isLeaf) {
                const dotIndex = value.lastIndexOf('.');
                // 如果有后缀且不是以点开头
                if (dotIndex > 0) {
                  input.setSelectionRange(0, dotIndex);
                } else {
                  input.select();
                }
              } else {
                input.select();
              }
              requestAnimationFrame(() => {
                input.scrollLeft = 0;
              });
            }}
          />
        </div>
      );
    }

    return (
      <div
        className={`tree-node-label ${dragOverKey === treeNode.key ? 'drag-over' : ''}`}
        ref={bindLabelRef(treeNode.key)}
        data-node-key={String(treeNode.key || '')}
        data-node-folder={isFolder ? 'true' : 'false'}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={(e) => handleSelectionIntent(treeNode, e)}
        onContextMenu={(e) => openMenu(e, treeNode, isFolder)}
      >
        <span
          className={`tree-node-text ${isArchiveFolder ? 'tree-node-text-archive' : ''}`}
          ref={bindTextRef(treeNode.key)}
        >
          {label}
        </span>
      </div>
    );
  };

  useEffect(() => {
    const handleLocate = (event: Event) => {
      const customEvent = event as CustomEvent<TreeLocateNodeDetail>;
      const detail = customEvent.detail;
      if (!detail) return;
      if (Number(detail.libraryId) !== Number(libraryId)) return;
      const nodeId = Number(detail.nodeId);
      if (!Number.isFinite(nodeId) || nodeId <= 0) return;

      void locateNodeInTreeById(nodeId).catch((error) => {
        runtimeLogger.warn('目录树定位节点失败:', error);
        Toast.warning('目录树定位失败，请稍后重试');
      });
    };

    window.addEventListener(TREE_LOCATE_NODE_EVENT, handleLocate as EventListener);
    return () => {
      window.removeEventListener(TREE_LOCATE_NODE_EVENT, handleLocate as EventListener);
    };
  }, [libraryId, locateNodeInTreeById]);

  useEffect(() => {
    removeStaleTreeDragPreviews();
    return () => {
      removeStaleTreeDragPreviews();
    };
  }, []);

  useEffect(() => {
    const endExternalDragSession = () => {
      restoreExternalDragExpandedKeys();
      lastExternalDropResolutionRef.current = null;
    };

    window.addEventListener('drop', endExternalDragSession);
    window.addEventListener('dragend', endExternalDragSession);

    return () => {
      window.removeEventListener('drop', endExternalDragSession);
      window.removeEventListener('dragend', endExternalDragSession);
    };
  }, [restoreExternalDragExpandedKeys]);

  React.useLayoutEffect(() => {
    syncRenderedSelectionStyles();
  }, [syncRenderedSelectionStyles]);

  React.useLayoutEffect(() => {
    refreshVisibleRowBounds();
  }, [refreshVisibleRowBounds]);

  const resolveExternalUploadAtPointer = (clientY: number): { hoveredNode: any | null; resolution: ExternalUploadResolution } => {
    const container = wrapperRef.current?.parentElement ?? null;
    let visibleRows = visibleRowBoundsRef.current;
    if (visibleRows.length === 0) {
      visibleRows = computeVisibleRowBounds(visibleNodesLinear, rowRefs.current, container);
      visibleRowBoundsRef.current = visibleRows;
    }

    const hoveredNode = resolveVisibleTreeNodeByClientY(clientY, container, visibleRows);
    const resolution = resolveExternalUpload(hoveredNode, treeDataRef.current || []);
    if (resolution.targetNode || resolution.blockedReason) {
      lastExternalDropResolutionRef.current = {
        clientY,
        createdAt: Date.now(),
        resolution,
      };
      return { hoveredNode, resolution };
    }

    const fallback = lastExternalDropResolutionRef.current;
    if (fallback?.resolution?.targetNode && container && visibleRows.length > 0) {
      const FALLBACK_MAX_AGE_MS = 500;
      const FALLBACK_MAX_POINTER_DELTA = 28;
      const FALLBACK_ROW_GAP_TOLERANCE = 10;
      const ageMs = Date.now() - fallback.createdAt;
      const pointerDelta = Math.abs(clientY - fallback.clientY);
      const containerRect = container.getBoundingClientRect();
      const localY = clientY - containerRect.top + container.scrollTop;
      const firstRow = visibleRows[0];
      const lastRow = visibleRows[visibleRows.length - 1];
      const withinNearbyRows = localY >= firstRow.top - FALLBACK_ROW_GAP_TOLERANCE
        && localY <= lastRow.bottom + FALLBACK_ROW_GAP_TOLERANCE;

      if (
        ageMs <= FALLBACK_MAX_AGE_MS
        && pointerDelta <= FALLBACK_MAX_POINTER_DELTA
        && withinNearbyRows
      ) {
        return { hoveredNode, resolution: fallback.resolution };
      }
    }

    return { hoveredNode, resolution };
  };

  const handleTreeContainerExternalDragOverCapture = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(e)) {
      return;
    }
    e.preventDefault();
    const { hoveredNode, resolution } = resolveExternalUploadAtPointer(e.clientY);
    if (resolution.targetNode && !resolution.blockedReason) {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'none';
    }

    if (shouldShowExternalUploadHover(hoveredNode, resolution)) {
      applyExternalUploadHover(resolution);
    } else {
      clearExternalUploadHover();
    }
  };

  const handleTreeContainerExternalDropCapture = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const { resolution } = resolveExternalUploadAtPointer(e.clientY);
    handleExternalUploadDrop(e, resolution);
    lastExternalDropResolutionRef.current = null;
  };

  const handleTreeContainerExternalDragLeaveCapture = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(e)) {
      return;
    }
    const wrapper = wrapperRef.current;
    const nextTarget = e.relatedTarget as Node | null;
    if (wrapper && nextTarget && wrapper.contains(nextTarget)) {
      return;
    }
    lastExternalDropResolutionRef.current = null;
    clearExternalUploadHover();
  };

  return (
    <div 
      className="tree-container" 
      ref={treeContainerRef}
      style={{ height: '100%', width: '100%' }}
      onContextMenu={(e) => {
        const optionElement = (e.target as HTMLElement | null)?.closest('.semi-tree-option');
        if (optionElement) {
          const labelElement = optionElement.querySelector<HTMLElement>('.tree-node-label[data-node-key]');
          const nodeKey = String(labelElement?.dataset.nodeKey || '').trim();
          if (nodeKey) {
            const fallbackNode = findNodeByKey(treeDataRef.current || [], nodeKey);
            if (fallbackNode) {
              openMenu(e, fallbackNode, String(labelElement?.dataset.nodeFolder) === 'true');
              return;
            }
          }
        }
        // 空白区域右键：打开根目录菜单
        openMenu(e, null, true);
      }}
    >
      <div
        className="custom-tree-wrapper"
        ref={wrapperRef}
        onDragOverCapture={handleTreeContainerExternalDragOverCapture}
        onDragLeaveCapture={handleTreeContainerExternalDragLeaveCapture}
        onDropCapture={handleTreeContainerExternalDropCapture}
      >
        {treeData.length === 0 ? (
          <div style={{ 
            padding: '40px 20px', 
            textAlign: 'center', 
            color: 'var(--semi-color-text-2)', 
            fontSize: '14px'
          }}>
            目录树为空，右键菜单可新建文件或文件夹
          </div>
        ) : (
          <Tree
            draggable
            onDragStart={(info) => {
              runtimeLogger.debug('开始拖拽', info);
              dragDropHandledRef.current = false;
              dragDropPendingRef.current = false;
              const draggedNode = (info as any)?.node || (info as any)?.dragNode;
              const draggedNodeId = Number(draggedNode?.id);
              if (!Number.isFinite(draggedNodeId) || draggedNodeId <= 0) {
                dragSelectionNodeIdsRef.current = [];
                resetDragCollapseTracking();
                return;
              }
              if (!selectedNodeIds.includes(draggedNodeId)) {
                setSelectedNodeIds([draggedNodeId]);
                setSelectionAnchorKey(String(draggedNode?.key || ''));
                dragSelectionNodeIdsRef.current = [draggedNodeId];
                prepareDragCollapsedNodes([draggedNodeId]);
                return;
              }
              dragSelectionNodeIdsRef.current = [...selectedNodeIds];
              prepareDragCollapsedNodes(selectedNodeIds);
            }}
            onDragEnd={(info) => {
              runtimeLogger.debug('拖拽结束', info);
              if (!dragDropPendingRef.current && !dragDropHandledRef.current) {
                restoreDragCollapsedKeys();
              }
              if (!dragDropPendingRef.current) {
                resetDragCollapseTracking();
              }
              dragSelectionNodeIdsRef.current = [];
              removeStaleTreeDragPreviews();
            }}
            onDrop={(info) => {
              const dropEvent = ((info as any)?.event || (info as any)?.nativeEvent || null) as React.DragEvent | null;
              if (dropEvent && isExternalFileDrag(dropEvent)) {
                removeStaleTreeDragPreviews();
                return;
              }
              dragDropPendingRef.current = true;
              removeStaleTreeDragPreviews();
              void handleTreeDrop(info);
            }}
            renderDraggingNode={renderDraggingNode}
            className="custom-tree"
            treeData={renderTreeData}
            expandedKeys={expandedKeys}
            value={[]}
            onExpand={handleExpand}
            onSelect={() => {}}
            onDoubleClick={handleTreeDoubleClick}
            loadData={handleLoadData}
            directory
            renderLabel={renderLabel}
            style={{ padding: '2px 0 2px 0' }}
          />
        )}
      </div>

      {/* 目录树右键菜单已迁移至 overlay 子窗口（见 docs/overlay-window-architecture.md） */}
      {/* 上传确认弹框已迁移至 overlay 子窗口（见 docs/overlay-window-architecture.md） */}

      {/* 新建文件/文件夹 Modal - 居中显示 */}
      <CreateNodeModal
        visible={createModal.visible}
        type={createModal.type}
        name={createModal.name}
        loading={createModal.loading}
        defaultProvider={createModal.defaultProvider}
        providers={createModal.providers}
        providerLoading={createModal.providerLoading}
        selectedProvider={createModal.selectedProvider}
        onNameChange={(value) => setCreateModal(prev => ({ ...prev, name: value }))}
        onProviderChange={(value) => setCreateModal(prev => ({ ...prev, selectedProvider: value }))}
        onConfirm={handleConfirmCreate}
        onCancel={handleCancelCreate}
      />

      {/* 存储迁移对话框 */}
      <MigrationDialog
        visible={migrationDialog.visible}
        libraryId={Number(libraryId)}
        rootNodeId={migrationDialog.rootNodeId}
        nodeName={migrationDialog.nodeName}
        availableProviders={migrationProviders}
        onCancel={() => setMigrationDialog({ visible: false, rootNodeId: 0, nodeName: '' })}
        onSuccess={() => {
          setMigrationDialog({ visible: false, rootNodeId: 0, nodeName: '' });
          window.location.hash = '#/transfer-center?tab=migration';
        }}
      />
    </div>
  );
}
