import React from 'react';
import styled from 'styled-components';
import type { AIServiceReasoningEffort } from '../ai-service.types';
import { REASONING_EFFORT_LABELS } from './reasoning-effort-labels';

const Slider = styled.div`
  position: relative; height: 28px; width: 100%; touch-action: none; cursor: pointer; outline: none; user-select: none;
  .reasoning-slider-track {
    position: absolute; inset: 2px 0; border-radius: 999px; overflow: hidden;
    background: color-mix(in srgb, var(--app-text) 13%, var(--app-bg-popover));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-text) 3%, transparent);
  }
  .reasoning-slider-fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--semi-color-primary); transition: width 160ms cubic-bezier(.2, .8, .2, 1); }
  &[data-maximum='true'] .reasoning-slider-fill {
    width: 100% !important;
    background: linear-gradient(100deg, #3e4ae5, #7b5aeb 48%, #aa72ee 70%, #6450d9);
  }
  .reasoning-slider-effect { position: absolute; inset: 0; overflow: hidden; pointer-events: none; border-radius: inherit; }
  .reasoning-slider-dot { position: absolute; top: 50%; width: 4px; height: 4px; border-radius: 50%; transform: translate(-50%, -50%); background: color-mix(in srgb, var(--app-text) 30%, transparent); }
  .reasoning-slider-dot[data-filled='true'] { background: #ffffff60; }
  .reasoning-slider-thumb { position: absolute; top: 0; width: 28px; height: 28px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #00000020; transform: translateX(-50%); pointer-events: none; transition: left 160ms cubic-bezier(.2, .8, .2, 1); }
  &:focus-visible .reasoning-slider-thumb { outline: 2px solid var(--semi-color-focus-border); outline-offset: 3px; }
  &[aria-disabled='true'] { cursor: default; }
  @media (prefers-reduced-motion: reduce) {
    .reasoning-slider-fill, .reasoning-slider-thumb { transition: none; }
  }
`;

function position(index: number, count: number): string {
  const ratio = count > 1 ? index / (count - 1) : 0;
  return `calc(${ratio * 100}% + ${14 - ratio * 28}px)`;
}

export interface ReasoningEffortSliderProps {
  active: boolean;
  options: readonly AIServiceReasoningEffort[];
  value: AIServiceReasoningEffort;
  preview: AIServiceReasoningEffort | null;
  onPreview: (value: AIServiceReasoningEffort | null) => void;
  onChange: (value: AIServiceReasoningEffort) => void;
  trackEffect?: React.ReactNode;
}

export default function ReasoningEffortSlider({ active, options, value, preview, onPreview, onChange, trackEffect }: ReasoningEffortSliderProps) {
  const drag = React.useRef<{ pointerId: number; element: HTMLDivElement; initialValue: AIServiceReasoningEffort } | null>(null);
  const index = Math.max(0, options.indexOf(preview ?? value));
  const maximum = options.length > 1 && index === options.length - 1;
  const release = React.useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    return current;
  }, []);
  const cancel = React.useCallback(() => { if (release()) onPreview(null); }, [onPreview, release]);
  React.useEffect(() => { cancel(); }, [active, options, value, cancel]);
  React.useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined') return;
    const cancelWhenHidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancelWhenHidden);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancelWhenHidden); };
  }, [active, cancel]);
  React.useEffect(() => () => { release(); }, [release]);
  const pointerValue = (element: HTMLDivElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - 14) / Math.max(1, rect.width - 28)));
    return options[Math.round(ratio * (options.length - 1))];
  };
  return <Slider role="slider" aria-label="推理强度" aria-orientation="horizontal"
    aria-valuemin={0} aria-valuemax={Math.max(0, options.length - 1)} aria-valuenow={index}
    aria-valuetext={REASONING_EFFORT_LABELS[options[index]]} aria-disabled={!active || options.length < 2}
    tabIndex={active ? 0 : -1} data-maximum={maximum}
    onPointerDown={event => {
      if (!active || options.length < 2 || event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, element: event.currentTarget, initialValue: value };
      onPreview(pointerValue(event.currentTarget, event.clientX));
    }}
    onPointerMove={event => {
      if (active && drag.current?.pointerId === event.pointerId) onPreview(pointerValue(event.currentTarget, event.clientX));
    }}
    onPointerUp={event => {
      if (!active || drag.current?.pointerId !== event.pointerId) return;
      const next = pointerValue(event.currentTarget, event.clientX);
      const current = release(); onPreview(null);
      if (next !== current?.initialValue) onChange(next);
    }}
    onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
    onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
    onBlur={cancel}
    onKeyDown={event => {
      if (event.key === 'Escape') { cancel(); return; }
      if (!active) return;
      const offset = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
      if (!offset && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault(); event.stopPropagation(); cancel();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + offset));
      if (options[nextIndex] !== value) onChange(options[nextIndex]);
    }}>
    <div className="reasoning-slider-track" aria-hidden="true">
      <div className="reasoning-slider-fill" style={{ width: position(index, options.length) }} />
      {active && maximum ? <div className="reasoning-slider-effect">{trackEffect}</div> : null}
      {!maximum ? options.map((effort, dotIndex) => <span key={effort} className="reasoning-slider-dot" data-filled={dotIndex <= index} style={{ left: position(dotIndex, options.length) }} />) : null}
    </div>
    <div className="reasoning-slider-thumb" aria-hidden="true" style={{ left: position(index, options.length) }} />
  </Slider>;
}
