import React from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import OpaquePageContainer from '@/components/OpaquePageContainer';
import { useNavigate } from 'react-router-dom';
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
  TAG_PRIMARY_COLOR_PRESETS,
  TAG_TEXT_COLOR_PRESETS,
} from '@/features/tag-management/constants/tag-color-presets';

const TAG_TYPE_OPTIONS: Array<{ value: TagType; label: string }> = [
  { value: 'ASMR', label: 'ASMR' },
  { value: 'COMIC', label: '漫画' },
  { value: 'AUDIO', label: '音频' },
  { value: 'VIDEO', label: '视频' },
  { value: 'FILE', label: '文件' },
  { value: 'FOLDER', label: '文件夹' },
  { value: 'GENERAL', label: '通用' },
  { value: 'FILE_TAB', label: '顶部标签' },
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

const RESOURCE_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'general', label: '通用' },
  { value: 'asmr', label: 'ASMR' },
  { value: 'comic', label: '漫画' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
  { value: 'file', label: '文件' },
  { value: 'folder', label: '文件夹' },
];

type TagCenterMode = 'RESOURCE' | 'UI_MAPPING';
type TagResourceSection = 'ALL' | 'GENERAL' | 'ASMR' | 'COMIC' | 'AUDIO' | 'VIDEO' | 'FILE' | 'FOLDER';

const TAG_RESOURCE_SECTIONS: Array<{
  key: TagResourceSection;
  label: string;
  description: string;
  type?: TagType;
}> = [
  { key: 'ALL', label: '全部资源', description: '跨资源类型查看所有业务标签' },
  { key: 'GENERAL', label: '通用', description: '适用于多个资源域的通用标签', type: 'GENERAL' },
  { key: 'ASMR', label: 'ASMR', description: 'ASMR 内置类型与归档标签', type: 'ASMR' },
  { key: 'COMIC', label: '漫画', description: '漫画、作者、角色与系列标签', type: 'COMIC' },
  { key: 'AUDIO', label: '音频', description: '音乐、音频归档与播放列表标签', type: 'AUDIO' },
  { key: 'VIDEO', label: '视频', description: '视频、合集与媒体处理标签', type: 'VIDEO' },
  { key: 'FILE', label: '文件', description: '普通文件搜索辅助标签', type: 'FILE' },
  { key: 'FOLDER', label: '文件夹', description: '目录与归档入口标签', type: 'FOLDER' },
];

