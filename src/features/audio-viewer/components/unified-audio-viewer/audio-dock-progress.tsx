import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useSmoothAudioDockProgress } from './use-smooth-audio-dock-progress';
import {
  AUDIO_DOCK_PROGRESS_STROKE,
  createAudioDockProgressGeometry,
  getAudioDockProgressPoint,
  getAudioDockProgressRatio,
} from './audio-dock-progress-geometry';

interface AudioDockProgressProps {
  visible: boolean;
  disabled: boolean;
  duration: number;
  value: number;
  startColor: string;
  endColor: string;
  smooth?: boolean;
  readTime?: () => number | null;
  onPreview: (time: number) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function AudioDockProgress({
  visible, disabled, duration, value, startColor, endColor, smooth = false, readTime, onPreview, onCommit, onCancel,
}: AudioDockProgressProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fillRef = useRef<SVGPathElement>(null);
  const gradientRef = useRef<SVGLinearGradientElement>(null);
  const gestureRef = useRef<{ pointerId: number; left: number; top: number } | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const gradientId = `audio-dock-progress-${useId().replace(/:/g, '')}`;
  const geometry = useMemo(() => createAudioDockProgressGeometry(size.width, size.height), [size]);
  const max = Number.isFinite(duration) ? Math.max(duration, 0) : 0;
  const current = Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0;
  const ratio = max > 0 ? current / max : 0;
  const enabled = visible && !disabled && max > 0;
  const end = geometry ? getAudioDockProgressPoint(geometry, ratio) : null;
  useSmoothAudioDockProgress({ fill: fillRef, gradient: gradientRef, geometry, duration: max, value: current, enabled: enabled && smooth, readTime });

  const releaseGesture = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture && svgRef.current?.hasPointerCapture(gesture.pointerId)) {
      svgRef.current.releasePointerCapture(gesture.pointerId);
    }
    return gesture;
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // A resized/hidden dock invalidates the gesture's cached position. Losing
    // capture cancels its preview; it never submits a seek into another source.
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture) {
      if (svgRef.current?.hasPointerCapture(gesture.pointerId)) svgRef.current.releasePointerCapture(gesture.pointerId);
      cancelRef.current();
    }
  }, [enabled, geometry]);

  const previewPointer = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!enabled || !geometry || !gesture || gesture.pointerId !== event.pointerId) return;
    onPreview(getAudioDockProgressRatio(geometry, event.clientX - gesture.left, event.clientY - gesture.top) * max);
  };

  return (
    <div className="audio-dock-progress" ref={rootRef} aria-hidden={!visible} data-visible={visible}>
      <input
        ref={inputRef}
        className="audio-dock-progress-keyboard"
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={current}
        disabled={!enabled}
        tabIndex={visible ? 0 : -1}
        aria-label="播放进度"
        onChange={event => onPreview(Number(event.currentTarget.value))}
        onKeyDown={event => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          releaseGesture();
          onCancel();
        }}
        onKeyUp={event => { if (event.key !== 'Escape') onCommit(); }}
        onBlur={() => {
          if (releaseGesture()) onCancel();
          else onCommit();
        }}
      />
      {geometry && end && (
        <svg
          ref={svgRef}
          className="audio-dock-progress-svg"
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-hidden="true"
          onPointerDown={event => {
            if (!enabled || event.button !== 0 || gestureRef.current) return;
            event.preventDefault();
            // Size comes only from ResizeObserver. Read the origin once per
            // gesture; pointer moves project against the cached geometry.
            const { left, top } = event.currentTarget.getBoundingClientRect();
            gestureRef.current = { pointerId: event.pointerId, left, top };
            event.currentTarget.setPointerCapture(event.pointerId);
            inputRef.current?.focus({ preventScroll: true });
            previewPointer(event);
          }}
          onPointerMove={previewPointer}
          onPointerUp={event => {
            if (gestureRef.current?.pointerId !== event.pointerId) return;
            previewPointer(event);
            releaseGesture();
            onCommit();
          }}
          onPointerCancel={event => {
            if (gestureRef.current?.pointerId !== event.pointerId) return;
            releaseGesture();
            onCancel();
          }}
          onLostPointerCapture={event => {
            if (gestureRef.current?.pointerId !== event.pointerId) return;
            gestureRef.current = null;
            onCancel();
          }}
        >
          <defs>
            <linearGradient ref={gradientRef} id={gradientId} gradientUnits="userSpaceOnUse" x1={geometry.inset} x2={Math.max(end.x, geometry.inset + 0.001)} y1={0} y2={0}>
              <stop offset="0%" stopColor={startColor} />
              <stop offset="100%" stopColor={endColor} />
            </linearGradient>
          </defs>
          <path className="audio-dock-progress-track" d={geometry.path} fill="none" strokeWidth={AUDIO_DOCK_PROGRESS_STROKE} strokeLinecap="round" />
          <path
            ref={fillRef}
            className="audio-dock-progress-fill"
            d={geometry.path}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={AUDIO_DOCK_PROGRESS_STROKE}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - ratio}
            visibility={ratio > 0 ? 'visible' : 'hidden'}
          />
          <path className="audio-dock-progress-hit" d={geometry.path} fill="none" stroke="transparent" strokeWidth={14} pointerEvents={enabled ? 'stroke' : 'none'} />
        </svg>
      )}
    </div>
  );
}
