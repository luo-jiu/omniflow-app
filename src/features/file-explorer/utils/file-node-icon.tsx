import React from 'react';
import imageIcon from '@/assets/icons/material/image.svg';
import audioIcon from '@/assets/icons/material/audio.svg';
import videoIcon from '@/assets/icons/material/video.svg';
import pdfIcon from '@/assets/icons/material/pdf.svg';
import blankFileIcon from '@/assets/icons/material/file-blank.svg';
import comicFolderIcon from '@/assets/icons/material/folder-comic.svg';

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

  if (normalized === 'mp4') {
    return createIconNode(videoIcon, 'video');
  }

  if (normalized === 'pdf') {
    return createIconNode(pdfIcon, 'pdf');
  }

  return createIconNode(blankFileIcon, 'file');
}

export function getFileNodeIconByParentBuiltInType(ext?: string, parentBuiltInType?: string): React.ReactNode {
  const normalizedBuiltInType = String(parentBuiltInType || 'DEF').toUpperCase();
  if (normalizedBuiltInType === 'COMIC') {
    if (isImageExtension(ext)) {
      return getFileNodeIcon(ext);
    }
    return createWarningIconNode('与漫画模式不匹配的文件');
  }
  return getFileNodeIcon(ext);
}

export function getDirectoryBuiltInIcon(builtInType?: string): React.ReactNode | undefined {
  const normalized = String(builtInType || 'DEF').toUpperCase();
  if (normalized === 'DEF') {
    return undefined;
  }
  if (normalized === 'COMIC') {
    return createIconNode(comicFolderIcon, 'comic-folder');
  }
  return createWarningIconNode(`未知内置类型: ${normalized}`);
}
