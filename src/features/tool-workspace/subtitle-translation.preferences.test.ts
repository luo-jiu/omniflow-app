import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSubtitleTranslationPreferences,
  saveSubtitleTranslationPreferences,
} from './subtitle-translation.service';

function createStorage() {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  } as Storage;
}

describe('subtitle translation preferences', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('migrates task settings and removes the legacy plaintext connection data', () => {
    storage.setItem('subtitle-translation-preferences:v1', JSON.stringify({
      apiKey: 'plaintext-secret',
      baseUrl: 'https://api.example.com/v1',
      contextWindow: 0,
      model: 'model-a',
      presetPrompt: 'prompt',
      targetLanguage: '日语',
      unloadModelAfterTranslate: true,
    }));

    expect(loadSubtitleTranslationPreferences()).toEqual({
      contextWindow: 0,
      model: 'model-a',
      presetPrompt: 'prompt',
      reasoningEffort: 'auto',
    });
    expect(storage.getItem('subtitle-translation-preferences:v1')).toBeNull();
    expect(storage.getItem('subtitle-translation-preferences:v2')).toBe(JSON.stringify({
      contextWindow: 0,
      model: 'model-a',
      presetPrompt: 'prompt',
      reasoningEffort: 'auto',
    }));
  });

  it('only persists task-level settings', () => {
    saveSubtitleTranslationPreferences({
      contextWindow: 3,
      model: 'model-b',
      presetPrompt: '',
      reasoningEffort: 'high',
    });

    expect(JSON.parse(storage.getItem('subtitle-translation-preferences:v2') || '{}'))
      .toEqual({
        contextWindow: 3,
        model: 'model-b',
        presetPrompt: '',
        reasoningEffort: 'high',
      });
  });
});
