import { describe, expect, it } from 'vitest';
import { shouldCheckAgentCompletion } from './agent-completion-check';

describe('long tool task completion checkpoint', () => {
  it('checks only once at a text-only candidate ending of a long task', () => {
    const base = { checked: false, completedToolCalls: 8, pendingToolCalls: 0, nonReadToolAttempted: false };
    expect(shouldCheckAgentCompletion(base)).toBe(true);
    expect(shouldCheckAgentCompletion({ ...base, checked: true, completedToolCalls: 40 })).toBe(false);
    expect(shouldCheckAgentCompletion({ ...base, pendingToolCalls: 1 })).toBe(false);
    expect(shouldCheckAgentCompletion({ ...base, completedToolCalls: 1 })).toBe(false);
    expect(shouldCheckAgentCompletion({ ...base, nonReadToolAttempted: true })).toBe(false);
  });
});
