import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }));
import { createAgentModelCatalog } from './agent-model-catalog';
import { resolveAgentModelContextBudget } from './agent-model-context';
import { createAIServiceModelDiscoveryCache } from '../aiServiceModelDiscoveryCache';

describe('Agent model catalog', () => {
  const connection = { apiKey: 'test-key', baseUrl: 'https://example.com/v1', providerType: 'openai' as const };
  beforeEach(() => { mocks.fetch.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });
  it.each([{}, { data: 'invalid' }])('treats malformed successful response %j as a cooled-down failure while retaining old identity', async malformed => {
    const model = 'gpt-6.1-sol';
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const shared = createAIServiceModelDiscoveryCache();
    shared.publish(shared.begin(connection), { data: [{ id: model }] });
    const catalog = createAgentModelCatalog(shared);
    now.mockReturnValue(1_300_001);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(malformed)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    expect(await catalog.get(connection, model)).toEqual({ listedModelId: model });
    now.mockReturnValue(1_330_000);
    expect(await catalog.get(connection, model)).toEqual({ listedModelId: model });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(3_000);
    now.mockReturnValue(1_330_002);
    expect(await catalog.get(connection, model)).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('cools down a malformed response even when no directory was ever discovered', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mocks.fetch.mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'gpt-6.1-sol' }] })));
    const catalog = createAgentModelCatalog();
    expect(await catalog.get(connection, 'gpt-6.1-sol')).toBeUndefined();
    expect(await catalog.get(connection, 'gpt-6.1-sol')).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_030_001);
    expect(await catalog.get(connection, 'gpt-6.1-sol')).toEqual({ listedModelId: 'gpt-6.1-sol' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps an ID-only listing as exact model identity for the bundled window snapshot', async () => {
    const model = 'gpt-6.1-sol';
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: model }] })));
    const metadata = await createAgentModelCatalog().get(connection, model);
    expect(metadata).toEqual({ listedModelId: model });
    expect(resolveAgentModelContextBudget({ ...connection, model, metadata }))
      .toMatchObject({ contextWindowTokens: 272_000, maxContextWindowTokens: 872_000, source: 'catalog' });
  });
  it('retains a connection listing through a failed refresh and removes it after a successful refresh omits the model', async () => {
    const model = 'gpt-6.1-sol';
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: model }] })))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'other-model' }] })));
    const catalog = createAgentModelCatalog();
    expect(await catalog.get(connection, model)).toEqual({ listedModelId: model });
    now.mockReturnValue(1_300_001);
    const retained = await catalog.get(connection, model);
    expect(resolveAgentModelContextBudget({ ...connection, model, metadata: retained }).source).toBe('catalog');
    now.mockReturnValue(1_330_002);
    const removed = await catalog.get(connection, model);
    expect(removed).toBeUndefined();
    expect(resolveAgentModelContextBudget({ ...connection, model, metadata: removed }).source).toBe('fallback');
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it.each([
    { apiKey: 'other-key' }, { baseUrl: 'https://other.example/v1' }, { providerType: 'local' as const },
  ])('does not reuse another connection identity after changing %j', async changed => {
    const model = 'gpt-6.1-sol';
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: model }] })))
      .mockRejectedValueOnce(new Error('offline'));
    const catalog = createAgentModelCatalog();
    expect(await catalog.get(connection, model)).toEqual({ listedModelId: model });
    expect(await catalog.get({ ...connection, ...changed }, model)).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
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
