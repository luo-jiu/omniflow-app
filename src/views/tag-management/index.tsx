import React from 'react';
import styled from 'styled-components';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, ColorPicker, Input, InputNumber, Select, Switch, TextArea, Toast } from '@douyinfe/semi-ui';
import { IconChevronLeft, IconDelete, IconEdit } from '@douyinfe/semi-icons';
import OpaquePageContainer from '@/components/OpaquePageContainer';
import { CompactModal } from '@/components/ui/compact-modal';
import { openCompactConfirm } from '@/components/ui/compact-confirm';
import { ThemeButton, ThemeSurface, ThemeText } from '@/components/ui/theme-foundation';
import { focusVisibleStyles } from '@/components/ui/theme-foundation-styles';
import { fetchRepositories, type Library } from '@/features/file-explorer/services/file.api';
import { createLibraryTag, deleteLibraryTag, updateLibraryTag, type LibraryTagPayload, type TagItem } from '@/features/tag-management/services/tag.api';
import { useDebouncedTagKeyword, useLibraryTagPage } from '@/features/tag-management/hooks/useLibraryTagPage';
import { TAG_DIMENSION_OPTIONS, tagDimensionLabel } from '@/features/tag-management/constants/tag-dimensions';
import {
  TAG_COLOR_TONE_OPTIONS, DEFAULT_TAG_COLOR_TONE, getTagPrimaryColorPresets,
  normalizeTagColorTone, TAG_TEXT_COLOR_PRESETS, type TagColorTone,
} from '@/features/tag-management/constants/tag-color-presets';

const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_TONE_KEY = 'tag-management:primary-color-tone:v1';
const DEFAULT_FORM: LibraryTagPayload = { name: '', dimension: 'custom', color: '#4F8CFF', textColor: '', description: '', sortOrder: 0, enabled: 1 };

const Wrapper = styled.div<{ $embedded: boolean }>`
  display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0;
  padding: ${({ $embedded }) => $embedded ? '0' : '28px 32px 24px'};
  color: var(--app-text); font-size: 12px; -webkit-app-region: no-drag;
  .heading { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  h1 { margin: 0; font-size: 22px; line-height: 1.3; }
  .library-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
  .library-select { width: 240px; }
  .back { width: 28px; height: 28px; padding: 0; }
  .empty { display: grid; place-content: center; flex: 1; color: var(--app-text-secondary); }
  [role=alert] { color: var(--app-danger-text); }
`;
const Catalog = styled(ThemeSurface)`
  display: flex; flex-direction: column; flex: 1; min-height: 0;
  border: 1px solid var(--app-border); border-radius: 8px; overflow: hidden;
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px; border-bottom: 1px solid var(--app-border); }
  .search { flex: 1; min-width: 160px; max-width: 360px; }
  .category { width: 150px; }
  .table-scroll { flex: 1; min-height: 180px; overflow: auto; }
  table { width: 100%; min-width: 610px; border-collapse: collapse; table-layout: fixed; }
  th { text-align: left; color: var(--app-text-secondary); font-weight: 500; background: var(--app-bg-raised); }
  th, td { height: 42px; padding: 7px 10px; border-bottom: 1px solid var(--app-border); vertical-align: middle; }
  td .truncate { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 9px; border-radius: 999px; vertical-align: middle; }
  .actions { display: flex; gap: 4px; }
  .actions button { min-width: 28px; padding: 3px; }
  .state { display: flex; align-items: center; justify-content: center; gap: 8px; height: 160px; color: var(--app-text-secondary); }
  .pager { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--app-border); }
  .pager-actions { display: flex; align-items: center; gap: 8px; }
`;
const Editor = styled.div`
  display: grid; gap: 12px; font-size: 12px; border: 0; margin: 0; padding: 0; min-width: 0;
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .field { display: grid; gap: 6px; min-width: 0; }
  .field-label { color: var(--app-text-secondary); }
  .color-card { display: grid; gap: 9px; padding: 10px; border: 1px solid var(--app-border); border-radius: 8px; background: var(--app-bg-raised); align-content: start; }
  .color-row { display: grid; grid-template-columns: minmax(0,1fr) 28px; align-items: center; gap: 8px; }
  .color-picker { width: 28px !important; height: 28px !important; border-radius: 6px; overflow: hidden; border: 1px solid var(--app-border); }
  .palette { display: flex; flex-wrap: wrap; gap: 7px; }
  .swatch { width: 22px; height: 22px; padding: 0; border-radius: 999px; border: 1px solid var(--app-border); cursor: pointer; ${focusVisibleStyles} }
  .swatch[aria-pressed=true] { box-shadow: 0 0 0 2px var(--app-focus-border); }
  .tone { display: flex; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid var(--app-border); }
  .preview { display: inline-block; padding: 4px 10px; border-radius: 999px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .enabled { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  @media (max-width: 620px) { .grid { grid-template-columns: 1fr; } }
`;

