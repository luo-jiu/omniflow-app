import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIServiceReasoningEffort } from '../ai-service.types';
import ReasoningEffortSlider from './ReasoningEffortSlider';

const options: readonly AIServiceReasoningEffort[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
let view: TestRenderer.ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

function setup(initial: AIServiceReasoningEffort = 'low') {
  const onChange = vi.fn();
  const captured = new Set<number>();
  const element = {
    focus: vi.fn(), getBoundingClientRect: () => ({ left: 100, width: 228 }),
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  };
  function Harness({ active = true, externalValue }: { active?: boolean; externalValue?: AIServiceReasoningEffort }) {
    const [value, setValue] = React.useState(initial);
    const [preview, setPreview] = React.useState<AIServiceReasoningEffort | null>(null);
    return <ReasoningEffortSlider active={active} options={options} value={externalValue ?? value} preview={preview} onPreview={setPreview}
      onChange={next => { onChange(next); setValue(next); }} trackEffect={<span data-effect />} />;
  }
  act(() => { view = TestRenderer.create(<Harness />); });
  const slider = () => view!.root.findAllByType('div').find(node => node.props.role === 'slider')!;
  const pointer = (clientX: number, pointerId = 7) => ({ pointerId, clientX, button: 0, preventDefault: vi.fn(), currentTarget: element });
  const keyboard = (key: string) => ({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  return { onChange, element, slider, pointer, keyboard, Harness };
}

describe('Reasoning effort slider', () => {
  it('previews discrete steps and commits only the pointerup value', () => {
    const { slider, element, pointer, onChange } = setup();
    act(() => slider().props.onPointerDown(pointer(234)));
    expect(slider().props['aria-valuetext']).toBe('高');
    expect(onChange).not.toHaveBeenCalled();
    act(() => slider().props.onPointerMove(pointer(999)));
    expect(slider().props['aria-valuetext']).toBe('最大');
    expect(element.setPointerCapture).toHaveBeenCalledWith(7);
    act(() => slider().props.onPointerUp(pointer(999)));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('max');
    expect(element.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(slider().props['aria-valuenow']).toBe(5);
  });

  it.each(['onPointerCancel', 'onLostPointerCapture', 'onBlur'])('restores the committed value without a write on %s', cancel => {
    const { slider, pointer, onChange, element } = setup('medium');
    act(() => slider().props.onPointerDown(pointer(999)));
    act(() => slider().props[cancel](pointer(999)));
    expect(slider().props['aria-valuetext']).toBe('中');
    expect(onChange).not.toHaveBeenCalled();
    expect(element.hasPointerCapture(7)).toBe(false);
    act(() => slider().props.onPointerUp(pointer(999)));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not save a drag that returns to its starting step or a different pointer', () => {
    const { slider, pointer, onChange } = setup('low');
    act(() => slider().props.onPointerDown(pointer(999)));
    act(() => slider().props.onPointerUp(pointer(999, 8)));
    expect(onChange).not.toHaveBeenCalled();
    act(() => slider().props.onPointerUp(pointer(154)));
    expect(onChange).not.toHaveBeenCalled();
    expect(slider().props['aria-valuetext']).toBe('低');
  });

  it('supports bounded arrows, Home and End, while Escape cancels without consuming the parent close', () => {
    const { slider, pointer, keyboard, onChange } = setup('auto');
    act(() => slider().props.onKeyDown(keyboard('ArrowLeft')));
    expect(onChange).not.toHaveBeenCalled();
    act(() => slider().props.onKeyDown(keyboard('ArrowRight')));
    expect(slider().props['aria-valuetext']).toBe('低');
    act(() => slider().props.onKeyDown(keyboard('End')));
    expect(slider().props['aria-valuetext']).toBe('最大');
    act(() => slider().props.onKeyDown(keyboard('ArrowUp')));
    expect(onChange).toHaveBeenCalledTimes(2);
    act(() => slider().props.onKeyDown(keyboard('Home')));
    expect(slider().props['aria-valuetext']).toBe('自动');
    act(() => slider().props.onPointerDown(pointer(999)));
    const escape = keyboard('Escape'); act(() => slider().props.onKeyDown(escape));
    expect(slider().props['aria-valuetext']).toBe('自动');
    expect(escape.stopPropagation).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it.each([{ active: false }, { externalValue: 'high' as const }])('cleans up a drag when controlled inputs change: %j', change => {
    const { slider, pointer, onChange, element, Harness } = setup('auto');
    act(() => slider().props.onPointerDown(pointer(999)));
    act(() => view!.update(<Harness {...change} />));
    expect(element.hasPointerCapture(7)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    act(() => slider().props.onPointerUp(pointer(999)));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('releases pointer capture and removes visual effects on unmount', () => {
    const { slider, pointer, onChange, element } = setup('auto');
    act(() => slider().props.onPointerDown(pointer(999)));
    expect(view!.root.findAllByProps({ 'data-effect': true })).toHaveLength(1);
    act(() => { view!.unmount(); view = undefined; });
    expect(element.hasPointerCapture(7)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mounts ordinary stars only at the highest available step, including drag previews', () => {
    const mounted = vi.fn(); const disposed = vi.fn();
    function Effect() { React.useEffect(() => { mounted(); return disposed; }, []); return null; }
    const element = (value: AIServiceReasoningEffort, preview: AIServiceReasoningEffort | null = null) => <ReasoningEffortSlider active options={options} value={value} preview={preview}
      onPreview={vi.fn()} onChange={vi.fn()} trackEffect={<Effect />} />;
    act(() => { view = TestRenderer.create(element('low')); });
    expect(mounted).not.toHaveBeenCalled();
    act(() => view!.update(element('max')));
    expect(mounted).toHaveBeenCalledOnce();
    act(() => view!.update(element('max', 'medium')));
    expect(disposed).toHaveBeenCalledOnce();
    act(() => view!.update(element('max')));
    expect(mounted).toHaveBeenCalledTimes(2);
    act(() => view!.update(element('auto')));
    expect(disposed).toHaveBeenCalledTimes(2);
    act(() => { view!.unmount(); view = undefined; }); expect(disposed).toHaveBeenCalledTimes(2);
  });

  it('keeps one Fast effect alive through previews and cancellation, then releases it when hidden', () => {
    const mounted = vi.fn(); const disposed = vi.fn(); const onChange = vi.fn();
    function Effect() { React.useEffect(() => { mounted(); return disposed; }, []); return null; }
    const element = (preview: AIServiceReasoningEffort | null, active = true) => <ReasoningEffortSlider active={active} options={options}
      value="high" preview={preview} fastMode onPreview={vi.fn()} onChange={onChange} trackEffect={<Effect />} />;
    act(() => { view = TestRenderer.create(element(null)); });
    expect(mounted).toHaveBeenCalledOnce();
    for (const preview of ['max', 'auto', 'medium', null] as const) {
      act(() => view!.update(element(preview)));
      expect(mounted).toHaveBeenCalledOnce();
      expect(disposed).not.toHaveBeenCalled();
    }
    expect(onChange).not.toHaveBeenCalled();
    act(() => view!.update(element(null, false)));
    expect(disposed).toHaveBeenCalledOnce();
  });

  it.each(['blur', 'visibilitychange'])('cancels a drag when the window loses availability: %s', event => {
    const listeners = new Map<string, () => void>();
    const events = { addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name) };
    vi.stubGlobal('window', events); vi.stubGlobal('document', { ...events, hidden: true });
    const { slider, pointer, onChange, element } = setup('low');
    act(() => slider().props.onPointerDown(pointer(999)));
    act(() => listeners.get(event)?.());
    expect(slider().props['aria-valuetext']).toBe('低'); expect(element.hasPointerCapture(7)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    act(() => { view!.unmount(); view = undefined; }); expect(listeners.size).toBe(0);
  });
});
