import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSubtitleTranslation } from './useSubtitleTranslation';

const mocks = vi.hoisted(() => ({
  fetchProfiles: vi.fn(), fetchModels: vi.fn(), savePreferences: vi.fn(), toastError: vi.fn(),
  runner: { activeRowId: null, doneCount: 0, libraryId: 3, running: false, totalCount: 0 },
}));
vi.mock('@douyinfe/semi-ui', () => ({ Toast: { error: mocks.toastError, warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/features/ai-services/ai-service.api', () => ({ fetchAIServiceProfiles: mocks.fetchProfiles }));
vi.mock('../subtitle-translation.service', () => ({
  fetchAvailableTranslationModels: mocks.fetchModels,
  loadSubtitleTranslationPreferences: () => ({ model: '', reasoningEffort: 'auto', contextWindow: 0, presetPrompt: '' }),
  saveSubtitleTranslationPreferences: mocks.savePreferences,
  loadSubtitleFromDroppedFile: vi.fn(), loadSubtitleFromLibraryNode: vi.fn(), pickLocalSubtitleFile: vi.fn(),
  saveSubtitleToLibraryNode: vi.fn(), saveSubtitleToLocalFile: vi.fn(), translateSubtitleRow: vi.fn(),
}));
vi.mock('../subtitle-translation.runner', () => ({ subtitleTranslationRunner: {
  getSnapshot: () => mocks.runner, drainResults: () => new Map(), subscribe: () => () => undefined,
  start: vi.fn(), stop: vi.fn(),
} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function profile(id: string) {
  return { activeProfileId: id, profiles: [{ id, name: id, providerType: 'openai', baseUrl: 'https://example.invalid/v1',
    hasApiKey: false, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' }] };
}

const input: Omit<Parameters<typeof useSubtitleTranslation>[0], 'active'> = {
  draft: { fileFormat: null, fileName: '', rows: [], sourceType: null }, libraryId: 3, rootNodeId: 1,
  onDraftReplace: vi.fn(), onDraftUpdate: vi.fn(), selectedTreeNode: null,
};
let state!: ReturnType<typeof useSubtitleTranslation>;
function Harness({ active }: { active: boolean }) {
  state = useSubtitleTranslation({ ...input, active });
  return null;
}
let view: TestRenderer.ReactTestRenderer | undefined;
beforeEach(() => { vi.clearAllMocks(); mocks.fetchProfiles.mockResolvedValue(profile('a')); });
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('subtitle model request ownership', () => {
  it.each([true, false])('ignores old-service models and preserves current loading (old finishes first=%s)', async (oldFirst) => {
    const oldRequest = deferred<string[]>();
    const currentRequest = deferred<string[]>();
    mocks.fetchModels.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise);
    await act(async () => { view = TestRenderer.create(<Harness active />); });
    let oldResult!: Promise<boolean>;
    act(() => { oldResult = state.handlers.onLoadModels(); });
    expect(state.loadingModels).toBe(true);
    act(() => view!.update(<Harness active={false} />));
    mocks.fetchProfiles.mockResolvedValue(profile('b'));
    await act(async () => view!.update(<Harness active />));
    expect(state.activeServiceId).toBe('b');
    let currentResult!: Promise<boolean>;
    act(() => { currentResult = state.handlers.onLoadModels(); });
    if (oldFirst) {
      await act(async () => { oldRequest.resolve(['old-model']); expect(await oldResult).toBe(false); });
      expect(state.availableModels).toEqual([]);
      expect(state.config.model).toBe('');
      expect(state.loadingModels).toBe(true);
    }
    await act(async () => { currentRequest.resolve(['current-model']); expect(await currentResult).toBe(true); });
    if (!oldFirst) {
      await act(async () => { oldRequest.resolve(['old-model']); expect(await oldResult).toBe(false); });
    }
    expect(state.availableModels).toEqual(['current-model']);
    expect(state.config.model).toBe('current-model');
    expect(state.loadingModels).toBe(false);
    expect(mocks.savePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ model: 'current-model' }));
  });

  it('drops an old-service error while the new request is pending', async () => {
    const oldRequest = deferred<string[]>();
    const currentRequest = deferred<string[]>();
    mocks.fetchModels.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise);
    await act(async () => { view = TestRenderer.create(<Harness active />); });
    let oldResult!: Promise<boolean>;
    act(() => { oldResult = state.handlers.onLoadModels(); });
    act(() => view!.update(<Harness active={false} />));
    mocks.fetchProfiles.mockResolvedValue(profile('b'));
    await act(async () => view!.update(<Harness active />));
    let currentResult!: Promise<boolean>;
    act(() => { currentResult = state.handlers.onLoadModels(); });
    await act(async () => { oldRequest.reject(new Error('old service failed')); expect(await oldResult).toBe(false); });
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(state.loadingModels).toBe(true);
    await act(async () => { currentRequest.resolve(['current-model']); await currentResult; });
    expect(state.availableModels).toEqual(['current-model']);
  });

  it('invalidates model requests on unmount without saving a late default model', async () => {
    const request = deferred<string[]>();
    mocks.fetchModels.mockReturnValueOnce(request.promise);
    await act(async () => { view = TestRenderer.create(<Harness active />); });
    let result!: Promise<boolean>;
    act(() => { result = state.handlers.onLoadModels(); });
    act(() => { view!.unmount(); view = undefined; });
    await act(async () => { request.resolve(['late-model']); expect(await result).toBe(false); });
    expect(mocks.savePreferences).not.toHaveBeenCalled();
  });
});
