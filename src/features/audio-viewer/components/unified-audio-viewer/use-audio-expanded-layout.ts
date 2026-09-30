import { useLayoutEffect, type RefObject } from 'react';

export function useAudioExpandedLayout(
  rootRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;

    const updateWindowOffset = () => {
      // Account for the workspace toolbar and tabs when locating the window's quarter line.
      root.style.setProperty('--audio-viewer-window-top', `${root.getBoundingClientRect().top}px`);
    };

    updateWindowOffset();
    const observer = new ResizeObserver(updateWindowOffset);
    observer.observe(root);
    window.addEventListener('resize', updateWindowOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateWindowOffset);
      root.style.removeProperty('--audio-viewer-window-top');
    };
  }, [enabled, rootRef]);
}
