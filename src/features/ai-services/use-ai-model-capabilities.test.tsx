import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAIModelCapabilities } from './use-ai-model-capabilities';
import type { AIServiceProfile } from './ai-service.types';

const { fetchCapabilities } = vi.hoisted(() => ({ fetchCapabilities: vi.fn() }));
vi.mock('./ai-service.api', () => ({ fetchAIServiceModelCapabilities: fetchCapabilities }));
const profile: AIServiceProfile = { id: 'a', updatedAt: '1', createdAt: '1', baseUrl: 'https://example.com/v1', providerType: 'openai', name: 'test', hasApiKey: false };
const catalog = ['model-a'];
const response = { profileId: 'a', profileUpdatedAt: '1', model: 'model-a', fastMode: true };
afterEach(() => vi.resetAllMocks());

function render() {
  let current!: ReturnType<typeof useAIModelCapabilities>;
  function Harness({ selected = profile, model = 'model-a', active = true }: { selected?: AIServiceProfile; model?: string; active?: boolean }) {
    current = useAIModelCapabilities(selected, model, active, catalog);
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Harness />); });
  return { get current() { return current; }, update: (props: React.ComponentProps<typeof Harness>) => act(() => renderer.update(<Harness {...props} />)), unmount: () => act(() => renderer.unmount()) };
}

describe('model capability projection', () => {
  it('only accepts the exact current profile revision and model, then refreshes on opening', async () => {
    fetchCapabilities.mockResolvedValue({ ...response, profileUpdatedAt: 'old' });
    const hook = render();
    try {
      await act(async () => {});
      expect(hook.current.fastModeAvailable).toBe(false);
      fetchCapabilities.mockResolvedValue(response);
      await act(async () => { hook.current.refresh(); });
      expect(hook.current.fastModeAvailable).toBe(true);
      fetchCapabilities.mockResolvedValue({ ...response, fastMode: false });
      await act(async () => { hook.current.refresh(); });
      expect(hook.current.fastModeAvailable).toBe(false);
    } finally { hook.unmount(); }
  });

  it('rejects an old response after a connection switch and hides capabilities synchronously', async () => {
    let resolveOld!: (result: typeof response) => void;
    fetchCapabilities.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({ ...response, profileId: 'b', fastMode: false });
    const hook = render();
    try {
      await act(async () => {});
      hook.update({ selected: { ...profile, id: 'b' } });
      expect(hook.current.fastModeAvailable).toBe(false);
      await act(async () => { resolveOld(response); });
      expect(hook.current.fastModeAvailable).toBe(false);
    } finally { hook.unmount(); }
  });

  it('hides Fast on lookup failure and while the workspace is hidden', async () => {
    fetchCapabilities.mockResolvedValue(response);
    const hook = render();
    try {
      await act(async () => {});
      expect(hook.current.fastModeAvailable).toBe(true);
      hook.update({ active: false });
      expect(hook.current.fastModeAvailable).toBe(false);
      fetchCapabilities.mockRejectedValue(new Error('unavailable'));
      await act(async () => { hook.update({ active: true }); });
      expect(hook.current.fastModeAvailable).toBe(false);
    } finally { hook.unmount(); }
  });
});
