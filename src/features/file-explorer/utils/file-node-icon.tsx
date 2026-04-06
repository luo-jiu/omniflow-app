import React from 'react';
import imageIcon from '@/assets/icons/material/image.svg';
import audioIcon from '@/assets/icons/material/audio.svg';
import wavAudioIcon from '@/assets/icons/material/audio-wav.svg';
import videoIcon from '@/assets/icons/material/video.svg';
import pdfIcon from '@/assets/icons/material/pdf.svg';
import blankFileIcon from '@/assets/icons/material/file-blank.svg';
import comicFolderIcon from '@/assets/icons/material/folder-comic.svg';
import asmrFolderIcon from '@/assets/icons/material/folder-asmr.svg';

function createIconNode(src: string, alt: string): React.ReactNode {
  return React.createElement('img', {
    src,
    alt,
    className: 'tree-file-type-icon',
  });
}

function normalizeExt(ext?: string): string {
  return (ext || '').toLowerCase().replace('.', '');
}

export function isImageExtension(ext?: string): boolean {
  const normalized = normalizeExt(ext);
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif'];
  return imageExtensions.includes(normalized);
}

function isAudioExtension(ext?: string): boolean {
  const normalized = normalizeExt(ext);
  const audioExtensions = ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'opus'];
  return audioExtensions.includes(normalized);
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

export function getFileNodeIcon(ext?: string): React.ReactNode {
  if (!ext) {
    return createIconNode(blankFileIcon, 'file');
  }

  const normalized = normalizeExt(ext);

  if (isImageExtension(normalized)) {
    return createIconNode(imageIcon, 'image');
  }

  if (normalized === 'mp3') {
    return createIconNode(audioIcon, 'audio');
  }

  if (normalized === 'wav') {
    return createIconNode(wavAudioIcon, 'audio-wav');
  }

  if (normalized === 'mp4') {
    return createIconNode(videoIcon, 'video');
  }

  if (normalized === 'pdf') {
    return createIconNode(pdfIcon, 'pdf');
  }

  return createIconNode(blankFileIcon, 'file');
}

export function getFileNodeIconByParentBuiltInType(
  ext?: string,
  parentBuiltInType?: string,
  parentArchiveMode?: number,
): React.ReactNode {
  const normalizedBuiltInType = String(parentBuiltInType || 'DEF').toUpperCase();
  const normalizedArchiveMode = Number(parentArchiveMode ?? 0) === 1 ? 1 : 0;
  if (normalizedBuiltInType === 'COMIC') {
    if (isImageExtension(ext)) {
      return getFileNodeIcon(ext);
    }
    return createWarningIconNode('与漫画模式不匹配的文件');
  }
  if (normalizedBuiltInType === 'ASMR' && normalizedArchiveMode === 1) {
    if (isAudioExtension(ext)) {
      return getFileNodeIcon(ext);
    }
    return createWarningIconNode('与 ASMR 归档模式不匹配的文件');
  }
  return getFileNodeIcon(ext);
}

export function getDirectoryBuiltInIcon(
  builtInType?: string,
  archiveMode?: number,
): React.ReactNode | undefined {
  const normalized = String(builtInType || 'DEF').toUpperCase();
  const normalizedArchiveMode = Number(archiveMode ?? 0) === 1 ? 1 : 0;
  if (normalizedArchiveMode === 1 && normalized === 'DEF') {
    return undefined;
  }
  if (normalized === 'DEF') {
    return undefined;
  }
  if (normalized === 'COMIC') {
    return createIconNode(comicFolderIcon, 'comic-folder');
  }
  if (normalized === 'ASMR') {
    return createIconNode(asmrFolderIcon, 'asmr-folder');
  }
  return createWarningIconNode(`未知内置类型: ${normalized}`);
}
