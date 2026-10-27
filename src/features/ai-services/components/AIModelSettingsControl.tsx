import React from 'react';
import { InputNumber, Popover } from '@douyinfe/semi-ui';
import styled, { keyframes } from 'styled-components';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { getAppPopupContainer } from '@/utils/popup-container';
import { getAIServiceModelReasoningEfforts } from '@/shared/ai-model-catalog';
import type { AIServiceProviderType, AIServiceReasoningEffort } from '../ai-service.types';
import ReasoningEffortSlider from './ReasoningEffortSlider';
import ReasoningStarfield from './ReasoningStarfield';
import { REASONING_EFFORT_LABELS } from './reasoning-effort-labels';
import { resolveModelPickerPlacement, type ModelPickerPlacement } from './model-picker-placement';

const Trigger = styled.button`
  min-width: 0; max-width: 260px; height: 30px; padding: 0 8px;
  border: 0; border-radius: var(--app-radius-large); background: transparent;
  color: var(--app-text-muted); display: flex; align-items: center; gap: 5px; cursor: pointer;
  &:hover:not(:disabled), &:focus-visible:not(:disabled), &[aria-expanded='true'] { background: var(--app-hover-bg); color: var(--app-text); }
  &:focus-visible { outline: 2px solid var(--semi-color-focus-border); outline-offset: -2px; }
  &:disabled { cursor: default; opacity: .45; }
  .model-name { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .reasoning-label { flex: none; color: var(--app-text-muted); font-size: 11px; }
  svg { width: 12px; height: 12px; flex: none; }
`;
const enter = keyframes`from { opacity: 0; transform: translateY(3px) scale(.98); } to { opacity: 1; transform: none; }`;
const Panel = styled.div<{ $height: number; $placement: ModelPickerPlacement }>`
  --picker-maximum-color: color-mix(in srgb, #a574ee 70%, var(--app-text));
  --model-picker-available-height: ${({ $placement }) => $placement.maxHeight}px;
  width: ${({ $placement }) => $placement.width}px; max-width: calc(100vw - 24px); height: ${({ $height }) => $height}px;
  max-height: var(--model-picker-available-height); box-sizing: border-box; overflow: hidden;
  padding: 10px 12px; position: relative; border: 1px solid var(--app-border-strong); border-radius: 16px;
  background: var(--app-bg-popover); color: var(--app-text); box-shadow: var(--app-shadow);
  transition: height 180ms cubic-bezier(.23, 1, .32, 1); animation: ${enter} 180ms cubic-bezier(.23, 1, .32, 1);
  button { font: inherit; color: inherit; border: 0; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--semi-color-focus-border); outline-offset: -2px; }
  button:disabled { cursor: default; opacity: .4; }
  .picker-heading { height: 38px; display: flex; flex-direction: column; align-items: center; }
  .picker-effort { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--semi-color-primary); }
  .picker-effort[data-maximum='true'] { color: var(--picker-maximum-color); }
  .picker-model { display: flex; align-items: center; justify-content: center; gap: 3px; max-width: calc(100% - 40px); min-height: 18px; padding: 0 3px; border-radius: 4px; background: transparent; color: var(--app-text-muted); font-size: 12px; line-height: 18px; }
  .picker-model span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picker-model:hover { color: var(--app-text); }
  .picker-model svg { width: 10px; height: 10px; flex: none; }
  .picker-reset { position: absolute; right: 8px; top: 8px; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; background: transparent; color: var(--app-text-muted); }
  .picker-reset:hover:not(:disabled) { background: var(--app-hover-bg); color: var(--app-text); }
  .picker-reset svg { width: 14px; height: 14px; }
  .picker-fast { position: absolute; left: 8px; top: 8px; width: 24px; height: 24px; display: grid; place-items: center; background: transparent; color: var(--app-text-muted); border-radius: 6px; }
  .picker-fast svg { width: 14px; height: 14px; }
  .picker-fast:hover, .picker-fast[aria-pressed='true'] { background: var(--app-hover-bg); }
  .picker-fast[aria-pressed='true'] { color: var(--picker-maximum-color); }
  .picker-fast[aria-pressed='true'] svg { fill: currentColor; }
  .picker-slider { margin-top: 8px; }
  .picker-context { display: flex; align-items: center; justify-content: space-between; height: 30px; margin-top: 8px; border-top: 1px solid var(--app-border); padding-top: 6px; box-sizing: border-box; font-size: 12px; }
  .picker-context .semi-input-number { width: 64px; }
  .picker-models-header { height: 28px; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 12px; font-weight: 500; }
  .picker-models-header > span { flex: 1; }
  .picker-back, .picker-refresh { display: grid; place-items: center; width: 24px; height: 24px; background: transparent; border-radius: 6px; }
  .picker-back:hover, .picker-refresh:hover:not(:disabled) { background: var(--app-hover-bg); }
  .picker-back svg, .picker-refresh svg { width: 14px; height: 14px; }
  @media (prefers-reduced-motion: reduce) { animation: none; transition: none; }
`;
const ModelList = styled.div`
  max-height: min(240px, calc(var(--model-picker-available-height) - 54px)); overflow: auto; display: flex; flex-direction: column; gap: 2px;
  ${workspaceScrollbarStyles}
  .model-option { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; flex: none; padding: 4px 6px; background: transparent; border-radius: 6px; font-size: 12px; line-height: 20px; text-align: left; }
  .model-option span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-option svg { width: 14px; height: 14px; flex: none; }
  .model-option:hover, .model-option:focus-visible { background: var(--app-hover-bg); }
  .model-option[aria-checked='true'] { background: var(--semi-color-primary-light-default); }
  .model-empty { min-height: 32px; display: flex; align-items: center; padding: 0 6px; color: var(--app-text-muted); font-size: 12px; }
`;

