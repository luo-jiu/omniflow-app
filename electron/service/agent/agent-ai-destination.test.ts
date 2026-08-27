import { describe, expect, it } from 'vitest';

import { createAgentAiDestinationSnapshot } from './agent-ai-destination';

function snapshot(overrides: Partial<{
  baseUrl: string;
  configurationRevision: string;
  id: string;
  apiKey: string;
  model: string;
  name: string;
  profileId: string;
  providerType: 'claude' | 'deepseek' | 'local' | 'openai';
}> = {}) {
  const profileId = overrides.profileId || 'profile-1';
  return createAgentAiDestinationSnapshot({
    model: overrides.model || 'gpt-5.6',
    profileId,
    runtimeConnection: {
      apiKey: overrides.apiKey || 'sk-private-value',
      baseUrl: overrides.baseUrl || 'https://ai.example.com/v1/',
      configurationRevision: 'configurationRevision' in overrides
        ? overrides.configurationRevision
        : '2026-08-28T00:00:00.000Z',
      id: overrides.id || profileId,
      name: overrides.name || 'OpenAI 工作配置',
      providerType: overrides.providerType || 'openai',
    },
  });
}

describe('Agent AI destination snapshot', () => {
  it('returns only credential-free identities and authoritative display metadata', () => {
    const result = snapshot();

    expect(result).toEqual({
      configurationIdentity: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
      identity: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
      model: 'gpt-5.6',
      profileId: 'profile-1',
      profileLabel: 'OpenAI 工作配置',
      providerType: 'openai',
    });
    expect(JSON.stringify(result)).not.toContain('sk-private-value');
    expect(JSON.stringify(result)).not.toContain('https://ai.example.com');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    { configurationRevision: '2026-08-28T00:00:01.000Z' },
    { baseUrl: 'https://other.example.com/v1' },
    { model: 'gpt-5.6-mini' },
    { profileId: 'profile-2' },
    { providerType: 'claude' as const },
  ])('changes destination identity when an execution destination field changes', (overrides) => {
    const initial = snapshot();
    const changed = snapshot(overrides);

    expect(changed.identity).not.toBe(initial.identity);
    if ('model' in overrides) {
      expect(changed.configurationIdentity).toBe(initial.configurationIdentity);
    } else {
      expect(changed.configurationIdentity).not.toBe(initial.configurationIdentity);
    }
  });

  it('keeps harmless trailing Base URL slashes canonical', () => {
    expect(snapshot({ baseUrl: 'https://ai.example.com/v1/' }).identity)
      .toBe(snapshot({ baseUrl: 'https://ai.example.com/v1////' }).identity);
  });

  it('binds credential changes for a legacy runtime that has no explicit config revision', () => {
    const initial = snapshot({
      apiKey: 'sk-first-private-value',
      configurationRevision: undefined,
    });
    const changed = snapshot({
      apiKey: 'sk-second-private-value',
      configurationRevision: undefined,
    });

    expect(changed.identity).not.toBe(initial.identity);
    expect(JSON.stringify({ changed, initial })).not.toContain('sk-first-private-value');
    expect(JSON.stringify({ changed, initial })).not.toContain('sk-second-private-value');
  });

  it('rejects a runtime profile resolved for a different profile ID', () => {
    expect(() => snapshot({ id: 'profile-other' })).toThrow('配置与当前 Run 不匹配');
  });
});
