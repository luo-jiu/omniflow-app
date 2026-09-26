import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ComicScrollProgressRing } from './comic-reader-dock.styles';
import {
  createComicScrollProgressGeometry,
  getComicScrollProgressRatio,
  type ComicScrollProgressGeometry,
} from './comic-scroll-progress-geometry';

const PROGRESS_ANIMATION_DURATION_MS = 240;

const clampProgress = (value: number) => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);

const easeOutCubic = (value: number) => {
  const progress = clampProgress(value);
  return 1 - (1 - progress) ** 3;
};

export default function ComicScrollProgress({ progress, onChange, animate = false }: {
  progress: number;
  onChange: (value: number) => void;
  animate?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 40, height: 200 });
  const [displayProgress, setDisplayProgress] = useState(() => clampProgress(progress));
  const displayProgressRef = useRef(displayProgress);
  const progressAnimationFrameRef = useRef<number | null>(null);
  const interactionRef = useRef(false);
  const boundsRef = useRef<{ left: number; top: number; width: number; height: number; geometry?: ComicScrollProgressGeometry } | null>(null);
  const onChangeRef = useRef(onChange);
  const pendingProgressRef = useRef<number | null>(null);
  const progressFrameRef = useRef<number | null>(null);
  displayProgressRef.current = displayProgress;
  onChangeRef.current = onChange;

  useEffect(() => {
    const target = clampProgress(progress);
    const current = displayProgressRef.current;
    if (!animate || interactionRef.current || Math.abs(target - current) < 0.0005) {
      if (progressAnimationFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(progressAnimationFrameRef.current);
        progressAnimationFrameRef.current = null;
      }
      displayProgressRef.current = target;
      setDisplayProgress(target);
      return;
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      displayProgressRef.current = target;
      setDisplayProgress(target);
      return;
    }

    if (progressAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(progressAnimationFrameRef.current);
    }
    const start = current;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const step = (now: number) => {
      const elapsed = now - startedAt;
      const animationProgress = clampProgress(elapsed / PROGRESS_ANIMATION_DURATION_MS);
      const next = start + (target - start) * easeOutCubic(animationProgress);
      displayProgressRef.current = next;
      setDisplayProgress(next);
      if (animationProgress < 1) {
        progressAnimationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }
      progressAnimationFrameRef.current = null;
      displayProgressRef.current = target;
      setDisplayProgress(target);
    };
    progressAnimationFrameRef.current = window.requestAnimationFrame(step);
    return () => {
      if (progressAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(progressAnimationFrameRef.current);
        progressAnimationFrameRef.current = null;
      }
    };
  }, [animate, progress]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setSize(previous => Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5
        ? previous
        : { width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => () => {
    if (progressFrameRef.current !== null) window.cancelAnimationFrame(progressFrameRef.current);
    if (progressAnimationFrameRef.current !== null) window.cancelAnimationFrame(progressAnimationFrameRef.current);
  }, []);
  const commitProgress = (value: number) => {
    const next = clampProgress(value);
    displayProgressRef.current = next;
    setDisplayProgress(next);
    onChangeRef.current(next);
  };
  const emitProgress = (value: number, immediate = false) => {
    pendingProgressRef.current = clampProgress(value);
    if (immediate) {
      if (progressFrameRef.current !== null) window.cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
      const pending = pendingProgressRef.current;
      if (pending !== null) commitProgress(pending);
      return;
    }
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      commitProgress(value);
      return;
    }
    if (progressFrameRef.current !== null) return;
    progressFrameRef.current = window.requestAnimationFrame(() => {
      progressFrameRef.current = null;
      const pending = pendingProgressRef.current;
      if (pending !== null) commitProgress(pending);
    });
  };
  const cancelPendingProgress = () => {
    pendingProgressRef.current = null;
    if (progressFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
  };
  const update = (event: PointerEvent<SVGSVGElement>, cachedBounds = boundsRef.current, immediate = false) => {
    const rect = cachedBounds ?? (() => {
      const next = event.currentTarget.getBoundingClientRect();
      const geometry = createComicScrollProgressGeometry(next.width, next.height);
      return geometry ? { ...next, geometry } : null;
    })();
    if (!rect) return;
    if (rect.height <= 0) return;
    // Keep a vertical fallback for synthetic/legacy callers without width data.
    if (!rect.geometry || !Number.isFinite(rect.width) || !Number.isFinite(event.clientX)) {
      emitProgress(Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1), immediate);
      return;
    }
    if (rect.width <= 0) return;
    const { geometry } = rect;
    const x = ((event.clientX - rect.left) / rect.width) * geometry.width;
    const y = ((event.clientY - rect.top) / rect.height) * geometry.height;
    emitProgress(getComicScrollProgressRatio(geometry, x, y), immediate);
  };
  const geometry = createComicScrollProgressGeometry(size.width, size.height);
  const normalizedProgress = clampProgress(displayProgress);
  const dashLength = geometry ? normalizedProgress * geometry.length : 0;
  const dashGap = geometry ? Math.max(geometry.length - dashLength, 0) : 0;
  return <ComicScrollProgressRing ref={ref} viewBox={`0 0 ${size.width} ${size.height}`} role="slider" aria-label="漫画阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(normalizedProgress * 100)}
    tabIndex={0} onPointerDown={event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      interactionRef.current = true;
      if (progressAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(progressAnimationFrameRef.current);
        progressAnimationFrameRef.current = null;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const nextGeometry = createComicScrollProgressGeometry(rect.width, rect.height);
      boundsRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, geometry: nextGeometry ?? undefined };
      event.currentTarget.setPointerCapture(event.pointerId);
      update(event, boundsRef.current, true);
    }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event); }}
    onPointerUp={event => {
      if (pendingProgressRef.current !== null) emitProgress(pendingProgressRef.current, true);
      interactionRef.current = false;
      boundsRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { interactionRef.current = false; boundsRef.current = null; cancelPendingProgress(); }} onLostPointerCapture={() => { interactionRef.current = false; boundsRef.current = null; cancelPendingProgress(); }} onKeyDown={event => {
      if (event.key === 'Home') { event.preventDefault(); commitProgress(0); }
      if (event.key === 'End') { event.preventDefault(); commitProgress(1); }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); commitProgress(Math.max(progress - 0.02, 0)); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); commitProgress(Math.min(progress + 0.02, 1)); }
    }}>
    {geometry && <>
      <rect className="comic-scroll-progress-track" x={geometry.inset} y={geometry.inset} width={geometry.width - geometry.inset * 2} height={geometry.height - geometry.inset * 2} rx={geometry.radius} />
      {normalizedProgress > 0 && <rect className="comic-scroll-progress-fill" x={geometry.inset} y={geometry.inset} width={geometry.width - geometry.inset * 2} height={geometry.height - geometry.inset * 2} rx={geometry.radius}
        strokeDasharray={normalizedProgress >= 1 ? undefined : `${dashLength} ${dashGap}`} strokeDashoffset="0" />}
    </>}
  </ComicScrollProgressRing>;
}
