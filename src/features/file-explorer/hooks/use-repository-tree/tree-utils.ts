import { buildTreeNodeLabel } from '@/utils/fileTreeSettings';
import { resolvePreviewFileType } from '@/utils/preview-file-type';
import { getDirectoryBuiltInIcon, getFileNodeIconByParentBuiltInType } from '../../utils/file-node-icon';
import type { Node, NodeRespDTO } from './types';

export function normalizeArchiveMode(mode?: number): 0 | 1 {
  return Number(mode ?? 0) === 1 ? 1 : 0;
}

export function resolveFileType(
  mimeType?: string,
  ext?: string,
): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
  return resolvePreviewFileType(mimeType, ext);
}

export function isImageFileNode(item: Pick<NodeRespDTO, 'mimeType' | 'ext'>): boolean {
  return resolveFileType(item.mimeType, item.ext) === 'image';
}

export function isVideoFileNode(item: Pick<NodeRespDTO, 'mimeType' | 'ext'>): boolean {
  return resolveFileType(item.mimeType, item.ext) === 'video';
}

export function isHiddenNodeName(name?: string, ext?: string): boolean {
  const trimmedName = String(name || '').trim();
  if (trimmedName.startsWith('.')) {
    return true;
  }
  const normalizedExt = String(ext || '').trim().replace(/^\./, '');
  return trimmedName.length === 0 && normalizedExt.length > 0;
}

export function isFileNodeType(type: unknown): boolean {
  return String(type) === 'file' || Number(type) === 1;
}

export function findNodeByKey(nodes: Node[], key: string): Node | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeByKey(node.children, key);
      if (found) return found;
    }
  }
  return null;
}

export function findNodeById(nodes: Node[], id: number): Node | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function mergeNodesPreservingLoadedState(previousTree: Node[], nextNodes: Node[]): Node[] {
  return nextNodes.map((node) => {
    const previous = findNodeById(previousTree, node.id);
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

export function replaceNodeChildren(
  nodes: Node[],
  key: string,
  children: Node[],
  options?: { markLoaded?: boolean },
): Node[] {
  const markLoaded = options?.markLoaded ?? true;
  let changed = false;

  const nextNodes = nodes.map((node) => {
    if (node.key === key) {
      const nextLoaded = markLoaded ? true : node.loaded;
      if (node.children === children && nextLoaded === node.loaded) {
        return node;
      }
      changed = true;
      return {
        ...node,
        children,
        loaded: nextLoaded,
      };
    }
    if (!node.children || node.children.length === 0) {
      return node;
    }
    const nextChildren = replaceNodeChildren(node.children, key, children, options);
    if (nextChildren === node.children) {
      return node;
    }
    changed = true;
    return { ...node, children: nextChildren };
  });

  return changed ? nextNodes : nodes;
}

export function removeTreeNodeByKey(nodes: Node[], targetKey: string): Node[] {
  let changed = false;
  const nextNodes: Node[] = [];

  nodes.forEach((node) => {
    if (node.key === targetKey) {
      changed = true;
      return;
    }

    if (!node.children || node.children.length === 0) {
      nextNodes.push(node);
      return;
    }

    const nextChildren = removeTreeNodeByKey(node.children, targetKey);
    if (nextChildren === node.children) {
      nextNodes.push(node);
      return;
    }

    changed = true;
    nextNodes.push({
      ...node,
      children: nextChildren,
    });
  });

  return changed ? nextNodes : nodes;
}

export function mapToTreeNode(
  item: NodeRespDTO,
  parentNode?: Pick<Node, 'builtInType' | 'archiveMode'>,
): Node {
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
