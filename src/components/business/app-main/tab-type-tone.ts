import type { FileViewerTab } from '@/contexts/file-viewer.context';
import { normalizeFileTabTargetKey } from '@/features/tag-management/constants/file-tab-targets';

export interface TabTypeTone {
  background: string;
  text: string;
  border: string;
}

export interface FileTabToneConfig {
  targetKey?: string | null;
  color?: string | null;
  textColor?: string | null;
  enabled?: number | boolean | null;
}

const DEFAULT_TONE: TabTypeTone = {
  background: 'color-mix(in srgb, var(--semi-color-info-light-default) 80%, transparent)',
  text: 'var(--semi-color-info)',
  border: 'color-mix(in srgb, var(--semi-color-info) 40%, transparent)',
};

const LABEL_TONE_MAP: Record<string, TabTypeTone> = {
  IMG: {
    background: 'color-mix(in srgb, var(--semi-color-tertiary-light-default) 84%, transparent)',
    text: 'var(--semi-color-tertiary)',
    border: 'color-mix(in srgb, var(--semi-color-tertiary) 38%, transparent)',
  },
  MP3: {
    background: 'color-mix(in srgb, var(--semi-color-warning-light-default) 84%, transparent)',
    text: 'var(--semi-color-warning)',
    border: 'color-mix(in srgb, var(--semi-color-warning) 42%, transparent)',
  },
  MP4: {
    background: 'color-mix(in srgb, var(--semi-color-info-light-default) 82%, transparent)',
    text: 'var(--semi-color-info)',
    border: 'color-mix(in srgb, var(--semi-color-info) 42%, transparent)',
  },
  PDF: {
    background: 'color-mix(in srgb, var(--semi-color-danger-light-default) 82%, transparent)',
    text: 'var(--semi-color-danger)',
    border: 'color-mix(in srgb, var(--semi-color-danger) 42%, transparent)',
  },
  COMIC: {
    background: 'color-mix(in srgb, var(--semi-color-success-light-default) 84%, transparent)',
    text: 'var(--semi-color-success)',
    border: 'color-mix(in srgb, var(--semi-color-success) 42%, transparent)',
  },
  ASMR: {
    background: 'color-mix(in srgb, var(--semi-color-primary-light-default) 84%, transparent)',
    text: 'var(--semi-color-primary)',
    border: 'color-mix(in srgb, var(--semi-color-primary) 42%, transparent)',
  },
  'ASMR-ARC': {
    background: 'color-mix(in srgb, var(--semi-color-success-light-default) 78%, var(--semi-color-primary-light-default) 22%)',
    text: 'color-mix(in srgb, var(--semi-color-success) 62%, var(--semi-color-primary) 38%)',
    border: 'color-mix(in srgb, var(--semi-color-success) 36%, var(--semi-color-primary) 32%)',
  },
  'COMIC-ARC': {
    background: 'color-mix(in srgb, var(--semi-color-success-light-default) 82%, var(--semi-color-warning-light-default) 18%)',
    text: 'color-mix(in srgb, var(--semi-color-success) 72%, var(--semi-color-warning) 28%)',
    border: 'color-mix(in srgb, var(--semi-color-success) 40%, var(--semi-color-warning) 24%)',
  },
  IMAGE: {
    background: 'color-mix(in srgb, var(--semi-color-tertiary-light-default) 84%, transparent)',
    text: 'var(--semi-color-tertiary)',
    border: 'color-mix(in srgb, var(--semi-color-tertiary) 38%, transparent)',
  },
  JPG: {
    background: 'color-mix(in srgb, var(--semi-color-tertiary-light-default) 84%, transparent)',
    text: 'var(--semi-color-tertiary)',
    border: 'color-mix(in srgb, var(--semi-color-tertiary) 38%, transparent)',
  },
  JPEG: {
    background: 'color-mix(in srgb, var(--semi-color-tertiary-light-default) 84%, transparent)',
    text: 'var(--semi-color-tertiary)',
    border: 'color-mix(in srgb, var(--semi-color-tertiary) 38%, transparent)',
  },
  PNG: {
    background: 'color-mix(in srgb, var(--semi-color-tertiary-light-default) 84%, transparent)',
    text: 'var(--semi-color-tertiary)',
    border: 'color-mix(in srgb, var(--semi-color-tertiary) 38%, transparent)',
  },
  WEBP: {
    background: 'color-mix(in srgb, var(--semi-color-tertiary-light-default) 84%, transparent)',
    text: 'var(--semi-color-tertiary)',
    border: 'color-mix(in srgb, var(--semi-color-tertiary) 38%, transparent)',
  },
  FILE: {
    background: 'color-mix(in srgb, var(--semi-color-warning-light-default) 80%, transparent)',
    text: 'var(--semi-color-warning)',
    border: 'color-mix(in srgb, var(--semi-color-warning) 40%, transparent)',
  },
};

