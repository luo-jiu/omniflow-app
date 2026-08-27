import type {
  EmbeddedBrowserResourceStateSnapshot,
} from '../types';

function normalizeIdentifier(value: unknown) {
  return String(value ?? '').trim();
}

export function resolveCapturedHlsManifestResourceId(
  snapshot: EmbeddedBrowserResourceStateSnapshot | null,
  tabId: string,
  manifestUrl: string,
) {
  const normalizedTabId = normalizeIdentifier(tabId);
  const normalizedManifestUrl = normalizeIdentifier(manifestUrl);
  if (
    snapshot?.status !== 'active'
    || snapshot.tabId !== normalizedTabId
    || !normalizedTabId
    || !normalizedManifestUrl
  ) {
    return null;
  }
  return snapshot.resources.find((resource) => (
    resource.tabId === normalizedTabId
    && resource.url === normalizedManifestUrl
  ))?.id || null;
}

export function resolveCapturedHlsTrackResourceIds(
  snapshot: EmbeddedBrowserResourceStateSnapshot | null,
  input: {
    audioManifestUrl: string;
    tabId: string;
    videoManifestUrl: string;
  },
) {
  const videoResourceId = resolveCapturedHlsManifestResourceId(
    snapshot,
    input.tabId,
    input.videoManifestUrl,
  );
  const audioResourceId = resolveCapturedHlsManifestResourceId(
    snapshot,
    input.tabId,
    input.audioManifestUrl,
  );
  return videoResourceId && audioResourceId
    ? { audioResourceId, videoResourceId }
    : null;
}
