import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Tree, Toast, Input, Popover, Modal } from '@douyinfe/semi-ui';
import {
  batchSetArchiveChildrenBuiltInType,
  createNode,
  deleteNodeAndChildren,
  getAllDescendantsByNodeId,
  fetchNodeDetailById,
  getFileLink,
  moveNodesBatch,
  renameNode,
  sortComicChildrenByName,
  updateNodeConfig,
} from "../../services/file.api";
import { uploadManager } from '@/utils/uploadManager.ts';
import UploadConfirmModal from './modals/UploadConfirmModal.tsx';
import CreateNodeModal from './modals/CreateNodeModal.tsx';
import DirectoryContextMenu from './context-menu/DirectoryContextMenu.tsx';
import { UPLOAD_TASK_STATUS } from '@/modules/upload-center/model/upload-task.types';
import { buildFileFullName, splitFileBaseNameAndExt } from '@/utils/fileTreeSettings';
import { validateWindowsLikeFileName } from '@/utils/windowsFileName';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { requestDesktopWindowActivation } from '@/utils/windowActivation';
import { useFileViewer } from '@/hooks/useFileViewer';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import {
  isIgnoredSystemFilePath,
  pickUploadFilesFromDesktop,
  pickUploadFoldersFromDesktop,
} from '@/features/file-explorer/services/desktop-upload-picker.api';
import type { UploadCandidateFile } from '@/features/file-explorer/services/desktop-upload-picker.api';
import { normalizeUploadRelativePath, UploadPathResolver } from '@/features/file-explorer/services/upload-path-resolver';
import {
  downloadUrlToDesktopPath,
  ensureDesktopDirectory,
  normalizeDownloadRelativePath,
  pickDownloadDirectoryFromDesktop,
} from '@/features/file-explorer/services/desktop-download.api';
import { TREE_LOCATE_NODE_EVENT, type TreeLocateNodeDetail } from '@/features/file-explorer/services/tree-locate';

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
  libraryId: number; // 添加 libraryId prop
  rootNodeId: number | null;
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

