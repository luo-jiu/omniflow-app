import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

interface UseArchiveCardGridOptions {
  baseCardWidth?: number;
  minScale?: number;
  gridGap?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function useArchiveCardGrid(options?: UseArchiveCardGridOptions) {
  const baseCardWidth = Math.max(1, Math.floor(options?.baseCardWidth ?? 342));
  const minScale = clamp(options?.minScale ?? 0.9, 0.75, 1);
  const gridGap = Math.max(0, Math.floor(options?.gridGap ?? 22));

  const minCardWidth = useMemo(
    () => Math.ceil(baseCardWidth * minScale),
    [baseCardWidth, minScale],
  );

  const viewportRef = useRef<HTMLElement | null>(null);
  const [gridMetrics, setGridMetrics] = useState<{ columns: number; cardWidth: number }>({
    columns: 1,
    cardWidth: baseCardWidth,
  });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const update = () => {
      const containerWidth = Math.max(Math.floor(element.clientWidth), 0);
      if (containerWidth <= 0) {
        setGridMetrics({ columns: 1, cardWidth: baseCardWidth });
        return;
      }

      const columns = Math.max(
        1,
        Math.floor((containerWidth + gridGap) / (minCardWidth + gridGap)),
      );
      const computedWidth = (containerWidth - (columns - 1) * gridGap) / columns;
      const nextCardWidth = columns === 1
        ? Math.max(1, Math.min(baseCardWidth, containerWidth))
        : clamp(Math.floor(computedWidth), minCardWidth, baseCardWidth);
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
  }, [baseCardWidth, gridGap, minCardWidth]);

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
