import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAIServiceIpc } from './aiService';
import { aiServiceModelDiscoveryCache } from '../service/aiServiceModelDiscoveryCache';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), active: vi.fn(), profile: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }));
vi.mock('../service/aiServiceStore', () => ({
  getActiveAIServiceRuntimeProfile: mocks.active, getAIServiceRuntimeProfile: mocks.profile,
  activateAIServiceProfile: vi.fn(), copyAIServiceProfile: vi.fn(), listAIServiceProfiles: vi.fn(),
  revealAIServiceProfileApiKey: vi.fn(), removeAIServiceProfile: vi.fn(), reorderAIServiceProfileList: vi.fn(), saveAIServiceProfile: vi.fn(),
}));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('Fast capability and completion IPC', () => {
  it.each([{ model: 'custom', declared: true }, { model: 'gpt-6-astra', declared: false }])(
    'enforces the main frame and carries $model Fast through the actual batch completion handler', async ({ model, declared }) => {
    vi.useFakeTimers();
    const profile = { id: 'ipc-fast-profile', configurationRevision: 'revision', name: 'test', providerType: 'openai' as const,
      baseUrl: 'https://ipc-fast.example/v1', apiKey: `ipc-fast-key-${model}` };
    mocks.active.mockReturnValue(profile); mocks.profile.mockReturnValue(profile);
    if (declared) aiServiceModelDiscoveryCache.publish(aiServiceModelDiscoveryCache.begin(profile),
      { data: [{ id: model, service_tiers: [{ id: 'priority' }] }] });
    const mainFrame = {};
    const sender = { id: 71, mainFrame, once: vi.fn(), isDestroyed: () => false };
    const mainWindow = { webContents: sender, isDestroyed: () => false };
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: any[]) => any>();
    registerAIServiceIpc({ handle: (channel: string, handler: Parameters<IpcMain['handle']>[1]) => {
      handlers.set(channel, handler);
    } } as unknown as IpcMain,
      { getMainWindow: () => mainWindow as unknown as BrowserWindow });
    const event = { sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
    const capabilities = handlers.get('ai-service:model-capabilities')!;
    expect(() => capabilities({ ...event, senderFrame: {} } as IpcMainInvokeEvent, model)).toThrow('无权访问');
    expect(capabilities(event, model)).toEqual({ model, fastMode: true, profileId: profile.id, profileUpdatedAt: 'revision' });
    expect(mocks.fetch).not.toHaveBeenCalled();
    const run = handlers.get('ai-service:run:begin')!(event, profile.id);
    try {
      vi.advanceTimersByTime(300_001);
      expect(capabilities(event, model).fastMode).toBe(!declared);
      mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'translated' } }] })));
      const result = await handlers.get('ai-service:complete')!(event, { profileId: profile.id, runSessionId: run.id,
        model, fastMode: true, systemPrompt: 'translate', userPrompt: 'line' });
      expect(result).toBe('translated');
      expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).service_tier).toBe('priority');
    } finally { handlers.get('ai-service:run:end')!(event, run.id); }
  });
});
