interface AgentScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** One user gesture can emit many scroll frames; layout clamps emit scroll too. */
export function createAgentScrollFollow(follow: { current: boolean }) {
  let userScrolling = false;
  let scrollbarGesture: { initialTop: number; moved: boolean } | null = null;
  return {
    startUserScroll() {
      scrollbarGesture = null;
      userScrolling = true;
    },
    startScrollbarDrag(metrics: AgentScrollMetrics) {
      scrollbarGesture = { initialTop: metrics.scrollTop, moved: false };
      userScrolling = true;
    },
    finishPointerScroll(metrics: AgentScrollMetrics | null) {
      if (!scrollbarGesture) return;
      if (!scrollbarGesture.moved && (!metrics || metrics.scrollTop === scrollbarGesture.initialTop)) userScrolling = false;
      scrollbarGesture = null;
    },
    finishUserScroll() {
      scrollbarGesture = null;
      userScrolling = false;
    },
    pause() {
      scrollbarGesture = null;
      userScrolling = false;
      follow.current = false;
    },
    onScroll(metrics: AgentScrollMetrics) {
      if (!userScrolling) return;
      if (scrollbarGesture && metrics.scrollTop !== scrollbarGesture.initialTop) scrollbarGesture.moved = true;
      follow.current = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= 48;
    },
  };
}

export function isAgentScrollbarPointer(event: {
  target: EventTarget | null;
  currentTarget: HTMLElement;
  clientX: number;
}) {
  const element = event.currentTarget;
  // macOS overlay scrollbars reserve no client width; the workspace thumb is 8px.
  const scrollbarWidth = Math.max(8, element.offsetWidth - element.clientWidth);
  return event.target === element
    && event.clientX >= element.getBoundingClientRect().right - scrollbarWidth;
}

export function isAgentScrollKey(event: {
  key: string;
  target: EventTarget | null;
  currentTarget: HTMLElement;
  defaultPrevented: boolean;
}) {
  if (event.defaultPrevented || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
  return isAgentScrollWheel({
    target: event.target,
    currentTarget: event.currentTarget,
    defaultPrevented: event.defaultPrevented,
    deltaY: ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ? -1 : 1,
    ctrlKey: false,
  });
}

export function canAgentScrollInDirection(element: AgentScrollMetrics, deltaY: number) {
  return deltaY > 0
    ? element.scrollTop + element.clientHeight < element.scrollHeight - 1
    : deltaY < 0 && element.scrollTop > 0;
}

/** Resolve only the event's ancestor chain; an inner text scroller owns its wheel. */
export function isAgentScrollWheel(event: {
  target: EventTarget | null;
  currentTarget: HTMLElement;
  deltaY: number;
  defaultPrevented: boolean;
  ctrlKey: boolean;
}) {
  if (!event.deltaY || event.defaultPrevented || event.ctrlKey) return false;
  let element = event.target as HTMLElement | null;
  while (element && element !== event.currentTarget) {
    if (element.scrollHeight > element.clientHeight) {
      const style = window.getComputedStyle(element);
      if (['auto', 'scroll', 'overlay'].includes(style.overflowY)
        && (canAgentScrollInDirection(element, event.deltaY)
          || ['contain', 'none'].includes(style.overscrollBehaviorY))) return false;
    }
    element = element.parentElement;
  }
  return element === event.currentTarget;
}
