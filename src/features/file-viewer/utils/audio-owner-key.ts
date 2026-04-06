export function resolveAudioOwnerKey(url: string, nodeId: number | null): string {
  if (nodeId !== null && nodeId !== undefined && Number.isFinite(nodeId)) {
    return `audio:node:${nodeId}`;
  }
  return `audio:url:${String(url || '').trim()}`;
}

