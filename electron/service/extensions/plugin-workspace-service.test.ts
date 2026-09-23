import { createHash } from 'node:crypto';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginWorkspaceOpen, PluginWorkspaceEvent } from '../../../src/shared/plugins/workspace.types';
import type { PluginCommandExecution } from '../../../src/shared/plugins/manual-command.types';
import type { PluginManager } from './plugin-manager';
import type { IsolatedPluginLoadOptions } from './isolated-view';
import type { createPluginCommandService } from './plugin-command-service';

const mocks = vi.hoisted(() => ({ load: vi.fn(), open: vi.fn(), dispose: vi.fn() }));
vi.mock('electron', () => ({ app: { getAppPath: () => '/app' } }));
vi.mock('./isolated-view', () => ({ PluginDevelopmentHost: class { load = mocks.load; dispose = mocks.dispose; } }));
vi.mock('./library-resource', () => ({ openLibraryResource: mocks.open }));
import { createPluginWorkspaceService } from './plugin-workspace-service';

const ownerScope = { backendScope: 'https://backend.test/api', accountScope: 'user:7' };
const accountScope = createHash('sha256').update(JSON.stringify(['https://backend.test/api/', 7])).digest('hex');
const disposers: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
const drain = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const callbacks = new Set<(id?: string) => void>();
  const workspace = { id: 'example.json.workspace', title: 'JSON', entry: 'workspace.html', commandId: 'example.json.run' };
  const plugin = { id: 'example.json', fingerprint: 'a'.repeat(64), commands: [{ id: workspace.commandId, toolId: 'example.json.transform' }], agentTools: [{ id: 'example.json.transform', kind: 'file-output' }] };
  const manager = { resolveWorkspace: vi.fn(() => ({ plugin, workspace, directory: '/installed/json' })), stillWorkspaceAllowed: vi.fn(() => true),
    attachRuntime: (listener: (id?: string) => void) => { callbacks.add(listener); return () => { callbacks.delete(listener); }; }, started: vi.fn(), stopped: vi.fn(), requestFailed: vi.fn() };
  const sender = { id: 9, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents;
  const parent = { webContents: sender, isDestroyed: () => false, getContentSize: () => [1000, 700] } as unknown as BrowserWindow;
  const records: PluginCommandExecution[] = [];
  const commandService = { prepare: vi.fn(async (_sender, _input, onCreated) => {
    const record = { id: 'execution-id', revision: 1, status: 'preparing' } as PluginCommandExecution;
    records.push(record); onCreated?.(record); record.status = 'awaiting-approval'; return record;
  }), list: vi.fn(() => records) };
  const service = createPluginWorkspaceService({ manager: manager as unknown as PluginManager, getMainWindow: () => parent,
    commands: () => commandService as unknown as ReturnType<typeof createPluginCommandService>, apiBaseUrl: ownerScope.backendScope, storageOrigins: ['https://storage.test'] });
  const instance = { stop: vi.fn(), setBounds: vi.fn(), setActive: vi.fn(), setTheme: vi.fn() };
  mocks.load.mockResolvedValue(instance);
  const resource = { accountScope, libraryId: 3, nodeId: 7, name: 'source.json', size: 3, revision: 'v1' };
  mocks.open.mockResolvedValue(resource);
  const input: PluginWorkspaceOpen = { clientId: 'client-id', workspaceId: workspace.id, libraryId: 3, nodeId: 7, ownerScope, token: 'test-token', username: 'test-user',
    theme: { schemaVersion: 1, revision: 1, mode: 'light', colors: {} }, destination: { parentId: 5, fileName: 'output.json' } };
  disposers.push(() => service.dispose());
  const execution = () => (mocks.load.mock.calls.at(-1)![4] as IsolatedPluginLoadOptions).workspaceExecution!;
  const events = () => vi.mocked(sender.send).mock.calls.map(call => call[1] as PluginWorkspaceEvent);
  return { service, sender, parent, manager, commandService, records, instance, input, resource, callbacks, execution, events };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); });