function storedTone(): TagColorTone {
  try { return normalizeTagColorTone(window.localStorage.getItem(COLOR_TONE_KEY)); }
  catch { return DEFAULT_TAG_COLOR_TONE; }
}
function safeColor(value: string | null | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value.trim()) ? value.trim().toUpperCase() : fallback;
}
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
function normalizeForm(form: LibraryTagPayload): LibraryTagPayload {
  return { ...form, name: form.name.trim(), dimension: form.dimension?.trim().toLowerCase() || 'custom',
    color: form.color.trim().toUpperCase(), textColor: form.textColor?.trim().toUpperCase() || '',
    description: form.description?.trim() || '', sortOrder: form.sortOrder ?? 0, enabled: form.enabled ?? 1 };
}

function LibraryTagCatalog({ libraryId }: { libraryId: number }) {
  const [search, setSearch] = React.useState('');
  const keyword = useDebouncedTagKeyword(search);
  const [dimension, setDimension] = React.useState('');
  const page = useLibraryTagPage({ libraryId, keyword, dimension });
  const [editor, setEditor] = React.useState<{ id?: number; form: LibraryTagPayload; baseline?: LibraryTagPayload } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [pending, setPending] = React.useState<Set<number>>(new Set());
  const [tone, setTone] = React.useState(storedTone);
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const form = editor?.form || DEFAULT_FORM;
  const searching = search.trim() !== keyword;
  const edit = (patch: Partial<LibraryTagPayload>) => setEditor(value => value ? { ...value, form: { ...value.form, ...patch } } : value);
  const changeTone = (value: TagColorTone) => {
    setTone(value);
    try { window.localStorage.setItem(COLOR_TONE_KEY, value); } catch { /* Editor preference is optional. */ }
  };
  const save = async () => {
    if (!editor || saving) return;
    if (!form.name.trim()) { Toast.warning('请填写标签名称'); return; }
    if (Array.from(form.description || '').length > 255) { Toast.warning('标签说明不能超过 255 个字符'); return; }
    if (!HEX_COLOR.test(form.color.trim()) || (form.textColor && !HEX_COLOR.test(form.textColor.trim()))) {
      Toast.warning('颜色需使用 #RRGGBB 或 #RRGGBBAA'); return;
    }
    setSaving(true);
    const payload = normalizeForm(form);
    try {
      if (editor.id && editor.baseline) {
        const baseline = normalizeForm(editor.baseline);
        const patch = Object.fromEntries(Object.entries(payload).filter(([key, value]) => value !== baseline[key as keyof LibraryTagPayload]));
        if (Object.keys(patch).length) await updateLibraryTag(libraryId, editor.id, patch);
      }
      else await createLibraryTag(libraryId, payload);
      if (active.current) { setEditor(null); page.reload(); Toast.success(editor.id ? '标签已保存' : '标签已创建'); }
    } catch (error) { if (active.current) Toast.error(errorMessage(error, '保存标签失败')); }
    finally { if (active.current) setSaving(false); }
  };
  const toggleEnabled = async (tag: TagItem, checked: boolean) => {
    if (pending.has(tag.id) || tag.legacy || tag.deleted) return;
    setPending(value => new Set(value).add(tag.id));
    try {
      await updateLibraryTag(libraryId, tag.id, { enabled: checked ? 1 : 0 });
      if (active.current) page.reload();
    } catch (error) { if (active.current) Toast.error(errorMessage(error, '更新标签失败')); }
    finally { if (active.current) setPending(value => { const next = new Set(value); next.delete(tag.id); return next; }); }
  };
  const openEdit = (tag: TagItem) => {
    if (tag.legacy || tag.deleted) return;
    const baseline = normalizeForm({ name: tag.name, dimension: tag.dimension, color: tag.color,
      textColor: tag.textColor, description: tag.description, sortOrder: tag.sortOrder, enabled: tag.enabled });
    setEditor({ id: tag.id, form: { ...baseline }, baseline });
  };
  const remove = (tag: TagItem) => {
    if (tag.legacy || tag.deleted) return;
    openCompactConfirm({
    title: '删除标签', content: `删除“${tag.name}”？已有资源上的关联会保留为已删除标签，可单独移除。`,
    okText: '删除', cancelText: '取消', okType: 'danger',
    onOk: async () => {
      if (!active.current) return;
      try { await deleteLibraryTag(libraryId, tag.id); if (active.current) page.reload(); }
      catch (error) { if (active.current) Toast.error(errorMessage(error, '删除标签失败')); }
    },
    });
  };

  return <>
    <Catalog $surface="panel">
      <div className="toolbar">
        <Input className="search" aria-label="搜索标签名称" placeholder="搜索标签名称" value={search} onChange={setSearch} showClear />
        <Select className="category" aria-label="按分类筛选" value={dimension || undefined} placeholder="全部分类" showClear filter allowCreate
          optionList={TAG_DIMENSION_OPTIONS} onChange={value => setDimension(value ? String(value) : '')} />
        <ThemeButton $variant="outline" onClick={() => setEditor({ form: { ...DEFAULT_FORM, dimension: dimension || 'custom' } })}>新建标签</ThemeButton>
        <ThemeButton $variant="quiet" disabled={page.loading} onClick={page.reload}>刷新</ThemeButton>
      </div>
      <div className="table-scroll" aria-busy={page.loading || searching}>
        <table>
          <thead><tr><th style={{ width: '24%' }}>标签</th><th style={{ width: '16%' }}>分类</th><th>说明</th><th style={{ width: 56 }}>排序</th><th style={{ width: 60 }}>启用</th><th style={{ width: 78 }}>操作</th></tr></thead>
          <tbody>{!searching && page.entries.map(tag => <tr key={tag.id}>
            <td><span className="label" title={tag.name} style={{ backgroundColor: tag.color, color: tag.textColor || '#FFFFFF' }}>{tag.name}{tag.legacy ? '（旧标签）' : ''}</span></td>
            <td><span className="truncate" title={tagDimensionLabel(tag.dimension)}>{tagDimensionLabel(tag.dimension)}</span></td>
            <td><span className="truncate" title={tag.description || ''}>{tag.description || '—'}</span></td>
            <td>{tag.sortOrder}</td>
            <td><Switch aria-label={`启用 ${tag.name}`} size="small" checked={tag.enabled === 1} loading={pending.has(tag.id)} disabled={pending.has(tag.id) || tag.legacy || tag.deleted} onChange={checked => void toggleEnabled(tag, checked)} /></td>
            <td><div className="actions">
              <ThemeButton $variant="quiet" aria-label={`编辑 ${tag.name}`} disabled={pending.has(tag.id) || tag.legacy || tag.deleted} onClick={() => openEdit(tag)}><IconEdit /></ThemeButton>
              <ThemeButton $variant="quiet" aria-label={`删除 ${tag.name}`} disabled={pending.has(tag.id) || tag.legacy || tag.deleted} onClick={() => remove(tag)}><IconDelete /></ThemeButton>
            </div></td>
          </tr>)}</tbody>
        </table>
        {page.error ? <div className="state" role="alert">{page.error}<Button size="small" onClick={page.reload}>重试</Button></div>
          : page.loading || searching ? <div className="state">正在加载…</div>
            : !page.entries.length ? <div className="state">{keyword || dimension ? '没有匹配的标签' : '这个资料库还没有标签'}</div> : null}
      </div>
      <div className="pager">
        <ThemeText $tone="secondary">本页 {page.entries.length} 个标签</ThemeText>
        <div className="pager-actions">
          <ThemeButton $variant="quiet" disabled={page.loading || searching || page.pageIndex === 0} onClick={page.previous}>上一页</ThemeButton>
          <span>第 {page.pageIndex + 1} 页</span>
          <ThemeButton $variant="quiet" disabled={page.loading || searching || !page.hasMore} onClick={page.next}>下一页</ThemeButton>
        </div>
      </div>
    </Catalog>
    <CompactModal width={560} title={editor?.id ? '编辑标签' : '新建标签'} visible={Boolean(editor)}
      onCancel={() => { if (!saving) setEditor(null); }} onOk={() => void save()} confirmLoading={saving}
      okText={editor?.id ? '保存' : '创建'} cancelText="取消" closeOnEsc={!saving} maskClosable={!saving}>
      <Editor as="fieldset" disabled={saving}>
        <div className="grid">
          <label className="field"><span className="field-label">标签名称</span><Input aria-label="标签名称" value={form.name} maxLength={64} onChange={name => edit({ name })} placeholder="例如：日语 / 作者名 / 治愈系" /></label>
          <label className="field"><span className="field-label">分类（可选）</span><Select aria-label="标签分类" value={form.dimension || 'custom'} filter allowCreate showClear
            optionList={TAG_DIMENSION_OPTIONS.some(option => option.value === form.dimension) ? TAG_DIMENSION_OPTIONS : [...TAG_DIMENSION_OPTIONS, { value: form.dimension || 'custom', label: form.dimension || '未分类' }]}
            onChange={value => edit({ dimension: value ? String(value) : 'custom' })} placeholder="选择或输入分类" /></label>
        </div>
        <div className="grid">
          {(['color', 'textColor'] as const).map(field => {
            const primary = field === 'color';
            const presets = primary ? getTagPrimaryColorPresets(tone) : TAG_TEXT_COLOR_PRESETS;
            const value = form[field] || '';
            const fallback = primary ? '#4F8CFF' : '#FFFFFF';
            return <section className="color-card" key={field}>
              <span>{primary ? '主色' : '文字色'}</span>
              <div className="color-row">
                <Input aria-label={primary ? '标签主色' : '标签文字色'} value={value} maxLength={9} placeholder={primary ? fallback : '留空使用白字'} onChange={color => edit({ [field]: color })} />
                <ColorPicker className="color-picker" usePopover alpha value={ColorPicker.colorStringToValue(safeColor(value, fallback))}
                  onChange={color => edit({ [field]: color.hex.toUpperCase() })} width={320} height={200} />
              </div>
              <div className="palette">{presets.map(color => <button type="button" key={color} className="swatch"
                aria-label={`${primary ? '主色' : '文字色'} ${color}`} aria-pressed={value.toUpperCase() === color.toUpperCase()}
                style={{ backgroundColor: color }} onClick={() => edit({ [field]: color })} />)}</div>
              {primary && <div className="tone"><ThemeText $tone="secondary">明暗</ThemeText>{TAG_COLOR_TONE_OPTIONS.map(option => <button type="button" key={option.value}
                className="swatch" style={{ backgroundColor: option.color }} aria-label={`明暗 ${option.label}`} aria-pressed={tone === option.value} onClick={() => changeTone(option.value)} />)}</div>}
            </section>;
          })}
        </div>
        <div><span className="preview" style={{ backgroundColor: safeColor(form.color, '#4F8CFF'), color: safeColor(form.textColor, '#FFFFFF') }}>{form.name.trim() || '标签预览'}</span></div>
        <label className="field"><span className="field-label">说明（可选）</span><TextArea aria-label="标签说明" value={form.description || ''} maxLength={255} getValueLength={value => Array.from(value).length} rows={2} onChange={description => edit({ description: Array.from(description).slice(0, 255).join('') })} /></label>
        <div className="grid">
          <label className="field"><span className="field-label">排序</span><InputNumber aria-label="标签排序" value={form.sortOrder} min={-99999} max={99999} precision={0} onNumberChange={value => edit({ sortOrder: Number(value) || 0 })} /></label>
          <label className="enabled">启用<Switch checked={form.enabled !== 0} onChange={checked => edit({ enabled: checked ? 1 : 0 })} /></label>
        </div>
      </Editor>
    </CompactModal>
  </>;
}

