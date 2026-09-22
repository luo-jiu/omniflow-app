import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeAgentPluginToolSource } from './agent-plugin-source';

function source() {
  const identity = {
    pluginId: 'org.example.csv', pluginVersion: '0.1.0',
    packageFingerprint: 'a'.repeat(64), toolId: 'org.example.csv.query',
  };
  return {
    ...identity,
    registrationId: `plugin-tool:${createHash('sha256').update(JSON.stringify([
      'omniflow-agent-tool-v1', identity.pluginId, identity.pluginVersion,
      identity.packageFingerprint, identity.toolId,
    ])).digest('hex')}`,
  };
}

describe('Agent plugin source', () => {
  it('returns an immutable copy whose identity matches the host catalog', () => {
    const value = source();
    const normalized = normalizeAgentPluginToolSource(value, value.toolId);
    value.pluginVersion = '0.2.0';
    expect(normalized.pluginVersion).toBe('0.1.0');
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it.each([
    { pluginId: 'org.other.csv' },
    { pluginVersion: '0.1.1' },
    { packageFingerprint: 'b'.repeat(64) },
    { toolId: 'org.other.csv.query' },
    { registrationId: `plugin-tool:${'b'.repeat(64)}` },
    { pluginVersion: 'https://example.com/?token=secret' },
    { pluginVersion: '0.1.0\n' },
    { pluginId: 'a'.repeat(1025) },
    { token: 'never-persist-me' },
  ])('rejects altered, oversized or credential-bearing source %j', change => {
    expect(() => normalizeAgentPluginToolSource({ ...source(), ...change }))
      .toThrow('插件来源无效');
  });

  it('rejects inherited properties and accessors without invoking them', () => {
    expect(() => normalizeAgentPluginToolSource(Object.create(source())))
      .toThrow('插件来源无效');
    let called = false;
    const value = source();
    Object.defineProperty(value, 'pluginId', { enumerable: true, get() { called = true; return 'org.example.csv'; } });
    expect(() => normalizeAgentPluginToolSource(value)).toThrow('插件来源无效');
    expect(called).toBe(false);
    expect(() => normalizeAgentPluginToolSource(source(), 'file.list')).toThrow('插件来源无效');
  });
});
