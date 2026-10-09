import React from 'react';
import { Button, Input, Popover, Tag } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import { ThemeButton } from '@/components/ui/theme-foundation';
import { focusVisibleStyles } from '@/components/ui/theme-foundation-styles';
import { queryLibraryTags, type TagItem } from '../services/tag.api';
import { useDebouncedTagKeyword, useLibraryTagPage } from '../hooks/useLibraryTagPage';
import { tagDimensionLabel } from '../constants/tag-dimensions';

const Selection = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0;
  .semi-tag { max-width: 100%; }
  .semi-tag-content { overflow: hidden; text-overflow: ellipsis; }
`;
const Panel = styled.div`
  width: min(320px, calc(100vw - 40px)); padding: 10px; font-size: 12px;
  color: var(--app-text); background: var(--app-bg-popover); border-radius: 8px;
  .options { height: 190px; overflow: auto; margin: 8px 0; }
  .option { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 4px 6px; border-radius: 5px; cursor: pointer; }
  .option:hover { background: var(--app-hover-bg); }
  .option input { flex-shrink: 0; ${focusVisibleStyles} }
  .name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dimension { color: var(--app-text-secondary); font-size: 11px; }
  .pager { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .empty { padding: 24px 6px; color: var(--app-text-secondary); text-align: center; }
  .error { color: var(--semi-color-danger); }
`;

export interface LibraryTagPickerProps {
  libraryId: number;
  valueIds: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

function ScopedLibraryTagPicker({ libraryId, valueIds, onChange, disabled = false, placeholder = '选择标签' }: LibraryTagPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const keyword = useDebouncedTagKeyword(search);
  const page = useLibraryTagPage({ libraryId, keyword, enabled: true, active: open && !disabled });
  const [selectedTags, setSelectedTags] = React.useState<Map<number, TagItem>>(new Map());
  const [selectedError, setSelectedError] = React.useState('');
  const idsKey = [...new Set(valueIds)].sort((a, b) => a - b).join(',');

  React.useEffect(() => {
    let disposed = false;
    const ids = idsKey ? idsKey.split(',').map(Number) : [];
    if (!ids.length) { setSelectedTags(new Map()); setSelectedError(''); return; }
    // Explicit selected IDs are bounded independently of the searchable catalog.
    const chunks: number[][] = [];
    for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100));
    Promise.all(chunks.map(chunk => queryLibraryTags({ libraryId, ids: chunk, limit: 100 })))
      .then(pages => {
        if (!disposed) {
          setSelectedTags(new Map(pages.flatMap(result => result.entries).map(tag => [tag.id, tag])));
          setSelectedError('');
        }
      })
      .catch((error: unknown) => {
        if (!disposed) setSelectedError(error instanceof Error ? error.message : '标签名称加载失败');
      });
    return () => { disposed = true; };
  }, [libraryId, idsKey]);

  const known = new Map([...selectedTags, ...page.entries.map(tag => [tag.id, tag] as const)]);
  const selected = new Set(valueIds);
  const candidates = page.entries.filter(tag => !tag.deleted && !tag.legacy);
  const toggle = (id: number) => onChange(selected.has(id) ? valueIds.filter(value => value !== id) : [...valueIds, id]);
  const searching = search.trim() !== keyword;

  return (
    <Selection>
      {valueIds.map(id => {
        const tag = known.get(id);
        return <Tag key={id} closable={!disabled} onClose={() => onChange(valueIds.filter(value => value !== id))}
          style={tag ? { backgroundColor: tag.color, color: tag.textColor || '#FFFFFF' } : undefined}>
          {tag?.name || `标签 #${id}`}{tag?.deleted ? '（已删除）' : tag?.legacy ? '（旧标签）' : tag?.enabled === 0 ? '（已停用）' : ''}
        </Tag>;
      })}
      <Popover trigger="click" position="bottomLeft" visible={open && !disabled}
        onVisibleChange={visible => setOpen(visible)} content={(
          <Panel>
            <Input aria-label="搜索标签" placeholder="搜索标签名称" value={search} onChange={setSearch} showClear />
            <div className="options" aria-busy={page.loading || searching}>
              {page.error ? <div className="empty error" role="alert">{page.error}<Button size="small" onClick={page.reload}>重试</Button></div>
                : page.loading || searching ? <div className="empty">正在搜索…</div>
                  : candidates.length === 0 ? <div className="empty">没有匹配的标签</div>
                    : candidates.map(tag => (
                      <label className="option" key={tag.id}>
                        <input type="checkbox" checked={selected.has(tag.id)} onChange={() => toggle(tag.id)} />
                        <span className="name" title={tag.name}>{tag.name}</span>
                        <span className="dimension">{tagDimensionLabel(tag.dimension)}</span>
                      </label>
                    ))}
            </div>
            <div className="pager">
              <Button size="small" disabled={page.loading || searching || page.pageIndex === 0} onClick={page.previous}>上一页</Button>
              <span>第 {page.pageIndex + 1} 页</span>
              <Button size="small" disabled={page.loading || searching || !page.hasMore} onClick={page.next}>下一页</Button>
            </div>
          </Panel>
        )}>
        <ThemeButton $variant="outline" disabled={disabled} aria-label={placeholder}>{placeholder}</ThemeButton>
      </Popover>
      {selectedError && <span role="alert">{selectedError}</span>}
    </Selection>
  );
}

export function LibraryTagPicker(props: LibraryTagPickerProps) {
  return <ScopedLibraryTagPicker key={props.libraryId} {...props} />;
}

export default LibraryTagPicker;