function findNodeById(nodes: any[], targetId: number): any | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, targetId);
      if (found) return found;
    }
  }
  return null;
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
  loadData,
  libraryId,
  rootNodeId,
}: DirectoryTreeProps) {
  const { closeTabByNodeId, tabs } = useFileViewer();

  interface UploadModalTargetNode {
    id: number;
    key: string;
    label: string;
    libraryId: number;
  }

  // 外部文件拖拽：悬停高亮 & 延迟展开
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const expandTimerRef = useRef<number | null>(null);

  // 菜单状态
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    node: any | null; // null 表示根目录
    isFolder: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    node: null,
    isFolder: false,
  });

  // 上传 Modal 的状态
  const [uploadModal, setUploadModal] = useState<{
    visible: boolean;
    files: UploadCandidateFile[];
    targetNode: UploadModalTargetNode | null;
    loading: boolean;
  }>({
    visible: false,
    files: [],
    targetNode: null,
    loading: false,
  });

  // 新建文件/文件夹 Modal 的状态
  const [createModal, setCreateModal] = useState<{
    visible: boolean;
    type: 'file' | 'dir' | null;
    parentNode: any | null; // 父节点，null 表示根目录
    name: string;
    loading: boolean;
  }>({
    visible: false,
    type: null,
    parentNode: null,
    name: '',
    loading: false,
  });

  // 内联编辑状态（重命名用）
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null);
  const dragSelectionNodeIdsRef = useRef<number[]>([]);

  // Tree 内容容器（可滚动内容层在 wrapper 中）
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // 仅当用户通过“右键 -> 打开原始目录”授权后，才允许内置类型目录展开
  const rawOpenAllowedKeysRef = useRef<Set<string>>(new Set());
  const [rawOpenVersion, setRawOpenVersion] = useState(0);

  // 为每个“可见行”的 label 与其内部文字 span 保持引用
  type RowRefs = { label: HTMLElement | null; text: HTMLElement | null };
  const rowRefs = useRef<Map<string, RowRefs>>(new Map());
  const treeDataRef = useRef<any[]>(treeData);

  // 记录上一次应用到 wrapper 的 minWidth，避免 1px 抖动
  const lastAppliedWidthRef = useRef<number>(0);

  // 记录上一次的 expandedKeys
  const prevExpandedKeysRef = useRef<string[]>(expandedKeys);

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

  const formatFileSize = (size: unknown): string => {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    const precision = index <= 1 ? 0 : 2;
    return `${value.toFixed(precision)} ${units[index]}`;
  };

  const formatDateTime = (value: unknown): string => {
    if (!value) return '-';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  const showNodeProperties = (node: any) => {
    const isFile = node.isLeaf === true;
    const baseName = String(node.data?.rawName || node.label || node.name || '');
    const ext = String(node.data?.rawExt ?? node.ext ?? '').replace(/^\./, '');
    const fullName = isFile ? buildFileFullName(baseName, ext) : baseName;
    const typeLabel = isFile ? '文件' : '文件夹';
    const builtInType = String(node.builtInType || 'DEF').toUpperCase();
    const archiveMode = Number(node.archiveMode ?? 0) === 1 ? '开启' : '关闭';
    const mimeType = String(node.data?.mimeType || node.mimeType || '');
    const fileSize = formatFileSize(node.data?.fileSize ?? node.fileSize);
    const createdAt = formatDateTime(node.data?.createdAt || node.createdAt);
    const updatedAt = formatDateTime(node.data?.updatedAt || node.updatedAt);

    const fieldStyle: React.CSSProperties = {
      display: 'grid',
      gridTemplateColumns: '88px 1fr',
      columnGap: 10,
      rowGap: 6,
      alignItems: 'start',
      fontSize: 13,
      lineHeight: '20px',
      marginBottom: 4,
    };
    const labelStyle: React.CSSProperties = {
      color: 'var(--semi-color-text-2)',
      userSelect: 'none',
    };
    const valueStyle: React.CSSProperties = {
      color: 'var(--semi-color-text-0)',
      wordBreak: 'break-all',
      minWidth: 0,
    };

    Modal.info({
      title: `属性 · ${fullName || '-'}`,
      okText: '关闭',
      width: 560,
      centered: true,
      content: (
        <div style={{ marginTop: 4 }}>
          <div style={fieldStyle}><span style={labelStyle}>名称</span><span style={valueStyle}>{fullName || '-'}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>类型</span><span style={valueStyle}>{typeLabel}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>后缀</span><span style={valueStyle}>{isFile ? (ext || '-') : '-'}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>MIME</span><span style={valueStyle}>{isFile ? (mimeType || '-') : '-'}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>大小</span><span style={valueStyle}>{isFile ? fileSize : '-'}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>内置类型</span><span style={valueStyle}>{builtInType}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>归档模式</span><span style={valueStyle}>{archiveMode}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>节点ID</span><span style={valueStyle}>{node.id ?? '-'}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>父节点ID</span><span style={valueStyle}>{node.parentId ?? ROOT_PARENT_ID ?? '-'}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>创建时间</span><span style={valueStyle}>{createdAt}</span></div>
          <div style={fieldStyle}><span style={labelStyle}>修改时间</span><span style={valueStyle}>{updatedAt}</span></div>
        </div>
      ),
    });
  };

  const resolveNodeType = (node: any): 'dir' | 'file' => {
    const typeRaw = String(node?.type ?? '').toLowerCase();
    if (typeRaw === 'file' || Number(node?.type) === 1 || node?.isLeaf === true) {
      return 'file';
    }
    return 'dir';
  };

  const resolveNodeBaseName = (node: any): string =>
    String(node?.data?.rawName ?? node?.name ?? node?.label ?? '');

  const resolveNodeExt = (node: any): string =>
    String(node?.data?.rawExt ?? node?.ext ?? '').replace(/^\./, '');

  const buildNodeFileName = (node: any): string =>
    buildFileFullName(resolveNodeBaseName(node), resolveNodeExt(node));

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

  const scheduleRecompute = () => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      recomputeRequiredWidth();
    });
  };

  /** 基于当前已经渲染的所有节点，计算内容所需的最小宽度 */
  const recomputeRequiredWidth = () => {
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
  };

  // 处理文件放置逻辑
  const toUploadModalTargetNode = (node: any | null): UploadModalTargetNode | null => {
    if (!node) {
      const rootParentId = resolveRootParentId();
      if (rootParentId === null) return null;
      return {
        id: rootParentId,
        key: 'root',
        label: '根目录',
        libraryId,
      };
    }
    const rootParentId = ROOT_PARENT_ID;
    const fallbackId = rootParentId !== null ? rootParentId : Number(node.id);
    return {
      id: Number(node.id || fallbackId),
      key: String(node.key || 'root'),
      label: String(node.label || node.data?.rawName || '根目录'),
      libraryId: Number(node.libraryId || libraryId),
    };
  };

  const buildUploadCandidateFromDragFile = (file: File): UploadCandidateFile => {
    const rawRelativePath = (file as any).webkitRelativePath || file.name;
    const relativePath = normalizeUploadRelativePath(rawRelativePath || file.name);
    return {
      file,
      relativePath: relativePath || file.name,
    };
  };

  const openUploadModal = (targetNode: UploadModalTargetNode, files: UploadCandidateFile[]) => {
    if (!files.length) {
      Toast.warning('未选择可上传文件');
      return;
    }
    setUploadModal({
      visible: true,
      files,
      targetNode,
      loading: false,
    });
  };

  const handleExternalDropOnFolder = (treeNode: any, e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;

    requestDesktopWindowActivation(true);
    const candidates = files
      .map(buildUploadCandidateFromDragFile)
      .filter(candidate => !isIgnoredSystemFilePath(candidate.relativePath || candidate.file.name));
    if (!candidates.length) {
      Toast.warning('拖拽内容仅包含系统隐藏文件，已忽略');
      return;
    }
    const targetNode = toUploadModalTargetNode(treeNode);
    if (!targetNode) {
      return;
    }
    openUploadModal(targetNode, candidates);
  };

  // 外部文件拖拽
  const isExternalFileDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes('Files');
  };

  const findNodeByKey = (nodes: any[], targetKey: string): any | null => {
    for (const node of nodes) {
      if (node.key === targetKey) return node;
      if (node.children && node.children.length > 0) {
        const found = findNodeByKey(node.children, targetKey);
        if (found) return found;
      }
    }
    return null;
  };

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

  const renderTreeData = (() => {
    // 读取版本号用于触发重算（由 allow/revoke 更新）
    void rawOpenVersion;

    const patchNodes = (nodes: any[]): any[] => {
      return nodes.map(node => {
        const patchedChildren = node.children && node.children.length > 0
          ? patchNodes(node.children)
          : node.children;

        if (!isBuiltInFolderNode(node)) {
          if (patchedChildren !== node.children) {
            return { ...node, children: patchedChildren };
          }
          return node;
        }

        if (isRawOpenAllowed(node.key)) {
          return {
            ...node,
            isLeaf: false,
            children: patchedChildren,
          };
        }

        // 回锁时清空展示态：隐藏箭头并清空当前挂载子节点
        return {
          ...node,
          isLeaf: true,
          loaded: false,
          children: [],
        };
      });
    };

    return patchNodes(treeData);
  })();

  const collectVisibleTreeNodes = (nodes: any[], expandedKeySet: Set<string>, acc: any[]) => {
    nodes.forEach((node) => {
      acc.push(node);
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) return;
      if (String(node.type) === 'file') return;
      if (!expandedKeySet.has(String(node.key))) return;
      collectVisibleTreeNodes(children, expandedKeySet, acc);
    });
  };

  const getVisibleNodesLinear = (): any[] => {
    const acc: any[] = [];
    collectVisibleTreeNodes(renderTreeData, new Set(expandedKeys), acc);
    return acc;
  };

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

    const dragNode = info?.dragNode as any;
    const dropNode = info?.node as any;
    if (!dragNode || !dropNode) {
      Toast.error('拖拽数据异常');
      return;
    }

    const dropNodeId = Number(dropNode.id);
    if (!Number.isFinite(dropNodeId)) {
      Toast.error('拖拽节点数据异常');
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
        return;
      }
      newParentId = dropNodeId;
      beforeNodeId = null;
    }

    if (!Number.isFinite(newParentId) || newParentId <= 0) {
      const rootParentId = resolveRootParentId();
      if (rootParentId === null) {
        return;
      }
      newParentId = rootParentId;
    }

    const normalizedMoveNodes = normalizeMoveSelection(activeSelectionIds);
    if (normalizedMoveNodes.length === 0) {
      Toast.warning('当前选中节点不可移动');
      return;
    }

    for (const moveNode of normalizedMoveNodes) {
      const moveNodeId = Number(moveNode.id);
      if (!Number.isFinite(moveNodeId) || moveNodeId <= 0) {
        continue;
      }
      if (newParentId === moveNodeId || isDescendantNodeById(newParentId, moveNodeId, parentMap)) {
        Toast.warning('不能移动到自身或其子节点下');
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
    } catch (error: any) {
      runtimeLogger.error('移动节点失败:', error);
      Toast.error(error?.message || '移动失败');
    } finally {
      dragSelectionNodeIdsRef.current = [];
    }
  };

  const createDragPreview = (label: string, textColor: string, previewWidth: number): HTMLElement => {
    const preview = document.createElement('div');
    preview.textContent = label;
    preview.style.boxSizing = 'border-box';
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
    return preview;
  };

  const renderDraggingNode = (nodeInstance: HTMLElement, nodeData: unknown): HTMLElement => {

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

  const resolveParentNodeForAppend = (parentId: number) => {
    if (ROOT_PARENT_ID !== null && parentId === ROOT_PARENT_ID) {
      return {
        id: ROOT_PARENT_ID,
        key: 'root',
        label: '根目录',
        libraryId,
      };
    }
    const parentNode = findNodeById(treeDataRef.current || [], parentId);
    if (parentNode) {
      return parentNode;
    }
    return null;
  };

  const hashString = (input: string): string => {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  };

  const buildUploadGroupId = (
    relativePath: string,
    fallbackFileName: string,
    localPath: string,
    batchSeed: string,
  ): string => {
    const segments = String(relativePath || fallbackFileName || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean);
    const rootSegment = segments[0] || fallbackFileName || 'file';
    const normalizedLocalPath = String(localPath || '').replace(/\\/g, '/');
    const suffix = segments.slice(1).join('/');
    const rootLocalPath = suffix && normalizedLocalPath.endsWith(`/${suffix}`)
      ? normalizedLocalPath.slice(0, normalizedLocalPath.length - suffix.length - 1)
      : normalizedLocalPath;
    return `${batchSeed}:${rootSegment}:${hashString(rootLocalPath || normalizedLocalPath || relativePath)}`;
  };

  const nextMicroTask = () =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

  const startUploadInBackground = async (
    files: UploadCandidateFile[],
    targetNode: UploadModalTargetNode,
  ) => {
    const pathResolver = new UploadPathResolver({
      libraryId: targetNode.libraryId,
      rootParentId: targetNode.id,
      onDirectoryCreated: ({ parentId, newDirectoryNode }) => {
        if (!onUploadSuccess) return;
        const parentNode = resolveParentNodeForAppend(parentId);
        if (!parentNode) return;
        onUploadSuccess(parentNode, newDirectoryNode);
      },
    });

    const CHUNK_SIZE = 120;
    const batchSeed = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const donePromises: Array<Promise<any>> = [];

    for (let start = 0; start < files.length; start += CHUNK_SIZE) {
      const chunk = files.slice(start, start + CHUNK_SIZE);
      const chunkTasks = await Promise.all(
        chunk.map(async (candidate) => {
          const relativePath = normalizeUploadRelativePath(candidate.relativePath || candidate.file.name);
          const parentId = await pathResolver.resolveParentId(relativePath);
          return {
            file: candidate.file,
            parentId,
            libraryId: targetNode.libraryId,
            relativePath,
            folderGroupId: buildUploadGroupId(
              relativePath,
              candidate.file.name,
              String((candidate.file as any)?.path || ''),
              batchSeed,
            ),
          };
        }),
      );

      const batch = uploadManager.createBatch(chunkTasks, {
        onSingleSuccess: (newNode) => {
          const parentId = Number((newNode as any)?.parentId || targetNode.id);
          const parentNode = resolveParentNodeForAppend(parentId);
          if (onUploadSuccess && parentNode) {
            onUploadSuccess(parentNode, newNode);
          }
        },
      });
      donePromises.push(batch.done);
      await nextMicroTask();
    }

    const results = (await Promise.all(donePromises)).flat();
    const successCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.SUCCESS).length;
    const failedCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.FAILED).length;
    const canceledCount = results.filter(r => r.taskStatus === UPLOAD_TASK_STATUS.CANCELED).length;

    if (failedCount === 0 && canceledCount === 0) {
      Toast.success(`成功上传 ${successCount} 个文件`);
    } else if (failedCount === 0 && canceledCount > 0) {
      Toast.info(`上传已中断：成功 ${successCount} 个，中断 ${canceledCount} 个`);
    } else if (successCount > 0 || canceledCount > 0) {
      Toast.warning(
        `部分上传成功：成功 ${successCount} 个，失败 ${failedCount} 个，中断 ${canceledCount} 个`,
      );
    } else {
      Toast.error('全部文件上传失败');
    }
  };

  // 执行上传逻辑
  const handleConfirmUpload = async () => {
    const { files, targetNode } = uploadModal;
    if (!files.length || !targetNode) return;

    setUploadModal({ visible: false, files: [], targetNode: null, loading: false });
    Toast.info(`正在准备上传队列（${files.length} 个文件）`);

    void startUploadInBackground(files, targetNode).catch((error) => {
      runtimeLogger.error('上传执行失败:', error);
      Toast.error((error as any)?.message || '上传过程中出现未知错误');
    });
  };

  // 取消上传
  const handleCancelUpload = () => {
    if (uploadModal.loading) {
      return;
    }
    setUploadModal({ visible: false, files: [], targetNode: null, loading: false });
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
      if (prev?.text) rowRefs.current.set(key, { label: null, text: prev.text });
      else rowRefs.current.delete(key);
      return;
    }
    const prev = rowRefs.current.get(key) ?? { label: null, text: null };
    rowRefs.current.set(key, { ...prev, label: el });
    scheduleRecompute();
  };
  const bindTextRef = (key: string) => (el: HTMLElement | null) => {
    if (!el) {
      const prev = rowRefs.current.get(key);
      if (prev?.label) rowRefs.current.set(key, { label: prev.label, text: null });
      else rowRefs.current.delete(key);
      return;
    }
    const prev = rowRefs.current.get(key) ?? { label: null, text: null };
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
  const handleExpand = (keys: string[]) => {
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

    requestAnimationFrame(() => {
      scheduleRecompute(); // 只看视口，不会被未见内容影响
    });

    prevExpandedKeysRef.current = filteredKeys;
  };

  const handleTreeDoubleClick = (e: React.MouseEvent, node: any) => {
    onDoubleClick(e, node);
  };

  const handlePickUploadFromDesktop = async (mode: 'file' | 'folder', node: any | null) => {
    try {
      requestDesktopWindowActivation(true);
      const targetNode = toUploadModalTargetNode(node);
      if (!targetNode) {
        return;
      }
      const files = mode === 'file'
        ? await pickUploadFilesFromDesktop()
        : await pickUploadFoldersFromDesktop();
      if (!files.length) {
        return;
      }
      openUploadModal(targetNode, files);
    } catch (error: any) {
      runtimeLogger.error(`选择${mode === 'file' ? '文件' : '文件夹'}失败:`, error);
      Toast.error(error?.message || `选择${mode === 'file' ? '文件' : '文件夹'}失败`);
    }
  };

  // 菜单行为
  const handleAction = async (action: string, node: any) => {
    // 关闭菜单
    setMenuState(prev => ({ ...prev, visible: false }));

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

    if (action === '下载') {
      try {
        await handleDownloadNode(node);
      } catch (error: any) {
        runtimeLogger.error('下载节点失败:', error);
        Toast.error(error?.message || '下载失败');
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
      });
    } else if (action === '新建文件夹') {
      setCreateModal({
        visible: true,
        type: 'dir',
        parentNode: node,
        name: '',
        loading: false,
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
        runtimeLogger.debug('🗑️ [删除]', node);
        const parentIdCandidate = Number(node?.parentId);
        const parentId = Number.isFinite(parentIdCandidate) && parentIdCandidate > 0
          ? parentIdCandidate
          : (ROOT_PARENT_ID ?? 0);
        // node.id 是 ancestorId
        await deleteNodeAndChildren(node.id, libraryId);
        Toast.success('删除成功');
        
        // 通知父组件从本地 treeData 中移除节点
        // 直接传递 node.key，这样父组件可以直接删除，不需要查找
        if (onDeleteSuccess) {
          // 构造成一个类 parent 结构，或者传 null
          const dummyParent = node.parentId
            ? { id: node.parentId }
            : (ROOT_PARENT_ID !== null ? { id: ROOT_PARENT_ID, key: 'root' } : null);
          // 传递 node.key 而不是 node.id，这样父组件可以直接删除
          onDeleteSuccess(dummyParent, node.key);
        }

        if (onMoveSuccess && parentId > 0 && (ROOT_PARENT_ID === null || parentId !== ROOT_PARENT_ID)) {
          await onMoveSuccess({ affectedParentIds: [parentId] });
        }

        const playerState = globalAudioPlayer.getState();
        const shouldClearAudio = tabs.some(tab => (
          tab.nodeId === node.id &&
          tab.fileType === 'audio' &&
          tab.fileUrl === playerState.src
        ));

        closeTabByNodeId(node.id);
        if (shouldClearAudio) {
          globalAudioPlayer.clear();
        }
        Toast.info('文件已移入回收站');
        
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
    const { type, parentNode, name } = createModal;
    if (!type || !name.trim()) {
      Toast.warning('请输入名称');
      return;
    }

    const resolvedRootParentId = ROOT_PARENT_ID;
    if (!parentNode && resolvedRootParentId === null) {
      Toast.warning('目录根节点初始化中，请稍后重试');
      return;
    }

    setCreateModal(prev => ({ ...prev, loading: true }));
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
      const newNode = await createNode({
        name: nextCreateValue.name,
        ext: type === 'file' ? nextCreateValue.ext : undefined,
        parentId,
        libraryId,
        type,
      });
      
      Toast.success(`${type === 'dir' ? '文件夹' : '文件'}创建成功`);
      setCreateModal({ visible: false, type: null, parentNode: null, name: '', loading: false });
      
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
    setCreateModal({ visible: false, type: null, parentNode: null, name: '', loading: false });
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
    
    // 获取鼠标位置
    const x = e.clientX;
    const y = e.clientY;
    
    // 如果已经打开，先关闭再打开，强制位置刷新
    if (menuState.visible) {
      setMenuState(prev => ({ ...prev, visible: false }));
      setTimeout(() => {
        setMenuState({
          visible: true,
          x,
          y,
          node,
          isFolder,
        });
      }, 0);
    } else {
      setMenuState({
        visible: true,
        x,
        y,
        node,
        isFolder,
      });
    }
  };

  // 行 label 渲染
  const renderLabel = (label?: ReactNode, treeNode?: any): ReactNode => {
    if (!treeNode) return label;
    const isFolder = String(treeNode.type) === 'dir';
    const isArchiveFolder = isFolder && Number(treeNode.archiveMode ?? 0) === 1;

    // 外部文件拖拽进入：高亮并延时 500ms 自动展开
    const onDragEnter = (e: React.DragEvent) => {
      if (!isExternalFileDrag(e) || !isFolder) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOverKey(treeNode.key);

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
      if (!isExternalFileDrag(e) || !isFolder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const clearHover = () => {
      setDragOverKey(prev => (prev === treeNode.key ? null : prev));
      if (expandTimerRef.current) {
        window.clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
    };
    const onDragLeave = (e: React.DragEvent) => {
      if (!isExternalFileDrag(e) || !isFolder) return;
      e.stopPropagation();
      clearHover();
    };
    const onDrop = (e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clearHover();
      if (!isFolder) {
        runtimeLogger.info('⚠️ 目标是文件，忽略上传：请投递到文件夹节点');
        return;
      }
      handleExternalDropOnFolder(treeNode, e);
    };

    if (editingKey === treeNode.key) {
      const renameInputWidthCh = Math.min(Math.max(editingName.length + 6, 24), 72);

      return (
        <div 
          className="tree-node-label editing" 
          ref={bindLabelRef(treeNode.key)}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%' }}
        >
          <Input
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
              fontSize: '19px',
              height: '34px',
              backgroundColor: 'var(--semi-color-bg-1)',
              border: '1px solid var(--semi-color-primary)',
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

    const isSelected = selectedNodeIds.includes(Number(treeNode.id));
    return (
      <div
        className={`tree-node-label ${dragOverKey === treeNode.key ? 'drag-over' : ''} ${isSelected ? 'is-multi-selected' : ''}`}
        ref={bindLabelRef(treeNode.key)}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        title={typeof label === 'string' ? label : undefined}
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

  // 全局关闭菜单事件
  useEffect(() => {
    const closeMenu = () => setMenuState(prev => ({ ...prev, visible: false }));
    const onScroll = () => closeMenu();
    const onResize = () => closeMenu();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, []);

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

  return (
    <div 
      className="tree-container" 
      style={{ height: '100%', width: '100%' }}
      onContextMenu={(e) => {
        // 空白区域右键：打开根目录菜单
        // 如果点在了 node 上，renderLabel 里的 onContextMenu 会 stopPropagation，所以这里不会触发
        openMenu(e, null, true);
      }}
    >
      <div className="custom-tree-wrapper" ref={wrapperRef}>
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
              const draggedNode = (info as any)?.node || (info as any)?.dragNode;
              const draggedNodeId = Number(draggedNode?.id);
              if (!Number.isFinite(draggedNodeId) || draggedNodeId <= 0) {
                dragSelectionNodeIdsRef.current = [];
                return;
              }
              if (!selectedNodeIds.includes(draggedNodeId)) {
                setSelectedNodeIds([draggedNodeId]);
                setSelectionAnchorKey(String(draggedNode?.key || ''));
                dragSelectionNodeIdsRef.current = [draggedNodeId];
                return;
              }
              dragSelectionNodeIdsRef.current = [...selectedNodeIds];
            }}
            onDragEnd={(info) => {
              runtimeLogger.debug('拖拽结束', info);
              dragSelectionNodeIdsRef.current = [];
            }}
            onDrop={(info) => {
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

      {/* 
        单个 Popover 实例，通过 position anchor 模拟“跟随鼠标”
        Semi Popover 需要一个 trigger element。
        我们在鼠标位置渲染一个看不见的 div，作为 anchor。
      */}
      <Popover
        trigger="custom"
        visible={menuState.visible}
        onClickOutSide={() => setMenuState(prev => ({ ...prev, visible: false }))}
        position="bottomLeft" // 改为 bottomLeft
        style={{
          padding: 0,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          boxShadow: 'none',
        }}
        getPopupContainer={() => document.body}
        showArrow={false}
        spacing={4}
        content={
          <DirectoryContextMenu 
            node={menuState.node} 
            isFolder={menuState.isFolder} 
            onAction={handleAction} 
            onClose={() => setMenuState(prev => ({ ...prev, visible: false }))}
          />
        }
      >
        <div 
          style={{
            position: 'fixed',
            left: menuState.x,
            top: menuState.y,
            width: 1,
            height: 1,
            pointerEvents: 'none'
          }} 
        />
      </Popover>

      {/* Modal 组件 - 居中显示 */}
      <UploadConfirmModal
        visible={uploadModal.visible}
        files={uploadModal.files}
        targetNode={uploadModal.targetNode}
        loading={uploadModal.loading}
        onConfirm={handleConfirmUpload}
        onCancel={handleCancelUpload}
      />

      {/* 新建文件/文件夹 Modal - 居中显示 */}
      <CreateNodeModal
        visible={createModal.visible}
        type={createModal.type}
        name={createModal.name}
        loading={createModal.loading}
        onNameChange={(value) => setCreateModal(prev => ({ ...prev, name: value }))}
        onConfirm={handleConfirmCreate}
        onCancel={handleCancelCreate}
      />
    </div>
  );
}