const FILE_TYPE_TONE_MAP: Partial<Record<NonNullable<FileViewerTab['fileType']>, TabTypeTone>> = {
  image: LABEL_TONE_MAP.IMG,
  audio: LABEL_TONE_MAP.MP3,
  video: LABEL_TONE_MAP.MP4,
  pdf: LABEL_TONE_MAP.PDF,
  comic: LABEL_TONE_MAP.COMIC,
  asmr: LABEL_TONE_MAP.ASMR,
  asmr_archive: LABEL_TONE_MAP['ASMR-ARC'],
  comic_archive: LABEL_TONE_MAP['COMIC-ARC'],
  other: LABEL_TONE_MAP.FILE,
};

const UNKNOWN_LABEL_PALETTE: TabTypeTone[] = [
  {
    background: 'color-mix(in srgb, var(--semi-color-primary-light-default) 80%, transparent)',
    text: 'var(--semi-color-primary)',
    border: 'color-mix(in srgb, var(--semi-color-primary) 38%, transparent)',
  },
  {
    background: 'color-mix(in srgb, var(--semi-color-success-light-default) 80%, transparent)',
    text: 'var(--semi-color-success)',
    border: 'color-mix(in srgb, var(--semi-color-success) 38%, transparent)',
  },
  {
    background: 'color-mix(in srgb, var(--semi-color-warning-light-default) 80%, transparent)',
    text: 'var(--semi-color-warning)',
    border: 'color-mix(in srgb, var(--semi-color-warning) 38%, transparent)',
  },
  {
    background: 'color-mix(in srgb, var(--semi-color-info-light-default) 80%, transparent)',
    text: 'var(--semi-color-info)',
    border: 'color-mix(in srgb, var(--semi-color-info) 38%, transparent)',
  },
  {
    background: 'color-mix(in srgb, var(--semi-color-tertiary-light-default) 80%, transparent)',
    text: 'var(--semi-color-tertiary)',
    border: 'color-mix(in srgb, var(--semi-color-tertiary) 38%, transparent)',
  },
];

function hashLabel(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 33 + label.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function resolveUnknownLabelTone(normalizedLabel: string): TabTypeTone {
  if (!normalizedLabel) {
    return DEFAULT_TONE;
  }
  const index = hashLabel(normalizedLabel) % UNKNOWN_LABEL_PALETTE.length;
  return UNKNOWN_LABEL_PALETTE[index];
}

function isHexColor(input: string | null | undefined): boolean {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(input || '').trim());
}

function buildToneFromConfig(config: FileTabToneConfig | null | undefined): TabTypeTone | null {
  if (!config) {
    return null;
  }
  const enabled = config.enabled === undefined || config.enabled === null
    ? true
    : Boolean(Number(config.enabled));
  if (!enabled) {
    return null;
  }
  const baseColor = String(config.color || '').trim().toUpperCase();
  if (!isHexColor(baseColor)) {
    return null;
  }
  const textColor = String(config.textColor || '').trim().toUpperCase();
  return {
    background: `color-mix(in srgb, ${baseColor} 18%, var(--semi-color-bg-0) 82%)`,
    text: isHexColor(textColor) ? textColor : baseColor,
    border: `color-mix(in srgb, ${baseColor} 46%, var(--semi-color-border) 54%)`,
  };
}

export function resolveTabTargetKey(tab: FileViewerTab, tabTypeLabel: string): string {
  const normalizedLabel = normalizeFileTabTargetKey(tabTypeLabel);
  if (normalizedLabel) {
    return normalizedLabel;
  }
  if (tab.fileType === 'image') return 'IMG';
  if (tab.fileType === 'audio') return 'MP3';
  if (tab.fileType === 'video') return 'MP4';
  if (tab.fileType === 'pdf') return 'PDF';
  if (tab.fileType === 'comic') return 'COMIC';
  if (tab.fileType === 'asmr') return 'ASMR';
  if (tab.fileType === 'asmr_archive') return 'ASMR-ARC';
  if (tab.fileType === 'comic_archive') return 'COMIC-ARC';
  return 'FILE';
}

export function resolveTabTypeTone(
  tab: FileViewerTab,
  tabTypeLabel: string,
  remoteToneByTargetKey?: Record<string, FileTabToneConfig>,
): TabTypeTone {
  const normalizedLabel = String(tabTypeLabel || '').trim().toUpperCase();
  const targetKey = resolveTabTargetKey(tab, normalizedLabel);
  const remoteTone = buildToneFromConfig(remoteToneByTargetKey?.[targetKey]);
  if (remoteTone) {
    return remoteTone;
  }
  if (normalizedLabel && LABEL_TONE_MAP[normalizedLabel]) {
    return LABEL_TONE_MAP[normalizedLabel];
  }
  if (normalizedLabel) {
    return resolveUnknownLabelTone(normalizedLabel);
  }
  if (tab.fileType && FILE_TYPE_TONE_MAP[tab.fileType]) {
    return FILE_TYPE_TONE_MAP[tab.fileType] as TabTypeTone;
  }
  return DEFAULT_TONE;
}
