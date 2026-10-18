import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  AGENT_COMPOSER_CHROME_HEIGHT,
  INITIAL_AGENT_COMPOSER_HEIGHT,
  clampAgentComposerHeight,
} from '../agent-composer-layout';

export function useAgentComposerAutoHeight({ textareaRef, draft, enabled, layoutMotionPending, onHeightChange }: {
  textareaRef: RefObject<HTMLTextAreaElement>;
  draft: string;
  enabled: boolean;
  layoutMotionPending: boolean;
  onHeightChange: (height: number) => void;
}): void {
  const pendingRef = useRef(layoutMotionPending);
  pendingRef.current = layoutMotionPending;
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;
  const measureRef = useRef<(() => void) | null>(null);
  const previousInputRef = useRef<{ draft: string; enabled: boolean; pending: boolean } | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!enabled || !textarea) return;
    let subscribed = true;
    let measuredWidth = 0;
    const measure = (width = textarea.clientWidth) => {
      measuredWidth = width;
      textarea.style.height = `${INITIAL_AGENT_COMPOSER_HEIGHT - AGENT_COMPOSER_CHROME_HEIGHT}px`;
      const height = clampAgentComposerHeight(textarea.scrollHeight + AGENT_COMPOSER_CHROME_HEIGHT);
      textarea.style.height = `${height - AGENT_COMPOSER_CHROME_HEIGHT}px`;
      onHeightChangeRef.current(height);
    };
    measureRef.current = measure;
    const observer = new ResizeObserver(() => {
      // Keep the last usable height while the sidebar changes width. The textarea
      // already scrolls internally, so draft edits can still be measured immediately.
      if (!subscribed || pendingRef.current) return;
      const width = textarea.clientWidth;
      if (width !== measuredWidth) measure(width);
    });
    observer.observe(textarea);
    return () => {
      subscribed = false;
      observer.disconnect();
      measureRef.current = null;
    };
  }, [enabled, textareaRef]);

  useLayoutEffect(() => {
    const previous = previousInputRef.current;
    previousInputRef.current = { draft, enabled, pending: layoutMotionPending };
    const inputChanged = !previous || previous.draft !== draft || previous.enabled !== enabled;
    const motionFinished = previous?.pending && !layoutMotionPending;
    if (enabled && (inputChanged || motionFinished)) measureRef.current?.();
  }, [draft, enabled, layoutMotionPending, textareaRef]);
}
