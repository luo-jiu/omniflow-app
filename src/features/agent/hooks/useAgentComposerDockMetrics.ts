import { useLayoutEffect, useRef, type RefObject } from 'react';

export function useAgentComposerDockMetrics({ composerFrameRef, scrollRef, enabled, layoutMotionPending,
  onHeightChange, onScrollbarWidth }: {
  composerFrameRef: RefObject<HTMLElement>;
  scrollRef: RefObject<HTMLElement>;
  enabled: boolean;
  layoutMotionPending: boolean;
  onHeightChange: (height: number) => void;
  onScrollbarWidth: (width: number) => void;
}): void {
  const inputsRef = useRef({ enabled, layoutMotionPending, onHeightChange, onScrollbarWidth });
  inputsRef.current = { enabled, layoutMotionPending, onHeightChange, onScrollbarWidth };
  const measureRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const frame = composerFrameRef.current;
    if (!enabled || !frame) return;
    const scroll = scrollRef.current;
    let subscribed = true;
    const measure = () => {
      const inputs = inputsRef.current;
      // Width motion must not force a layout read, even when the resulting metrics are unchanged.
      if (!subscribed || !inputs.enabled || inputs.layoutMotionPending) return;
      const height = frame.getBoundingClientRect().height;
      const scrollbarWidth = scroll ? scroll.offsetWidth - scroll.clientWidth : undefined;
      inputs.onHeightChange(height);
      if (scrollbarWidth !== undefined) inputs.onScrollbarWidth(scrollbarWidth);
    };
    measureRef.current = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    if (scroll) observer.observe(scroll);
    return () => {
      subscribed = false;
      observer.disconnect();
      measureRef.current = null;
    };
  }, [composerFrameRef, enabled, scrollRef]);

  useLayoutEffect(() => {
    if (enabled && !layoutMotionPending) measureRef.current?.();
  }, [composerFrameRef, enabled, layoutMotionPending, scrollRef]);
}
