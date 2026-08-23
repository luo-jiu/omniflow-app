import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadAgentModelPreferences,
  saveAgentModelPreferences,
} from './agent-model-preferences';

function createStorage(): Storage {
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

describe('Agent model preferences', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists the selected model and reasoning effort locally', () => {
    saveAgentModelPreferences({ model: 'gpt-5.2', reasoningEffort: 'high' });

    expect(loadAgentModelPreferences()).toEqual({
      model: 'gpt-5.2',
      reasoningEffort: 'high',
    });
  });

  it('falls back when stored preferences are invalid', () => {
    localStorage.setItem('agent-model-preferences:v1', '{');

    expect(loadAgentModelPreferences()).toEqual({
      model: '',
      reasoningEffort: 'auto',
    });
    expect(localStorage.getItem('agent-model-preferences:v1')).toBeNull();
  });
});
