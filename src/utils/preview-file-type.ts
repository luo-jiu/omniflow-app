export type PreviewFileType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif', 'heic', 'heif', 'heics', 'heifs']);
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
  'txt', 'text', 'md', 'markdown', 'mdx', 'json', 'json5', 'jsonc',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
  'html', 'htm', 'vue', 'svelte', 'xml', 'svg', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl', 'stylus',
  'py', 'pyw', 'rb', 'rake', 'gemspec', 'go', 'rs', 'java', 'kt', 'kts',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'hxx',
  'php', 'phtml', 'swift', 'lua', 'pl', 'pm', 'pod', 'r', 'rmd', 'proto',
  'sh', 'bash', 'zsh', 'fish', 'bats', 'bat', 'ps1', 'psm1', 'psd1',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'properties',
  'env', 'gitignore', 'dockerignore', 'editorconfig',
  'log', 'csv', 'tsv', 'sql', 'pgsql', 'psql', 'mysql', 'sqlite',
  'diff', 'patch', 'dockerfile', 'nginx', 'cmake',
  'srt', 'vtt', 'ass', 'ssa', 'lrc',
]);
const TEXT_FILE_NAMES = new Set([
  'dockerfile',
  'containerfile',
  'gemfile',
  'rakefile',
  'cmakelists.txt',
  'nginx.conf',
  '.bashrc',
  '.zshrc',
  '.profile',
  '.bash_profile',
  '.zprofile',
  '.editorconfig',
  '.gitignore',
  '.dockerignore',
]);

export function normalizeFileExtension(ext?: string): string {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

function normalizeFileName(fileName?: string): string {
  return String(fileName || '')
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .toLowerCase() || '';
}

function resolveExtensionFromName(fileName?: string): string {
  const normalizedName = normalizeFileName(fileName);
  if (!normalizedName) return '';
  if (normalizedName.startsWith('.env')) return 'env';
  if (normalizedName.startsWith('dockerfile.')) return 'dockerfile';
  if (normalizedName.startsWith('.') && !normalizedName.slice(1).includes('.')) {
    return normalizeFileExtension(normalizedName.slice(1));
  }
  return normalizeFileExtension(normalizedName.split('.').pop());
}

function isTextFileName(fileName?: string): boolean {
  const normalizedName = normalizeFileName(fileName);
  if (!normalizedName) return false;
  return TEXT_FILE_NAMES.has(normalizedName)
    || normalizedName.startsWith('.env')
    || normalizedName.startsWith('dockerfile.')
    || TEXT_EXTENSIONS.has(resolveExtensionFromName(normalizedName));
}

export function resolvePreviewFileType(
  mimeType?: string,
  ext?: string,
  fileName?: string,
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
  if (isTextFileName(fileName)) return 'text';
  return 'other';
}
