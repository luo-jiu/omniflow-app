import { describe, expect, it } from 'vitest';

import {
  MAX_AGENT_COMPOSER_HEIGHT,
  MIN_AGENT_COMPOSER_HEIGHT,
  resolveAgentComposerDragHeight,
} from './agent-composer-layout';

describe('Agent composer resize', () => {
  it('grows upward and shrinks downward', () => {
    expect(resolveAgentComposerDragHeight(130, 200, 170)).toBe(160);
    expect(resolveAgentComposerDragHeight(130, 200, 230)).toBe(100);
  });

  it('clamps the resized height', () => {
    expect(resolveAgentComposerDragHeight(100, 200, -1000)).toBe(MAX_AGENT_COMPOSER_HEIGHT);
    expect(resolveAgentComposerDragHeight(100, 200, 1000)).toBe(MIN_AGENT_COMPOSER_HEIGHT);
  });
});
