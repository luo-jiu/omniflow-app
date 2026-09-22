import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedPlugin, PluginCatalog } from '@/shared/plugin-management';

const mocks = vi.hoisted(() => ({ catalog: null as PluginCatalog | null, listeners: new Set<() => void>() }));
vi.mock('@/service/plugins/plugin-management.api', () => ({ pluginManagementApi: {
  getSnapshot: () => mocks.catalog,
  subscribe: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); },
  start: () => undefined,
} }));
import { installManagedViewerContributions } from './installed-viewers';
import { viewerRegistry } from './viewer-registry';

const disposers: Array<() => void> = [];
const View = () => null;
function plugin(overrides: Partial<ManagedPlugin> = {}): ManagedPlugin {
  return { id: 'test.managed', version: '1.0.0', fingerprint: 'a'.repeat(64), enabled: true,
    readApproved: true, toolApproved: true, renameApproved: true, source: 'local', installedAt: 'now',
    permissions: ['resource.read'], running: 0, viewers: [{ id: 'test.managed.text', title: 'Text', extensions: ['txt'] }], ...overrides };
}
function sync(plugins: ManagedPlugin[]) {
  mocks.catalog = { revision: (mocks.catalog?.revision ?? 0) + 1, safeMode: false, plugins, logs: [] };
  for (const listener of mocks.listeners) listener();
}
beforeEach(() => { mocks.catalog = null; mocks.listeners.clear(); });
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); });

describe('managed Viewer contribution projection', () => {
  it.each([['resource.rename.propose', 'agent.tools'], ['resource.read', 'agent.tools']])('ignores enabled Tool-only packages with permissions %j', (...permissions) => {
    const register = vi.spyOn(viewerRegistry, 'registerBatch');
    sync([plugin({ viewers: [], permissions })]);
    expect(() => disposers.push(installManagedViewerContributions(View))).not.toThrow();
    expect(register).not.toHaveBeenCalled();
    expect(() => sync([plugin({ viewers: [], permissions, fingerprint: 'b'.repeat(64) })])).not.toThrow();
    expect(register).not.toHaveBeenCalled();
  });

  it('removes previous Viewers when an enabled package becomes Tool-only and restores them when contributed again', () => {
    const register = vi.spyOn(viewerRegistry, 'registerBatch');
    sync([plugin()]); const dispose = installManagedViewerContributions(View); disposers.push(dispose);
    const previousView = viewerRegistry.get('test.managed.text')?.View;
    expect(previousView).toBeTypeOf('function'); expect(register).toHaveBeenCalledTimes(1);
    expect(() => sync([plugin({ viewers: [], fingerprint: 'b'.repeat(64) })])).not.toThrow();
    expect(viewerRegistry.get('test.managed.text')).toBeUndefined(); expect(register).toHaveBeenCalledTimes(1);
    sync([plugin({ fingerprint: 'c'.repeat(64) })]);
    expect(viewerRegistry.get('test.managed.text')?.View).not.toBe(previousView); expect(register).toHaveBeenCalledTimes(2);
    dispose(); expect(viewerRegistry.get('test.managed.text')).toBeUndefined(); expect(mocks.listeners.size).toBe(0);
  });

  it('keeps normal Viewer contributions available alongside approved Tool-only packages', () => {
    const register = vi.spyOn(viewerRegistry, 'registerBatch');
    sync([plugin(), plugin({ id: 'test.rename', viewers: [], readApproved: false, permissions: ['resource.rename.propose', 'agent.tools'] })]);
    disposers.push(installManagedViewerContributions(View));
    expect(viewerRegistry.get('test.managed.text')).toBeDefined(); expect(register).toHaveBeenCalledTimes(1);
    sync([plugin({ enabled: false }), plugin({ id: 'test.rename', viewers: [], permissions: ['resource.rename.propose', 'agent.tools'] })]);
    expect(viewerRegistry.get('test.managed.text')).toBeUndefined(); expect(register).toHaveBeenCalledTimes(1);
  });
});
