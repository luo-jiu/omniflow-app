import { useContext, useEffect, useRef, useState } from 'react';
import { AppearanceControlContext, AppearanceViewContext } from './appearance.context';
import { BUILT_IN_COLOR_THEMES, BUILT_IN_ICON_THEMES } from './built-in-themes';
import type { ThemeOperationToken, ThemeSelection } from './theme-state';
import styled from 'styled-components';

const Panel = styled.section`
  padding: 16px 0; border-bottom: 1px solid var(--app-border);
  h3 { font-size: 13px; margin-bottom: 10px; }
  .appearance-fields { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  select, button { min-height: 28px; padding: 3px 10px; border: 1px solid var(--app-border-strong); border-radius: var(--app-radius-small); background: var(--app-panel); color: var(--app-text); }
  button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--app-focus-border); outline-offset: 2px; }
  .appearance-actions { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
  p { font-size: 12px; color: var(--app-text-secondary); margin: 8px 0; }
  [role=alert] { color: var(--app-danger-text); }
`;
export default function AppearanceSettings() {
  const controls = useContext(AppearanceControlContext);
  const view = useContext(AppearanceViewContext);
  const activePreview = useRef<ThemeOperationToken | null>(null);
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
    <div className="appearance-fields">
      <label>配色<select aria-label="颜色主题" value={selected.colorThemeId} onChange={event => preview({ ...selected, colorThemeId: event.target.value })}>
        {missingColor && <option value={selected.colorThemeId}>不可用的主题</option>}
        {BUILT_IN_COLOR_THEMES.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <label>图标<select aria-label="图标包" value={selected.iconThemeId} onChange={event => preview({ ...selected, iconThemeId: event.target.value })}>
        {missingIcons && <option value={selected.iconThemeId}>不可用的图标包</option>}
        {BUILT_IN_ICON_THEMES.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <label>强调色<input type="color" aria-label="自定义强调色" value={/^#[\da-f]{6}$/i.test(view.colors['accent.default']) ? view.colors['accent.default'] : '#345847'} onChange={event => preview({ ...selected, overrides: { ...selected.overrides, colors: { ...selected.overrides?.colors, 'accent.default': event.target.value, 'text.link': event.target.value, 'focus.border': event.target.value } } })} /></label>
    </div>
    {(missingColor || missingIcons) && <p role="status">已选外观不可用，当前使用内置外观显示。你可以重新选择或恢复默认。</p>}
    <div className="appearance-actions">
      <button disabled={controls.phase !== 'preview'} onClick={() => {
        if (!activePreview.current) return;
        if (controls.confirm(activePreview.current)) { activePreview.current = null; setError(''); }
        else setError('保存失败，已保留上次保存的外观。请重试。');
      }}>保存外观</button>
      <button disabled={controls.phase !== 'preview'} onClick={() => { if (activePreview.current) controls.cancel(activePreview.current); activePreview.current = null; setError(''); }}>取消预览</button>
      <button onClick={() => preview({ ...selected, colorThemeId: 'omniflow.default', iconThemeId: 'omniflow.material', overrides: {} })}>恢复默认</button>
    </div>
    <p>{controls.phase === 'preview' ? '正在预览，保存后保留；离开此页会取消预览。' : '配色与图标可独立选择，保存在本机当前账号下。'}</p>
    {error && <p role="alert">{error}</p>}
  </Panel>;
}
