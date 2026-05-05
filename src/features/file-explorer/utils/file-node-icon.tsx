import React from 'react';
import { resolvePreviewFileType } from '@/utils/preview-file-type';

// 与 directory-tree/style.ts 的 .tree-file-type-icon { width: 15px; height: 15px } 保持一致。
const TREE_ICON_SIZE = 15;
const TREE_ICON_SUBTITLE_BADGE_SIZE = 9;

const materialIconUrls = import.meta.glob('../../../assets/icons/material/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

function getMaterialIconUrl(iconName: string): string | undefined {
  return materialIconUrls[`../../../assets/icons/material/${iconName}.svg`];
}

function createIconNode(src: string, alt: string): React.ReactNode {
  const normalizedAltClass = String(alt || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
  return React.createElement('img', {
    src,
    alt,
    className: `tree-file-type-icon tree-file-type-icon-${normalizedAltClass}`,
    width: TREE_ICON_SIZE,
    height: TREE_ICON_SIZE,
    draggable: false,
  });
}

function createAudioWithSubtitleIconNode(): React.ReactNode {
  const audioIcon = getMaterialIconUrl('audio') || getMaterialIconUrl('file-blank') || '';
  const subtitleIcon = getMaterialIconUrl('subtitles') || getMaterialIconUrl('file-blank') || '';
  return React.createElement(
    'span',
    {
      className: 'tree-file-type-icon tree-file-type-icon-audio-subtitles',
      title: '带字幕的音频',
      style: {
        position: 'relative',
        display: 'inline-flex',
        width: TREE_ICON_SIZE,
        height: TREE_ICON_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    React.createElement('img', {
      src: audioIcon,
      alt: 'audio',
      width: TREE_ICON_SIZE,
      height: TREE_ICON_SIZE,
      draggable: false,
      style: { display: 'block', width: TREE_ICON_SIZE, height: TREE_ICON_SIZE, objectFit: 'contain' },
    }),
    React.createElement('img', {
      src: subtitleIcon,
      alt: 'subtitles',
      width: TREE_ICON_SUBTITLE_BADGE_SIZE,
      height: TREE_ICON_SUBTITLE_BADGE_SIZE,
      draggable: false,
      style: {
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: TREE_ICON_SUBTITLE_BADGE_SIZE,
        height: TREE_ICON_SUBTITLE_BADGE_SIZE,
        objectFit: 'contain',
        filter: 'drop-shadow(0 0 1px rgba(255, 255, 255, 0.9))',
      },
    }),
  );
}

function normalizeExt(ext?: string): string {
  return (ext || '').toLowerCase().replace('.', '');
}

function normalizeFileName(fileName?: string): string {
  return String(fileName || '').trim().toLowerCase();
}

function buildNormalizedFullName(fileName?: string, ext?: string): string {
  const normalizedName = normalizeFileName(fileName);
  const normalizedExt = normalizeExt(ext);
  if (!normalizedName || !normalizedExt || normalizedName.endsWith(`.${normalizedExt}`)) {
    return normalizedName;
  }
  return `${normalizedName}.${normalizedExt}`;
}

export function isImageExtension(ext?: string): boolean {
  const normalized = normalizeExt(ext);
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif'];
  return imageExtensions.includes(normalized);
}

export function isAudioExtension(ext?: string): boolean {
  const normalized = normalizeExt(ext);
  const audioExtensions = ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'oga', 'opus'];
  return audioExtensions.includes(normalized);
}

function isVideoExtension(ext?: string): boolean {
  return resolvePreviewFileType(undefined, ext) === 'video';
}

export function isSubtitleExtension(ext?: string): boolean {
  const normalized = normalizeExt(ext);
  const subtitleExtensions = ['lrc', 'srt', 'vtt', 'ass', 'ssa'];
  return subtitleExtensions.includes(normalized);
}

const FILE_ICON_BY_NAME: Record<string, string> = {
  '.babelrc': 'babel',
  '.dockerignore': 'docker',
  '.editorconfig': 'editorconfig',
  '.env': 'settings',
  '.env.development': 'settings',
  '.env.local': 'settings',
  '.env.production': 'settings',
  '.env.test': 'settings',
  '.eslintignore': 'eslint',
  '.eslintrc': 'eslint',
  '.eslintrc.cjs': 'eslint',
  '.eslintrc.js': 'eslint',
  '.eslintrc.json': 'eslint',
  '.eslintrc.yaml': 'eslint',
  '.eslintrc.yml': 'eslint',
  '.gitattributes': 'git',
  '.gitignore': 'git',
  '.gitmodules': 'git',
  '.npmrc': 'npm',
  '.prettierrc': 'prettier',
  '.prettierrc.cjs': 'prettier',
  '.prettierrc.js': 'prettier',
  '.prettierrc.json': 'prettier',
  '.prettierrc.yaml': 'prettier',
  '.prettierrc.yml': 'prettier',
  'babel.config.cjs': 'babel',
  'babel.config.js': 'babel',
  'babel.config.json': 'babel',
  'bun.lockb': 'bun',
  'compose.yaml': 'docker',
  'compose.yml': 'docker',
  'deno.json': 'deno',
  'deno.lock': 'deno',
  'docker-compose.yaml': 'docker',
  'docker-compose.yml': 'docker',
  'dockerfile': 'docker',
  'eslint.config.js': 'eslint',
  'eslint.config.mjs': 'eslint',
  'eslint.config.ts': 'eslint',
  'go.mod': 'go',
  'go.sum': 'go',
  'jsconfig.json': 'jsconfig',
  'license': 'license',
  'makefile': 'makefile',
  'nginx.conf': 'nginx',
  'package-lock.json': 'npm',
  'package.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'pom.xml': 'maven',
  'postcss.config.cjs': 'postcss',
  'postcss.config.js': 'postcss',
  'postcss.config.mjs': 'postcss',
  'postcss.config.ts': 'postcss',
  'prettier.config.cjs': 'prettier',
  'prettier.config.js': 'prettier',
  'prettier.config.mjs': 'prettier',
  'prettier.config.ts': 'prettier',
  'readme': 'readme',
  'readme.md': 'readme',
  'schema.prisma': 'prisma',
  'stylelint.config.cjs': 'stylelint',
  'stylelint.config.js': 'stylelint',
  'stylelint.config.mjs': 'stylelint',
  'stylelint.config.ts': 'stylelint',
  'tsconfig.json': 'tsconfig',
  'vite.config.js': 'vite',
  'vite.config.mjs': 'vite',
  'vite.config.ts': 'vite',
  'webpack.config.cjs': 'webpack',
  'webpack.config.js': 'webpack',
  'webpack.config.ts': 'webpack',
  'yarn.lock': 'yarn',
};

const FILE_ICON_BY_EXTENSION: Record<string, string> = {
  '7z': 'zip',
  ass: 'subtitles',
  astro: 'astro',
  avif: 'image',
  bash: 'command',
  bat: 'command',
  bmp: 'image',
  bz2: 'zip',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  conf: 'settings',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'table',
  cts: 'typescript',
  cxx: 'cpp',
  dart: 'dart',
  doc: 'word',
  docx: 'word',
  env: 'settings',
  fish: 'command',
  flac: 'audio',
  gif: 'image',
  go: 'go',
  gz: 'zip',
  h: 'h',
  htm: 'html',
  html: 'html',
  hpp: 'hpp',
  hs: 'document',
  ini: 'settings',
  java: 'java',
  jpeg: 'image',
  jpg: 'image',
  js: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jsx: 'react',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  log: 'log',
  lrc: 'subtitles',
  lua: 'lua',
  m4a: 'audio',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'mdx',
  mkd: 'markdown',
  mjs: 'javascript',
  mp3: 'audio',
  mts: 'typescript',
  oga: 'audio',
  ogg: 'audio',
  opus: 'audio',
  otf: 'font',
  pdf: 'pdf',
  php: 'php',
  plist: 'settings',
  png: 'image',
  potx: 'powerpoint',
  pps: 'powerpoint',
  ppsx: 'powerpoint',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  prisma: 'prisma',
  properties: 'settings',
  proto: 'proto',
  ps1: 'powershell',
  psm1: 'powershell',
  py: 'python',
  rar: 'zip',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scss: 'sass',
  sh: 'command',
  sql: 'database',
  srt: 'subtitles',
  ssa: 'subtitles',
  svg: 'svg',
  swift: 'swift',
  tar: 'zip',
  tf: 'terraform',
  tfvars: 'terraform',
  toml: 'toml',
  ts: 'typescript',
  tsv: 'table',
  tsx: 'react_ts',
  ttf: 'font',
  txt: 'document',
  vtt: 'subtitles',
  vue: 'vue',
  wav: 'audio-wav',
  webp: 'image',
  woff: 'font',
  woff2: 'font',
  xhtml: 'html',
  xls: 'table',
  xlsx: 'table',
  xml: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xz: 'zip',
  yaml: 'yaml',
  yml: 'yaml',
  zip: 'zip',
  zsh: 'command',
};

function resolveFileIconName(ext?: string, fileName?: string): string | undefined {
  const fullName = buildNormalizedFullName(fileName, ext);
  if (fullName && FILE_ICON_BY_NAME[fullName]) {
    return FILE_ICON_BY_NAME[fullName];
  }

  const normalizedExt = normalizeExt(ext);
  return FILE_ICON_BY_EXTENSION[normalizedExt];
}

function createWarningIconNode(title: string): React.ReactNode {
  return React.createElement(
    'span',
    {
      className: 'tree-built-in-type-icon tree-built-in-type-icon-unknown',
      title,
    },
    '⚠',
  );
}

export function getFileNodeIcon(ext?: string, fileName?: string): React.ReactNode {
  const blankFileIcon = getMaterialIconUrl('file-blank') || '';
  const normalized = normalizeExt(ext);
  const mappedIconName = resolveFileIconName(normalized, fileName);
  const mappedIconUrl = mappedIconName ? getMaterialIconUrl(mappedIconName) : undefined;
  if (mappedIconUrl) {
    return createIconNode(mappedIconUrl, mappedIconName || normalized);
  }

  if (!ext) {
    return createIconNode(blankFileIcon, 'file');
  }

  if (isImageExtension(normalized)) {
    return createIconNode(getMaterialIconUrl('image') || blankFileIcon, 'image');
  }

  if (normalized === 'mp3') {
    return createIconNode(getMaterialIconUrl('audio') || blankFileIcon, 'audio');
  }

  if (normalized === 'wav') {
    return createIconNode(getMaterialIconUrl('audio-wav') || blankFileIcon, 'audio-wav');
  }

  if (isVideoExtension(normalized)) {
    return createIconNode(getMaterialIconUrl('video') || blankFileIcon, 'video');
  }

  if (normalized === 'pdf') {
    return createIconNode(getMaterialIconUrl('pdf') || blankFileIcon, 'pdf');
  }

  return createIconNode(blankFileIcon, 'file');
}

export function getFileNodeIconByParentBuiltInType(
  ext?: string,
  parentBuiltInType?: string,
  parentArchiveMode?: number,
  fileName?: string,
  options?: {
    hasAudioSubtitle?: boolean;
    audioArchiveSubtitle?: boolean;
  },
): React.ReactNode {
  const normalizedBuiltInType = String(parentBuiltInType || 'DEF').toUpperCase();
  const normalizedArchiveMode = Number(parentArchiveMode ?? 0) === 1 ? 1 : 0;
  if (normalizedBuiltInType === 'COMIC') {
    if (isImageExtension(ext)) {
      return getFileNodeIcon(ext, fileName);
    }
    return createWarningIconNode('与漫画模式不匹配的文件');
  }
  if (normalizedBuiltInType === 'ASMR' && normalizedArchiveMode === 1) {
    if (isAudioExtension(ext)) {
      return getFileNodeIcon(ext, fileName);
    }
    return createWarningIconNode('与 ASMR 归档模式不匹配的文件');
  }
  if (normalizedBuiltInType === 'VIDEO') {
    if (isVideoExtension(ext) || isImageExtension(ext) || isSubtitleExtension(ext)) {
      return getFileNodeIcon(ext, fileName);
    }
    return createWarningIconNode(
      normalizedArchiveMode === 1
        ? '与视频归档模式不匹配的文件'
        : '与视频模式不匹配的文件',
    );
  }
  if (normalizedBuiltInType === 'AUDIO' && normalizedArchiveMode === 1) {
    if (options?.audioArchiveSubtitle || isSubtitleExtension(ext)) {
      const subtitleIcon = getMaterialIconUrl('subtitles') || getMaterialIconUrl('file-blank') || '';
      return createIconNode(subtitleIcon, 'subtitles');
    }
    if (isAudioExtension(ext)) {
      if (options?.hasAudioSubtitle) {
        return createAudioWithSubtitleIconNode();
      }
      return getFileNodeIcon(ext, fileName);
    }
    return createWarningIconNode('与音频归档模式不匹配的文件');
  }
  return getFileNodeIcon(ext, fileName);
}

export function getDirectoryBuiltInIcon(
  builtInType?: string,
  archiveMode?: number,
  expanded?: boolean,
): React.ReactNode | undefined {
  const normalized = String(builtInType || 'DEF').toUpperCase();
  const normalizedArchiveMode = Number(archiveMode ?? 0) === 1 ? 1 : 0;
  if (normalizedArchiveMode === 1 && normalized === 'DEF') {
    return undefined;
  }
  if (normalized === 'DEF') {
    return createIconNode(
      getMaterialIconUrl(expanded ? 'folder-base-open' : 'folder-base') || '',
      'default-folder',
    );
  }
  if (normalized === 'COMIC') {
    const iconName = normalizedArchiveMode === 1
      ? (expanded ? 'folder-comic-archive-open' : 'folder-comic-archive')
      : (expanded ? 'folder-comic-open' : 'folder-comic');
    return createIconNode(getMaterialIconUrl(iconName) || getMaterialIconUrl('folder-comic') || '', 'comic-folder');
  }
  if (normalized === 'ASMR') {
    const iconName = normalizedArchiveMode === 1
      ? (expanded ? 'folder-asmr-archive-open' : 'folder-asmr-archive')
      : (expanded ? 'folder-asmr-open' : 'folder-asmr');
    return createIconNode(getMaterialIconUrl(iconName) || getMaterialIconUrl('folder-asmr') || '', 'asmr-folder');
  }
  if (normalized === 'VIDEO') {
    const iconName = normalizedArchiveMode === 1
      ? (expanded ? 'folder-video-archive-open' : 'folder-video-archive')
      : (expanded ? 'folder-video-open' : 'folder-video');
    return createIconNode(getMaterialIconUrl(iconName) || getMaterialIconUrl('video') || '', 'video-folder');
  }
  if (normalized === 'AUDIO') {
    const iconName = normalizedArchiveMode === 1
      ? (expanded ? 'folder-audio-archive-open' : 'folder-audio-archive')
      : (expanded ? 'folder-audio-open' : 'folder-audio');
    return createIconNode(
      getMaterialIconUrl(iconName) || getMaterialIconUrl('audio') || '',
      'audio-folder',
    );
  }
  return createWarningIconNode(`未知内置类型: ${normalized}`);
}
