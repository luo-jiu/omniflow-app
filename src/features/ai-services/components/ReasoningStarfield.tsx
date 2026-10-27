import React from 'react';
import styled from 'styled-components';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { createReasoningStarfieldRenderer } from './reasoning-starfield-renderer';

const Surface = styled.span`
  /* This local blue/violet material expresses maximum reasoning, independently of theme accents. */
  --reasoning-starfield-violet: #9763f1;
  --reasoning-starfield-indigo: #250e7a;
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
  contain: paint;
  &[data-maximum='true'] { background: linear-gradient(100deg, var(--reasoning-starfield-indigo), var(--reasoning-starfield-violet), var(--reasoning-starfield-indigo)); }

  &[hidden] { display: none; }
  canvas { display: block; width: 100%; height: 100%; }
`;

export interface ReasoningStarfieldProps { active: boolean; reducedMotion?: boolean; maximum?: boolean; fastMode?: boolean }

/** Decorative maximum-effort material. The caller owns selection and popup visibility. */
export default function ReasoningStarfield({ active, reducedMotion, maximum = true, fastMode = false }: ReasoningStarfieldProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const modeRef = React.useRef({ maximum, fastMode });
  const synchronizeRef = React.useRef<(() => void) | undefined>();
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !workspaceActive || !canvas) return;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let renderer = createReasoningStarfieldRenderer(canvas);
    let disposed = false;
    let lost = false;
    let intersecting = true;
    let frame: number | undefined;
    let previousTimestamp: number | undefined;
    let seconds = 0;
    let width = 0;
    let height = 0;
    const reduceMotion = () => reducedMotion ?? media?.matches ?? false;
    const visible = () => !disposed && !lost && intersecting && !document.hidden && width > 0 && height > 0;
    const stop = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      previousTimestamp = undefined;
    };
    const paint = () => renderer?.draw(seconds, width, height, { ...modeRef.current, reducedMotion: reduceMotion() }) === true;
    const animate = (timestamp: number) => {
      frame = undefined;
      if (!visible() || reduceMotion() || !renderer) { stop(); return; }
      if (previousTimestamp !== undefined) seconds += Math.min(64, Math.max(0, timestamp - previousTimestamp)) / 1000;
      previousTimestamp = timestamp;
      if (paint()) frame = window.requestAnimationFrame(animate);
      else stop();
    };
    const synchronize = () => {
      if (!visible() || !renderer) { stop(); return; }
      const needsAnimation = paint();
      if (reduceMotion() || !needsAnimation) stop();
      else if (frame === undefined) frame = window.requestAnimationFrame(animate);
    };
    const resize = () => {
      if (disposed) return;
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(0, Math.round(bounds.width));
      height = Math.max(0, Math.round(bounds.height));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      synchronize();
    };
    const contextLost = (event: Event) => { event.preventDefault(); lost = true; stop(); };
    const contextRestored = () => {
      if (disposed) return;
      renderer?.dispose();
      renderer = createReasoningStarfieldRenderer(canvas);
      lost = false;
      resize();
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    const intersectionObserver = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      if (disposed) return;
      intersecting = entries.some(entry => entry.target === canvas && entry.isIntersecting);
      synchronize();
    });
    resizeObserver?.observe(canvas);
    intersectionObserver?.observe(canvas);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', synchronize);
    media?.addEventListener('change', synchronize);
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    synchronizeRef.current = synchronize;
    resize();
    return () => {
      disposed = true;
      synchronizeRef.current = undefined;
      stop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', synchronize);
      media?.removeEventListener('change', synchronize);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      renderer?.dispose();
    };
  }, [active, reducedMotion, workspaceActive]);
  React.useEffect(() => {
    modeRef.current = { maximum, fastMode };
    synchronizeRef.current?.();
  }, [maximum, fastMode]);
  return <Surface aria-hidden="true" data-maximum={maximum} hidden={!active || !workspaceActive}><canvas ref={canvasRef} /></Surface>;
}
