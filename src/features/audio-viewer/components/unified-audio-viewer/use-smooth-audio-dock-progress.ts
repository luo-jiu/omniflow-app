import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { getAudioDockProgressPoint, type AudioDockProgressGeometry } from './audio-dock-progress-geometry';

/** Read the existing media clock; never emit playback state or rerender the viewer per frame. */
export function useSmoothAudioDockProgress({ fill, gradient, geometry, duration, value, enabled, readTime }: {
  fill: RefObject<SVGPathElement>;
  gradient: RefObject<SVGLinearGradientElement>;
  geometry: AudioDockProgressGeometry | null;
  duration: number;
  value: number;
  enabled: boolean;
  readTime?: () => number | null;
}) {
  const lastRatio = useRef<number | null>(null);
  const paint = useCallback((time: number, force = false) => {
    if (!geometry || !fill.current || !gradient.current || !Number.isFinite(time)) return;
    const ratio = duration > 0 ? Math.min(Math.max(time / duration, 0), 1) : 0;
    const previous = lastRatio.current;
    // Long tracks need fewer writes, while short tracks still move every frame.
    if (!force && previous !== null && (ratio === previous || (ratio > 0 && ratio < 1 && Math.abs(ratio - previous) * geometry.length < 0.15))) return;
    lastRatio.current = ratio;
    fill.current.setAttribute('stroke-dashoffset', String(1 - ratio));
    fill.current.setAttribute('visibility', ratio > 0 ? 'visible' : 'hidden');
    gradient.current.setAttribute('x2', String(Math.max(getAudioDockProgressPoint(geometry, ratio).x, geometry.inset + 0.001)));
  }, [duration, fill, geometry, gradient]);

  useLayoutEffect(() => {
    if (!geometry) return;
    const time = enabled && readTime ? readTime() : value;
    if (time !== null) paint(time, true);
  }, [enabled, geometry, paint, readTime, value]);

  useEffect(() => {
    if (!enabled || !readTime || !geometry || duration <= 0) return;
    let frameId = 0;
    let sampledAt = -Infinity;
    const sampleInterval = 1000 / Math.min(60, Math.max(4, Math.ceil(geometry.length / duration / 0.15)));
    const frame = (now: number) => {
      frameId = 0;
      if (document.hidden) return;
      if (now - sampledAt + 0.5 >= sampleInterval) {
        sampledAt = now;
        const time = readTime();
        if (time === null) return;
        // Native currentTime also stays still when buffering; don't extrapolate past it.
        paint(time);
      }
      frameId = window.requestAnimationFrame(frame);
    };
    const visibility = () => {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
      if (!document.hidden) frameId = window.requestAnimationFrame(frame);
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [duration, enabled, geometry, paint, readTime]);
}
