import { buildFileFullName } from '@/utils/fileTreeSettings';

export function findNodeById(nodes: any[], targetId: number): any | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

export function findNodeByKey(nodes: any[], targetKey: string): any | null {
  for (const node of nodes) {
    if (node.key === targetKey) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeByKey(node.children, targetKey);
      if (found) return found;
    }
  }
  return null;
}

export function buildNodeLogicalPath(
  nodes: any[],
  targetNode: any,
  rootNodeId: number | null,
): string {
  const normalizedRootId = Number(rootNodeId);
  const hasRootId = Number.isFinite(normalizedRootId) && normalizedRootId > 0;
  const segments: string[] = [];
  const visited = new Set<number>();
  let currentNode = targetNode;

  while (currentNode) {
    const currentId = Number(currentNode.id);
    if (hasRootId && currentId === normalizedRootId) {
      break;
    }
    if (Number.isFinite(currentId)) {
      if (visited.has(currentId)) {
        break;
      }
      visited.add(currentId);
    }

    const name = resolveNodeBaseName(currentNode);
    if (name) {
      segments.unshift(name);
    }

    const parentId = Number(currentNode.parentId);
    if (
      !Number.isFinite(parentId)
      || parentId <= 0
      || (hasRootId && parentId === normalizedRootId)
    ) {
      break;
    }
    currentNode = findNodeById(nodes, parentId);
  }

  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

export const resolveNodeType = (node: any): 'dir' | 'file' => {
  const type = String(node?.type ?? '');
  return type === 'file' || type === '1' || node?.isLeaf === true ? 'file' : 'dir';
};

export const resolveNodeBaseName = (node: any): string =>
  String(node?.data?.rawName || node?.name || node?.label || '').trim();

export const resolveNodeExt = (node: any): string =>
  String(node?.data?.rawExt ?? node?.ext ?? '').replace(/^\./, '').trim();

export const buildNodeFileName = (node: any): string =>
  resolveNodeType(node) === 'file'
    ? buildFileFullName(resolveNodeBaseName(node), resolveNodeExt(node))
    : resolveNodeBaseName(node);
