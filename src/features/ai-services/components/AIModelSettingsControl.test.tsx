import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputNumber, Popover } from '@douyinfe/semi-ui';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { getAppPopupContainer } from '@/utils/popup-container';
import AIModelSettingsControl, { type AIModelSettingsControlProps } from './AIModelSettingsControl';
import ReasoningEffortSlider from './ReasoningEffortSlider';
import ReasoningStarfield from './ReasoningStarfield';

vi.mock('@douyinfe/semi-ui', () => ({
  Popover: ({ children, content, visible }: { children: React.ReactNode; content: React.ReactNode; visible: boolean }) => <>{children}{visible ? content : null}</>,
  InputNumber: () => null,
}));
vi.mock('./ReasoningStarfield', () => ({ default: () => <span data-starfield /> }));

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}
function props(overrides: Partial<AIModelSettingsControlProps> = {}): AIModelSettingsControlProps {
  return { availableModels: [], loadingModels: false, model: 'gpt-6.1-sol', modelSourceKey: 'profile', providerType: 'openai',
    onLoadModels: vi.fn(async () => true), onModelChange: vi.fn(), onReasoningEffortChange: vi.fn(), reasoningEffort: 'auto', ...overrides };
}
function button(view: TestRenderer.ReactTestRenderer, label: string) {
  return view.root.findAllByType('button').find(node => node.props['aria-label'] === label)!;
}
function slider(view: TestRenderer.ReactTestRenderer) { return view.root.findAllByType('div').find(node => node.props.role === 'slider')!; }
function open(view: TestRenderer.ReactTestRenderer) { act(() => view.root.findByType(Popover).props.onVisibleChange(true)); }
function openModels(view: TestRenderer.ReactTestRenderer) { open(view); act(() => button(view, '选择模型').props.onClick()); }
function key(key: string, extra = {}) { return { key, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }; }
let view: TestRenderer.ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });
function render(input = props(), options?: TestRenderer.TestRendererOptions) {
  act(() => { view = TestRenderer.create(<AIModelSettingsControl {...input} />, options); });
  return view!;
}

