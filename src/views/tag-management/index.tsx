import React from 'react';
import styled from 'styled-components';
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

const Wrapper = styled.div`
  padding: 42px 56px;
  max-width: 1160px;
  margin: 0 auto;
  width: 100%;
  color: var(--semi-color-text-0);
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .subtitle {
    margin: 0 0 18px 48px;
    color: var(--semi-color-text-2);
    font-size: 14px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }

  .toolbar-create-btn {
    min-height: 38px;
    padding: 0 16px;
    font-size: 14px;
    border-radius: 8px;
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

  .section {
    margin-top: 18px;
    padding: 14px 14px 4px;
    border: 1px solid var(--semi-color-border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--semi-color-bg-0) 96%, transparent);
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--semi-color-border) 68%, transparent);
    flex-shrink: 0;
  }

  .swatch-cell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .color-field {
    display: grid;
    gap: 8px;
  }

  .field-label {
    color: var(--semi-color-text-1);
    font-size: 13px;
    line-height: 18px;
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
    font-size: 13px;
    line-height: 22px;
    padding: 0 4px;
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

  const openCreateOther = () => {
    setForm(DEFAULT_FORM_STATE);
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

  return (
    <OpaquePageContainer>
    <Wrapper>
      <div className="header">
        <div className="header-left">
          <Button
            icon={<IconChevronLeft style={{ fontSize: 20 }} />}
            theme="borderless"
            onClick={() => navigate(-1)}
            style={{ padding: '6px', borderRadius: 8 }}
          />
          <Title heading={2} style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>
            标签管理
          </Title>
        </div>
      </div>

      <div className="subtitle">
        顶部标签与业务标签分区管理。你可以搜索标签名、类型、目标键并进行颜色配置。
      </div>

      <div className="toolbar">
        <Input
          value={searchKeyword}
          onChange={setSearchKeyword}
          placeholder="搜索标签名称 / 类型 / 目标键"
          showClear
          style={{ width: 340 }}
        />
        <Button
          theme="borderless"
          onClick={openCreateOther}
          className="toolbar-create-btn"
        >
          新建标签
        </Button>
      </div>

      <section className="section">
        <div className="section-title">
          <Title heading={5} style={{ margin: 0 }}>顶部标签（FILE_TAB）</Title>
        </div>
        <Table
          dataSource={fileTabRows}
          pagination={false}
          rowKey="key"
          empty={<Empty description="未匹配到顶部标签项" />}
          columns={[
            { title: '目标键', dataIndex: 'target.key', width: 120 },
            { title: '目标名称', dataIndex: 'target.label', width: 140 },
            { title: '说明', dataIndex: 'target.description' },
            {
              title: '当前标签',
              width: 160,
              render: (_: unknown, record: { target: FileTabTarget; tag: TagItem | null }) => (
                record.tag
                  ? <Tag color="green">{record.tag.name}</Tag>
                  : <Tag color="grey">未配置</Tag>
              ),
            },
            {
              title: '颜色',
              width: 170,
              render: (_: unknown, record: { target: FileTabTarget; tag: TagItem | null }) => {
                const color = record.tag?.color || '';
                return (
                  <span className="swatch-cell">
                    <span className="swatch" style={{ backgroundColor: color || '#00000000' }} />
                    <span>{color || '-'}</span>
                  </span>
                );
              },
            },
            {
              title: '操作',
              width: 220,
              render: (_: unknown, record: { target: FileTabTarget; tag: TagItem | null }) => (
                <div style={{ display: 'inline-flex', gap: 8 }}>
                  <Button
                    theme="borderless"
                    icon={<IconEdit />}
                    onClick={() => openConfigureFileTab(record.target, record.tag)}
                  >
                    {record.tag ? '编辑映射' : '配置映射'}
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
      </section>

      <section className="section">
        <div className="section-title">
          <Title heading={5} style={{ margin: 0 }}>资源标签（多维标签）</Title>
        </div>
        <Table
          loading={loading}
          dataSource={otherTagRows}
          rowKey="id"
          empty={<Empty description="暂无业务标签" />}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 80 },
            { title: '标签名称', dataIndex: 'name', width: 180 },
            {
              title: '类型',
              dataIndex: 'type',
              width: 110,
              render: (value: string) => <Tag>{String(value || '').toUpperCase()}</Tag>,
            },
            {
              title: '维度',
              dataIndex: 'dimension',
              width: 130,
              render: (value: string) => {
                const option = TAG_DIMENSION_OPTIONS.find(item => item.value === value);
                return option?.label || value || '-';
              },
            },
            {
              title: '资源',
              dataIndex: 'resourceKind',
              width: 110,
              render: (value: string | null) => value || '-',
            },
            {
              title: '颜色',
              dataIndex: 'color',
              width: 150,
              render: (value: string) => (
                <span className="swatch-cell">
                  <span className="swatch" style={{ backgroundColor: value || '#00000000' }} />
                  <span>{value || '-'}</span>
                </span>
              ),
            },
            { title: '启用', dataIndex: 'enabled', width: 90, render: (value: number) => (Number(value) === 1 ? '是' : '否') },
            { title: '排序', dataIndex: 'sortOrder', width: 90 },
            { title: '描述', dataIndex: 'description', render: (value: string) => value || '-' },
            {
              title: '操作',
              width: 170,
              render: (_: unknown, record: TagItem) => (
                <div style={{ display: 'inline-flex', gap: 8 }}>
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
      </section>

      <Modal
        title={form.id ? '编辑标签' : '新建标签'}
        visible={editorVisible}
        okText={form.id ? '保存' : '创建'}
        onCancel={() => setEditorVisible(false)}
        onOk={handleSubmit}
        confirmLoading={editorSubmitting}
        width={560}
        style={modalNoDragStyle}
        okButtonProps={{
          size: 'large',
          style: {
            minWidth: 96,
            height: 38,
            fontSize: 14,
            borderRadius: 8,
          },
        }}
        cancelButtonProps={{
          size: 'large',
          style: {
            minWidth: 96,
            height: 38,
            fontSize: 14,
            borderRadius: 8,
          },
        }}
      >
        <div style={{ display: 'grid', gap: 14 }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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

          <div className="color-field" style={{ display: 'grid', gap: 10 }}>
            <span className="field-label" style={{ fontSize: 14, lineHeight: '20px' }}>主色</span>
            <div className="color-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
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
                  width: 78,
                  height: 42,
                  borderRadius: 8,
                  display: 'block',
                }}
              />
            </div>
            <div className="palette" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {TAG_PRIMARY_COLOR_PRESETS.map(color => (
                <button
                  key={color}
                  type="button"
                  className={`palette-item ${isColorActive(form.color, color) ? 'active' : ''}`}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
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

          <div className="color-field" style={{ display: 'grid', gap: 10 }}>
            <span className="field-label" style={{ fontSize: 14, lineHeight: '20px' }}>文字色（可空）</span>
            <div className="color-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
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
                  width: 78,
                  height: 42,
                  borderRadius: 8,
                  display: 'block',
                }}
              />
            </div>
            <div className="palette" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {TAG_TEXT_COLOR_PRESETS.map(color => (
                <button
                  key={color}
                  type="button"
                  className={`palette-item ${isColorActive(form.textColor, color) ? 'active' : ''}`}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
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
                  fontSize: 13,
                  lineHeight: '24px',
                  padding: '0 6px',
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

          <div className="color-field" style={{ display: 'grid', gap: 8 }}>
            <span className="field-label" style={{ fontSize: 14, lineHeight: '20px' }}>
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

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
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
    </OpaquePageContainer>
  );
};

export default TagManagement;
