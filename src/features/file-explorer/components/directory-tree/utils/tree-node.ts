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
