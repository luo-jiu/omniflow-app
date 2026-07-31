import type { FileViewerFileType } from '@/shared/file-viewer-types';

export interface ViewerSessionPolicy {
  defaultHotCost: 'light' | 'medium' | 'heavy';
  warm: 'none' | 'memory';
  cold: 'none' | 'device' | 'remote' | 'device-and-remote';
  closeBehavior: 'discard' | 'retain-reading-position';
  hasDraft: boolean;
}

export const viewerSessionPolicies = {
  image: {
    defaultHotCost: 'medium',
    warm: 'none',
    cold: 'none',
    closeBehavior: 'discard',
    hasDraft: false,
  },
  video: {
    defaultHotCost: 'heavy',
    warm: 'memory',
    cold: 'remote',
    closeBehavior: 'retain-reading-position',
    hasDraft: false,
  },
  audio: {
    defaultHotCost: 'medium',
    warm: 'none',
    cold: 'none',
    closeBehavior: 'discard',
    hasDraft: false,
  },
  pdf: {
    defaultHotCost: 'heavy',
    warm: 'memory',
    cold: 'none',
    closeBehavior: 'retain-reading-position',
    hasDraft: false,
  },
  text: {
    defaultHotCost: 'medium',
    warm: 'none',
    cold: 'none',
    closeBehavior: 'discard',
    hasDraft: true,
  },
  comic: {
    defaultHotCost: 'heavy',
    warm: 'memory',
    cold: 'remote',
    closeBehavior: 'retain-reading-position',
    hasDraft: false,
  },
  gallery: {
    defaultHotCost: 'heavy',
    warm: 'memory',
    cold: 'none',
    closeBehavior: 'discard',
    hasDraft: false,
  },
  asmr: {
    defaultHotCost: 'medium',
    warm: 'memory',
    cold: 'none',
    closeBehavior: 'retain-reading-position',
    hasDraft: false,
  },
  asmr_archive: {
    defaultHotCost: 'heavy',
    warm: 'memory',
    cold: 'remote',
    closeBehavior: 'retain-reading-position',
    hasDraft: false,
  },
  comic_archive: {
    defaultHotCost: 'heavy',
    warm: 'memory',
    cold: 'remote',
    closeBehavior: 'retain-reading-position',
    hasDraft: false,
  },
  video_archive: {
    defaultHotCost: 'heavy',
    warm: 'memory',
    cold: 'none',
    closeBehavior: 'retain-reading-position',
    hasDraft: false,
  },
  audio_archive: {
    defaultHotCost: 'heavy',
    warm: 'memory',
    cold: 'none',
    closeBehavior: 'retain-reading-position',
    hasDraft: false,
  },
  gallery_archive: {
    defaultHotCost: 'heavy',
    warm: 'none',
    cold: 'none',
    closeBehavior: 'discard',
    hasDraft: false,
  },
  other: {
    defaultHotCost: 'light',
    warm: 'none',
    cold: 'none',
    closeBehavior: 'discard',
    hasDraft: false,
  },
} as const satisfies Record<FileViewerFileType, ViewerSessionPolicy>;
