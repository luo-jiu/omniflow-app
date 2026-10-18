import { useLayoutEffect, useState, type RefObject } from 'react';

export function useSidePanelMotion(
  sidePanelRef: RefObject<HTMLDivElement>,
  collapsed: boolean,
  signal: number,
): { collapsed: boolean; pending: boolean } {
  // Publish pending in the initiating render, before getAnimations starts the transition clock.
  const [settled, setSettled] = useState({ collapsed, signal });

  useLayoutEffect(() => {
    let active = true;
    const waitForWidth = () => {
      if (!active) return;
      const sidePanel = sidePanelRef.current;
      const animations = typeof sidePanel?.getAnimations === 'function' ? sidePanel.getAnimations() : [];
      const transitions = animations.filter(animation =>
        'transitionProperty' in animation && animation.transitionProperty === 'width'
        && (animation.effect as KeyframeEffect | null)?.target === sidePanel
        && animation.playState !== 'finished'
        && (animation.playState === 'running' || animation.pending),
      );

      if (transitions.length === 0) {
        setSettled(current => current.collapsed === collapsed && current.signal === signal
          ? current : { collapsed, signal });
        return;
      }

      // A resize can replace the width transition without changing the intent or signal.
      void Promise.allSettled(transitions.map(animation => animation.finished)).then(waitForWidth);
    };
    waitForWidth();
    return () => { active = false; };
  }, [collapsed, signal, sidePanelRef]);

  return {
    collapsed: settled.collapsed,
    pending: settled.collapsed !== collapsed || settled.signal !== signal,
  };
}