type TagManagementProps = { embedded?: boolean; onBack?: () => void };
export default function TagManagement({ embedded = false, onBack }: TagManagementProps) {
  const navigate = useNavigate();
  const params = useParams();
  const routeLibraryId = Number(params.id);
  const initialLibraryId = Number.isSafeInteger(routeLibraryId) && routeLibraryId > 0 ? routeLibraryId : undefined;
  const [libraryId, setLibraryId] = React.useState<number | undefined>(initialLibraryId);
  const [libraries, setLibraries] = React.useState<Library[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [moreLibraries, setMoreLibraries] = React.useState(false);
  const libraryRequest = React.useRef(0);
  React.useEffect(() => setLibraryId(initialLibraryId), [initialLibraryId]);
  React.useEffect(() => {
    const sequence = ++libraryRequest.current;
    fetchRepositories(undefined, 50).then(items => {
      if (sequence !== libraryRequest.current) return;
      setLibraries(items); setMoreLibraries(items.length === 50);
    }).catch((reason: unknown) => { if (sequence === libraryRequest.current) setError(errorMessage(reason, '加载资料库失败')); })
      .finally(() => { if (sequence === libraryRequest.current) setLoading(false); });
    return () => { libraryRequest.current += 1; };
  }, []);
  const loadMoreLibraries = async () => {
    if (loading) return;
    const sequence = ++libraryRequest.current;
    setLoading(true); setError('');
    try {
      const items = await fetchRepositories(libraries[libraries.length - 1]?.id, 50);
      if (sequence !== libraryRequest.current) return;
      setLibraries(existing => [...new Map([...existing, ...items].map(library => [library.id, library])).values()]);
      setMoreLibraries(items.length === 50);
    } catch (reason) { if (sequence === libraryRequest.current) setError(errorMessage(reason, '加载资料库失败')); }
    finally { if (sequence === libraryRequest.current) setLoading(false); }
  };
  const libraryOptions = libraries.map(library => ({ value: library.id, label: library.name }));
  if (libraryId && !libraryOptions.some(option => option.value === libraryId)) {
    libraryOptions.unshift({ value: libraryId, label: `当前资料库 #${libraryId}` });
  }
  const content = <Wrapper $embedded={embedded}>
    <div className="heading"><ThemeButton className="back" $variant="quiet" aria-label="返回设置" onClick={() => onBack ? onBack() : navigate('/settings')}><IconChevronLeft /></ThemeButton><h1>标签管理</h1></div>
    <div className="library-row">
      <Select className="library-select" aria-label="选择资料库" value={libraryId} loading={loading} placeholder="选择资料库" filter
        optionList={libraryOptions} onChange={value => setLibraryId(Number(value) || undefined)} />
      {(moreLibraries || error) && <ThemeButton $variant="quiet" disabled={loading} onClick={() => void loadMoreLibraries()}>{error ? '重试' : '更多资料库'}</ThemeButton>}
      <ThemeText $tone="secondary">标签属于资料库，可用于其中的文件、目录和作品。</ThemeText>
    </div>
    {error && <div role="alert">{error}</div>}
    {libraryId ? <LibraryTagCatalog key={libraryId} libraryId={libraryId} /> : <div className="empty">选择资料库以管理标签</div>}
  </Wrapper>;
  return embedded ? content : <OpaquePageContainer>{content}</OpaquePageContainer>;
}
