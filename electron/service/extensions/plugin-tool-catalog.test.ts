import { describe, expect, it } from 'vitest';
import type { PluginToolContribution } from '../../../packages/plugin-sdk/index.js';
import type { ManagedPlugin } from '../../../src/shared/plugin-management';
import { assertPluginToolNames, createPluginToolSnapshot, isPluginCommandToolAllowed } from './plugin-tool-catalog';
import renameManifest from '../../../samples/batch-rename/manifest.json';
import { parsePluginManifest } from './manifest';

const tool: PluginToolContribution = {
  id: 'test.csv.query', title: 'CSV 查询', description: '分析本次授权 CSV 文件', entry: 'tool.html',
  inputSchema: { type: 'object', properties: { resource: { type: 'object', properties: { nodeId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }, required: ['nodeId'], additionalProperties: false } }, required: ['resource'], additionalProperties: false },
  outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  resourceAccess: [{ parameter: 'resource', mode: 'read', kind: 'file' }], timeoutMs: 1000, maxResultBytes: 1024,
};
function plugin(overrides: Partial<ManagedPlugin> = {}): ManagedPlugin {
  return { id: 'test.csv', version: '1.0.0', fingerprint: 'a'.repeat(64), enabled: true, readApproved: true, toolApproved: true, source: 'local', installedAt: 'now', viewers: [], agentTools: [structuredClone(tool)], permissions: ['resource.read', 'agent.tools'], running: 0, ...overrides };
}
describe('frozen plugin tool catalog', () => {
  it('requires rename approval independently and filters each contribution by its own capability', () => {
    const rename = parsePluginManifest(renameManifest, 'darwin').agentTools![0];
    const mixed = plugin({ agentTools: [tool, rename], permissions: ['resource.read', 'resource.rename.propose', 'agent.tools'] });
    expect(createPluginToolSnapshot([mixed]).map(item => item.contribution.id)).toEqual([tool.id]);
    expect(createPluginToolSnapshot([{ ...mixed, readApproved: false, renameApproved: true }]).map(item => item.contribution.id)).toEqual([rename.id]);
    for (const override of [{ renameApproved: false }, { renameApproved: undefined }, { toolApproved: false }, { permissions: ['resource.read', 'agent.tools'] }]) {
      expect(createPluginToolSnapshot([plugin({ agentTools: [rename], renameApproved: true, ...override })])).toEqual([]);
    }
  });
  it('requires independent activation, resource and Tool approval', () => {
    for (const change of [{ enabled: false }, { readApproved: false }, { toolApproved: undefined }, { toolApproved: false }, { blockedReason: 'revoked' }, { permissions: ['resource.read'] }]) {
      expect(createPluginToolSnapshot([plugin(change)])).toEqual([]);
    }
    expect(createPluginToolSnapshot([plugin()])).toHaveLength(1);
  });
  it('allows only declared manual commands while retaining resource approvals and separate Agent identities', () => {
    const commands = [{ id: 'test.csv.run', title: '查询 CSV', toolId: tool.id, locations: ['file-menu' as const] }];
    const manual = plugin({ commands, toolApproved: false, permissions: ['resource.read'] });
    expect(createPluginToolSnapshot([manual])).toEqual([]);
    const snapshot = createPluginToolSnapshot([manual], [], 'command');
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].registrationId).not.toBe(createPluginToolSnapshot([plugin({ commands })])[0].registrationId);
    for (const changes of [{ enabled: false }, { readApproved: false }, { commands: [] }, { blockedReason: 'recovery' }, { permissions: [] }, { commands: [{ ...commands[0], toolId: 'other.tool' }] }, { commands: [{ ...commands[0], id: 'other.run' }] }]) {
      expect(isPluginCommandToolAllowed({ ...manual, ...changes }, tool)).toBe(false);
    }
    const rename = parsePluginManifest(renameManifest, 'darwin');
    const renamePlugin = plugin({ id: rename.id, agentTools: rename.agentTools, commands: rename.commands, readApproved: false, toolApproved: false, renameApproved: true, permissions: ['resource.rename.propose'] });
    expect(createPluginToolSnapshot([renamePlugin], [], 'command')).toHaveLength(1);
    expect(createPluginToolSnapshot([{ ...renamePlugin, renameApproved: false }], [], 'command')).toEqual([]);
  });
  it('freezes copied declarations and binds code fingerprint into registration identity', () => {
    const original = plugin(); const snapshot = createPluginToolSnapshot([original]);
    original.agentTools![0].title = 'changed';
    expect(snapshot[0].contribution.title).toBe('CSV 查询');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0].contribution.inputSchema.properties!.resource)).toBe(true);
    expect(createPluginToolSnapshot([plugin()])[0]?.registrationId).toBe(snapshot[0].registrationId);
    expect(createPluginToolSnapshot([plugin({ fingerprint: 'b'.repeat(64) })])[0].registrationId).not.toBe(snapshot[0].registrationId);
  });
  it('rejects canonical, provider-normalization and truncation collisions before provider use', () => {
    expect(() => assertPluginToolNames([{ id: 'a.b' }, { id: 'a.b' }])).toThrow('DUPLICATE_TOOL_ID');
    expect(() => assertPluginToolNames([{ id: 'a.b' }, { id: 'a_b' }])).toThrow('PLUGIN_TOOL_PROVIDER_NAME_CONFLICT');
    expect(() => assertPluginToolNames([{ id: 'a'.repeat(65) }, { id: 'a'.repeat(64) + 'b' }])).toThrow('PLUGIN_TOOL_PROVIDER_NAME_CONFLICT');
    expect(() => createPluginToolSnapshot([plugin()], ['test_csv_query'])).toThrow('PLUGIN_TOOL_PROVIDER_NAME_CONFLICT');
  });
});
