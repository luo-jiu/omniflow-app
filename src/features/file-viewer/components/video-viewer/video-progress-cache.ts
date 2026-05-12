import { isDisposingAnyWorkspace } from '@/features/workspace-resource-release/dispose-markers';

export interface VideoPlaybackProgress {
  currentTime: number;
  duration: number;
  updatedAt: string;
}

const VIDEO_PROGRESS_CACHE_MAX_ENTRIES = 48;

export const videoProgressCache = new Map<string, VideoPlaybackProgress>();

export function resolveVideoProgressCacheKey(url: string, nodeId?: number | null): string {
  if (nodeId !== null && nodeId !== undefined && Number.isFinite(nodeId)) {
    return `node:${nodeId}`;
  }
  return `url:${String(url || '').trim()}`;
}

export function setVideoProgressSnapshot(cacheKey: string, progress: VideoPlaybackProgress) {
  if (isDisposingAnyWorkspace()) {
    return;
  }
  if (videoProgressCache.has(cacheKey)) {
    videoProgressCache.delete(cacheKey);
  }
  videoProgressCache.set(cacheKey, progress);
  if (videoProgressCache.size > VIDEO_PROGRESS_CACHE_MAX_ENTRIES) {
    const oldestKey = videoProgressCache.keys().next().value;
    if (oldestKey) {
      videoProgressCache.delete(oldestKey);
    }
  }
}

export function clearVideoProgressSnapshotForFile(url: string, nodeId?: number | null) {
  videoProgressCache.delete(resolveVideoProgressCacheKey(url, nodeId));
}

export function clearAllVideoProgressSnapshots() {
  videoProgressCache.clear();
}
