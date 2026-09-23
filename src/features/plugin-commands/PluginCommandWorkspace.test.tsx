import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginCommandExecution } from '@/shared/plugins/manual-command.types';

const mocks = vi.hoisted(() => ({
  catalog: null as any, prepare: vi.fn(), approve: vi.fn(), cancel: vi.fn(), reconcile: vi.fn(),
  list: vi.fn(), refresh: vi.fn(), event: undefined as ((execution: PluginCommandExecution) => void) | undefined,
}));
vi.mock('@/service/plugins/plugin-management.api', () => ({ pluginManagementApi: {
  subscribe: () => () => undefined, getSnapshot: () => mocks.catalog, start: () => undefined,
} }));
vi.mock('@/service/plugins/plugin-command.api', () => ({ pluginCommandApi: {
  available: () => true, scope: (libraryId: number) => ({ libraryId, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' } }),
  isCurrentScope: () => true, subscribe: (listener: (execution: PluginCommandExecution) => void) => { mocks.event = listener; return () => { mocks.event = undefined; }; },
  list: mocks.list, prepare: mocks.prepare, approve: mocks.approve, cancel: mocks.cancel, reconcile: mocks.reconcile,
} }));
vi.mock('./command-runtime', () => ({ startPluginCommandRuntime: () => undefined }));
vi.mock('@/features/file-explorer', () => ({ LibraryNodePickerModal: () => null }));
vi.mock('@/features/file-explorer/services/file.api', () => ({ fetchNodeDetailById: async (id: number) => ({ id, libraryId: 3, parentId: 9, type: 'file', name: 'source', ext: 'csv' }) }));
vi.mock('@/features/file-explorer/services/node-mutation-events', () => ({ notifyLibraryNodesMutated: vi.fn() }));
import PluginCommandWorkspace from './PluginCommandWorkspace';

const source = { pluginId: 'example.export', pluginVersion: '1.0.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.export.tool', registrationId: 'r1' };
function execution(status: PluginCommandExecution['status'], revision = 1): PluginCommandExecution {
  return { id: 'e1', libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' }, commandId: 'example.export.run', title: '导出', source, status, revision,
    createdAt: '2026-09-23', updatedAt: '2026-09-23', action: { kind: 'plugin.file-output', version: 1, libraryId: 3, operationId: 'op1', ...source,
      sourceNodeId: 12, parentId: 9, fileName: 'result.json', providerId: 'local', mediaType: 'application/json', sizeBytes: 12, sha256: 'b'.repeat(64) },
    preview: { title: '确认', description: '确认保存', risk: 'write', details: [{ label: '目标目录', value: '文档' }] } };
}
function button(tree: ReactTestRenderer, label: string) { return tree.root.findAllByType('button').find(node => node.children.includes(label))!; }
const request = { id: 1, commandId: 'example.export.run', nodeIds: [12] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.event = undefined; mocks.list.mockResolvedValue([]);
  mocks.catalog = { revision: 1, safeMode: false, plugins: [{ id: source.pluginId, version: source.pluginVersion, fingerprint: source.packageFingerprint,
    enabled: true, readApproved: true, outputApproved: true, toolApproved: false, permissions: ['resource.read', 'resource.output.propose'],
    commands: [{ id: request.commandId, title: '导出', toolId: source.toolId, locations: ['file-menu', 'tool-workspace'] }],
    agentTools: [{ id: source.toolId, title: '导出', description: 'CSV 导出', kind: 'file-output', inputSchema: { type: 'object', required: [], properties: {} }, output: { mediaTypes: ['application/json'], maxBytes: 1048576 } }],
  }] };
});
describe('manual plugin commands', () => {
  it('prepares from host file selection and requires a separate explicit approval', async () => {
    mocks.prepare.mockResolvedValue(execution('awaiting-approval')); mocks.approve.mockResolvedValue(execution('completed', 2));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<PluginCommandWorkspace libraryId={3} rootNodeId={8} request={request} />); });
    await act(async () => tree.root.findByProps({ id: 'plugin-command-filename' }).props.onChange({ target: { value: 'result.json' } }));
    await act(async () => button(tree, '准备并预览').props.onClick());
    expect(mocks.prepare).toHaveBeenCalledWith({ libraryId: 3, pluginId: source.pluginId, commandId: request.commandId, nodeIds: [12], parameters: {}, destination: { parentId: 9, fileName: 'result.json' } });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('文档');
    await act(async () => button(tree, '确认执行').props.onClick());
    expect(mocks.approve).toHaveBeenCalledWith({ libraryId: 3, executionId: 'e1', expectedRevision: 1 });
    await act(async () => tree.unmount());
  });
  it('can cancel the main preparation while the prepare promise is pending', async () => {
    let finish!: (value: PluginCommandExecution) => void;
    mocks.prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.cancel.mockResolvedValue(execution('cancelled', 2));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<PluginCommandWorkspace libraryId={3} rootNodeId={8} request={request} />); });
    await act(async () => tree.root.findByProps({ id: 'plugin-command-filename' }).props.onChange({ target: { value: 'result.json' } }));
    await act(async () => { button(tree, '准备并预览').props.onClick(); });
    await act(async () => mocks.event?.(execution('preparing')));
    expect(button(tree, '取消任务').props.disabled).toBe(false);
    await act(async () => button(tree, '取消任务').props.onClick());
    expect(mocks.cancel).toHaveBeenCalledOnce();
    await act(async () => finish(execution('preparing')));
    expect(JSON.stringify(tree.toJSON())).toContain('已取消');
    await act(async () => tree.unmount());
  });
  it('rejects cross-library events and keeps a terminal revision ahead of late events', async () => {
    mocks.list.mockResolvedValue([execution('completed', 3)]);
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<PluginCommandWorkspace libraryId={3} />); });
    await act(async () => { mocks.event?.(execution('executing', 2)); mocks.event?.({ ...execution('failed', 4), libraryId: 4 }); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('已完成'); expect(output).not.toContain('执行中');
    await act(async () => tree.unmount());
  });
  it('keeps cancellation available after approval while main is executing', async () => {
    let finish!: (value: PluginCommandExecution) => void;
    mocks.list.mockResolvedValue([execution('awaiting-approval')]);
    mocks.approve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.cancel.mockResolvedValue(execution('cancelled', 3));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<PluginCommandWorkspace libraryId={3} />); });
    await act(async () => { button(tree, '确认执行').props.onClick(); });
    await act(async () => mocks.event?.(execution('executing', 2)));
    expect(button(tree, '取消任务').props.disabled).toBe(false);
    await act(async () => button(tree, '取消任务').props.onClick());
    await act(async () => finish(execution('cancelled', 3)));
    expect(mocks.cancel).toHaveBeenCalledWith({ libraryId: 3, executionId: 'e1', expectedRevision: 2 });
    await act(async () => tree.unmount());
  });
});
