import { describe, expect, it } from 'vitest';
import { getPluginCommandMenuItems, resolvePluginCommandMenuAction } from './command-menu';
import type { ManagedPlugin, PluginCatalog } from '@/shared/plugin-management';
import rename from '../../../samples/batch-rename/manifest.json';
import output from '../../../samples/json-transform/manifest.json';

const catalog = (...manifests: unknown[]): PluginCatalog => ({
  revision: 1, safeMode: false, logs: [],
  plugins: manifests.map(manifest => ({
    ...(manifest as object), fingerprint: 'a'.repeat(64), enabled: true, source: 'local',
    installedAt: '', running: 0, readApproved: true, outputApproved: true, renameApproved: true, toolApproved: false,
  } as ManagedPlugin)),
});

describe('manual plugin file menu', () => {
  it('supports multi-file rename but only single-file output without requiring AI tool approval', () => {
    const installed = catalog(rename, output);
    expect(getPluginCommandMenuItems(installed, 1)).toHaveLength(2);
    expect(getPluginCommandMenuItems(installed, 2).map(item => item.id)).toEqual([installed.plugins[0].commands![0].id]);
    expect(getPluginCommandMenuItems(installed, 0)).toEqual([]);
    expect(getPluginCommandMenuItems(installed, 51)).toEqual([]);
  });

  it('removes disabled, unapproved and safe-mode-blocked commands', () => {
    const installed = catalog(rename, output);
    installed.plugins[0].enabled = false;
    installed.plugins[1].outputApproved = false;
    expect(getPluginCommandMenuItems(installed, 1)).toEqual([]);
    installed.plugins[0].enabled = true;
    installed.plugins[0].blockedReason = 'SAFE_MODE';
    expect(getPluginCommandMenuItems(installed, 1)).toEqual([]);
  });

  it('rejects stale or injected overlay actions and leaves built-in commands unchanged', () => {
    const snapshot = [{ id: 'example.rename.manual' }];
    expect(resolvePluginCommandMenuAction('omniflow.node.info', snapshot, snapshot)).toBeNull();
    expect(resolvePluginCommandMenuAction('plugin-command:example.rename.manual', snapshot, snapshot)).toBe('example.rename.manual');
    expect(() => resolvePluginCommandMenuAction('plugin-command:example.rename.manual', snapshot, [])).toThrow();
    expect(() => resolvePluginCommandMenuAction('plugin-command:example.other.manual', snapshot, snapshot)).toThrow();
  });
});
