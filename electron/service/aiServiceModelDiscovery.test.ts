import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), getActiveProfile: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }));
vi.mock('./aiServiceStore', () => ({ getActiveAIServiceRuntimeProfile: mocks.getActiveProfile, getAIServiceRuntimeProfile: vi.fn() }));

import { listActiveAIServiceModels } from './aiServiceClient';
import { agentModelCatalog } from './agent/agent-model-catalog';
import { resolveAgentModelContextBudget } from './agent/agent-model-context';

const model = 'gpt-6.1-sol';
let connectionOrdinal = 0;
const directory = (ids: string[]) => new Response(JSON.stringify({ data: ids.map(id => ({ id })) }));

function setupConnection() {
  const connection = { providerType: 'openai' as const, baseUrl: 'https://example.test/v1', apiKey: `isolated-key-${++connectionOrdinal}` };
  mocks.getActiveProfile.mockReturnValue(connection);
  return connection;
}

describe('AI settings and Agent model discovery integration', () => {
  beforeEach(() => { mocks.fetch.mockReset(); mocks.getActiveProfile.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('serves repeated menu loads from a successful directory until its five-minute expiry', async () => {
    vi.useFakeTimers();
    setupConnection();
    mocks.fetch.mockResolvedValueOnce(directory([model])).mockResolvedValueOnce(directory(['new-model']));
    expect(await listActiveAIServiceModels()).toEqual([model]);
    expect(await listActiveAIServiceModels()).toEqual([model]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect(await listActiveAIServiceModels()).toEqual(['new-model']);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent menus but lets an explicit refresh replace an older in-flight result', async () => {
    setupConnection();
    let finish!: (response: Response) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(directory(['new-model']));
    const first = listActiveAIServiceModels();
    const second = listActiveAIServiceModels();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(await listActiveAIServiceModels({ forceRefresh: true })).toEqual(['new-model']);
    finish(directory([model]));
    expect(await first).toEqual(['new-model']);
    expect(await second).toEqual(['new-model']);
    expect(await listActiveAIServiceModels()).toEqual(['new-model']);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('isolates directories after credentials change and releases a failed pending request for retry', async () => {
    setupConnection();
    mocks.fetch.mockResolvedValueOnce(directory([model]));
    await listActiveAIServiceModels();
    setupConnection();
    mocks.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(directory(['other-model']));
    await expect(listActiveAIServiceModels()).rejects.toThrow('offline');
    expect(await listActiveAIServiceModels()).toEqual(['other-model']);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('reuses the actual UI listing in the production Agent singleton with one GET and the 272K budget', async () => {
    const connection = setupConnection();
    mocks.fetch.mockResolvedValueOnce(directory([model]));
    expect(await listActiveAIServiceModels()).toEqual([model]);
    const metadata = await agentModelCatalog.get(connection, model);
    expect(metadata).toEqual({ listedModelId: model });
    expect(resolveAgentModelContextBudget({ ...connection, model, metadata }))
      .toMatchObject({ contextWindowTokens: 272_000, source: 'catalog' });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicit UI refresh failure visible while retaining its earlier successful discovery', async () => {
    const connection = setupConnection();
    mocks.fetch.mockResolvedValueOnce(directory([model]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '目录暂不可用' } }), { status: 503 }));
    await listActiveAIServiceModels();
    await expect(listActiveAIServiceModels({ forceRefresh: true })).rejects.toThrow('目录暂不可用');
    expect(await agentModelCatalog.get(connection, model)).toEqual({ listedModelId: model });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('uses a new UI success immediately even during the Agent failure cooldown', async () => {
    const connection = setupConnection();
    mocks.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(directory([model]));
    expect(await agentModelCatalog.get(connection, model)).toBeUndefined();
    await listActiveAIServiceModels();
    expect(await agentModelCatalog.get(connection, model)).toEqual({ listedModelId: model });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('settles a late failed Agent discovery from a newer successful UI directory', async () => {
    const connection = setupConnection();
    let fail!: (error: Error) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { fail = reject; }))
      .mockResolvedValueOnce(directory([model]));
    const pending = agentModelCatalog.get(connection, model);
    await listActiveAIServiceModels();
    fail(new Error('Agent discovery timed out'));
    expect(await pending).toEqual({ listedModelId: model });
    expect(await agentModelCatalog.get(connection, model)).toEqual({ listedModelId: model });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not restore a removed ID from an older Agent response that arrives after UI refresh', async () => {
    const connection = setupConnection();
    let finish!: (response: Response) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(directory(['different-model']));
    const pending = agentModelCatalog.get(connection, model);
    expect(await listActiveAIServiceModels()).toEqual(['different-model']);
    finish(directory([model]));
    expect(await pending).toBeUndefined();
    expect(await agentModelCatalog.get(connection, 'different-model')).toEqual({ listedModelId: 'different-model' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