describe('Model picker', () => {
  it('opens a single compact settings panel without fetching models, then commits supported keyboard choices', () => {
    const input = props(); const current = render(input); open(current);
    expect(current.root.findAllByType(Popover)).toHaveLength(1);
    expect(current.root.findByType(Popover).props.getPopupContainer).toBe(getAppPopupContainer);
    expect(current.root.findByType(Popover).props.autoAdjustOverflow).toBe(false);
    expect(input.onLoadModels).not.toHaveBeenCalled();
    expect(current.root.findByType(ReasoningEffortSlider).props.options).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(slider(current).props['aria-valuetext']).toBe('自动');
    act(() => slider(current).props.onKeyDown(key('End')));
    expect(input.onReasoningEffortChange).toHaveBeenLastCalledWith('max');
    act(() => current.update(<AIModelSettingsControl {...input} reasoningEffort="xhigh" />));
    expect(slider(current).props['aria-valuetext']).toBe('极高');
    expect(JSON.stringify(current.toJSON())).not.toContain('Ultra');
    expect(JSON.stringify(current.toJSON())).not.toContain('Fast');
  });

  it('keeps ordinary stars at maximum effort and supports Fast particles at lower efforts', () => {
    const input = props({ model: 'gpt-5.5', reasoningEffort: 'xhigh' }); const current = render(input);
    expect(current.root.findAllByProps({ 'data-starfield': true })).toHaveLength(0);
    open(current);
    expect(slider(current).props['aria-valuemax']).toBe(4);
    expect(slider(current).props['data-maximum']).toBe(true);
    expect(current.root.findAllByProps({ 'data-starfield': true })).toHaveLength(1);
    expect(current.root.findByType(ReasoningStarfield).props.maximum).toBe(true);
    act(() => current.update(<AIModelSettingsControl {...input} reasoningEffort="high" />));
    expect(current.root.findAllByProps({ 'data-starfield': true })).toHaveLength(0);
    act(() => current.update(<AIModelSettingsControl {...input} reasoningEffort="high" fastMode fastModeAvailable />));
    expect(current.root.findAllByProps({ 'data-starfield': true })).toHaveLength(1);
    expect(current.root.findByType(ReasoningStarfield).props.maximum).toBe(false);
    expect(current.root.findByType(ReasoningStarfield).props.fastMode).toBe(true);
    act(() => current.root.findByType(ReasoningEffortSlider).props.onPreview('low'));
    expect(current.root.findByType(ReasoningStarfield).props.maximum).toBe(false);
    expect(current.root.findByType(ReasoningStarfield).props.fastMode).toBe(true);
    expect(input.onReasoningEffortChange).not.toHaveBeenCalled();
    act(() => current.root.findByType(ReasoningEffortSlider).props.onPreview(null));
    act(() => current.update(<AIModelSettingsControl {...input} fastMode fastModeAvailable />));
    expect(current.root.findByType(ReasoningStarfield).props.fastMode).toBe(true);
    expect(current.root.findByType(ReasoningStarfield).props.active).toBe(true);
    act(() => current.update(<AIModelSettingsControl {...input} reasoningEffort="low" fastMode />));
    expect(current.root.findAllByProps({ 'data-starfield': true })).toHaveLength(0);
    act(() => current.root.findByType(Popover).props.onVisibleChange(false));
    expect(current.root.findAllByProps({ 'data-starfield': true })).toHaveLength(0);
  });

  it.each([
    { model: 'gpt-5.5', providerType: 'openai' as const, count: 5 },
    { model: 'GPT-6.1-SOL', providerType: 'openai' as const, count: 4 },
    { model: 'gpt-6.1-sol', providerType: 'claude' as const, count: 4 },
  ])('normalizes unsupported max after changing to $providerType/$model', ({ model, providerType, count }) => {
    const input = props({ reasoningEffort: 'max' }); const current = render(input); open(current);
    act(() => current.update(<AIModelSettingsControl {...input} model={model} providerType={providerType} />));
    expect(current.root.findByType(Popover).props.visible).toBe(false);
    expect(input.onReasoningEffortChange).toHaveBeenCalledWith('auto');
    open(current); expect(slider(current).props['aria-valuemax']).toBe(count - 1);
    expect(slider(current).props['aria-valuetext']).toBe('自动');
  });

  it('keeps stored extended effort while its service is loading and resets only effort when requested', () => {
    const input = props({ reasoningEffort: 'max', providerType: undefined }); const current = render(input);
    expect(input.onReasoningEffortChange).not.toHaveBeenCalled();
    act(() => current.update(<AIModelSettingsControl {...input} providerType="openai" />));
    open(current); act(() => button(current, '重置推理强度为自动').props.onClick());
    expect(input.onReasoningEffortChange).toHaveBeenCalledWith('auto');
    expect(input.onModelChange).not.toHaveBeenCalled();
    expect(current.root.findByType(Popover).props.visible).toBe(true);
  });

  it('retains the subtitle-only context field and callback', () => {
    const contextWindow = { value: 5, onChange: vi.fn() }; const current = render(props({ contextWindow })); open(current);
    const input = current.root.findByType(InputNumber); expect(input.props.value).toBe(5);
    act(() => input.props.onNumberChange(7)); expect(contextWindow.onChange).toHaveBeenCalledWith(7);
  });

  it('opens the selected model with keyboard focus and returns focus after Escape or slider Enter', () => {
    const triggerFocus = vi.fn(); const sliderFocus = vi.fn(); const selectedFocus = vi.fn(); const modelFocus = vi.fn();
    const current = render(props({ availableModels: ['gpt-5.5', 'gpt-6.1-sol'] }), { createNodeMock: element => {
      if (element.props['aria-haspopup'] === 'dialog') return { focus: triggerFocus };
      if (element.props.role === 'dialog') return { querySelector: (selector: string) => ({ focus: selector === '[role="slider"]' ? sliderFocus : selector === '.picker-model' ? modelFocus : selectedFocus }) };
      return null;
    } });
    const trigger = current.root.findAllByType('button').find(node => node.props['aria-haspopup'] === 'dialog')!;
    act(() => trigger.props.onKeyDown(key('ArrowDown'))); expect(sliderFocus).toHaveBeenCalledOnce();
    act(() => trigger.props.onKeyDown(key('ArrowUp'))); expect(sliderFocus).toHaveBeenCalledTimes(2);
    act(() => button(current, '选择模型').props.onClick()); expect(selectedFocus).toHaveBeenCalledOnce();
    act(() => button(current, '返回推理设置').props.onClick()); expect(modelFocus).toHaveBeenCalledOnce();
    const dialog = () => current.root.findAllByType('div').find(node => node.props.role === 'dialog')!;
    act(() => dialog().props.onKeyDown(key('Enter', { target: { getAttribute: () => 'slider' } })));
    expect(current.root.findByType(Popover).props.visible).toBe(false); expect(triggerFocus).toHaveBeenCalledOnce();
    open(current); act(() => dialog().props.onKeyDown(key('Escape')));
    expect(triggerFocus).toHaveBeenCalledTimes(2);
  });

  it('navigates model choices, commits the original ID once, and returns to settings in the same panel', () => {
    const input = props({ availableModels: ['gpt-5.5', 'gpt-6.1-sol'] }); const current = render(input); openModels(current);
    const choices = current.root.findAllByType('button').filter(node => node.props.role === 'menuitemradio');
    expect(choices.map(node => node.props['aria-checked'])).toEqual([true, false]);
    const nodes = [{ focus: vi.fn() }, { focus: vi.fn() }]; vi.stubGlobal('document', { activeElement: nodes[0] });
    const menu = current.root.findAllByType('div').find(node => node.props.role === 'menu')!;
    act(() => menu.props.onKeyDown(key('End', { currentTarget: { querySelectorAll: () => nodes } })));
    expect(nodes[1].focus).toHaveBeenCalledOnce();
    vi.stubGlobal('document', { activeElement: null });
    act(() => menu.props.onKeyDown(key('ArrowUp', { currentTarget: { querySelectorAll: () => nodes } })));
    expect(nodes[1].focus).toHaveBeenCalledTimes(2);
    act(() => choices[1].props.onClick());
    expect(input.onModelChange).toHaveBeenCalledOnce();
    expect(input.onModelChange).toHaveBeenCalledWith('gpt-5.5');
    expect(current.root.findByType(Popover).props.visible).toBe(true);
    expect(button(current, '选择模型')).toBeDefined();
    act(() => current.update(<AIModelSettingsControl {...input} model="gpt-5.5" />));
    expect(current.root.findByType(Popover).props.visible).toBe(true);
    expect(slider(current).props['aria-valuemax']).toBe(4);
    act(() => current.update(<AIModelSettingsControl {...input} model="external-model" />));
    expect(current.root.findByType(Popover).props.visible).toBe(false);
  });

  it('focuses the first available model when the current model is absent', () => {
    const optionFocus = vi.fn(); const backFocus = vi.fn();
    const current = render(props({ model: 'custom', availableModels: ['gpt-5.5'] }), { createNodeMock: element => {
      if (element.props.role === 'dialog') return { querySelector: (selector: string) => selector === '.model-option' ? { focus: optionFocus }
        : selector === '.picker-back' ? { focus: backFocus } : null };
      return null;
    } });
    openModels(current); expect(optionFocus).toHaveBeenCalledOnce(); expect(backFocus).not.toHaveBeenCalled();
  });

  it('notifies the owner once per mouse or keyboard opening without loading models', () => {
    const onOpenSettings = vi.fn(); const input = props({ onOpenSettings }); const current = render(input);
    open(current); open(current); expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(input.onLoadModels).not.toHaveBeenCalled();
    act(() => current.root.findByType(Popover).props.onVisibleChange(false));
    const trigger = current.root.findAllByType('button').find(node => node.props['aria-haspopup'] === 'dialog')!;
    act(() => trigger.props.onKeyDown(key('ArrowDown')));
    act(() => trigger.props.onKeyDown(key('ArrowDown')));
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
    act(() => button(current, '选择模型').props.onClick());
    act(() => button(current, '返回推理设置').props.onClick());
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
  });

  it('measures before opening, keeps placement across views, and re-clamps on resize with listener cleanup', () => {
    const listeners = new Map<string, () => void>();
    const events = { addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name) };
    const viewport = { ...events, innerWidth: 1200, innerHeight: 800 };
    const overlay = { getBoundingClientRect: () => ({ left: 0, right: viewport.innerWidth, top: 0, bottom: 800, width: viewport.innerWidth, height: 800 }) };
    vi.stubGlobal('window', viewport); vi.stubGlobal('document', { ...events, hidden: false, getElementById: () => overlay });
    const current = render(props({ availableModels: ['gpt-5.5', 'gpt-6.1-sol'] }), { createNodeMock: element => {
      if (element.props['aria-haspopup'] === 'dialog') return { getBoundingClientRect: () => ({ left: 40, right: 160, top: 600, bottom: 630 }) };
      return null;
    } });
    open(current);
    const popover = () => current.root.findByType(Popover).props;
    expect(popover().position).toBe('top'); expect(popover().spacing).toEqual({ x: 40, y: 8 });
    act(() => button(current, '选择模型').props.onClick());
    expect(popover().position).toBe('top'); expect(popover().spacing).toEqual({ x: 40, y: 8 });
    act(() => { viewport.innerWidth = 240; listeners.get('resize')?.(); });
    expect(popover().content.props.$placement.width).toBe(216);
    expect(popover().spacing).toEqual({ x: 20, y: 8 });
    act(() => popover().onVisibleChange(false)); expect(listeners.size).toBe(0);
  });

  it('only shows the real Fast control when available and changes it independently of effort', () => {
    const onFastModeChange = vi.fn(); const input = props({ reasoningEffort: 'max', onFastModeChange });
    const current = render(input); open(current);
    expect(button(current, '加速模式')).toBeUndefined();
    act(() => current.update(<AIModelSettingsControl {...input} fastModeAvailable />));
    expect(button(current, '加速模式').props['aria-pressed']).toBe(false);
    act(() => button(current, '加速模式').props.onClick());
    expect(onFastModeChange).toHaveBeenCalledWith(true);
    expect(input.onReasoningEffortChange).not.toHaveBeenCalled();
    expect(current.root.findByType(Popover).props.visible).toBe(true);
    act(() => current.update(<AIModelSettingsControl {...input} fastModeAvailable fastMode />));
    expect(button(current, '加速模式').props['aria-pressed']).toBe(true);
    expect(button(current, '加速模式').props.title).toContain('优先处理，可能增加用量');
    act(() => button(current, '加速模式').props.onClick());
    expect(onFastModeChange).toHaveBeenLastCalledWith(false);
    act(() => button(current, '重置推理强度为自动').props.onClick());
    expect(onFastModeChange).toHaveBeenCalledTimes(2);
    act(() => current.update(<AIModelSettingsControl {...input} fastModeAvailable onFastModeChange={undefined} />));
    expect(button(current, '加速模式')).toBeUndefined();
  });
});

