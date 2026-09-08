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
  it('retires legacy Composer budget overrides without clearing other preferences', () => {
    saveAgentModelPreferences({ model: 'gpt-5.4', reasoningEffort: 'high' });
    const keys = ['agent-model-budget:v1:["profile-a","model-a"]', 'agent-model-budget:v1:["profile-b","model-b"]'];
    keys.forEach(key => localStorage.setItem(key, '{"contextWindowTokens":4096}'));
    localStorage.setItem('other-setting', 'keep');
    expect(loadAgentModelPreferences()).toEqual({ model: 'gpt-5.4', reasoningEffort: 'high' });
    keys.forEach(key => expect(localStorage.getItem(key)).toBeNull());
    expect(localStorage.getItem('other-setting')).toBe('keep');
  });

  it('uses normal model preferences even if legacy cleanup is unavailable', () => {
    saveAgentModelPreferences({ model: 'gpt-5.4', reasoningEffort: 'high' });
    localStorage.setItem('agent-model-budget:v1:old', 'invalid');
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(loadAgentModelPreferences()).toEqual({ model: 'gpt-5.4', reasoningEffort: 'high' });
  });
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
