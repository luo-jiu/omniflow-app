import { useContext, useEffect, useId, useRef, useState } from 'react';
import { AppearanceControlContext, AppearanceViewContext } from './appearance.context';
import { BUILT_IN_COLOR_THEMES, BUILT_IN_ICON_THEMES } from './built-in-themes';
import type { ThemeOperationToken, ThemeSelection } from './theme-state';
import styled from 'styled-components';
import { buttonStyles, focusVisibleStyles, inputStyles, textToneStyles } from '@/components/ui/theme-foundation-styles';

const Panel = styled.section`
  padding: 16px 0; border-bottom: 1px solid var(--app-border); font-size: 12px; line-height: 1.5;
  h3 { font-size: 13px; margin-bottom: 10px; }
  .appearance-fields { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; }
  .appearance-field { flex: 1 1 180px; min-width: 0; }
  label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  select { ${inputStyles} min-height: 28px; padding: 3px 10px; }
  button { ${buttonStyles('secondary')} min-height: 28px; padding: 3px 10px; border: 1px solid transparent; border-radius: var(--app-radius-small); cursor: pointer; }
  input[type=color] { ${focusVisibleStyles} }
  .appearance-actions { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  p { ${textToneStyles('secondary')} font-size: 12px; line-height: 1.5; margin: 8px 0; }
  [role=alert] { color: var(--app-danger-text); }
`;
export default function AppearanceSettings({ onOpenPreview }: { onOpenPreview?: () => void }) {
  const controls = useContext(AppearanceControlContext);
  const view = useContext(AppearanceViewContext);
  const activePreview = useRef<ThemeOperationToken | null>(null);
  const descriptionId = useId();
  const [error, setError] = useState('');
  const cancel = controls?.cancel;
  useEffect(() => () => { if (activePreview.current) cancel?.(activePreview.current); }, [cancel]);
  if (!controls || !view) return null;
  const selected = controls.selection;
  const missingColor = !BUILT_IN_COLOR_THEMES.some(item => item.id === selected.colorThemeId);
  const missingIcons = !BUILT_IN_ICON_THEMES.some(item => item.id === selected.iconThemeId);
  const preview = (selection: ThemeSelection) => {
    try { activePreview.current = controls.preview(selection); setError(''); }
    catch { setError('外观设置无效，请检查后重试。'); }
  };
  return <Panel aria-label="外观设置">
    <h3>外观</h3>
    <p>明暗模式在下方「界面主题」中切换。</p>
    <div className="appearance-fields">
      <div className="appearance-field">
        <label>界面配色<select aria-label="颜色主题" aria-describedby={`${descriptionId}-colors`} value={selected.colorThemeId} onChange={event => preview({ ...selected, colorThemeId: event.target.value })}>
          {missingColor && <option value={selected.colorThemeId}>不可用的主题</option>}
          {BUILT_IN_COLOR_THEMES.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        <p id={`${descriptionId}-colors`}>切换界面背景、按钮和选中状态等颜色。</p>
      </div>
      <div className="appearance-field">
        <label>目录图标<select aria-label="目录图标" aria-describedby={`${descriptionId}-icons`} value={selected.iconThemeId} onChange={event => preview({ ...selected, iconThemeId: event.target.value })}>
          {missingIcons && <option value={selected.iconThemeId}>不可用的图标包</option>}
          {BUILT_IN_ICON_THEMES.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        <p id={`${descriptionId}-icons`}>更换文件夹图标；普通文件仍使用原图标。</p>
      </div>
      <div className="appearance-field">
        <label>强调色<input type="color" aria-label="自定义强调色" aria-describedby={`${descriptionId}-accent`} value={/^#[\da-f]{6}$/i.test(view.colors['accent.default']) ? view.colors['accent.default'] : '#345847'} onChange={event => preview({ ...selected, overrides: { ...selected.overrides, colors: { ...selected.overrides?.colors, 'accent.default': event.target.value, 'text.link': event.target.value, 'focus.border': event.target.value } } })} /></label>
        <p id={`${descriptionId}-accent`}>修改主色、链接和焦点边框；悬停等颜色仍随配色。</p>
      </div>
    </div>
    {(missingColor || missingIcons) && <p role="status">已选外观不可用，当前使用内置外观显示。你可以重新选择或恢复默认。</p>}
    <div className="appearance-actions">
      <button disabled={controls.phase !== 'preview'} onClick={() => {
        if (!activePreview.current) return;
        if (controls.confirm(activePreview.current)) { activePreview.current = null; setError(''); }
        else setError('保存失败，已保留上次保存的外观。请重试。');
      }}>保存外观</button>
      <button disabled={controls.phase !== 'preview'} onClick={() => { if (activePreview.current) controls.cancel(activePreview.current); activePreview.current = null; setError(''); }}>取消预览</button>
      <button title="预览默认配色和图标，保存后保留" onClick={() => preview({ ...selected, colorThemeId: 'omniflow.default', iconThemeId: 'omniflow.material', overrides: {} })}>恢复默认</button>
    </div>
    <p>{controls.phase === 'preview' ? '正在预览，保存到本机当前账号；取消或离开此页会恢复上次保存的外观。' : '修改或恢复默认后立即预览，保存后在本机当前账号保留。'}</p>
    {onOpenPreview && <div className="appearance-actions">
      <button type="button" onClick={onOpenPreview}>主题预览</button>
      <span>集中查看背景、文字、按钮和归档选中效果。</span>
    </div>}
    {error && <p role="alert">{error}</p>}
  </Panel>;
}
