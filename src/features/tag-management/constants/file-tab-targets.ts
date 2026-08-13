export interface FileTabTarget {
  key: string;
  label: string;
  description: string;
}

export const FILE_TAB_TARGETS: FileTabTarget[] = [
  { key: 'IMG', label: '图片', description: '图片查看标签（IMG）' },
  { key: 'MP3', label: '音频', description: '音频标签（MP3）' },
  { key: 'MP4', label: '视频', description: '视频标签（MP4）' },
  { key: 'PDF', label: '文档', description: 'PDF 查看标签（PDF）' },
  { key: 'COMIC', label: '漫画', description: '漫画查看器标签（COMIC）' },
  { key: 'GALLERY', label: '图集', description: '图集查看器标签（GALLERY）' },
  { key: 'GALLERY-ARC', label: '图集归档', description: '图集归档标签（GALLERY-ARC）' },
  { key: 'COMIC-ARC', label: '漫画归档', description: '漫画归档标签（COMIC-ARC）' },
  { key: 'ASMR', label: 'ASMR', description: 'ASMR 查看器标签（ASMR）' },
  { key: 'ASMR-ARC', label: 'ASMR 归档', description: 'ASMR 归档标签（ASMR-ARC）' },
  { key: 'AUDIO', label: '音频', description: '音频查看器标签（AUDIO）' },
  { key: 'AUDIO-ARC', label: '音频归档', description: '音频归档标签（AUDIO-ARC）' },
  { key: 'FILE', label: '通用文件', description: '默认文件标签（FILE）' },
];

const FILE_TAB_TARGET_ALIAS_MAP: Record<string, string> = {
  IMAGE: 'IMG',
  JPG: 'IMG',
  JPEG: 'IMG',
  PNG: 'IMG',
  GIF: 'IMG',
  WEBP: 'IMG',
  ASMR_ARC: 'ASMR-ARC',
  ASMR_ARCHIVE: 'ASMR-ARC',
  COMIC_ARC: 'COMIC-ARC',
  COMIC_ARCHIVE: 'COMIC-ARC',
  'GALLERY-A': 'GALLERY-ARC',
  'GALLERY-ARCHIVE': 'GALLERY-ARC',
  GALLERY_ARC: 'GALLERY-ARC',
  GALLERY_ARCHIVE: 'GALLERY-ARC',
  AUDIO_ARC: 'AUDIO-ARC',
  AUDIO_ARCHIVE: 'AUDIO-ARC',
};

export function normalizeFileTabTargetKey(input: string | null | undefined): string {
  const normalized = String(input || '').trim().toUpperCase();
  if (!normalized) {
    return 'FILE';
  }
  return FILE_TAB_TARGET_ALIAS_MAP[normalized] || normalized;
}
