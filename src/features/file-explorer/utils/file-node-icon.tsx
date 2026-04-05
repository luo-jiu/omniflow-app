import React from 'react';
import imageIcon from '@/assets/icons/material/image.svg';
import audioIcon from '@/assets/icons/material/audio.svg';
import videoIcon from '@/assets/icons/material/video.svg';
import pdfIcon from '@/assets/icons/material/pdf.svg';
import blankFileIcon from '@/assets/icons/material/file-blank.svg';

function createIconNode(src: string, alt: string): React.ReactNode {
  return React.createElement('img', {
    src,
    alt,
    className: 'tree-file-type-icon',
  });
}

export function getFileNodeIcon(ext?: string): React.ReactNode {
  if (!ext) {
    return createIconNode(blankFileIcon, 'file');
  }

  const normalized = ext.toLowerCase().replace('.', '');

  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif'];
  if (imageExtensions.includes(normalized)) {
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
