import React from 'react';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import type { OverlayBoundaryRect } from '@/components/ui/context-menu/overlay';
import comicFolderIcon from '@/assets/icons/material/folder-comic.svg';
import asmrFolderIcon from '@/assets/icons/material/folder-asmr.svg';
import videoIcon from '@/assets/icons/material/video.svg';
import audioFolderIcon from '@/assets/icons/material/folder-audio.svg';

interface DirectoryContextMenuProps {
  node: any;
  isFolder: boolean;
  onAction: (action: string, node: any) => void;
  onClose?: () => void;
  boundaryRect?: OverlayBoundaryRect | null;
  deleteCount?: number;
  submenuPreferredHorizontal?: 'left' | 'right';
  getPopupContainer?: () => HTMLElement;
}

const BUILT_IN_MENU_ICON_SIZE = 13;

function createBuiltInMenuIcon(src: string, alt: string): React.ReactNode {
  return (
    <img
      src={src}
      alt={alt}
      width={BUILT_IN_MENU_ICON_SIZE}
      height={BUILT_IN_MENU_ICON_SIZE}
      style={{ display: 'block', width: BUILT_IN_MENU_ICON_SIZE, height: BUILT_IN_MENU_ICON_SIZE, objectFit: 'contain' }}
    />
  );
}

const COMIC_BUILT_IN_MENU_ICON = createBuiltInMenuIcon(comicFolderIcon, 'comic');
const ASMR_BUILT_IN_MENU_ICON = createBuiltInMenuIcon(asmrFolderIcon, 'asmr');
const VIDEO_BUILT_IN_MENU_ICON = createBuiltInMenuIcon(videoIcon, 'video');
const AUDIO_BUILT_IN_MENU_ICON = createBuiltInMenuIcon(audioFolderIcon, 'audio');

function getBuiltInTypeMenuIcon(builtInType: string): React.ReactNode | undefined {
  const normalizedType = String(builtInType || '').toUpperCase();
  if (normalizedType === 'COMIC') {
    return COMIC_BUILT_IN_MENU_ICON;
  }
  if (normalizedType === 'ASMR') {
    return ASMR_BUILT_IN_MENU_ICON;
  }
  if (normalizedType === 'VIDEO') {
    return VIDEO_BUILT_IN_MENU_ICON;
  }
  if (normalizedType === 'AUDIO') {
    return AUDIO_BUILT_IN_MENU_ICON;
  }
  return undefined;
}

function createTrailingBuiltInTypeLabel(
  text: string,
  builtInType: string,
): React.ReactNode {
  const icon = getBuiltInTypeMenuIcon(builtInType);
  if (!icon) {
    return text;
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 7,
      }}
    >
      <span>{text}</span>
      <span
        style={{
          display: 'inline-flex',
          width: BUILT_IN_MENU_ICON_SIZE,
          height: BUILT_IN_MENU_ICON_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
    </span>
  );
}

/**
 * 目录树右键菜单
 * 使用通用的 ContextMenu 组件构建
 */
