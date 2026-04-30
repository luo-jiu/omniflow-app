export type PreviewFileType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif']);
const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'avi',
  'ts',
  'flv',
  'hlv',
  'f4v',
  'mpeg',
  'mpg',
  'wmv',
  'asf',
  'movie',
  'divx',
  'mpeg4',
  'vid',
  'ogv',
  '3gp',
]);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'oga', 'opus']);
const PDF_EXTENSIONS = new Set(['pdf']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'json5', 'jsonc',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
  'html', 'htm', 'xml', 'svg', 'css', 'scss', 'less',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'ps1',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'env', 'gitignore', 'dockerignore', 'editorconfig',
  'log', 'csv', 'tsv', 'sql',
  'srt', 'vtt', 'ass', 'ssa', 'lrc',
]);

export function normalizeFileExtension(ext?: string): string {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

export function resolvePreviewFileType(
  mimeType?: string,
  ext?: string,
): PreviewFileType {
  if (mimeType) {
    const normalizedMimeType = String(mimeType).toLowerCase();
    if (normalizedMimeType.startsWith('image/')) return 'image';
    if (normalizedMimeType.startsWith('video/')) return 'video';
    if (normalizedMimeType.startsWith('audio/')) return 'audio';
    if (normalizedMimeType === 'application/pdf' || normalizedMimeType.endsWith('/pdf')) return 'pdf';
    if (normalizedMimeType.startsWith('text/')) return 'text';
    if (normalizedMimeType === 'application/json' || normalizedMimeType === 'application/xml' || normalizedMimeType === 'application/javascript') return 'text';
  }

  const normalizedExt = normalizeFileExtension(ext);
  if (IMAGE_EXTENSIONS.has(normalizedExt)) return 'image';
  if (VIDEO_EXTENSIONS.has(normalizedExt)) return 'video';
  if (AUDIO_EXTENSIONS.has(normalizedExt)) return 'audio';
  if (PDF_EXTENSIONS.has(normalizedExt)) return 'pdf';
  if (TEXT_EXTENSIONS.has(normalizedExt)) return 'text';
  return 'other';
}
