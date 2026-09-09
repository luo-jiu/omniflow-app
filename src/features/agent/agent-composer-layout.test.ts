import { describe, expect, it } from 'vitest';

import {
  MAX_AGENT_COMPOSER_HEIGHT,
  MIN_AGENT_COMPOSER_HEIGHT,
  INITIAL_AGENT_COMPOSER_HEIGHT,
  clampAgentComposerHeight,
} from './agent-composer-layout';

describe('Agent composer automatic height', () => {
  it('uses content height within the allowed range', () => {
    expect(clampAgentComposerHeight(140)).toBe(140);
    expect(MAX_AGENT_COMPOSER_HEIGHT).toBe(INITIAL_AGENT_COMPOSER_HEIGHT * 2);
  });

  it('clamps the resized height', () => {
    expect(clampAgentComposerHeight(1000)).toBe(MAX_AGENT_COMPOSER_HEIGHT);
    expect(clampAgentComposerHeight(20)).toBe(MIN_AGENT_COMPOSER_HEIGHT);
  });
});