const DirectoryContextMenu: React.FC<DirectoryContextMenuProps> = ({
  node,
  isFolder,
  onAction,
  onClose,
  boundaryRect,
  submenuPreferredHorizontal = 'left',
  getPopupContainer: getPopupContainerProp,
}) => {
  // 根目录菜单
  if (node === null) {
    const rootItems: ContextMenuItem[] = [
      { 
        key: 'new-file', 
        label: '新建文件', 
        onClick: () => onAction('新建文件', null) 
      },
      { 
        key: 'new-folder', 
        label: '新建文件夹', 
        onClick: () => onAction('新建文件夹', null) 
      },
      { type: 'divider', key: 'root-divider-create-upload' },
      {
        key: 'upload-file',
        label: '上传文件',
        onClick: () => onAction('上传文件', null),
      },
      {
        key: 'upload-folder',
        label: '上传文件夹',
        onClick: () => onAction('上传文件夹', null),
      }
    ];
    return (
      <ContextMenu
        items={rootItems}
        className="directory-context-menu directory-tree-context-menu"
        onItemClick={onClose}
        submenuPosition="auto"
        submenuPreferredHorizontal={submenuPreferredHorizontal}
        boundaryRect={boundaryRect}
        getPopupContainer={getPopupContainerProp}
      />
    );
  }

  // 文件/文件夹菜单
  const currentBuiltInType = String(node?.builtInType || 'DEF').toUpperCase();
  const currentArchiveMode = Number(node?.archiveMode ?? 0) === 1 ? 1 : 0;
  const parentBuiltInType = String(node?.data?.parentBuiltInType || 'DEF').toUpperCase();
  const parentArchiveMode = Number(node?.data?.parentArchiveMode ?? 0) === 1 ? 1 : 0;
  const isAudioArchiveChildFile = !isFolder && parentBuiltInType === 'AUDIO' && parentArchiveMode === 1;
  const isAudioArchiveAudioFile = isAudioArchiveChildFile && node?.data?.audioArchiveAudio === true;
  const isAudioArchiveFolder = isFolder && currentBuiltInType === 'AUDIO' && currentArchiveMode === 1;
  const audioSubtitleVisible = node?.data?.audioArchiveSubtitlesVisible === true;

  const items: ContextMenuItem[] = isFolder
    ? [
      {
        key: 'new-file',
        label: '新建文件',
        onClick: () => onAction('新建文件', node),
      },
      {
        key: 'new-folder',
        label: '新建文件夹',
        onClick: () => onAction('新建文件夹', node),
      },
    ]
    : [
      {
        key: 'rename',
        label: '重命名',
        onClick: () => onAction('重命名', node),
      },
      {
        key: 'props',
        label: '属性',
        onClick: () => onAction('属性', node),
      },
      {
        key: 'download',
        label: '下载',
        onClick: () => onAction('下载', node),
      },
      {
        key: 'open-in-browser',
        label: '在浏览器打开',
        onClick: () => onAction('在浏览器打开', node),
      },
    ];

  // 文件夹：基础信息组后加分隔线，再进入模式设置组
  if (isFolder) {
    items.push({ type: 'divider', key: 'divider-basic-mode' });
  }

  items.push(
    {
      key: 'built-in-type',
      label: '内置类型',
      children: [
        {
          key: 'built-in-type-def',
          label: currentBuiltInType === 'DEF' ? '默认（当前）' : '默认',
          onClick: () => onAction('设置内置类型:DEF', node),
        },
        {
          key: 'built-in-type-comic',
          label: currentBuiltInType === 'COMIC' ? '漫画（当前）' : '漫画',
          icon: COMIC_BUILT_IN_MENU_ICON,
          onClick: () => onAction('设置内置类型:COMIC', node),
        },
        {
          key: 'built-in-type-asmr',
          label: currentBuiltInType === 'ASMR' ? 'ASMR（当前）' : 'ASMR',
          icon: ASMR_BUILT_IN_MENU_ICON,
          onClick: () => onAction('设置内置类型:ASMR', node),
        },
        {
          key: 'built-in-type-video',
          label: currentBuiltInType === 'VIDEO' ? '视频（当前）' : '视频',
          icon: VIDEO_BUILT_IN_MENU_ICON,
          onClick: () => onAction('设置内置类型:VIDEO', node),
        },
        ...(isFolder ? [{
          key: 'built-in-type-audio',
          label: currentBuiltInType === 'AUDIO' ? '音频（当前）' : '音频',
          icon: AUDIO_BUILT_IN_MENU_ICON,
          onClick: () => onAction('设置内置类型:AUDIO', node),
        }] : []),
      ],
    },
  );

  // 归档模式只允许目录设置，文件不展示
  if (isFolder) {
    items.push({
      key: 'archive-mode',
      label: '归档模式',
      children: [
        {
          key: 'archive-mode-off',
          label: currentArchiveMode === 0 ? '关闭（当前）' : '关闭',
          onClick: () => onAction('设置归档模式:0', node),
        },
        {
          key: 'archive-mode-on',
          label: currentArchiveMode === 1 ? '开启（当前）' : '开启',
          onClick: () => onAction('设置归档模式:1', node),
        },
      ],
    });
  }

  const isBuiltInFolder = isFolder && currentBuiltInType !== 'DEF';
  const isArchiveFolder = isBuiltInFolder && currentArchiveMode === 1;

  if (isArchiveFolder) {
    items.push({
      key: 'batch-set-built-in-type',
      label: createTrailingBuiltInTypeLabel('批量设置内置类型', currentBuiltInType),
      onClick: () => onAction('批量设置内置类型', node),
    });
  }

  if (isBuiltInFolder) {
    if (!isArchiveFolder) {
      items.push({
        key: 'open-raw-folder',
        label: '打开原始目录',
        onClick: () => onAction('打开原始目录', node),
      });
    }
    if (currentBuiltInType === 'COMIC' || currentBuiltInType === 'AUDIO') {
      items.push({
        key: 'sort-by-name',
        label: '按名称排序',
        onClick: () => onAction('按名称排序', node),
      });
    }
    if (isAudioArchiveFolder) {
      items.push({
        key: 'toggle-audio-subtitles',
        label: audioSubtitleVisible ? '隐藏文件' : '显示隐藏文件',
        onClick: () => onAction(audioSubtitleVisible ? '隐藏音频字幕文件' : '显示音频字幕文件', node),
      });
    }
  }

  if (isAudioArchiveAudioFile) {
    items.push({ type: 'divider', key: 'divider-audio-subtitles' });
    items.push({
      key: 'toggle-audio-file-subtitles',
      label: audioSubtitleVisible ? '隐藏文件' : '显示隐藏文件',
      onClick: () => onAction(audioSubtitleVisible ? '隐藏音频字幕文件' : '显示音频字幕文件', node),
    });
  }

  if (isFolder) {
    items.push(
      { type: 'divider', key: 'divider-rename-props' },
      {
        key: 'rename',
        label: '重命名',
        onClick: () => onAction('重命名', node),
      },
      {
        key: 'props',
        label: '属性',
        onClick: () => onAction('属性', node),
      },
      { type: 'divider', key: 'divider-upload' },
      {
        key: 'upload-file',
        label: '上传文件',
        onClick: () => onAction('上传文件', node),
      },
      {
        key: 'upload-folder',
        label: '上传文件夹',
        onClick: () => onAction('上传文件夹', node),
      },
      {
        key: 'download',
        label: '下载',
        onClick: () => onAction('下载', node),
      }
    );
  }

  if (isFolder) {
    items.push(
      { type: 'divider', key: 'divider-refresh' },
      {
        key: 'refresh',
        label: '刷新',
        onClick: () => onAction('刷新', node),
      },
    );
  }

  // 危险操作分割线
  items.push({ type: 'divider', key: 'divider-delete' });

  // 删除操作（带二次确认）
  items.push({
    key: 'delete',
    label: '删除',
    danger: true,
    onClick: () => onAction('delete', node),
  });

  return (
    <ContextMenu 
      items={items} 
      className="directory-context-menu directory-tree-context-menu"
      onItemClick={onClose}
      submenuPosition="auto"
      submenuPreferredHorizontal={submenuPreferredHorizontal}
      boundaryRect={boundaryRect}
      getPopupContainer={getPopupContainerProp}
    />
  );
};

export default DirectoryContextMenu;
