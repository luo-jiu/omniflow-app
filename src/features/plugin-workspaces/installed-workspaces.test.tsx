import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedPlugin, PluginCatalog } from '@/shared/plugin-management';
const mocks = vi.hoisted(() => ({ catalog: null as PluginCatalog | null, listeners: new Set<() => void>() }));
vi.mock('@/service/plugins/plugin-management.api', () => ({ pluginManagementApi: {
  getSnapshot: () => mocks.catalog, start: () => undefined,
  subscribe: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); },
} }));
vi.mock('@/features/tool-workspace/tool-registry', async () => {
  const { ContributionRegistry } = await import('@/features/extensions/contribution-registry');
  return { toolRegistry: new ContributionRegistry(() => undefined) };
});
import { installManagedWorkspaceContributions } from './installed-workspaces';
import { toolRegistry } from '@/features/tool-workspace/tool-registry';

const id = 'example.transform.workspace';
const disposers: Array<() => void> = [];
function plugin(overrides: Partial<ManagedPlugin> = {}): ManagedPlugin {
  return { id: 'example.transform', version: '1.0.0', fingerprint: 'a'.repeat(64), enabled: true, readApproved: true,
    outputApproved: true, toolApproved: false, source: 'local', installedAt: 'now', viewers: [], running: 0,
    permissions: ['resource.read', 'resource.output.propose'],
    commands: [{ id: 'example.transform.run', title: '运行', toolId: 'example.transform.tool', locations: ['tool-workspace'] }],
    agentTools: [{ id: 'example.transform.tool', title: '转换', description: '转换', kind: 'file-output', entry: 'tool.html', timeoutMs: 30000,
      inputSchema: { type: 'object', properties: {} }, resourceAccess: [{ kind: 'file', mode: 'read', parameter: 'resource' }],
      output: { mediaTypes: ['application/json'], maxBytes: 1024 } }],
    workspaces: [{ id, title: 'JSON 转换', entry: 'workspace.html', commandId: 'example.transform.run' }], ...overrides };
}
function sync(plugins: ManagedPlugin[], flags: Partial<PluginCatalog> = {}) {
  mocks.catalog = { revision: (mocks.catalog?.revision ?? 0) + 1, safeMode: false, logs: [], plugins, ...flags };
  for (const listener of mocks.listeners) listener();
}
beforeEach(() => { mocks.catalog = null; mocks.listeners.clear(); });
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); });
describe('installed workspace navigation', () => {
  it('registers without Agent approval, keeps component identity during running updates, and replaces it on package update', () => {
    sync([plugin()]); disposers.push(installManagedWorkspaceContributions(() => null));
    const first = toolRegistry.get(id)?.View;
    expect(first).toBeTypeOf('function');
    sync([plugin({ running: 1 })]); expect(toolRegistry.get(id)?.View).toBe(first);
    sync([plugin({ fingerprint: 'b'.repeat(64) })]); expect(toolRegistry.get(id)?.View).not.toBe(first);
  });
  it('removes revoked or blocked workspaces and restores the stable navigation id after approval', () => {
    sync([plugin()]); disposers.push(installManagedWorkspaceContributions(() => null));
    sync([plugin({ outputApproved: false })]); expect(toolRegistry.get(id)).toBeUndefined();
    sync([plugin()]); expect(toolRegistry.get(id)).toBeDefined();
    sync([plugin()], { safeMode: true }); expect(toolRegistry.get(id)).toBeUndefined();
    sync([plugin()], { settingsRecoveryRequired: true }); expect(toolRegistry.get(id)).toBeUndefined();
    sync([]); expect(toolRegistry.get(id)).toBeUndefined();
  });
  it('ignores packages without workspaces and releases the catalog subscription', () => {
    sync([plugin({ workspaces: [] })]); const dispose = installManagedWorkspaceContributions(() => null);
    expect(toolRegistry.getSnapshot()).toHaveLength(0);
    sync([plugin()]); expect(toolRegistry.getSnapshot()).toHaveLength(1);
    dispose(); expect(toolRegistry.getSnapshot()).toHaveLength(0); expect(mocks.listeners.size).toBe(0);
  });
});
