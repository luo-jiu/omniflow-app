export function deriveAudioTrackName(src: string | null, fallbackTrackName?: string | null): string {
  if (fallbackTrackName && fallbackTrackName.trim()) {
    return fallbackTrackName;
  }

  if (!src) return '音频播放中';

  try {
    const noQuery = src.split('?')[0];
    const name = decodeURIComponent(noQuery.substring(noQuery.lastIndexOf('/') + 1));
    return name || '音频播放中';
  } catch {
    return '音频播放中';
  }
}
