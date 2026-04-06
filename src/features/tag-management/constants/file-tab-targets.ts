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
  { key: 'COMIC-ARC', label: '漫画归档', description: '漫画归档标签（COMIC-ARC）' },
  { key: 'ASMR', label: 'ASMR', description: 'ASMR 查看器标签（ASMR）' },
  { key: 'ASMR-ARC', label: 'ASMR 归档', description: 'ASMR 归档标签（ASMR-ARC）' },
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
};

export function normalizeFileTabTargetKey(input: string | null | undefined): string {
  const normalized = String(input || '').trim().toUpperCase();
  if (!normalized) {
    return 'FILE';
  }
  return FILE_TAB_TARGET_ALIAS_MAP[normalized] || normalized;
}
