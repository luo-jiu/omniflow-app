import { useEffect, useMemo, useRef, useState } from 'react';
import { createAudioDockProgressGeometry, getAudioDockProgressPoint } from './audio-dock-progress-geometry';
import { AUDIO_DOCK_METEOR_SHRINK_MS, AUDIO_DOCK_METEOR_DURATION_MS, AUDIO_DOCK_METEOR_FLIGHT_MS, createAudioDockReturnPath, getAudioDockReturnPoint } from './audio-dock-meteor-geometry';

export interface AudioDockMeteorEvent {
  id: number;
  src: string;
  fromColor: string;
  ratio: number;
}

const TRAIL_SEGMENTS = 24;

export function AudioDockMeteor({ event, color, onFinish }: {
  event: AudioDockMeteorEvent;
  color: string;
  onFinish: () => void;
}) {
  const root = useRef<SVGSVGElement>(null);
  const moving = useRef<SVGGElement>(null);
  const head = useRef<SVGCircleElement>(null);
  const trails = useRef<Array<SVGPathElement | null>>([]);
  const targetColor = useRef(color);
  const finish = useRef(onFinish);
  targetColor.current = color;
  finish.current = onFinish;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const geometry = useMemo(() => createAudioDockProgressGeometry(size.width, size.height), [size]);
  const lower = geometry ? createAudioDockReturnPath(geometry) : null;
  const fullPath = geometry && lower ? geometry.path + lower.path.slice(lower.path.indexOf(' V ')) : '';
  const initialProgress = geometry && lower ? Math.min(Math.max(event.ratio, 0), 1) * geometry.length / (geometry.length + lower.length) : 0;

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches || document.hidden) { finish.current(); return; }
    let measured: { width: number; height: number } | null = null;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 3 || height <= 3) return;
      if (measured) {
        if (measured.width !== width || measured.height !== height) finish.current();
        return;
      }
      measured = { width, height };
      setSize(measured);
    });
    observer.observe(node);
    const cancel = () => finish.current();
    const hidden = () => { if (document.hidden) cancel(); };
    reduced.addEventListener('change', cancel);
    document.addEventListener('visibilitychange', hidden);
    const watchdog = window.setTimeout(cancel, 1800);
    return () => {
      observer.disconnect();
      window.clearTimeout(watchdog);
      reduced.removeEventListener('change', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  useEffect(() => {
    if (!geometry || !moving.current || !head.current) return;
    const group = moving.current;
    const dot = head.current;
    const route = createAudioDockReturnPath(geometry);
    const fullLength = geometry.length + route.length;
    const initialHead = geometry.length * Math.min(Math.max(event.ratio, 0), 1);
    const shortTail = Math.min(110, route.length * 0.16, initialHead);
    group.style.color = event.fromColor;
    let appliedColor = event.fromColor;
    let frameId = 0;
    let startedAt: number | null = null;
    const frame = (now: number) => {
      startedAt ??= now;
      const elapsed = now - startedAt;
      if (elapsed >= AUDIO_DOCK_METEOR_DURATION_MS) { finish.current(); return; }
      // The head moves from frame one. The original bar is already its long
      // fading tail; shortening and forward travel happen on this same path.
      const t = Math.min(elapsed / AUDIO_DOCK_METEOR_FLIGHT_MS, 1);
      const distance = initialHead + (fullLength - initialHead) * (1 - (1 - t) ** 2);
      const shrink = Math.min(elapsed / AUDIO_DOCK_METEOR_SHRINK_MS, 1);
      const tailLength = shortTail + (initialHead - shortTail) * (1 - shrink) ** 3;
      const segmentLength = tailLength / TRAIL_SEGMENTS / fullLength;
      const progress = distance / fullLength;
      const point = distance <= geometry.length
        ? getAudioDockProgressPoint(geometry, distance / geometry.length)
        : getAudioDockReturnPoint(geometry, (distance - geometry.length) / route.length);
      if (elapsed > 0 && appliedColor !== targetColor.current) {
        appliedColor = targetColor.current;
        group.style.color = appliedColor;
      }
      for (let index = 0; index < TRAIL_SEGMENTS; index++) {
        const segment = trails.current[index];
        if (!segment) continue;
        const end = progress - index * segmentLength;
        const start = Math.max(0, end - segmentLength);
        segment.setAttribute('stroke-dasharray', `${Math.max(end - start, 0)} 2`);
        segment.setAttribute('stroke-dashoffset', String(-start));
        segment.style.opacity = end > 0 ? String((1 - index / TRAIL_SEGMENTS) ** 2) : '0';
      }
      group.style.opacity = String(Math.min(1, (AUDIO_DOCK_METEOR_DURATION_MS - elapsed) / 100));
      dot.setAttribute('cx', String(point.x));
      dot.setAttribute('cy', String(point.y));
      frameId = window.requestAnimationFrame(frame);
    };
    frameId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(frameId);
  }, [event, geometry]);

  return <svg ref={root} className="audio-dock-meteor" aria-hidden="true" viewBox={`0 0 ${size.width} ${size.height}`}>
    {geometry && lower && <>
      <g ref={moving} className="audio-dock-meteor-light" style={{ color: event.fromColor }}>
        {Array.from({ length: TRAIL_SEGMENTS }, (_, index) => <path key={index} ref={node => { trails.current[index] = node; }} d={fullPath}
          fill="none" stroke="currentColor" strokeWidth={3 * (1 - index / TRAIL_SEGMENTS)} pathLength={1}
          strokeDasharray={`${initialProgress / TRAIL_SEGMENTS} 2`}
          strokeDashoffset={-(initialProgress * (1 - (index + 1) / TRAIL_SEGMENTS))}
          opacity={(1 - index / TRAIL_SEGMENTS) ** 2} />)}
        <circle ref={head} r={3} fill="currentColor" cx={getAudioDockProgressPoint(geometry, event.ratio).x} cy={getAudioDockProgressPoint(geometry, event.ratio).y} />
      </g>
    </>}
  </svg>;
}
