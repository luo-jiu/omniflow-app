import { describe, expect, it } from 'vitest';
import { shouldSubmitAgentComposer } from './agent-composer-keyboard';

describe('Agent composer keyboard', () => {
  const enter = { key: 'Enter', shiftKey: false, nativeEvent: {} };
  it('submits ordinary Enter but preserves newlines, IME confirmation and running drafts', () => {
    expect(shouldSubmitAgentComposer(enter, false)).toBe(true);
    expect(shouldSubmitAgentComposer({ ...enter, shiftKey: true }, false)).toBe(false);
    expect(shouldSubmitAgentComposer({ ...enter, nativeEvent: { isComposing: true } }, false)).toBe(false);
    expect(shouldSubmitAgentComposer({ ...enter, nativeEvent: { keyCode: 229 } }, false)).toBe(false);
    expect(shouldSubmitAgentComposer(enter, true)).toBe(false);
  });
});
