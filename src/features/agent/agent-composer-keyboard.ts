export function shouldSubmitAgentComposer(event: {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean; keyCode?: number };
}, busy: boolean): boolean {
  return !busy && event.key === 'Enter' && !event.shiftKey
    && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}
