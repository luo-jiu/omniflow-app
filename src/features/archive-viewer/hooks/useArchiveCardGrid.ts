import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

interface UseArchiveCardGridOptions {
  baseCardWidth?: number;
  gridGap?: number;
}

export function useArchiveCardGrid(options?: UseArchiveCardGridOptions) {
  const baseCardWidth = Math.max(1, Math.floor(options?.baseCardWidth ?? 342));
  const gridGap = Math.max(0, Math.floor(options?.gridGap ?? 22));

  const viewportRef = useRef<HTMLElement | null>(null);
  const [gridMetrics, setGridMetrics] = useState<{ columns: number; cardWidth: number }>({
    columns: 1,
    cardWidth: baseCardWidth,
  });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const update = () => {
      const style = getComputedStyle(element);
      const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const containerWidth = Math.max(Math.floor(element.clientWidth - horizontalPadding), 0);
      if (containerWidth <= 0) {
        setGridMetrics({ columns: 1, cardWidth: baseCardWidth });
        return;
      }

      const columns = Math.max(
        1,
        Math.floor((containerWidth + gridGap) / (baseCardWidth + gridGap)),
      );
      const nextCardWidth = Math.max(1, Math.min(baseCardWidth, containerWidth));
      setGridMetrics((previous) => {
        if (
          previous.columns === columns
          && Math.abs(previous.cardWidth - nextCardWidth) < 0.5
        ) {
          return previous;
        }
        return {
          columns,
          cardWidth: nextCardWidth,
        };
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [baseCardWidth, gridGap]);

  const wrapperStyle = useMemo(
    () => ({
      '--archive-card-width': `${gridMetrics.cardWidth}px`,
      '--archive-card-gap': `${gridGap}px`,
      '--archive-column-count': String(gridMetrics.columns),
    } as CSSProperties),
    [gridGap, gridMetrics.cardWidth, gridMetrics.columns],
  );

  return {
    viewportRef,
    wrapperStyle,
  };
}
