export function buildAsmrOwnerKey(libraryId: number, nodeId: number): string {
  return `asmr::lib:${libraryId}::node:${nodeId}`;
}

export function parseAsmrRouteInfo(fileUrl: string): { libraryId: number; nodeId: number } | null {
  const matches = /^asmr:\/\/library\/(\d+)\/node\/(\d+)$/i.exec(String(fileUrl || '').trim());
  if (!matches) {
    return null;
  }

  const libraryId = Number(matches[1]);
  const nodeId = Number(matches[2]);
  if (!Number.isFinite(libraryId) || !Number.isFinite(nodeId)) {
    return null;
  }

  return { libraryId, nodeId };
}

export function resolveAsmrOwnerKey(fileUrl: string, preferredNodeId?: number | null): string | null {
  const routeInfo = parseAsmrRouteInfo(fileUrl);
  if (!routeInfo) {
    return null;
  }

  const nodeIdFromInput = Number(preferredNodeId);
  const nodeId = Number.isFinite(nodeIdFromInput) ? nodeIdFromInput : routeInfo.nodeId;
  return buildAsmrOwnerKey(routeInfo.libraryId, nodeId);
}

