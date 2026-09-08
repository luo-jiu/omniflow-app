import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }));
import { createAgentModelCatalog } from './agent-model-catalog';

describe('Agent model catalog', () => {
  const connection = { apiKey: 'test-key', baseUrl: 'https://example.com/v1', providerType: 'openai' as const };
  beforeEach(() => { mocks.fetch.mockReset(); });
  it('caches metadata and coalesces discovery for the same connection', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'a', context_length: 128_000 }] })));
    const catalog = createAgentModelCatalog();
    const first = await Promise.all([catalog.get(connection, 'a'), catalog.get(connection, 'a')]);
    expect(first).toEqual([expect.objectContaining({ contextWindowTokens: 128_000 }), expect.objectContaining({ contextWindowTokens: 128_000 })]);
    expect(await catalog.get(connection, 'a')).toEqual(first[0]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('isolates credentials and endpoints, and degrades without blocking on missing metadata', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'a', context_window: 128_000 }] })))
      .mockResolvedValueOnce(new Response('no catalog', { status: 404 }))
      .mockRejectedValueOnce(new Error('offline'));
    const catalog = createAgentModelCatalog();
    expect(await catalog.get(connection, 'a')).toMatchObject({ contextWindowTokens: 128_000 });
    expect(await catalog.get({ ...connection, apiKey: 'other-key' }, 'a')).toBeUndefined();
    expect(await catalog.get({ ...connection, baseUrl: 'https://other.example/v1' }, 'a')).toBeUndefined();
    expect(await catalog.get({ ...connection, apiKey: 'other-key' }, 'a')).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
});
