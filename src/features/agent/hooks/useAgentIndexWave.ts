import React from 'react';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { indexWaveCenter } from '../agent-index-wave';

export function useAgentIndexWave(activeIndex: number): number | null {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const [center, setCenter] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!workspaceActive || activeIndex < 0) { setCenter(null); return; }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let startedAt = 0;
    let lastPaint = 0;
    const tick = (now: number) => {
      if (now - lastPaint >= 1000 / 30) {
        lastPaint = now;
        setCenter(indexWaveCenter(activeIndex, now - startedAt));
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      setCenter(null);
      if (document.hidden || reducedMotion.matches) return;
      startedAt = performance.now();
      lastPaint = 0;
      frame = requestAnimationFrame(tick);
    };
    sync();
    reducedMotion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [activeIndex, workspaceActive]);
  return !workspaceActive || activeIndex < 0 ? null : center;
}
