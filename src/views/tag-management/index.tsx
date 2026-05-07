import React from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import OpaquePageContainer from '@/components/OpaquePageContainer';
import { useNavigate } from 'react-router-dom';
import generalTagIcon from '@/assets/icons/material/settings.svg';
import asmrTagIcon from '@/assets/icons/material/folder-asmr.svg';
import comicTagIcon from '@/assets/icons/material/folder-comic.svg';
import audioTagIcon from '@/assets/icons/material/audio.svg';
import videoTagIcon from '@/assets/icons/material/video.svg';
import fileTagIcon from '@/assets/icons/material/file-blank.svg';
import folderTagIcon from '@/assets/icons/material/folder-base.svg';
import uiMappingTagIcon from '@/assets/icons/material/command.svg';
import {
  Button,
  ColorPicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { IconChevronLeft, IconDelete, IconEdit } from '@douyinfe/semi-icons';
import {
  createTag,
  deleteTag,
  fetchTags,
  updateTag,
  type TagItem,
  type TagDimension,
  type TagScope,
  type TagType,
} from '@/features/tag-management/services/tag.api';
import {
  FILE_TAB_TARGETS,
  normalizeFileTabTargetKey,
  type FileTabTarget,
} from '@/features/tag-management/constants/file-tab-targets';
import {
  TAG_COLOR_TONE_OPTIONS,
  DEFAULT_TAG_COLOR_TONE,
  getTagPrimaryColorPresets,
  normalizeTagColorTone,
  TAG_TEXT_COLOR_PRESETS,
  type TagColorTone,
} from '@/features/tag-management/constants/tag-color-presets';

interface TagOption<T extends string = string> {
  value: T;
  label: string;
  icon: string;
}

const TAG_TYPE_OPTIONS: Array<TagOption<TagType>> = [
  { value: 'GENERAL', label: '通用', icon: generalTagIcon },
  { value: 'ASMR', label: 'ASMR', icon: asmrTagIcon },
  { value: 'COMIC', label: '漫画', icon: comicTagIcon },
  { value: 'AUDIO', label: '音频', icon: audioTagIcon },
  { value: 'VIDEO', label: '视频', icon: videoTagIcon },
  { value: 'FILE', label: '文件', icon: fileTagIcon },
  { value: 'FOLDER', label: '文件夹', icon: folderTagIcon },
  { value: 'FILE_TAB', label: '界面映射', icon: uiMappingTagIcon },
];

const TAG_DIMENSION_OPTIONS: Array<{ value: TagDimension; label: string }> = [
  { value: 'custom', label: '自定义' },
  { value: 'genre', label: '内容 / 风格' },
  { value: 'creator', label: '作者 / 创作者' },
  { value: 'character', label: '角色' },
  { value: 'series', label: '系列 / 作品' },
  { value: 'source', label: '来源' },
  { value: 'language', label: '语言' },
  { value: 'region', label: '地区' },
  { value: 'technical', label: '技术属性' },
  { value: 'status', label: '状态' },
];

const RESOURCE_KIND_OPTIONS: Array<TagOption> = [
  { value: 'general', label: '通用', icon: generalTagIcon },
  { value: 'asmr', label: 'ASMR', icon: asmrTagIcon },
  { value: 'comic', label: '漫画', icon: comicTagIcon },
  { value: 'audio', label: '音频', icon: audioTagIcon },
  { value: 'video', label: '视频', icon: videoTagIcon },
  { value: 'file', label: '文件', icon: fileTagIcon },
  { value: 'folder', label: '文件夹', icon: folderTagIcon },
];

type TagCenterMode = 'RESOURCE' | 'UI_MAPPING';
type TagResourceSection = 'ALL' | 'GENERAL' | 'ASMR' | 'COMIC' | 'AUDIO' | 'VIDEO' | 'FILE' | 'FOLDER';

const TAG_RESOURCE_SECTIONS: Array<{
  key: TagResourceSection;
  label: string;
  description: string;
  icon: string;
  type?: TagType;
}> = [
  { key: 'ALL', label: '全部资源', description: '跨资源类型查看所有业务标签', icon: generalTagIcon },
  { key: 'GENERAL', label: '通用', description: '适用于多个资源域的通用标签', icon: generalTagIcon, type: 'GENERAL' },
  { key: 'ASMR', label: 'ASMR', description: 'ASMR 内置类型与归档标签', icon: asmrTagIcon, type: 'ASMR' },
  { key: 'COMIC', label: '漫画', description: '漫画、作者、角色与系列标签', icon: comicTagIcon, type: 'COMIC' },
  { key: 'AUDIO', label: '音频', description: '音乐、音频归档与播放列表标签', icon: audioTagIcon, type: 'AUDIO' },
  { key: 'VIDEO', label: '视频', description: '视频、合集与媒体处理标签', icon: videoTagIcon, type: 'VIDEO' },
  { key: 'FILE', label: '文件', description: '普通文件搜索辅助标签', icon: fileTagIcon, type: 'FILE' },
  { key: 'FOLDER', label: '文件夹', description: '目录与归档入口标签', icon: folderTagIcon, type: 'FOLDER' },
];

const FILE_TAB_SECTION_META = {
  label: '顶部标签映射',
  description: '文件预览顶部标签颜色映射',
  icon: uiMappingTagIcon,
};

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FILE_TAB_UPDATE_EVENT = 'omniflow:file-tab-tags-updated';
const TAG_COLOR_TONE_STORAGE_KEY = 'tag-management:primary-color-tone:v1';
const TAG_MANAGEMENT_SELECT_DROPDOWN_CLASS = 'tag-management-select-dropdown';

interface TagFormState {
  id?: number;
  name: string;
  type: TagType;
  scope: TagScope;
  dimension: TagDimension;
  resourceKind: string;
  targetKey: string;
  color: string;
  textColor: string;
  sortOrder: number;
  enabled: boolean;
  description: string;
}

const DEFAULT_FORM_STATE: TagFormState = {
  name: '',
  type: 'GENERAL',
  scope: 'resource',
  dimension: 'custom',
  resourceKind: 'general',
  targetKey: '',
  color: '#4F8CFF',
  textColor: '',
  sortOrder: 0,
  enabled: true,
  description: '',
};

const TagCenterPage = styled(OpaquePageContainer)`
  overflow: hidden;
`;

const Wrapper = styled.div`
  padding: 28px 32px 24px;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--semi-color-text-0);
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 11px;
    margin-bottom: 6px;
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 11px;
  }

  .page-back-button {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    min-width: 28px;
    padding: 0;
    border-radius: 7px;
  }

  .page-title {
    margin: 0;
    font-size: 23px;
    font-weight: 700;
    line-height: 1.15;
  }

  .center-layout {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 14px;
    flex: 1;
    min-height: 0;
  }

  .side-panel,
  .main-panel {
    min-height: 0;
    border: 1px solid var(--semi-color-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-bg-0) 96%, transparent);
  }

  .side-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 9px;
    overflow: hidden;
  }

  .side-heading {
    flex-shrink: 0;
    padding: 4px 6px 7px;
    color: var(--semi-color-text-2);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
  }

  .type-list {
    display: grid;
    gap: 3px;
    align-content: start;
    grid-auto-rows: max-content;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding-right: 2px;
  }

  .side-divider {
    flex-shrink: 0;
    height: 1px;
    margin: 7px 6px 6px;
    background: var(--semi-color-border);
  }

  .type-button {
    width: 100%;
    height: auto;
    min-height: 30px;
    justify-content: flex-start;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--semi-color-text-1);
    text-align: left;
  }

  .type-button:hover {
    background: var(--semi-color-fill-0);
    color: var(--semi-color-text-0);
  }

  .type-button.active {
    border-color: color-mix(in srgb, var(--semi-color-primary) 58%, transparent);
    background: color-mix(in srgb, var(--semi-color-primary) 16%, transparent);
    color: var(--semi-color-primary);
  }

  .type-button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--semi-color-primary) 72%, transparent);
    outline-offset: 1px;
  }

  .type-button-inner {
    display: grid;
    width: 100%;
  }

  .type-button-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.2;
  }

  .type-button-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .type-button-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    object-fit: contain;
  }

  .type-button-label-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .type-count {
    color: var(--semi-color-text-2);
    font-size: 12px;
    font-weight: 600;
  }

  .main-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .main-panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    padding: 12px 13px 10px;
    border-bottom: 1px solid var(--semi-color-border);
  }

  .main-title {
    margin: 0;
    font-size: 16px;
    line-height: 1.25;
    font-weight: 700;
  }

  .main-desc {
    margin-top: 3px;
    color: var(--semi-color-text-2);
    font-size: 12px;
    line-height: 1.45;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .toolbar-search {
    width: 260px;
  }

  .toolbar-search .semi-input-wrapper,
  .toolbar-search .semi-input {
    font-size: 13px;
  }

  .toolbar-search .semi-input-wrapper {
    min-height: 30px;
  }

  .toolbar-create-btn {
    min-height: 30px;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 6px;
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-bg-0);
  }

  .toolbar-create-btn:hover {
    background: var(--semi-color-bg-0);
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .toolbar-create-btn:active {
    background: var(--semi-color-bg-0);
    border-color: color-mix(in srgb, var(--semi-color-primary) 78%, var(--semi-color-border) 22%);
    color: color-mix(in srgb, var(--semi-color-primary) 88%, var(--semi-color-text-0) 12%);
  }

  .toolbar-create-btn:focus-visible {
    background: var(--semi-color-bg-0);
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .table-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 10px;
  }

  .table-body .tag-table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .table-body .tag-table > .semi-spin,
  .table-body .tag-table > .semi-spin > .semi-spin-children,
  .table-body .tag-table > .semi-spin > .semi-spin-children > div {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 68%, transparent);
    flex-shrink: 0;
  }

  .swatch-cell {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    font-size: 12px;
  }

  .cell-ellipsis {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-actions {
    display: inline-flex;
    gap: 5px;
  }

  .color-field {
    display: grid;
    gap: 8px;
  }

  .field-label {
    color: var(--semi-color-text-1);
    font-size: 11px;
    line-height: 15px;
  }

  .color-row {
    display: grid;
    grid-template-columns: 1fr 52px;
    gap: 10px;
    align-items: center;
  }

  .native-color-picker {
    width: 52px;
    height: 36px;
    border: 1px solid var(--semi-color-border);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    padding: 2px;
  }

  .native-color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .native-color-picker::-webkit-color-swatch {
    border: none;
    border-radius: 4px;
  }

  .palette {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .palette-item {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 75%, transparent);
    cursor: pointer;
    padding: 0;
    background: transparent;
    transition: box-shadow 120ms ease;
  }

  .palette-item.active {
    box-shadow: 0 0 0 2px var(--semi-color-primary);
  }

  .palette-clear {
    border: none;
    background: transparent;
    color: var(--semi-color-text-2);
    cursor: pointer;
    font-size: 11px;
    line-height: 18px;
    padding: 0 4px;
  }

  .semi-table {
    font-size: 12px;
  }

  .semi-table-container {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--semi-color-border);
    border-radius: 8px;
    background: var(--semi-color-bg-0);
  }

  .semi-table-pagination-outer {
    flex-shrink: 0;
    min-height: 36px;
    padding-top: 4px;
  }

  .semi-table-pagination-info {
    font-size: 12px;
    line-height: 18px;
  }

  .semi-page-item {
    min-width: 28px;
    height: 28px;
    margin-left: 2px;
    margin-right: 2px;
    line-height: 28px;
  }

  .semi-table-thead > .semi-table-row > .semi-table-row-head,
  .semi-table-tbody > .semi-table-row > .semi-table-row-cell {
    padding: 8px 9px;
  }

  .semi-table-thead > .semi-table-row > .semi-table-row-head {
    font-size: 12px;
    font-weight: 600;
  }

  .semi-button {
    height: 25px;
    min-height: 25px;
    padding: 0 7px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }

  .semi-button .semi-icon {
    font-size: 12px;
  }

  .semi-tag {
    font-size: 12px;
    line-height: 16px;
  }

  .semi-empty-description {
    font-size: 13px;
  }

  .semi-page,
  .semi-page-total,
  .semi-page-item {
    font-size: 12px;
  }

  @media (max-width: 760px) {
    padding: 20px 12px 14px;

    .center-layout {
      grid-template-columns: 1fr;
    }

    .side-panel {
      display: none;
    }

    .toolbar-search {
      width: min(100%, 240px);
    }
  }
`;

const TagManagementCompactModalStyle = createGlobalStyle`
  .tag-management-compact-modal,
  .tag-management-compact-confirm {
    width: 620px !important;
  }

  .tag-management-compact-modal .semi-modal-content,
  .tag-management-compact-confirm .semi-modal-content {
    overflow: hidden;
    padding: 0 !important;
    border: 1px solid var(--app-border-strong);
    border-radius: 12px;
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  }

  .tag-management-compact-modal .semi-modal-header,
  .tag-management-compact-confirm .semi-modal-header {
    margin: 0;
    padding: 18px 22px 8px !important;
  }

  .tag-management-compact-modal .semi-modal-title,
  .tag-management-compact-confirm .semi-modal-title {
    font-size: 18px;
    line-height: 1.25;
    font-weight: 700;
  }

  .tag-management-compact-modal .semi-modal-close,
  .tag-management-compact-confirm .semi-modal-close {
    top: 16px !important;
    right: 18px !important;
    width: 24px !important;
    min-width: 24px !important;
    height: 24px !important;
    padding: 0 !important;
    border-radius: 6px !important;
    background: transparent !important;
    color: var(--semi-color-text-1);
  }

  .tag-management-compact-modal .semi-modal-close:hover,
  .tag-management-compact-confirm .semi-modal-close:hover {
    background: var(--semi-color-fill-0) !important;
    color: var(--semi-color-text-0);
  }

  .tag-management-compact-modal .semi-modal-close .semi-icon,
  .tag-management-compact-confirm .semi-modal-close .semi-icon {
    font-size: 13px;
  }

  .tag-management-compact-modal .tag-editor-title {
    display: flex;
    align-items: center;
    gap: 18px;
    min-width: 0;
  }

  .tag-management-compact-modal .tag-editor-title-text {
    flex-shrink: 0;
  }

  .tag-management-compact-modal .semi-modal-body,
  .tag-management-compact-confirm .semi-modal-body {
    padding: 0 22px 16px !important;
    font-size: 12px;
    line-height: 1.55;
    color: var(--semi-color-text-1);
  }

  .tag-management-compact-modal .semi-modal-footer,
  .tag-management-compact-confirm .semi-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 0;
    padding: 0 22px 18px !important;
  }

  .tag-management-compact-modal .semi-button,
  .tag-management-compact-confirm .semi-button {
    height: 30px;
    min-width: 64px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }

  .tag-management-compact-modal .semi-input-wrapper,
  .tag-management-compact-modal .semi-input,
  .tag-management-compact-modal .semi-select,
  .tag-management-compact-modal .semi-select-selection,
  .tag-management-compact-modal .semi-input-number,
  .tag-management-compact-modal textarea {
    font-size: 12px;
  }

  .tag-management-compact-modal .semi-input-wrapper,
  .tag-management-compact-modal .semi-select,
  .tag-management-compact-modal .semi-input-number {
    height: 30px;
    min-height: 30px;
  }

  .tag-management-compact-modal .semi-select {
    max-height: 30px !important;
    overflow: hidden !important;
    border-radius: 8px !important;
  }

  .tag-management-compact-modal .semi-select::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .tag-management-compact-modal .semi-select-selection {
    height: 30px;
    min-height: 30px;
    max-height: 30px;
    align-items: center;
    overflow: hidden !important;
    padding-top: 0;
    padding-bottom: 0;
    border-radius: 8px !important;
  }

  .tag-management-compact-modal .semi-select-selection-placeholder,
  .tag-management-compact-modal .semi-select-selection-rendered,
  .tag-management-compact-modal .semi-select-selection-text,
  .tag-management-compact-modal .semi-select-selection span {
    overflow: hidden !important;
  }

  .tag-management-compact-modal .semi-select-selection-text {
    max-height: none !important;
    line-height: 30px;
    white-space: nowrap;
  }

  .tag-management-compact-modal .semi-select-selection-text::-webkit-scrollbar {
    display: none;
  }

  .tag-management-compact-modal .semi-select-arrow {
    align-self: center;
  }

  .tag-management-compact-modal .tag-editor-form {
    display: grid;
    gap: 12px;
  }

  .tag-management-compact-modal .tag-editor-section {
    display: grid;
    gap: 10px;
  }

  .tag-management-compact-modal .tag-editor-color-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.42fr) minmax(0, 1fr);
    gap: 10px;
  }

  .tag-management-compact-modal .tag-editor-tone-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }

  .tag-management-compact-modal .tag-editor-tone-label {
    color: var(--semi-color-text-2);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
  }

  .tag-management-compact-modal .tag-editor-tone-list {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .tag-management-compact-modal .tag-editor-tone-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 31px;
    height: 22px;
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 72%, transparent);
    border-radius: 7px;
    color: #14532d;
    cursor: pointer;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    padding: 0;
    transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  }

  .tag-management-compact-modal .tag-editor-tone-button:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--semi-color-primary) 62%, var(--semi-color-border) 38%);
  }

  .tag-management-compact-modal .tag-editor-tone-button.active {
    border-color: var(--semi-color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--semi-color-primary) 30%, transparent);
  }

  .tag-management-compact-modal .tag-editor-section-title {
    margin: 0;
    color: var(--semi-color-text-2);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: 0;
  }

  .tag-management-compact-modal .tag-editor-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .tag-management-compact-modal .tag-editor-field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .tag-management-compact-modal .tag-editor-label {
    color: var(--semi-color-text-2);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
  }

  .tag-management-compact-modal .tag-editor-color-card {
    display: grid;
    align-content: start;
    gap: 9px;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 82%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--semi-color-bg-1) 70%, transparent);
  }

  .tag-management-compact-modal .tag-editor-color-card.compact {
    gap: 8px;
  }

  .tag-management-compact-modal .tag-editor-color-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .tag-management-compact-modal .tag-editor-color-title {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .tag-management-compact-modal .tag-editor-color-name {
    color: var(--semi-color-text-0);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.25;
  }

  .tag-management-compact-modal .tag-editor-color-desc {
    color: var(--semi-color-text-2);
    font-size: 10px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag-management-compact-modal .tag-editor-color-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px;
    gap: 8px;
    align-items: center;
  }

  .tag-management-compact-modal .tag-editor-color-picker {
    width: 28px !important;
    height: 28px !important;
    min-width: 28px;
    border: 1px solid var(--semi-color-border);
    border-radius: 7px;
    overflow: hidden;
  }

  .tag-management-compact-modal .tag-editor-palette {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .tag-management-compact-modal .tag-editor-swatch {
    width: 21px;
    height: 21px;
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 76%, transparent);
    border-radius: 999px;
    padding: 0;
    cursor: pointer;
    transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  }

  .tag-management-compact-modal .tag-editor-swatch:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--semi-color-primary) 58%, var(--semi-color-border) 42%);
  }

  .tag-management-compact-modal .tag-editor-swatch.active {
    border-color: var(--semi-color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--semi-color-primary) 36%, transparent);
  }

  .tag-management-compact-modal .tag-editor-preview {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    justify-self: start;
    min-width: 72px;
    max-width: 100%;
    height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }

  .tag-management-compact-modal .tag-editor-title .tag-editor-preview {
    justify-self: auto;
    max-width: 180px;
  }

  .tag-management-compact-modal .tag-editor-tone-divider {
    width: calc(100% - 18px);
    height: 1px;
    justify-self: center;
    background: color-mix(in srgb, var(--semi-color-border) 72%, transparent);
  }

  .tag-management-compact-modal .tag-editor-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 82%, transparent);
    border-radius: 9px;
    background: color-mix(in srgb, var(--semi-color-bg-1) 62%, transparent);
  }

  .tag-management-compact-modal .tag-editor-toggle-copy {
    display: grid;
    gap: 2px;
  }

  .tag-management-compact-modal .tag-editor-toggle-title {
    color: var(--semi-color-text-0);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.25;
  }

  .tag-management-compact-modal .tag-editor-toggle-desc {
    color: var(--semi-color-text-2);
    font-size: 10px;
    line-height: 1.35;
  }

  .tag-management-compact-modal textarea {
    min-height: 72px !important;
    resize: vertical;
  }

  @media (max-width: 680px) {
    .tag-management-compact-modal,
    .tag-management-compact-confirm {
      width: calc(100vw - 32px) !important;
    }

    .tag-management-compact-modal .tag-editor-color-grid,
    .tag-management-compact-modal .tag-editor-grid {
      grid-template-columns: 1fr;
    }
  }

  .tag-management-select-dropdown {
    background: var(--semi-color-bg-3);
    border-radius: 8px;
    overflow: hidden;
  }

  .tag-management-select-dropdown.semi-select-option-list-wrapper {
    padding: 0;
  }

  .tag-management-select-dropdown .semi-select-option-list {
    background: transparent;
    scrollbar-color: color-mix(in srgb, var(--semi-color-text-3) 58%, transparent) transparent;
    scrollbar-width: thin;
    border-radius: 8px;
  }

  .tag-management-select-dropdown .semi-select-option-list::-webkit-scrollbar {
    width: 6px;
    height: 6px;
    background: transparent;
  }

  .tag-management-select-dropdown .semi-select-option-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .tag-management-select-dropdown .semi-select-option-list::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-text-3) 58%, transparent);
  }

  .tag-management-select-dropdown .semi-select-option-list::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--semi-color-text-2) 62%, transparent);
  }

  .tag-management-select-dropdown .semi-select-option-icon {
    display: none;
  }

  .tag-management-select-dropdown .semi-select-option {
    min-height: 28px;
    margin: 0 4px;
    padding: 5px 10px;
    border-radius: 6px;
    box-sizing: border-box;
  }

  .tag-management-select-dropdown .semi-select-option-custom {
    min-height: 28px;
    margin: 0 4px;
    padding: 5px 10px;
    border-radius: 6px;
    box-sizing: border-box;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .tag-management-select-dropdown .semi-select-option-custom-selected,
  .tag-management-select-dropdown .tag-management-select-option-row-selected {
    background: var(--semi-color-fill-0);
  }

  .tag-management-select-dropdown .semi-select-option:hover,
  .tag-management-select-dropdown .semi-select-option-focused,
  .tag-management-select-dropdown .semi-select-option-custom:hover,
  .tag-management-select-dropdown .semi-select-option-custom-focused,
  .tag-management-select-dropdown .tag-management-select-option-row-focused {
    background: var(--semi-color-fill-1);
  }

  .tag-management-select-dropdown .semi-select-option-selected:hover,
  .tag-management-select-dropdown .semi-select-option-custom-selected:hover,
  .tag-management-select-dropdown .tag-management-select-option-row-selected.tag-management-select-option-row-focused {
    background: color-mix(in srgb, var(--semi-color-fill-2) 72%, var(--semi-color-primary) 8%);
  }

  .tag-management-select-dropdown .semi-select-option-custom-disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .tag-management-select-option {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .tag-management-select-option-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    object-fit: contain;
  }

  .tag-management-select-option-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

function normalizeHexColor(color: string): string {
  return String(color || '').trim().toUpperCase();
}

function toColorPickerValue(color: string, fallback: string) {
  const normalized = normalizeHexColor(color);
  const safeColor = HEX_COLOR_PATTERN.test(normalized) ? normalized : fallback;
  return ColorPicker.colorStringToValue(safeColor);
}

function isColorActive(currentValue: string, presetValue: string): boolean {
  return normalizeHexColor(currentValue) === normalizeHexColor(presetValue);
}

function loadStoredTagColorTone(): TagColorTone {
  if (typeof window === 'undefined') return DEFAULT_TAG_COLOR_TONE;
  try {
    return normalizeTagColorTone(window.localStorage.getItem(TAG_COLOR_TONE_STORAGE_KEY));
  } catch {
    return DEFAULT_TAG_COLOR_TONE;
  }
}

function storeTagColorTone(tone: TagColorTone): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TAG_COLOR_TONE_STORAGE_KEY, tone);
  } catch {
    // localStorage 可能被禁用；保留当前内存状态即可。
  }
}

function renderTagSelectOption(option: TagOption): React.ReactNode {
  return (
    <span className="tag-management-select-option">
      <img className="tag-management-select-option-icon" src={option.icon} alt="" />
      <span className="tag-management-select-option-label">{option.label}</span>
    </span>
  );
}

function renderTagSelectOptionItem(props: {
  className?: string;
  style?: React.CSSProperties;
  label?: React.ReactNode;
  icon?: string;
  selected?: boolean;
  focused?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent) => void;
  onMouseEnter?: (event: React.MouseEvent) => void;
}): React.ReactNode {
  const optionClassName = [
    props.className,
    props.selected ? 'tag-management-select-option-row-selected' : '',
    props.focused ? 'tag-management-select-option-row-focused' : '',
    props.disabled ? 'tag-management-select-option-row-disabled' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={optionClassName}
      style={props.style}
      role="option"
      aria-disabled={props.disabled ? 'true' : 'false'}
      onClick={props.onClick}
      onMouseEnter={props.onMouseEnter}
    >
      <span className="tag-management-select-option">
        {props.icon ? <img className="tag-management-select-option-icon" src={props.icon} alt="" /> : null}
        <span className="tag-management-select-option-label">{props.label}</span>
      </span>
    </div>
  );
}

function renderTagSelectSelectedItem(optionNode: Record<string, unknown>): React.ReactNode {
  return (
    <span className="tag-management-select-option">
      {typeof optionNode.icon === 'string' ? (
        <img className="tag-management-select-option-icon" src={optionNode.icon} alt="" />
      ) : null}
      <span className="tag-management-select-option-label">
        {React.isValidElement(optionNode.label) || typeof optionNode.label === 'string' || typeof optionNode.label === 'number'
          ? optionNode.label
          : String(optionNode.value || '')}
      </span>
    </span>
  );
}

function validateForm(form: TagFormState): string | null {
  const name = form.name.trim();
  if (!name) return '标签名称不能为空';
  if (name.length > 64) return '标签名称不能超过 64 个字符';
  if (String(form.type).toUpperCase() !== 'FILE_TAB') {
    if (!String(form.dimension || '').trim()) return '标签维度不能为空';
    if (!String(form.resourceKind || '').trim()) return '资源类型不能为空';
  }
  const color = normalizeHexColor(form.color);
  if (!HEX_COLOR_PATTERN.test(color)) return '主色格式错误，请输入 #RRGGBB 或 #RRGGBBAA';
  const textColor = normalizeHexColor(form.textColor);
  if (textColor && !HEX_COLOR_PATTERN.test(textColor)) return '文字色格式错误，请输入 #RRGGBB 或 #RRGGBBAA';
  if (String(form.type).toUpperCase() === 'FILE_TAB' && !normalizeFileTabTargetKey(form.targetKey)) {
    return '顶部标签类型必须绑定目标';
  }
  if (!Number.isFinite(form.sortOrder)) return '排序值非法';
  return null;
}

function matchesSearch(text: string, keyword: string): boolean {
  return String(text || '').toUpperCase().includes(keyword.toUpperCase());
}

function inferResourceKindFromTagType(type: TagType): string {
  switch (String(type || '').trim().toUpperCase()) {
    case 'ASMR':
      return 'asmr';
    case 'COMIC':
      return 'comic';
    case 'AUDIO':
      return 'audio';
    case 'VIDEO':
      return 'video';
    case 'FILE':
      return 'file';
    case 'FOLDER':
      return 'folder';
    default:
      return 'general';
  }
}

function mapTagToForm(tag: TagItem): TagFormState {
  return {
    id: tag.id,
    name: tag.name,
    type: String(tag.type || '').toUpperCase(),
    scope: tag.scope || 'resource',
    dimension: tag.dimension || 'custom',
    resourceKind: tag.resourceKind || inferResourceKindFromTagType(tag.type),
    targetKey: normalizeFileTabTargetKey(tag.targetKey || ''),
    color: tag.color || '#4F8CFF',
    textColor: tag.textColor || '',
    sortOrder: Number(tag.sortOrder ?? 0),
    enabled: Number(tag.enabled ?? 1) === 1,
    description: tag.description || '',
  };
}

const TagManagement: React.FC = () => {
  const navigate = useNavigate();
  const { Title } = Typography;
  const modalNoDragStyle = React.useMemo(
    () => ({ WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties),
    []
  );

  const [loading, setLoading] = React.useState(false);
  const [searchKeyword, setSearchKeyword] = React.useState('');
  const [items, setItems] = React.useState<TagItem[]>([]);
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [editorSubmitting, setEditorSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<TagFormState>(DEFAULT_FORM_STATE);
  const [lockType, setLockType] = React.useState<TagType | null>(null);
  const [lockTargetKey, setLockTargetKey] = React.useState<string | null>(null);
  const [activeMode, setActiveMode] = React.useState<TagCenterMode>('RESOURCE');
  const [activeSection, setActiveSection] = React.useState<TagResourceSection>('ALL');
  const [primaryColorTone, setPrimaryColorTone] = React.useState<TagColorTone>(() => loadStoredTagColorTone());
  const [togglingTagIds, setTogglingTagIds] = React.useState<Set<number>>(() => new Set());

  const loadList = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchTags();
      setItems(list);
    } catch (error: any) {
      Toast.error(error?.message || '加载标签失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  const emitFileTabUpdated = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent(FILE_TAB_UPDATE_EVENT));
  }, []);

  const fileTabTagMap = React.useMemo(() => {
    const map = new Map<string, TagItem>();
    items
      .filter(item => String(item.type || '').toUpperCase() === 'FILE_TAB')
      .forEach((item) => {
        const targetKey = normalizeFileTabTargetKey(item.targetKey || '');
        if (!targetKey) return;
        const existing = map.get(targetKey);
        if (!existing || Number(existing.sortOrder ?? 0) > Number(item.sortOrder ?? 0)) {
          map.set(targetKey, item);
        }
      });
    return map;
  }, [items]);

  const normalizedKeyword = searchKeyword.trim().toUpperCase();
  const primaryColorPresets = React.useMemo(
    () => getTagPrimaryColorPresets(primaryColorTone),
    [primaryColorTone]
  );

  const handlePrimaryColorToneChange = React.useCallback((tone: TagColorTone) => {
    setPrimaryColorTone(tone);
    storeTagColorTone(tone);
  }, []);

  const handleToggleEnabled = React.useCallback(async (record: TagItem, checked: boolean) => {
    setTogglingTagIds(prev => new Set(prev).add(record.id));
    try {
      const normalizedType = String(record.type || '').trim().toUpperCase();
      await updateTag(record.id, {
        name: record.name,
        type: normalizedType,
        scope: normalizedType === 'FILE_TAB' ? 'ui' : record.scope || 'resource',
        dimension: normalizedType === 'FILE_TAB' ? 'custom' : record.dimension || 'custom',
        resourceKind: normalizedType === 'FILE_TAB' ? null : record.resourceKind || inferResourceKindFromTagType(normalizedType),
        targetKey: normalizedType === 'FILE_TAB' ? normalizeFileTabTargetKey(record.targetKey || '') : null,
        color: normalizeHexColor(record.color || DEFAULT_FORM_STATE.color),
        textColor: normalizeHexColor(record.textColor || '') || null,
        sortOrder: Number(record.sortOrder || 0),
        enabled: checked ? 1 : 0,
        description: record.description || null,
      });
      Toast.success(checked ? '标签已启用' : '标签已停用');
      if (normalizedType === 'FILE_TAB') {
        emitFileTabUpdated();
      }
      await loadList();
    } catch (error: any) {
      Toast.error(error?.message || '更新标签状态失败');
    } finally {
      setTogglingTagIds((prev) => {
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
    }
  }, [emitFileTabUpdated, loadList]);

  const fileTabRows = React.useMemo(() => {
    return FILE_TAB_TARGETS
      .map((target) => {
        const tag = fileTabTagMap.get(target.key) || null;
        return { key: target.key, target, tag };
      })
      .filter(({ target, tag }) => {
        if (!normalizedKeyword) return true;
        return (
          matchesSearch(target.key, normalizedKeyword)
          || matchesSearch(target.label, normalizedKeyword)
          || matchesSearch(target.description, normalizedKeyword)
          || matchesSearch(tag?.name || '', normalizedKeyword)
        );
      });
  }, [fileTabTagMap, normalizedKeyword]);

  const otherTagRows = React.useMemo(() => {
    return items
      .filter(item => String(item.type || '').toUpperCase() !== 'FILE_TAB')
      .filter((item) => {
        if (!normalizedKeyword) return true;
        return (
          matchesSearch(item.name, normalizedKeyword)
          || matchesSearch(item.type, normalizedKeyword)
          || matchesSearch(item.dimension || '', normalizedKeyword)
          || matchesSearch(item.resourceKind || '', normalizedKeyword)
          || matchesSearch(item.description || '', normalizedKeyword)
          || matchesSearch(item.targetKey || '', normalizedKeyword)
        );
      });
  }, [items, normalizedKeyword]);

  const activeSectionMeta = React.useMemo(
    () => TAG_RESOURCE_SECTIONS.find(section => section.key === activeSection) || TAG_RESOURCE_SECTIONS[0],
    [activeSection]
  );

  const activeResourceRows = React.useMemo(() => {
    if (activeSection === 'ALL') return otherTagRows;
    return otherTagRows.filter(item => String(item.type || '').toUpperCase() === activeSection);
  }, [activeSection, otherTagRows]);

  const sectionCounts = React.useMemo(() => {
    const counts = new Map<TagResourceSection, number>();
    counts.set('ALL', items.filter(item => String(item.type || '').toUpperCase() !== 'FILE_TAB').length);
    TAG_RESOURCE_SECTIONS.forEach((section) => {
      if (!section.type) return;
      counts.set(
        section.key,
        items.filter(item => String(item.type || '').toUpperCase() === String(section.type).toUpperCase()).length
      );
    });
    return counts;
  }, [items]);

  const openCreateOther = () => {
    const nextType = activeSection === 'ALL' ? 'GENERAL' : activeSection;
    setForm({
      ...DEFAULT_FORM_STATE,
      type: nextType,
      resourceKind: inferResourceKindFromTagType(nextType),
    });
    setLockType(null);
    setLockTargetKey(null);
    setEditorVisible(true);
  };

  const openEdit = (tag: TagItem) => {
    setForm(mapTagToForm(tag));
    setLockType(null);
    setLockTargetKey(null);
    setEditorVisible(true);
  };

  const openConfigureFileTab = (target: FileTabTarget, tag: TagItem | null) => {
    if (tag) {
      setForm(mapTagToForm(tag));
    } else {
      setForm({
        ...DEFAULT_FORM_STATE,
        type: 'FILE_TAB',
        scope: 'ui',
        dimension: 'custom',
        resourceKind: '',
        targetKey: target.key,
        name: target.key,
      });
    }
    setLockType('FILE_TAB');
    setLockTargetKey(target.key);
    setEditorVisible(true);
  };

  const handleSubmit = async () => {
    const errorMessage = validateForm(form);
    if (errorMessage) {
      Toast.warning(errorMessage);
      return;
    }

    const normalizedType = String((lockType || form.type || '')).trim().toUpperCase();
    const normalizedTargetKey = normalizedType === 'FILE_TAB'
      ? normalizeFileTabTargetKey(lockTargetKey || form.targetKey || '')
      : null;
    const normalizedResourceKind = normalizedType === 'FILE_TAB'
      ? null
      : String(form.resourceKind || 'general').trim().toLowerCase();
    const payload = {
      name: form.name.trim(),
      type: normalizedType,
      scope: normalizedType === 'FILE_TAB' ? 'ui' : 'resource',
      dimension: normalizedType === 'FILE_TAB' ? 'custom' : String(form.dimension || 'custom').trim().toLowerCase(),
      resourceKind: normalizedResourceKind,
      targetKey: normalizedTargetKey,
      color: normalizeHexColor(form.color),
      textColor: normalizeHexColor(form.textColor) || null,
      sortOrder: Number(form.sortOrder || 0),
      enabled: form.enabled ? 1 : 0,
      description: form.description.trim() || null,
    };

    setEditorSubmitting(true);
    try {
      if (form.id) {
        await updateTag(form.id, payload);
        Toast.success('标签已更新');
      } else {
        await createTag(payload);
        Toast.success('标签已创建');
      }
      if (normalizedType === 'FILE_TAB') {
        emitFileTabUpdated();
      }
      setEditorVisible(false);
      await loadList();
    } catch (error: any) {
      Toast.error(error?.message || '保存标签失败');
    } finally {
      setEditorSubmitting(false);
    }
  };

  const handleDelete = async (record: TagItem) => {
    Modal.confirm({
      title: '确认删除该标签？',
      content: `删除后标签「${record.name}」将不可用`,
      okType: 'danger',
      className: 'tag-management-compact-confirm',
      onOk: async () => {
        try {
          await deleteTag(record.id);
          Toast.success('标签已删除');
          if (String(record.type || '').toUpperCase() === 'FILE_TAB') {
            emitFileTabUpdated();
          }
          await loadList();
        } catch (error: any) {
          Toast.error(error?.message || '删除标签失败');
        }
      },
    });
  };

  const editingType = String(lockType || form.type || '').toUpperCase();
  const isEditingFileTab = editingType === 'FILE_TAB';
  const previewBackgroundColor = HEX_COLOR_PATTERN.test(normalizeHexColor(form.color))
    ? normalizeHexColor(form.color)
    : DEFAULT_FORM_STATE.color;
  const previewTextColor = HEX_COLOR_PATTERN.test(normalizeHexColor(form.textColor))
    ? normalizeHexColor(form.textColor)
    : '#FFFFFF';
  const activeMainTitle = activeMode === 'UI_MAPPING' ? FILE_TAB_SECTION_META.label : activeSectionMeta.label;
  const activeMainDescription = activeMode === 'UI_MAPPING'
    ? FILE_TAB_SECTION_META.description
    : activeSectionMeta.description;

  return (
    <TagCenterPage>
    <TagManagementCompactModalStyle />
    <Wrapper>
      <div className="header">
        <div className="header-left">
          <Button
            icon={<IconChevronLeft style={{ fontSize: 14 }} />}
            theme="borderless"
            onClick={() => navigate(-1)}
            className="page-back-button"
          />
          <Title heading={2} className="page-title">
            标签管理
          </Title>
        </div>
      </div>

      <div className="center-layout">
        <aside className="side-panel">
          <div className="side-heading">资源标签</div>
          <div className="type-list">
            {TAG_RESOURCE_SECTIONS.map(section => (
              <button
                key={section.key}
                type="button"
                className={`type-button ${activeMode === 'RESOURCE' && activeSection === section.key ? 'active' : ''}`}
                onClick={() => {
                  setActiveMode('RESOURCE');
                  setActiveSection(section.key);
                }}
              >
                <span className="type-button-inner">
                  <span className="type-button-top">
                    <span className="type-button-label">
                      <img className="type-button-icon" src={section.icon} alt="" />
                      <span className="type-button-label-text">{section.label}</span>
                    </span>
                    <span className="type-count">{sectionCounts.get(section.key) || 0}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="side-divider" />
          <div className="side-heading">界面映射</div>
          <button
            type="button"
            className={`type-button ${activeMode === 'UI_MAPPING' ? 'active' : ''}`}
            onClick={() => setActiveMode('UI_MAPPING')}
          >
            <span className="type-button-inner">
              <span className="type-button-top">
                <span className="type-button-label">
                  <img className="type-button-icon" src={FILE_TAB_SECTION_META.icon} alt="" />
                  <span className="type-button-label-text">{FILE_TAB_SECTION_META.label}</span>
                </span>
                <span className="type-count">{fileTabTagMap.size}</span>
              </span>
            </span>
          </button>
        </aside>

        <main className="main-panel">
          <div className="main-panel-head">
            <div>
              <Title heading={5} className="main-title">{activeMainTitle}</Title>
              <div className="main-desc">{activeMainDescription}</div>
            </div>
            <div className="toolbar">
              <Input
                value={searchKeyword}
                onChange={setSearchKeyword}
                placeholder="搜索标签名称 / 类型 / 维度"
                showClear
                className="toolbar-search"
              />
              {activeMode === 'RESOURCE' ? (
                <Button
                  theme="borderless"
                  onClick={openCreateOther}
                  className="toolbar-create-btn"
                >
                  新建标签
                </Button>
              ) : null}
            </div>
          </div>

          <div className="table-body">
            {activeMode === 'UI_MAPPING' ? (
              <Table
                className="tag-table"
                dataSource={fileTabRows}
                pagination={false}
                rowKey="key"
                empty={<Empty description="未匹配到顶部标签项" />}
                columns={[
                  {
                    title: '目标键',
                    dataIndex: 'target.key',
                    width: 96,
                    render: (value: string) => <span className="cell-ellipsis">{value}</span>,
                  },
                  {
                    title: '目标名称',
                    dataIndex: 'target.label',
                    width: 112,
                    render: (value: string) => <span className="cell-ellipsis">{value}</span>,
                  },
                  {
                    title: '说明',
                    dataIndex: 'target.description',
                    render: (value: string) => <span className="cell-ellipsis">{value}</span>,
                  },
                  {
                    title: '当前标签',
                    width: 104,
                    render: (_: unknown, record: { target: FileTabTarget; tag: TagItem | null }) => (
                      record.tag
                        ? <Tag color="green">{record.tag.name}</Tag>
                        : <Tag color="grey">未配置</Tag>
                    ),
                  },
                  {
                    title: '颜色',
                    width: 118,
                    render: (_: unknown, record: { target: FileTabTarget; tag: TagItem | null }) => {
                      const color = record.tag?.color || '';
                      return (
                        <span className="swatch-cell">
                          <span className="swatch" style={{ backgroundColor: color || '#00000000' }} />
                          <span className="cell-ellipsis">{color || '-'}</span>
                        </span>
                      );
                    },
                  },
                  {
                    title: '操作',
                    width: 150,
                    render: (_: unknown, record: { target: FileTabTarget; tag: TagItem | null }) => (
                      <div className="row-actions">
                        <Button
                          theme="borderless"
                          icon={<IconEdit />}
                          onClick={() => openConfigureFileTab(record.target, record.tag)}
                        >
                          {record.tag ? '编辑' : '配置'}
                        </Button>
                        {record.tag ? (
                          <Button
                            theme="borderless"
                            type="danger"
                            icon={<IconDelete />}
                            onClick={() => {
                              void handleDelete(record.tag as TagItem);
                            }}
                          >
                            删除
                          </Button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            ) : (
              <Table
                className="tag-table"
                loading={loading}
                dataSource={activeResourceRows}
                rowKey="id"
                empty={<Empty description="暂无业务标签" />}
                pagination={{ pageSize: 12 }}
                columns={[
                  { title: 'ID', dataIndex: 'id', width: 58 },
                  {
                    title: '标签名称',
                    dataIndex: 'name',
                    width: 150,
                    render: (value: string) => <span className="cell-ellipsis">{value}</span>,
                  },
                  {
                    title: '类型',
                    dataIndex: 'type',
                    width: 82,
                    render: (value: string) => <Tag>{String(value || '').toUpperCase()}</Tag>,
                  },
                  {
                    title: '维度',
                    dataIndex: 'dimension',
                    width: 118,
                    render: (value: string) => {
                      const option = TAG_DIMENSION_OPTIONS.find(item => item.value === value);
                      return <span className="cell-ellipsis">{option?.label || value || '-'}</span>;
                    },
                  },
                  {
                    title: '资源',
                    dataIndex: 'resourceKind',
                    width: 86,
                    render: (value: string | null) => <span className="cell-ellipsis">{value || '-'}</span>,
                  },
                  {
                    title: '颜色',
                    dataIndex: 'color',
                    width: 116,
                    render: (value: string) => (
                      <span className="swatch-cell">
                        <span className="swatch" style={{ backgroundColor: value || '#00000000' }} />
                        <span className="cell-ellipsis">{value || '-'}</span>
                      </span>
                    ),
                  },
                    {
                      title: '启用',
                      dataIndex: 'enabled',
                      width: 70,
                      render: (value: number, record: TagItem) => (
                        <Switch
                          size="small"
                          checked={Number(value) === 1}
                          disabled={togglingTagIds.has(record.id)}
                          onChange={(checked) => {
                            void handleToggleEnabled(record, checked);
                          }}
                        />
                      ),
                    },
                  { title: '排序', dataIndex: 'sortOrder', width: 58 },
                  {
                    title: '描述',
                    dataIndex: 'description',
                    render: (value: string) => <span className="cell-ellipsis">{value || '-'}</span>,
                  },
                  {
                    title: '操作',
                    width: 132,
                    render: (_: unknown, record: TagItem) => (
                      <div className="row-actions">
                        <Button theme="borderless" icon={<IconEdit />} onClick={() => openEdit(record)}>
                          编辑
                        </Button>
                        <Button
                          theme="borderless"
                          type="danger"
                          icon={<IconDelete />}
                          onClick={() => {
                            void handleDelete(record);
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </main>
      </div>

        <Modal
          title={(
            <span className="tag-editor-title">
              <span className="tag-editor-title-text">{form.id ? '编辑标签' : '新建标签'}</span>
              <span
                className="tag-editor-preview"
                style={{
                  backgroundColor: previewBackgroundColor,
                  color: previewTextColor,
                }}
              >
                {form.name.trim() || '标签预览'}
              </span>
            </span>
          )}
        visible={editorVisible}
        okText={form.id ? '保存' : '创建'}
        onCancel={() => setEditorVisible(false)}
        onOk={handleSubmit}
        confirmLoading={editorSubmitting}
        width={620}
        className="tag-management-compact-modal"
        style={modalNoDragStyle}
        okButtonProps={{
          style: {
            minWidth: 64,
            height: 30,
            fontSize: 12,
            borderRadius: 6,
          },
        }}
        cancelButtonProps={{
          style: {
            minWidth: 64,
            height: 30,
            fontSize: 12,
            borderRadius: 6,
          },
        }}
      >
          <div className="tag-editor-form">
            <section className="tag-editor-section">
              <div className="tag-editor-field">
              <span className="tag-editor-label">标签名称</span>
              <Input
                value={form.name}
                onChange={(value) => setForm(prev => ({ ...prev, name: value }))}
                placeholder="例如：治愈系 / 作者名 / 合集状态"
                maxLength={64}
                showClear
              />
            </div>

            <div className="tag-editor-grid">
              <div className="tag-editor-field">
                <span className="tag-editor-label">类型</span>
                <Select
                  value={editingType}
                  dropdownClassName={TAG_MANAGEMENT_SELECT_DROPDOWN_CLASS}
                  spacing={0}
                  renderOptionItem={renderTagSelectOptionItem}
                  renderSelectedItem={renderTagSelectSelectedItem}
                  onChange={(value) => {
                    const nextType = String(value).toUpperCase();
                    setForm(prev => ({
                      ...prev,
                      type: nextType,
                      scope: nextType === 'FILE_TAB' ? 'ui' : 'resource',
                      resourceKind: nextType === 'FILE_TAB' ? '' : inferResourceKindFromTagType(nextType),
                    }));
                  }}
                  disabled={Boolean(lockType)}
                >
                  {TAG_TYPE_OPTIONS.map(option => (
                    <Select.Option key={String(option.value)} value={String(option.value)} label={option.label} icon={option.icon}>
                      {renderTagSelectOption(option)}
                    </Select.Option>
                  ))}
                </Select>
              </div>

              {isEditingFileTab ? (
                <div className="tag-editor-field">
                  <span className="tag-editor-label">映射目标</span>
                  <Select
                    value={normalizeFileTabTargetKey(lockTargetKey || form.targetKey)}
                    dropdownClassName={TAG_MANAGEMENT_SELECT_DROPDOWN_CLASS}
                    spacing={0}
                    onChange={(value) => setForm(prev => ({ ...prev, targetKey: String(value) }))}
                    disabled={Boolean(lockTargetKey)}
                  >
                    {FILE_TAB_TARGETS.map(target => (
                      <Select.Option key={target.key} value={target.key}>
                        {target.key} · {target.label}
                      </Select.Option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div className="tag-editor-field">
                  <span className="tag-editor-label">资源域</span>
                  <Select
                    value={form.resourceKind}
                    dropdownClassName={TAG_MANAGEMENT_SELECT_DROPDOWN_CLASS}
                    spacing={0}
                    renderOptionItem={renderTagSelectOptionItem}
                    renderSelectedItem={renderTagSelectSelectedItem}
                    onChange={(value) => setForm(prev => ({ ...prev, resourceKind: String(value).toLowerCase() }))}
                  >
                    {RESOURCE_KIND_OPTIONS.map(option => (
                      <Select.Option key={option.value} value={option.value} label={option.label} icon={option.icon}>
                        {renderTagSelectOption(option)}
                      </Select.Option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            {!isEditingFileTab ? (
              <div className="tag-editor-field">
                <span className="tag-editor-label">维度</span>
                <Select
                  value={form.dimension}
                  dropdownClassName={TAG_MANAGEMENT_SELECT_DROPDOWN_CLASS}
                  spacing={0}
                  onChange={(value) => setForm(prev => ({ ...prev, dimension: String(value).toLowerCase() }))}
                >
                  {TAG_DIMENSION_OPTIONS.map(option => (
                    <Select.Option key={String(option.value)} value={String(option.value)}>
                      {option.label}
                    </Select.Option>
                  ))}
                </Select>
              </div>
            ) : null}
            </section>

            <section className="tag-editor-section">
              <div className="tag-editor-color-grid">
              <div className="tag-editor-color-card">
                <div className="tag-editor-color-head">
                  <div className="tag-editor-color-title">
                    <span className="tag-editor-color-name">主色</span>
                    <span className="tag-editor-color-desc">选择常用色，或点右侧打开完整取色器</span>
                  </div>
                </div>
                <div className="tag-editor-color-row">
                  <Input
                    value={form.color}
                    onChange={(value) => setForm(prev => ({ ...prev, color: value }))}
                    placeholder="#4F8CFF"
                    maxLength={9}
                  />
                  <ColorPicker
                    className="tag-editor-color-picker"
                    usePopover
                    alpha
                    value={toColorPickerValue(form.color, '#4F8CFF')}
                    onChange={(color) => setForm(prev => ({ ...prev, color: normalizeHexColor(color.hex) }))}
                    width={360}
                    height={220}
                  />
                </div>
                  <div className="tag-editor-palette">
                    {primaryColorPresets.map(color => (
                    <button
                      key={color}
                      type="button"
                      className={`tag-editor-swatch ${isColorActive(form.color, color) ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setForm(prev => ({ ...prev, color }))}
                      aria-label={`主色 ${color}`}
                      />
                    ))}
                  </div>
                  <div className="tag-editor-tone-divider" />
                  <div className="tag-editor-tone-row">
                    <span className="tag-editor-tone-label">色调明暗</span>
                    <div className="tag-editor-tone-list">
                      {TAG_COLOR_TONE_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        className={`tag-editor-tone-button ${primaryColorTone === option.value ? 'active' : ''}`}
                        style={{ backgroundColor: option.color }}
                        onClick={() => handlePrimaryColorToneChange(option.value)}
                        aria-label={`色调明暗 ${option.label}`}
                      />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="tag-editor-color-card compact">
                <div className="tag-editor-color-head">
                  <div className="tag-editor-color-title">
                    <span className="tag-editor-color-name">文字色</span>
                    <span className="tag-editor-color-desc">留空使用默认白字</span>
                  </div>
                </div>
                <div className="tag-editor-color-row">
                  <Input
                    value={form.textColor}
                    onChange={(value) => setForm(prev => ({ ...prev, textColor: value }))}
                    placeholder="可空，例如 #FFFFFF"
                    maxLength={9}
                  />
                  <ColorPicker
                    className="tag-editor-color-picker"
                    usePopover
                    alpha
                    value={toColorPickerValue(form.textColor, '#FFFFFF')}
                    onChange={(color) => setForm(prev => ({ ...prev, textColor: normalizeHexColor(color.hex) }))}
                    width={360}
                    height={220}
                  />
                </div>
                <div className="tag-editor-palette">
                  {TAG_TEXT_COLOR_PRESETS.map(color => (
                    <button
                      key={color}
                      type="button"
                      className={`tag-editor-swatch ${isColorActive(form.textColor, color) ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setForm(prev => ({ ...prev, textColor: color }))}
                      aria-label={`文字色 ${color}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            </section>

            <section className="tag-editor-section">
              <div className="tag-editor-field">
                <span className="tag-editor-label">排序值</span>
                <InputNumber
                  value={form.sortOrder}
                  onNumberChange={(value) => setForm(prev => ({ ...prev, sortOrder: Number(value || 0) }))}
                  min={-99999}
                  max={99999}
                  precision={0}
                  hideButtons={false}
                  placeholder="默认 0"
                />
              </div>

            <div className="tag-editor-field">
              <span className="tag-editor-label">说明</span>
              <TextArea
                value={form.description}
                onChange={(value: string) => setForm(prev => ({ ...prev, description: value }))}
                placeholder="可选，用来补充标签含义"
                maxCount={255}
                autosize={{ minRows: 3, maxRows: 5 }}
              />
            </div>
          </section>
        </div>
      </Modal>
    </Wrapper>
    </TagCenterPage>
  );
};

export default TagManagement;
