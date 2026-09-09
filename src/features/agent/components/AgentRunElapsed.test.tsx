import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import AgentRunElapsed from './AgentRunElapsed';

const run: AgentRunSnapshot = {
  id: 'r1', sessionId: 's1', model: 'test', profileId: 'test', reasoningEffort: 'medium',
  revision: 1, status: 'running', userPrompt: 'test',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
};

afterEach(() => vi.useRealTimers());

describe('Agent run timer lifecycle', () => {
  it('ticks only while active, freezes on completion and releases its interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(run.createdAt));
    let renderer!: TestRenderer.ReactTestRenderer;
    const props = { run, collapsible: false, expanded: false, onToggle: vi.fn() };
    act(() => { renderer = TestRenderer.create(<AgentRunElapsed {...props} />); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(JSON.stringify(renderer.toJSON())).toContain('用时 0m 2s');
    act(() => renderer.update(<AgentRunElapsed {...props} run={{ ...run, status: 'completed', finishedAt: '2026-09-09T00:00:03Z' }} />));
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(JSON.stringify(renderer.toJSON())).toContain('用时 0m 3s');
    act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
