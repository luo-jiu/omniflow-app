import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), release: vi.fn() }));
vi.mock('@/service/auth-session-release', () => ({ registerAuthSessionRuntime: () => () => undefined }));
vi.mock('./plugin-command.api', () => ({ pluginCommandApi: {
  scope: (libraryId: number) => ({ libraryId, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' } }),
} }));
vi.mock('@/utils/auth', () => ({ auth: { getToken: () => 'synthetic-token', getUsername: () => 'fixture' } }));
import { pluginWorkspaceApi } from './plugin-workspace.api';
const input = { clientId: 'client1', workspaceId: 'example.transform.workspace', libraryId: 3, nodeId: 12,
  theme: { schemaVersion: 1 as const, revision: 1, mode: 'light' as const, colors: { 'surface.app': '#fff', 'text.primary': '#222' } } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.open.mockResolvedValue({ ok: true }); mocks.close.mockResolvedValue(undefined); mocks.release.mockResolvedValue(undefined);
  vi.stubGlobal('window', { electronPluginWorkspace: { open: mocks.open, close: mocks.close, release: mocks.release } });
});
afterEach(async () => { await pluginWorkspaceApi.release(); vi.unstubAllGlobals(); });
describe('trusted plugin workspace bridge', () => {
  it('adds host credentials and releases only the departing library views', async () => {
    await pluginWorkspaceApi.open(input);
    await pluginWorkspaceApi.open({ ...input, libraryId: 4, clientId: 'client2' });
    expect(mocks.open).toHaveBeenCalledWith({ ...input, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' }, token: 'synthetic-token', username: 'fixture' });
    await pluginWorkspaceApi.releaseLibrary(3);
    expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledWith('client1');
  });
  it('closes a late successful open again after its library has been released', async () => {
    let finish!: (value: { ok: boolean }) => void;
    mocks.open.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = pluginWorkspaceApi.open(input);
    await pluginWorkspaceApi.releaseLibrary(3);
    finish({ ok: true });
    await expect(pending).resolves.toEqual({ ok: false, code: 'CANCELLED' });
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});