describe('isolated workspace and manual command binding', () => {
  it('binds source, fingerprint and target in main and publishes execution identity before preparation finishes', async () => {
    const f = fixture(); const finished = deferred<PluginCommandExecution>();
    f.commandService.prepare.mockImplementation((_sender, _input, onCreated) => {
      const record = { id: 'execution-id', status: 'preparing' } as PluginCommandExecution;
      f.records.push(record); onCreated(record); return finished.promise;
    });
    expect(await f.service.open(f.sender, f.input)).toEqual({ ok: true });
    const acknowledged = f.execution().prepare({ select: ['rows'], pretty: true }, new AbortController().signal);
    expect(acknowledged).toMatchObject({ requestId: expect.any(String) });
    await drain();
    expect(f.commandService.prepare).toHaveBeenCalledWith(f.sender, { ownerScope, libraryId: 3, pluginId: 'example.json', commandId: 'example.json.run', nodeIds: [7],
      destination: { parentId: 5, fileName: 'output.json' }, parameters: { select: ['rows'], pretty: true } }, expect.any(Function));
    expect(f.events().map(event => event.type)).toEqual(['preparing', 'execution']);
    expect(f.instance.setBounds).toHaveBeenLastCalledWith(null);
    expect(() => f.service.destination(f.sender, f.input.clientId, { parentId: 99, fileName: 'changed.json' })).toThrow();
    expect(() => f.execution().prepare({}, new AbortController().signal)).toThrow();
    finished.resolve({ id: 'execution-id', status: 'awaiting-approval' } as PluginCommandExecution); await drain();
    expect(f.commandService.prepare).toHaveBeenCalledOnce();
  });
  it('refuses another account even when the renderer supplies valid credentials for an accessible file', async () => {
    const f = fixture(); mocks.open.mockResolvedValue({ ...f.resource, accountScope: 'another-user' });
    expect(await f.service.open(f.sender, f.input)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(JSON.stringify(f.events())).not.toContain('test-token');
  });
  it('rejects unbound windows and foreign backends before opening any resource', async () => {
    const f = fixture();
    await expect(f.service.open({ id: 10, isDestroyed: () => false } as WebContents, f.input)).rejects.toThrow();
    expect(await f.service.open(f.sender, { ...f.input, ownerScope: { ...ownerScope, backendScope: 'https://elsewhere.test/api' } })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('closes a pending open and rejects the late resource without loading a view', async () => {
    const f = fixture(); const pending = deferred<typeof f.resource>(); mocks.open.mockReturnValue(pending.promise);
    const opening = f.service.open(f.sender, f.input);
    f.service.close(f.sender, f.input.clientId); pending.resolve(f.resource);
    expect((await opening).ok).toBe(false); expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.open.mock.calls[0][0].signal.aborted).toBe(true);
  });
  it('stops all pending and loaded instances on management revocation without double-counting', async () => {
    const f = fixture(); await f.service.open(f.sender, f.input);
    for (const callback of f.callbacks) callback('example.json');
    expect(f.instance.stop).toHaveBeenCalledWith('revoked');
    expect(f.manager.stopped).toHaveBeenCalledOnce();
    expect(f.manager.stopped).toHaveBeenCalledWith('example.json', 'revoked', true);
    expect(() => f.execution().prepare({}, new AbortController().signal)).toThrow();
    f.service.close(f.sender, f.input.clientId);
    expect(f.manager.stopped).toHaveBeenCalledOnce();
  });
  it('does not erase an M1 execution when its view closes, and ignores late result events', async () => {
    const f = fixture(); const finished = deferred<PluginCommandExecution>();
    f.commandService.prepare.mockImplementation((_sender, _input, onCreated) => {
      const record = { id: 'execution-id', status: 'preparing' } as PluginCommandExecution;
      f.records.push(record); onCreated(record); return finished.promise;
    });
    await f.service.open(f.sender, f.input); f.execution().prepare({}, new AbortController().signal); await drain();
    f.service.close(f.sender, f.input.clientId);
    const count = f.events().length;
    finished.resolve({ id: 'execution-id', status: 'awaiting-approval' } as PluginCommandExecution); await drain();
    expect(f.records).toHaveLength(1); expect(f.events()).toHaveLength(count); expect(f.instance.stop).toHaveBeenCalledOnce();
  });
  it('keeps the native page hidden until an approved/rejected task is terminal, then clamps it to the host', async () => {
    const f = fixture(); await f.service.open(f.sender, f.input);
    const bounds = { x: 100, y: 80, width: 2000, height: 2000 };
    f.service.layout(f.sender, f.input.clientId, bounds);
    expect(f.instance.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 80, width: 900, height: 620 });
    f.execution().prepare({}, new AbortController().signal); await drain();
    f.service.layout(f.sender, f.input.clientId, bounds); expect(f.instance.setBounds).toHaveBeenLastCalledWith(null);
    f.records[0].status = 'cancelled';
    f.service.layout(f.sender, f.input.clientId, bounds);
    expect(f.instance.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 80, width: 900, height: 620 });
  });
  it('unlocks after a failed preparation and returns only a stable error event', async () => {
    const f = fixture(); f.commandService.prepare.mockRejectedValueOnce(new Error('private credential and filesystem details'));
    await f.service.open(f.sender, f.input); f.execution().prepare({}, new AbortController().signal); await drain();
    expect(f.events().at(-1)).toMatchObject({ type: 'error', code: 'UNAVAILABLE' });
    expect(JSON.stringify(f.events())).not.toContain('private credential');
    expect(() => f.service.destination(f.sender, f.input.clientId, { parentId: 8, fileName: 'next.json' })).not.toThrow();
  });
  it('retains a newer theme received while loading and ignores older revisions', async () => {
    const f = fixture(); const pending = deferred<typeof f.resource>(); mocks.open.mockReturnValue(pending.promise);
    const opening = f.service.open(f.sender, f.input);
    const newer = { ...f.input.theme, revision: 2, mode: 'dark' as const };
    f.service.theme(f.sender, f.input.clientId, newer); pending.resolve(f.resource); await opening;
    expect(f.instance.setTheme).toHaveBeenLastCalledWith(newer);
    f.service.theme(f.sender, f.input.clientId, f.input.theme);
    expect(f.instance.setTheme).toHaveBeenLastCalledWith(newer);
  });
});
