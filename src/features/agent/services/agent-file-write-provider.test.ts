import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetchProviders: vi.fn(), resolveTarget: vi.fn(), testProvider: vi.fn() }));
vi.mock('@/features/storage-config/services/storage-config.api', () => mocks);
import { resolveHealthyLibraryWriteProvider } from './agent-file-authority';
import { executeAgentFileWrite } from './agent-file-write';
import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetchProviders.mockResolvedValue({ defaultProvider: 'offline', providers: [
    { alias: 'offline', label: 'Offline' }, { alias: 'online', label: 'Online' },
  ] });
  mocks.resolveTarget.mockResolvedValue({ providerAlias: 'offline' });
  mocks.testProvider.mockImplementation(async (alias: string) => ({ success: alias === 'online' }));
});

describe('direct writes reuse publication storage selection', () => {
  it('checks the routed provider and falls back to the healthy configured provider', async () => {
    expect(await resolveHealthyLibraryWriteProvider({ fileName: 'test.cpp', fileSize: 5 })).toEqual({ id: 'online', label: 'Online' });
    expect(mocks.testProvider.mock.calls.map(call => call[0])).toEqual(['offline', 'online']);
  });
  it('passes the selected provider to the real direct-write orchestration', async () => {
    const upload = vi.fn(async () => ({ id: 9, libraryId: 3 }));
    const request = { toolName: 'file.write', appContext: { libraryId: 3 },
      ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' },
      input: { libraryId: 3, path: '/test.cpp', content: 'hello' },
    } as AgentToolExecutionRequest;
    const output = await executeAgentFileWrite(request, {
      assertOwner: vi.fn(), resolvePath: vi.fn(async () => ({ id: 8 })) as any,
      stage: vi.fn(async () => ({ filePath: '/tmp/test.cpp' })), cleanup: vi.fn(), upload: upload as any,
    });
    expect(output.result.ok).toBe(true);
    expect(upload).toHaveBeenCalledWith('/tmp/test.cpp', 8, 3, expect.objectContaining({ storageProvider: 'online' }));
  });
  it('fails before creating an upload when all providers are offline', async () => {
    mocks.testProvider.mockResolvedValue({ success: false });
    await expect(resolveHealthyLibraryWriteProvider({ fileName: 'test.txt', fileSize: 5 })).rejects.toThrow('没有可用');
  });
  it('rechecks cancellation after a probe, before selecting or uploading', async () => {
    const controller = new AbortController();
    mocks.testProvider.mockImplementationOnce(async () => { controller.abort(); return { success: true }; });
    await expect(resolveHealthyLibraryWriteProvider({ fileName: 'test.txt', fileSize: 5 }, () => controller.signal.throwIfAborted()))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