const FILE_TAB_SECTION_META = {
  label: '顶部标签映射',
  description: '文件预览顶部标签颜色映射',
};

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FILE_TAB_UPDATE_EVENT = 'omniflow:file-tab-tags-updated';

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

  .subtitle {
    margin: 0 0 16px 39px;
    max-width: 760px;
    color: var(--semi-color-text-2);
    font-size: 11px;
    line-height: 1.55;
    flex-shrink: 0;
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
    overflow: auto;
  }

  .side-heading {
    padding: 4px 6px 7px;
    color: var(--semi-color-text-2);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.4;
  }

  .type-list {
    display: grid;
    gap: 4px;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding-right: 2px;
  }

  .side-divider {
    flex-shrink: 0;
    height: 1px;
    margin: 9px 6px 8px;
    background: var(--semi-color-border);
  }

  .type-button {
    width: 100%;
    height: auto;
    min-height: 34px;
    justify-content: flex-start;
    padding: 6px 7px;
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
    gap: 2px;
    width: 100%;
  }

  .type-button-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
  }

  .type-button-desc {
    overflow: hidden;
    color: var(--semi-color-text-2);
    font-size: 9px;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .type-count {
    color: var(--semi-color-text-2);
    font-size: 10px;
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
    font-size: 10px;
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
    font-size: 11px;
  }

  .toolbar-search .semi-input-wrapper {
    min-height: 30px;
  }

  .toolbar-create-btn {
    min-height: 30px;
    padding: 0 12px;
    font-size: 11px;
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
    min-height: 0;
    overflow: auto;
    padding: 10px;
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
    font-size: 10px;
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
    font-size: 10px;
  }

  .semi-table-container {
    overflow: hidden;
  }

  .semi-table-thead > .semi-table-row > .semi-table-row-head,
  .semi-table-tbody > .semi-table-row > .semi-table-row-cell {
    padding: 8px 9px;
  }

  .semi-table-thead > .semi-table-row > .semi-table-row-head {
    font-size: 10px;
    font-weight: 600;
  }

  .semi-button {
    height: 25px;
    min-height: 25px;
    padding: 0 7px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
  }

  .semi-button .semi-icon {
    font-size: 12px;
  }

  .semi-tag {
    font-size: 10px;
    line-height: 16px;
  }

  .semi-empty-description {
    font-size: 11px;
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
    width: 380px !important;
  }

  .tag-management-compact-modal .semi-modal-content,
  .tag-management-compact-confirm .semi-modal-content {
    overflow: hidden;
    border: 1px solid var(--app-border-strong);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  }

  .tag-management-compact-modal .semi-modal-header,
  .tag-management-compact-confirm .semi-modal-header {
    margin: 0;
    padding: 13px 16px 8px !important;
  }

  .tag-management-compact-modal .semi-modal-title,
  .tag-management-compact-confirm .semi-modal-title {
    font-size: 14px;
    line-height: 1.35;
    font-weight: 700;
  }

  .tag-management-compact-modal .semi-modal-body,
  .tag-management-compact-confirm .semi-modal-body {
    padding: 0 16px 13px !important;
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
    padding: 0 16px 16px !important;
  }

  .tag-management-compact-modal .semi-button,
  .tag-management-compact-confirm .semi-button {
    height: 28px;
    min-width: 56px;
    padding: 0 10px;
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
    height: 28px;
    min-height: 28px;
  }

  .tag-management-compact-modal .semi-select {
    max-height: 28px !important;
    overflow: hidden !important;
  }

  .tag-management-compact-modal .semi-select::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .tag-management-compact-modal .semi-select-selection {
    height: 28px;
    min-height: 28px;
    max-height: 28px;
    align-items: center;
    overflow: hidden !important;
    padding-top: 0;
    padding-bottom: 0;
  }

  .tag-management-compact-modal .semi-select-selection-placeholder,
  .tag-management-compact-modal .semi-select-selection-rendered,
  .tag-management-compact-modal .semi-select-selection-text,
  .tag-management-compact-modal .semi-select-selection span {
    overflow: hidden !important;
  }

  .tag-management-compact-modal .semi-select-selection-text {
    max-height: none !important;
    line-height: 28px;
    white-space: nowrap;
  }

  .tag-management-compact-modal .semi-select-selection-text::-webkit-scrollbar {
    display: none;
  }

  .tag-management-compact-modal .semi-select-arrow {
    align-self: center;
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

      <div className="subtitle">
        按资源类型管理业务标签和顶部标签映射。后续 ASMR、视频、音频等入口会直接带上下文进入这里。
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
                    <span>{section.label}</span>
                    <span className="type-count">{sectionCounts.get(section.key) || 0}</span>
                  </span>
                  <span className="type-button-desc">{section.description}</span>
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
                <span>{FILE_TAB_SECTION_META.label}</span>
                <span className="type-count">{fileTabTagMap.size}</span>
              </span>
              <span className="type-button-desc">{FILE_TAB_SECTION_META.description}</span>
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
                    width: 58,
                    render: (value: number) => (Number(value) === 1 ? '是' : '否'),
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
        title={form.id ? '编辑标签' : '新建标签'}
        visible={editorVisible}
        okText={form.id ? '保存' : '创建'}
        onCancel={() => setEditorVisible(false)}
        onOk={handleSubmit}
        confirmLoading={editorSubmitting}
        width={380}
        className="tag-management-compact-modal"
        style={modalNoDragStyle}
        okButtonProps={{
          style: {
            minWidth: 56,
            height: 28,
            fontSize: 12,
            borderRadius: 6,
          },
        }}
        cancelButtonProps={{
          style: {
            minWidth: 56,
            height: 28,
            fontSize: 12,
            borderRadius: 6,
          },
        }}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <Input
            value={form.name}
            onChange={(value) => setForm(prev => ({ ...prev, name: value }))}
            placeholder="标签名称"
            maxLength={64}
            showClear
          />

          <Select
            value={editingType}
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
              <Select.Option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </Select.Option>
            ))}
          </Select>

          {isEditingFileTab ? (
            <Select
              value={normalizeFileTabTargetKey(lockTargetKey || form.targetKey)}
              onChange={(value) => setForm(prev => ({ ...prev, targetKey: String(value) }))}
              disabled={Boolean(lockTargetKey)}
            >
              {FILE_TAB_TARGETS.map(target => (
                <Select.Option key={target.key} value={target.key}>
                  {target.key} · {target.label}
                </Select.Option>
              ))}
            </Select>
          ) : null}

          {!isEditingFileTab ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Select
                value={form.dimension}
                onChange={(value) => setForm(prev => ({ ...prev, dimension: String(value).toLowerCase() }))}
              >
                {TAG_DIMENSION_OPTIONS.map(option => (
                  <Select.Option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </Select.Option>
                ))}
              </Select>
              <Select
                value={form.resourceKind}
                onChange={(value) => setForm(prev => ({ ...prev, resourceKind: String(value).toLowerCase() }))}
              >
                {RESOURCE_KIND_OPTIONS.map(option => (
                  <Select.Option key={option.value} value={option.value}>
                    {option.label}
                  </Select.Option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="color-field">
            <span className="field-label">主色</span>
            <div className="color-row">
              <Input
                value={form.color}
                onChange={(value) => setForm(prev => ({ ...prev, color: value }))}
                placeholder="#4F8CFF"
                maxLength={9}
              />
              <ColorPicker
                usePopover
                alpha
                value={toColorPickerValue(form.color, '#4F8CFF')}
                onChange={(color) => setForm(prev => ({ ...prev, color: normalizeHexColor(color.hex) }))}
                width={380}
                height={240}
                style={{
                  width: 52,
                  height: 30,
                  borderRadius: 6,
                  display: 'block',
                }}
              />
            </div>
            <div className="palette">
              {TAG_PRIMARY_COLOR_PRESETS.map(color => (
                <button
                  key={color}
                  type="button"
                  className={`palette-item ${isColorActive(form.color, color) ? 'active' : ''}`}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: '1px solid color-mix(in srgb, var(--semi-color-border) 75%, transparent)',
                    backgroundColor: color,
                    padding: 0,
                    cursor: 'pointer',
                    boxShadow: isColorActive(form.color, color) ? '0 0 0 2px var(--semi-color-primary)' : 'none',
                  }}
                  onClick={() => setForm(prev => ({ ...prev, color }))}
                  aria-label={`主色 ${color}`}
                />
              ))}
            </div>
          </div>

          <div className="color-field">
            <span className="field-label">文字色（可空）</span>
            <div className="color-row">
              <Input
                value={form.textColor}
                onChange={(value) => setForm(prev => ({ ...prev, textColor: value }))}
                placeholder="文字颜色（可空）例如 #FFFFFF"
                maxLength={9}
              />
              <ColorPicker
                usePopover
                alpha
                value={toColorPickerValue(form.textColor, '#FFFFFF')}
                onChange={(color) => setForm(prev => ({ ...prev, textColor: normalizeHexColor(color.hex) }))}
                width={380}
                height={240}
                style={{
                  width: 52,
                  height: 30,
                  borderRadius: 6,
                  display: 'block',
                }}
              />
            </div>
            <div className="palette">
              {TAG_TEXT_COLOR_PRESETS.map(color => (
                <button
                  key={color}
                  type="button"
                  className={`palette-item ${isColorActive(form.textColor, color) ? 'active' : ''}`}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: '1px solid color-mix(in srgb, var(--semi-color-border) 75%, transparent)',
                    backgroundColor: color,
                    padding: 0,
                    cursor: 'pointer',
                    boxShadow: isColorActive(form.textColor, color) ? '0 0 0 2px var(--semi-color-primary)' : 'none',
                  }}
                  onClick={() => setForm(prev => ({ ...prev, textColor: color }))}
                  aria-label={`文字色 ${color}`}
                />
              ))}
              <button
                type="button"
                className="palette-clear"
                onClick={() => setForm(prev => ({ ...prev, textColor: '' }))}
                style={{
                  fontSize: 11,
                  lineHeight: '18px',
                  padding: '0 4px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--semi-color-text-2)',
                  cursor: 'pointer',
                }}
              >
                清空文字色
              </button>
            </div>
          </div>

          <div className="color-field">
            <span className="field-label">
              排序值（越小越靠前）
            </span>
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

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span>启用</span>
            <Switch
              checked={form.enabled}
              onChange={(checked) => setForm(prev => ({ ...prev, enabled: checked }))}
            />
          </div>

          <TextArea
            value={form.description}
            onChange={(value: string) => setForm(prev => ({ ...prev, description: value }))}
            placeholder="标签说明（可空）"
            maxCount={255}
            autosize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
      </Modal>
    </Wrapper>
    </TagCenterPage>
  );
};

export default TagManagement;