describe('Model list lifecycle', () => {
  it('refreshes through the owner while retaining current choices and deduplicating a pending refresh', async () => {
    const request = deferred(); const input = props({ availableModels: ['gpt-5.5', 'gpt-6.1-sol'], onLoadModels: vi.fn(() => request.promise) });
    const current = render(input); openModels(current);
    act(() => button(current, '刷新模型').props.onClick());
    act(() => button(current, '刷新模型').props.onClick());
    expect(input.onLoadModels).toHaveBeenCalledOnce();
    expect(input.onLoadModels).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(input.onModelChange).not.toHaveBeenCalled(); expect(input.onReasoningEffortChange).not.toHaveBeenCalled();
    expect(current.root.findByType(Popover).props.visible).toBe(true);
    expect(current.root.findAllByType('button').filter(node => node.props.role === 'menuitemradio')).toHaveLength(2);
    act(() => current.update(<AIModelSettingsControl {...input} loadingModels />));
    expect(button(current, '刷新模型').props.disabled).toBe(true);
    await act(async () => request.resolve(true));
    act(() => current.update(<AIModelSettingsControl {...input} />));
    act(() => button(current, '刷新模型').props.onClick());
    expect(input.onLoadModels).toHaveBeenCalledTimes(2);
    await act(async () => { await request.promise; });
  });

  it('keeps available choices during refresh and does not fetch on reopening', () => {
    const input = props({ availableModels: ['gpt-5.5', 'gpt-6.1-sol'], loadingModels: true }); const current = render(input); openModels(current);
    expect(current.root.findAllByType('button').filter(node => node.props.role === 'menuitemradio')).toHaveLength(2);
    act(() => button(current, '返回推理设置').props.onClick()); act(() => button(current, '选择模型').props.onClick());
    expect(input.onLoadModels).not.toHaveBeenCalled();
  });

  it('deduplicates pending and successful empty requests', async () => {
    const request = deferred(); const input = props({ onLoadModels: vi.fn(() => request.promise) }); const current = render(input); openModels(current);
    act(() => button(current, '返回推理设置').props.onClick()); act(() => button(current, '选择模型').props.onClick());
    expect(input.onLoadModels).toHaveBeenCalledOnce();
    expect(input.onLoadModels).toHaveBeenLastCalledWith();
    await act(async () => request.resolve(true));
    act(() => current.root.findByType(Popover).props.onVisibleChange(false)); openModels(current);
    expect(input.onLoadModels).toHaveBeenCalledOnce();
  });

  it('ignores an earlier service success after the current request failed, allowing retry', async () => {
    const oldRequest = deferred(); const newRequest = deferred();
    const input = props({ onLoadModels: vi.fn(() => oldRequest.promise) }); const nextLoader = vi.fn(() => newRequest.promise);
    const current = render(input); openModels(current);
    act(() => current.update(<AIModelSettingsControl {...input} modelSourceKey="new" onLoadModels={nextLoader} />)); openModels(current);
    await act(async () => newRequest.resolve(false)); await act(async () => oldRequest.resolve(true));
    act(() => button(current, '返回推理设置').props.onClick()); act(() => button(current, '选择模型').props.onClick());
    expect(nextLoader).toHaveBeenCalledTimes(2);
  });

  it.each([{ disabled: true }, { model: 'other' }, { modelSourceKey: 'other' }])('closes and drops preview when identity/availability changes: %j', change => {
    const input = props(); const current = render(input); open(current);
    act(() => current.root.findByType(ReasoningEffortSlider).props.onPreview('max'));
    act(() => current.update(<AIModelSettingsControl {...input} {...change} />));
    expect(current.root.findByType(Popover).props.visible).toBe(false);
    expect(input.onReasoningEffortChange).not.toHaveBeenCalled();
    act(() => current.update(<AIModelSettingsControl {...input} />));
    expect(current.root.findByType(Popover).props.visible).toBe(false); open(current);
    expect(slider(current).props['aria-valuetext']).toBe('自动');
  });

  it('closes a hidden retained workspace and does not reopen it on return', () => {
    const input = props();
    const element = (active: boolean) => <WorkspaceVisibilityContext.Provider value={active}><AIModelSettingsControl {...input} /></WorkspaceVisibilityContext.Provider>;
    act(() => { view = TestRenderer.create(element(true)); }); open(view!);
    act(() => view!.update(element(false))); expect(view!.root.findByType(Popover).props.visible).toBe(false);
    act(() => view!.update(element(true))); expect(view!.root.findByType(Popover).props.visible).toBe(false);
  });
});
