import type { FileViewerFileType } from './file-viewer-types';

export const BUILT_IN_VIEWER_KINDS: readonly FileViewerFileType[] = Object.freeze(['image', 'video', 'audio', 'pdf', 'text', 'comic', 'gallery', 'asmr', 'asmr_archive', 'comic_archive', 'video_archive', 'audio_archive', 'gallery_archive', 'other']);
export function builtInViewerId(kind: FileViewerFileType): string { return `omniflow.viewer.${kind.replace(/_/g, '-')}`; }
export function isViewerContributionId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value);
}
export function isBuiltInViewerId(id: string): boolean { return BUILT_IN_VIEWER_KINDS.some(kind => builtInViewerId(kind) === id); }
// undefined means the legacy built-in namespace; null means invalid identity.
export function resourceViewerId(id: unknown, kind: FileViewerFileType): string | undefined | null {
  if (id === undefined || id === builtInViewerId(kind)) return undefined;
  return isViewerContributionId(id) && !isBuiltInViewerId(id) ? id : null;
}