function Chevron({ direction = 'down' }: { direction?: 'down' | 'right' | 'left' }) {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={direction === 'down' ? 'M4 6l4 4 4-4' : direction === 'left' ? 'M10 4L6 8l4 4' : 'M6 4l4 4-4 4'} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export interface AIModelSettingsControlProps {
  availableModels: string[];
  contextWindow?: { onChange: (value: number) => void; value: number };
  disabled?: boolean;
  fastMode?: boolean;
  fastModeAvailable?: boolean;
  loadingModels: boolean;
  model: string;
  modelSourceKey: string;
  onLoadModels: (options?: { forceRefresh?: boolean }) => Promise<boolean>;
  onOpenSettings?: () => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: AIServiceReasoningEffort) => void;
  onFastModeChange?: (enabled: boolean) => void;
  providerType?: AIServiceProviderType;
  reasoningEffort: AIServiceReasoningEffort;
}

export default function AIModelSettingsControl({ availableModels, contextWindow, disabled = false, fastMode = false, fastModeAvailable = false, loadingModels, model, modelSourceKey,
  onLoadModels, onOpenSettings, onModelChange, onReasoningEffortChange, onFastModeChange, providerType, reasoningEffort }: AIModelSettingsControlProps) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<'settings' | 'models'>('settings');
  const [preview, setPreview] = React.useState<AIServiceReasoningEffort | null>(null);
  const [placement, setPlacement] = React.useState<ModelPickerPlacement>({ position: 'top', spacingX: 0, width: 256, maxHeight: 600 });
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const focusIntent = React.useRef<'slider' | 'models' | 'model-button' | null>(null);
  const expectedModelRef = React.useRef<string | null>(null);
  const menuId = React.useId();
  const modelLoadStateRef = React.useRef<'idle' | 'loading' | 'loaded'>('idle');
  const modelLoadGenerationRef = React.useRef(0);
  const reasoningOptions = React.useMemo(() => getAIServiceModelReasoningEfforts(providerType || 'local', model), [model, providerType]);
  const selectedEffort = providerType && !reasoningOptions.includes(reasoningEffort) ? 'auto' : reasoningEffort;
  React.useEffect(() => { if (selectedEffort !== reasoningEffort) onReasoningEffortChange(selectedEffort); }, [onReasoningEffortChange, reasoningEffort, selectedEffort]);
  const displayedEffort = preview ?? selectedEffort;
  const maximum = reasoningOptions.length > 1 && displayedEffort === reasoningOptions[reasoningOptions.length - 1];
  const modelOptions = React.useMemo(() => [...availableModels].sort((left, right) => right.localeCompare(left, 'en', { numeric: true, sensitivity: 'base' })), [availableModels]);
  const visible = workspaceActive && !disabled && open;
  const updatePlacement = React.useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect?.();
    if (!anchor || typeof window === 'undefined') return;
    const overlay = getAppPopupContainer().getBoundingClientRect();
    const next = resolveModelPickerPlacement(anchor, { width: window.innerWidth, height: window.innerHeight },
      overlay.width > 0 && overlay.height > 0 ? overlay : undefined);
    setPlacement(current => current.position === next.position && current.spacingX === next.spacingX
      && current.width === next.width && current.maxHeight === next.maxHeight ? current : next);
  }, []);
  React.useLayoutEffect(() => {
    if (!visible || typeof window === 'undefined') return;
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updatePlacement);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    observer?.observe(getAppPopupContainer());
    return () => { window.removeEventListener('resize', updatePlacement); window.removeEventListener('scroll', updatePlacement, true); observer?.disconnect(); };
  }, [updatePlacement, visible]);
  const close = React.useCallback((restoreFocus = false) => {
    setOpen(false); setView('settings'); setPreview(null); focusIntent.current = null; expectedModelRef.current = null;
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  React.useEffect(() => { close(); }, [close, disabled, workspaceActive, modelSourceKey, providerType]);
  React.useEffect(() => {
    if (expectedModelRef.current === model) { expectedModelRef.current = null; return; }
    close();
  }, [close, model]);
  React.useEffect(() => {
    modelLoadGenerationRef.current += 1; modelLoadStateRef.current = 'idle';
    return () => { modelLoadGenerationRef.current += 1; };
  }, [modelSourceKey, workspaceActive]);
  React.useLayoutEffect(() => {
    if (!visible || !focusIntent.current) return;
    const node = focusIntent.current === 'slider' ? panelRef.current?.querySelector<HTMLElement>('[role="slider"]')
      : focusIntent.current === 'model-button' ? panelRef.current?.querySelector<HTMLElement>('.picker-model')
        : panelRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
          ?? panelRef.current?.querySelector<HTMLElement>('.model-option')
          ?? panelRef.current?.querySelector<HTMLElement>('.picker-back');
    node?.focus(); focusIntent.current = null;
  }, [visible, view, modelOptions.length]);
  const ensureModelsLoaded = React.useCallback((refresh = false) => {
    if (loadingModels || modelLoadStateRef.current === 'loading' || (!refresh && (availableModels.length || modelLoadStateRef.current === 'loaded'))) return;
    const generation = modelLoadGenerationRef.current; modelLoadStateRef.current = 'loading';
    void (refresh ? onLoadModels({ forceRefresh: true }) : onLoadModels()).then(loaded => {
      if (generation === modelLoadGenerationRef.current) modelLoadStateRef.current = loaded ? 'loaded' : 'idle';
    }).catch(() => { if (generation === modelLoadGenerationRef.current) modelLoadStateRef.current = 'idle'; });
  }, [availableModels.length, loadingModels, onLoadModels]);
  const panelHeight = view === 'settings' ? 96 + (contextWindow ? 38 : 0) : 54 + Math.max(32, Math.min(240, modelOptions.length * 30 - 2));

  return <Popover trigger="click" motion={false} position={placement.position} autoAdjustOverflow={false} spacing={{ x: placement.spacingX, y: 8 }} showArrow={false}
    getPopupContainer={getAppPopupContainer} visible={visible} rePosKey={`${view}:${panelHeight}:${placement.position}:${placement.spacingX}:${placement.width}:${placement.maxHeight}`}
    style={{ backgroundColor: 'transparent', boxShadow: 'none' }}
    onVisibleChange={next => {
      if (next && !disabled && workspaceActive) { if (!visible) { updatePlacement(); onOpenSettings?.(); } setOpen(true); }
      else close();
    }}
    content={visible ? <Panel id={menuId} ref={panelRef} $height={panelHeight} $placement={placement} role="dialog" aria-label="模型与推理设置"
      onKeyDown={event => {
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.target as HTMLElement).getAttribute('role') === 'slider')) {
          event.preventDefault(); event.stopPropagation(); close(true);
        }
      }}>
      {view === 'settings' ? <>
        {fastModeAvailable && onFastModeChange ? <button className="picker-fast" type="button" aria-label="加速模式" aria-pressed={fastMode}
          title={`${fastMode ? '关闭' : '开启'}加速模式：优先处理，可能增加用量`} onClick={() => onFastModeChange(!fastMode)}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9 1.5L2.5 9H7l-.5 5.5L13.5 7H9l.5-5.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button> : null}
        <div className="picker-heading">
          <span className="picker-effort" data-maximum={maximum}>{REASONING_EFFORT_LABELS[displayedEffort]}</span>
          <button className="picker-model" type="button" aria-label="选择模型" title={model || '选择模型'}
            onClick={() => { focusIntent.current = 'models'; setPreview(null); setView('models'); ensureModelsLoaded(); }}>
            <span>{model || '选择模型'}</span><Chevron direction="right" />
          </button>
        </div>
        <button className="picker-reset" type="button" aria-label="重置推理强度为自动" title="重置为自动"
          disabled={selectedEffort === 'auto' && preview === null} onClick={() => { setPreview(null); onReasoningEffortChange('auto'); }}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 4.2A5.5 5.5 0 1 1 2.6 10M3.2 1.8v3.4h3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="picker-slider"><ReasoningEffortSlider active={visible} options={reasoningOptions} value={selectedEffort}
          preview={preview} onPreview={setPreview} onChange={onReasoningEffortChange} trackEffect={<ReasoningStarfield active={visible} maximum={maximum} fastMode={fastModeAvailable && fastMode} />} /></div>
        {contextWindow ? <label className="picker-context"><span>上下文窗口</span><InputNumber aria-label="上下文窗口"
          hideButtons min={0} max={10} precision={0} value={contextWindow.value} onNumberChange={value => contextWindow.onChange(Number(value) || 0)} /></label> : null}
      </> : <>
        <div className="picker-models-header"><button className="picker-back" type="button" aria-label="返回推理设置"
          onClick={() => { focusIntent.current = 'model-button'; setView('settings'); }}><Chevron direction="left" /></button><span>选择模型</span>
          <button className="picker-refresh" type="button" title="刷新模型" aria-label="刷新模型" disabled={loadingModels} onClick={() => ensureModelsLoaded(true)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 4.2A5.5 5.5 0 1 1 2.6 10M3.2 1.8v3.4h3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <ModelList role="menu" aria-label="可用模型" onKeyDown={event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
          if (!items.length) return;
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : current < 0 ? event.key === 'ArrowDown' ? 0 : items.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
          items[next]?.focus();
        }}>
          {modelOptions.length ? modelOptions.map(modelId => <button key={modelId} className="model-option" type="button" role="menuitemradio"
            aria-checked={model === modelId} title={modelId} onClick={() => {
              expectedModelRef.current = modelId !== model ? modelId : null;
              focusIntent.current = 'slider'; setPreview(null); setView('settings'); onModelChange(modelId);
            }}><span>{modelId}</span>
            {model === modelId ? <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8l3 3 6-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
          </button>) : <div className="model-empty" role="status">{loadingModels ? '正在读取模型...' : '当前服务未返回模型'}</div>}
        </ModelList>
      </>}
    </Panel> : null}>
    <Trigger ref={triggerRef} disabled={disabled} type="button" title="选择模型与推理强度" aria-haspopup="dialog"
      aria-expanded={visible} aria-controls={visible ? menuId : undefined} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) && !disabled && workspaceActive) {
          event.preventDefault(); event.stopPropagation();
          if (visible && (event.key === 'Enter' || event.key === ' ')) close();
          else if (visible && view === 'settings') panelRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
          else { focusIntent.current = 'slider'; setView('settings'); if (!visible) { updatePlacement(); onOpenSettings?.(); } setOpen(true); }
        }
      }}>
      <span className="model-name">{model || '选择模型'}</span><span className="reasoning-label">{REASONING_EFFORT_LABELS[selectedEffort]}</span><Chevron />
    </Trigger>
  </Popover>;
}
