import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginCommandExecution } from '@/shared/plugins/manual-command.types';
import type { PluginWorkspaceEvent } from '@/shared/plugins/workspace.types';
const mocks = vi.hoisted(() => ({
  catalog: null as any, list: vi.fn(), approve: vi.fn(), cancel: vi.fn(), reconcile: vi.fn(),
  open: vi.fn(), close: vi.fn(), layout: vi.fn(), destination: vi.fn(), theme: vi.fn(),
  workspaceEvent: undefined as ((event: PluginWorkspaceEvent) => void) | undefined,
  commandEvent: undefined as ((execution: PluginCommandExecution) => void) | undefined,
}));
vi.mock('@/service/plugins/plugin-management.api', () => ({ pluginManagementApi: {
  getSnapshot: () => mocks.catalog, start: () => undefined, subscribe: () => () => undefined,
} }));
vi.mock('@/service/plugins/plugin-workspace.api', () => ({ pluginWorkspaceApi: {
  available: () => true, open: mocks.open, close: mocks.close, layout: mocks.layout, destination: mocks.destination, theme: mocks.theme,
  subscribe: (listener: (event: PluginWorkspaceEvent) => void) => { mocks.workspaceEvent = listener; return () => { mocks.workspaceEvent = undefined; }; },
} }));
vi.mock('@/service/plugins/plugin-command.api', () => ({ pluginCommandApi: {
  available: () => true, scope: (libraryId: number) => ({ libraryId, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' } }),
  isCurrentScope: () => true, list: mocks.list, approve: mocks.approve, cancel: mocks.cancel, reconcile: mocks.reconcile,
  subscribe: (listener: (execution: PluginCommandExecution) => void) => { mocks.commandEvent = listener; return () => { mocks.commandEvent = undefined; }; },
} }));
vi.mock('@/features/plugin-commands/command-runtime', () => ({ startPluginCommandRuntime: () => undefined }));
vi.mock('@/features/file-explorer', () => ({ LibraryNodePickerModal: (props: any) => <div data-testid="file-picker" {...props} /> }));
vi.mock('@/features/file-explorer/services/file.api', () => ({ fetchNodeDetailById: async (id: number) => ({ id, libraryId: 3, parentId: 9, type: 'file', name: 'source', ext: 'json' }) }));
import PluginWorkspace from './PluginWorkspace';

const workspaceId = 'example.transform.workspace', commandId = 'example.transform.run';
const source = { pluginId: 'example.transform', pluginVersion: '1.0.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.transform.tool', registrationId: 'r1' };
function execution(status: PluginCommandExecution['status'], revision = 1): PluginCommandExecution {
  return { id: 'e1', libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' }, commandId, title: 'JSON 转换', source, status, revision,
    createdAt: '2026-09-23', updatedAt: '2026-09-23', action: { kind: 'plugin.file-output', version: 1, libraryId: 3, operationId: 'op1', ...source,
      sourceNodeId: 12, parentId: 9, fileName: 'result.json', providerId: 'local', mediaType: 'application/json', sizeBytes: 12, sha256: 'b'.repeat(64) } };
}
let tree: ReactTestRenderer | undefined;
function button(label: string) { return tree!.root.findAllByType('button').find(node => node.children.includes(label))!; }
async function mount() {
  await act(async () => { tree = create(<PluginWorkspace workspaceId={workspaceId} libraryId={3} rootNodeId={8}
    selectedNodeIds={[12]} selectedTreeNode={{ id: 12, key: '12', libraryId: 3, parentId: 9, type: 'file', name: 'source', ext: 'json' }} />,
  { createNodeMock: () => ({ getBoundingClientRect: () => ({ x: 20, y: 120, width: 700, height: 400 }) }) }); });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.commandEvent = undefined; mocks.workspaceEvent = undefined;
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.list.mockResolvedValue([]); mocks.open.mockResolvedValue({ ok: true }); mocks.close.mockResolvedValue(undefined);
  mocks.layout.mockResolvedValue(undefined); mocks.theme.mockResolvedValue(undefined); mocks.destination.mockResolvedValue(undefined);
  mocks.catalog = { revision: 1, safeMode: false, plugins: [{ id: source.pluginId, version: source.pluginVersion, fingerprint: source.packageFingerprint,
    enabled: true, readApproved: true, outputApproved: true, toolApproved: false, permissions: ['resource.read', 'resource.output.propose'],
    workspaces: [{ id: workspaceId, title: 'JSON 转换', commandId, entry: 'workspace.html' }],
    commands: [{ id: commandId, title: '转换', toolId: source.toolId, locations: ['tool-workspace'] }],
    agentTools: [{ id: source.toolId, title: '转换', description: 'JSON', kind: 'file-output', output: { mediaTypes: ['application/json'], maxBytes: 1024 } }],
  }] };
});
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals(); });
describe('plugin workspace host boundary', () => {
  it('opens only after explicit input, updates the destination without reloading, and closes on unmount', async () => {
    await mount(); expect(mocks.open).not.toHaveBeenCalled();
    await act(async () => button('打开工具').props.onClick());
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 3, nodeId: 12, workspaceId }));
    const clientId = mocks.open.mock.calls[0][0].clientId;
    await act(async () => tree!.root.findByProps({ id: 'plugin-workspace-filename' }).props.onChange({ target: { value: 'result.json' } }));
    expect(mocks.destination).toHaveBeenLastCalledWith(clientId, { parentId: 9, fileName: 'result.json' });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    await act(async () => tree?.unmount()); tree = undefined;
    expect(mocks.close).toHaveBeenCalledWith(clientId); expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('hides the native view for the host picker and restores it after dismissal', async () => {
    await mount(); await act(async () => button('打开工具').props.onClick());
    const clientId = mocks.open.mock.calls[0][0].clientId;
    await act(async () => button('选择目录').props.onClick());
    expect(mocks.layout).toHaveBeenLastCalledWith(clientId, null);
    await act(async () => tree!.root.findByProps({ 'data-testid': 'file-picker' }).props.onCancel());
    expect(mocks.layout).toHaveBeenLastCalledWith(clientId, expect.objectContaining({ width: 700 }));
  });
  it('shows main-owned approval outside the native view and permits return only after the task settles', async () => {
    await mount(); await act(async () => button('打开工具').props.onClick());
    const clientId = mocks.open.mock.calls[0][0].clientId;
    await act(async () => {
      mocks.workspaceEvent?.({ clientId, type: 'preparing', requestId: 'r1' });
      mocks.commandEvent?.(execution('awaiting-approval'));
      mocks.workspaceEvent?.({ clientId, type: 'execution', requestId: 'r1', executionId: 'e1' });
    });
    expect(mocks.layout).toHaveBeenLastCalledWith(clientId, null);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(button('返回编辑').props.disabled).toBe(true);
    expect(tree!.root.findByProps({ id: 'plugin-workspace-filename' }).props.disabled).toBe(true);
    mocks.approve.mockResolvedValue(execution('completed', 2));
    await act(async () => button('确认执行').props.onClick());
    expect(mocks.approve).toHaveBeenCalledWith({ libraryId: 3, executionId: 'e1', expectedRevision: 1 });
    expect(button('返回编辑').props.disabled).toBe(false);
    await act(async () => button('返回编辑').props.onClick());
    expect(mocks.layout).toHaveBeenLastCalledWith(clientId, expect.objectContaining({ width: 700 }));
    expect(mocks.open).toHaveBeenCalledTimes(1);
  });
  it('ignores stale instance/cross-library events and never regresses a terminal revision', async () => {
    await mount(); await act(async () => button('打开工具').props.onClick());
    await act(async () => {
      mocks.workspaceEvent?.({ clientId: 'old-client', type: 'preparing', requestId: 'r1' });
      mocks.commandEvent?.({ ...execution('awaiting-approval'), libraryId: 4 });
    });
    expect(tree!.root.findAllByProps({ 'aria-label': '宿主执行确认' })).toHaveLength(0);
    await act(async () => { mocks.commandEvent?.(execution('completed', 3)); mocks.commandEvent?.(execution('executing', 2)); });
    await act(async () => button('执行记录').props.onClick());
    expect(JSON.stringify(tree!.toJSON())).toContain('已完成'); expect(JSON.stringify(tree!.toJSON())).not.toContain('执行中');
  });
});
