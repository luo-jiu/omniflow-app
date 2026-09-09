export function resolveTreeRefreshTargetId(node: { id?: unknown; type?: unknown } | null, rootNodeId: number | null): number | null {
  if (node && node.type !== 'dir') return null;
  const id = node ? Number(node.id) : Number(rootNodeId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
