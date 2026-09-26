import { useMemo, useRef, type CSSProperties } from 'react';

interface UseArchiveCardGridOptions {
  baseCardWidth?: number;
  gridGap?: number;
}

/** CSS owns responsive geometry; resizing must not rerender the card tree. */
export function useArchiveCardGrid(options?: UseArchiveCardGridOptions) {
  const baseCardWidth = Math.max(1, Math.floor(options?.baseCardWidth ?? 342));
  const gridGap = Math.max(0, Math.floor(options?.gridGap ?? 22));
  // The viewport ref remains the existing owner for scroll/session restoration.
  const viewportRef = useRef<HTMLElement | null>(null);
  const wrapperStyle = useMemo(
    () => ({
      '--archive-card-min-width': `${baseCardWidth}px`,
      '--archive-card-gap': `${gridGap}px`,
    } as CSSProperties),
    [baseCardWidth, gridGap],
  );

  return { viewportRef, wrapperStyle };
}
