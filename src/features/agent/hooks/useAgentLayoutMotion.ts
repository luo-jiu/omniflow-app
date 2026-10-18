import { useLayoutEffect, useRef, type RefObject } from 'react';

const LAYOUT_TRANSITION_PROPERTIES = new Set(['transform', 'opacity', 'padding-left', 'padding-right', 'height', 'top']);

export function useAgentLayoutMotion(
  rootRef: RefObject<HTMLElement>,
  request: number | null,
  onSettled?: (request: number) => void,
  waitForBubble = true,
): void {
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useLayoutEffect(() => {
    if (request === null) return;
    let active = true;
    const waitForLayout = () => {
      if (!active) return;
      const root = rootRef.current;
      const animations = typeof root?.getAnimations === 'function' ? root.getAnimations({ subtree: true }) : [];
      const transitions = animations.filter(animation => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return 'transitionProperty' in animation
          && typeof animation.transitionProperty === 'string'
          && LAYOUT_TRANSITION_PROPERTIES.has(animation.transitionProperty)
          && target?.hasAttribute('data-agent-layout-motion')
          && (waitForBubble || target.getAttribute('data-agent-layout-motion') !== 'bubble')
          && animation.playState !== 'finished'
          && (animation.playState === 'running' || animation.pending);
      });

      if (transitions.length === 0) {
        onSettledRef.current?.(request);
        return;
      }

      // Resizing can cancel this batch and start replacement transitions in the same request.
      void Promise.allSettled(transitions.map(animation => animation.finished)).then(waitForLayout);
    };
    waitForLayout();
    return () => { active = false; };
  }, [request, rootRef, waitForBubble]);
}
