import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAIServiceModelDiscoveryCache } from './aiServiceModelDiscoveryCache';

const connection = { providerType: 'openai' as const, baseUrl: 'https://example.test/v1', apiKey: 'secret-key' };

describe('shared AI model discovery cache', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('stores only bounded identity and whitelisted metadata, without credentials or raw provider fields', () => {
    const cache = createAIServiceModelDiscoveryCache();
    const ticket = cache.begin(connection);
    const snapshot = cache.publish(ticket, { apiKey: 'leaked-key', data: [{ id: 'gpt-6.1-sol',
      context_window: 272_000, supports_tool_calling: false, instructions: 'do not retain', unknown: { secret: 'value' } }] });
    expect([...snapshot!.models.values()]).toEqual([{ listedModelId: 'gpt-6.1-sol', contextWindowTokens: 272_000, supportsToolCalling: false }]);
    expect(JSON.stringify(ticket)).not.toContain('secret-key');
    expect(JSON.stringify([...snapshot!.models])).not.toContain('do not retain');
    expect(Object.isFrozen(snapshot!.models.get('gpt-6.1-sol'))).toBe(true);
  });

  it('keeps factories isolated and only retains the latest 32 connection successes', () => {
    const cache = createAIServiceModelDiscoveryCache();
    for (let index = 0; index < 33; index++) {
      cache.publish(cache.begin({ ...connection, apiKey: `key-${index}` }), { data: [{ id: 'model' }] });
    }
    expect(cache.read({ ...connection, apiKey: 'key-0' })).toBeUndefined();
    expect(cache.read({ ...connection, apiKey: 'key-1' })?.models.has('model')).toBe(true);
    expect(createAIServiceModelDiscoveryCache().read({ ...connection, apiKey: 'key-1' })).toBeUndefined();
  });

  it('keeps expired successes available for fallback and does not erase them on malformed successful bodies', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const cache = createAIServiceModelDiscoveryCache();
    const previous = cache.publish(cache.begin(connection), { data: [{ id: 'model' }] });
    expect(previous?.expiresAt).toBe(301_000);
    now.mockReturnValue(301_001);
    expect(cache.read(connection)).toBe(previous);
    expect(cache.publish(cache.begin(connection), 'not a directory')).toBeUndefined();
    expect(cache.publish(cache.begin(connection), { unexpected: [] })).toBeUndefined();
    expect(cache.read(connection)).toBe(previous);
    expect(cache.publish(cache.begin(connection), { data: [] })?.models.size).toBe(0);
  });

  it('rejects a late older success after a newer request has published its directory', () => {
    const cache = createAIServiceModelDiscoveryCache();
    const older = cache.begin(connection);
    const newer = cache.begin(connection);
    const current = cache.publish(newer, { data: [{ id: 'new-model' }] });
    expect(cache.publish(older, { data: [{ id: 'old-model' }] })).toBe(current);
    expect([...cache.read(connection)!.models.keys()]).toEqual(['new-model']);
  });

  it('does not resurrect an older success after its newer connection snapshot was evicted', () => {
    const cache = createAIServiceModelDiscoveryCache();
    const older = cache.begin(connection);
    cache.publish(cache.begin(connection), { data: [{ id: 'fresh-model' }] });
    for (let index = 0; index < 32; index++) {
      cache.publish(cache.begin({ ...connection, apiKey: `other-key-${index}` }), { data: [] });
    }
    expect(cache.read(connection)).toBeUndefined();
    expect(cache.publish(older, { data: [{ id: 'stale-model' }] })).toBeUndefined();
    expect(cache.read(connection)).toBeUndefined();
    expect(cache.publish(cache.begin(connection), { data: [{ id: 'refreshed-model' }] })?.models.has('refreshed-model')).toBe(true);
  });
});
