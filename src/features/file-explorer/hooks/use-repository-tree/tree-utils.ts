import { buildTreeNodeLabel } from '@/utils/fileTreeSettings';
import { resolvePreviewFileType, type PreviewFileType } from '@/utils/preview-file-type';
import {
  getDirectoryBuiltInIcon,
  getFileNodeIconByParentBuiltInType,
  isAudioExtension,
  isSubtitleExtension,
} from '../../utils/file-node-icon';
import type { Node, NodeRespDTO } from './types';

export function normalizeArchiveMode(mode?: number): 0 | 1 {
  return Number(mode ?? 0) === 1 ? 1 : 0;
}

export function resolveFileType(
  mimeType?: string,
  ext?: string,
  fileName?: string,
): PreviewFileType {
  return resolvePreviewFileType(mimeType, ext, fileName);
}

export function isImageFileNode(item: Pick<NodeRespDTO, 'mimeType' | 'ext'>): boolean {
  return resolveFileType(item.mimeType, item.ext) === 'image';
}

export function isVideoFileNode(item: Pick<NodeRespDTO, 'mimeType' | 'ext'>): boolean {
  return resolveFileType(item.mimeType, item.ext) === 'video';
}

export function isAudioFileNode(item: Pick<NodeRespDTO, 'mimeType' | 'ext'>): boolean {
  return resolveFileType(item.mimeType, item.ext) === 'audio' || isAudioExtension(item.ext);
}

export function isSubtitleFileNode(item: Pick<NodeRespDTO, 'type' | 'ext'>): boolean {
  return item.type === 'file' && isSubtitleExtension(item.ext);
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

function normalizeSubtitleMatchName(name?: string): string {
  return String(name || '').trim().toLowerCase();
}

export interface AudioArchiveSubtitleVisibility {
  showAllSubtitles?: boolean;
  expandedAudioNodeIds?: Set<number>;
}

interface TreeNodeMapOptions {
  audioArchiveHasSubtitle?: boolean;
  audioArchiveSubtitle?: boolean;
  audioArchiveSubtitleOwnerId?: number;
}

export function mapAudioArchiveChildrenForDisplay(
  children: NodeRespDTO[],
  parentNode?: Pick<Node, 'builtInType' | 'archiveMode'>,
  visibility?: AudioArchiveSubtitleVisibility,
): Array<{ item: NodeRespDTO; options?: TreeNodeMapOptions }> {
  const parentBuiltInType = String(parentNode?.builtInType || 'DEF').toUpperCase();
  const parentArchiveMode = normalizeArchiveMode(parentNode?.archiveMode);
  if (parentBuiltInType !== 'AUDIO' || parentArchiveMode !== 1) {
    return children.map(item => ({ item }));
  }

  const audioByName = new Map<string, NodeRespDTO[]>();
  const subtitlesByName = new Map<string, NodeRespDTO[]>();

  children.forEach((item) => {
    if (item.type !== 'file') {
      return;
    }
    const matchName = normalizeSubtitleMatchName(item.name);
    if (!matchName) {
      return;
    }
    if (isAudioFileNode(item)) {
      const bucket = audioByName.get(matchName) || [];
      bucket.push(item);
      audioByName.set(matchName, bucket);
      return;
    }
    if (isSubtitleFileNode(item)) {
      const bucket = subtitlesByName.get(matchName) || [];
      bucket.push(item);
      subtitlesByName.set(matchName, bucket);
    }
  });

  const consumedSubtitleIds = new Set<number>();
  const expandedAudioNodeIds = visibility?.expandedAudioNodeIds ?? new Set<number>();
  const result: Array<{ item: NodeRespDTO; options?: TreeNodeMapOptions }> = [];

  children.forEach((item) => {
    if (consumedSubtitleIds.has(item.id)) {
      return;
    }

    if (item.type === 'file' && isSubtitleFileNode(item)) {
      const matchName = normalizeSubtitleMatchName(item.name);
      if (audioByName.has(matchName)) {
        return;
      }
      result.push({ item, options: { audioArchiveSubtitle: true } });
      return;
    }

    if (item.type !== 'file' || !isAudioFileNode(item)) {
      result.push({ item });
      return;
    }

    const matchName = normalizeSubtitleMatchName(item.name);
    const subtitles = subtitlesByName.get(matchName) || [];
    const hasSubtitle = subtitles.length > 0;
    result.push({ item, options: { audioArchiveHasSubtitle: hasSubtitle } });

    if (!hasSubtitle) {
      return;
    }
    const shouldShowSubtitles = visibility?.showAllSubtitles || expandedAudioNodeIds.has(item.id);
    if (!shouldShowSubtitles) {
      return;
    }

    subtitles.forEach((subtitle) => {
      consumedSubtitleIds.add(subtitle.id);
      result.push({
        item: subtitle,
        options: {
          audioArchiveSubtitle: true,
          audioArchiveSubtitleOwnerId: item.id,
        },
      });
    });
  });

  return result;
}

export function mapChildrenToTreeNodes(
  children: NodeRespDTO[],
  parentNode?: Node,
  visibility?: AudioArchiveSubtitleVisibility,
): Node[] {
  return mapAudioArchiveChildrenForDisplay(children, parentNode, visibility)
    .map(({ item, options }) => mapToTreeNode(item, parentNode, options));
}

export function mapToTreeNode(
  item: NodeRespDTO,
  parentNode?: Pick<Node, 'builtInType' | 'archiveMode'>,
  options?: TreeNodeMapOptions,
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
      audioArchiveAudio: parentBuiltInType === 'AUDIO' && parentArchiveMode === 1 && item.type === 'file' && isAudioFileNode(item),
      audioArchiveHasSubtitle: options?.audioArchiveHasSubtitle === true,
      audioArchiveSubtitle: options?.audioArchiveSubtitle === true,
      audioArchiveSubtitleOwnerId: options?.audioArchiveSubtitleOwnerId,
    },
    icon: item.type === 'file'
      ? getFileNodeIconByParentBuiltInType(item.ext, parentBuiltInType, parentArchiveMode, item.name, {
        hasAudioSubtitle: options?.audioArchiveHasSubtitle,
        audioArchiveSubtitle: options?.audioArchiveSubtitle,
      })
      : getDirectoryBuiltInIcon(nodeBuiltInType, nodeArchiveMode),
    children: item.type === 'dir' ? [] : undefined,
    loaded: false,
    builtInType: nodeBuiltInType,
    archiveMode: nodeArchiveMode,
  };
}
