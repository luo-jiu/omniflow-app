export function shouldSubmitAgentComposer(event: {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean; keyCode?: number };
}, busy: boolean, composing = false): boolean {
  return !busy && event.key === 'Enter' && !event.shiftKey
    && !composing && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

// Some IMEs end composition immediately before dispatching the confirming Enter.
export function createAgentCompositionGuard() {
  let composing = false;
  let endedAt = Number.NEGATIVE_INFINITY;
  let confirmingEnter = false;
  return {
    isActive(time = performance.now()) {
      return composing || confirmingEnter || (time >= endedAt && time - endedAt < 50);
    },
    start() { composing = true; endedAt = Number.NEGATIVE_INFINITY; },
    end(time: number) { composing = false; endedAt = time; },
    keyDown(key: string, time: number) {
      if (key !== 'Enter') return composing;
      confirmingEnter = confirmingEnter || composing || (time >= endedAt && time - endedAt < 50);
      return confirmingEnter;
    },
    keyUp(key: string) {
      if (key === 'Enter') { confirmingEnter = false; endedAt = Number.NEGATIVE_INFINITY; }
    },
    reset() { composing = false; confirmingEnter = false; endedAt = Number.NEGATIVE_INFINITY; },
  };
}
