import { describe, expect, it } from 'vitest';
import { nodeConfigureTool } from './node-configure-tool';
import { libraryBatchTool } from './library-batch-tool';
import { createAgentToolRegistry } from '../agent-tool-registry';
import { normalizeAgentNodeConfigureInput } from '../../../../src/shared/agent/agent-node-config';

describe('node.configure tool contract', () => {
  const registry = createAgentToolRegistry([nodeConfigureTool, libraryBatchTool]);
  it('supports one target and partial configuration, with strict field/value validation', () => {
    for (const input of [{ nodeId: 8, builtInType: 'ASMR' }, { path: '/', archiveMode: 0 }, { path: '/comic', builtInType: 'COMIC', archiveMode: 1 }]) {
      expect(registry.validateInput('node.configure', input).ok).toBe(true);
    }
    for (const input of [{ nodeId: 8 }, { nodeId: 8, path: '/a', builtInType: 'COMIC' }, { path: '/a', builtInType: 'INVALID' },
      { path: '/a', archiveMode: true }, { path: '/a', archiveMode: 2 }, { path: '/a', archiveMode: 0, libraryId: 4 }, { builtInType: 'ASMR' }]) {
      expect(registry.validateInput('node.configure', input).ok).toBe(false);
    }
  });
  it('normalizes DEF without silently accepting an explicitly contradictory request', () => {
    expect(normalizeAgentNodeConfigureInput({ path: '/a', builtInType: 'DEF' })).toEqual({ path: '/a', builtInType: 'DEF', archiveMode: 0 });
    for (const input of [{ nodeId: 8, builtInType: 'DEF', archiveMode: 1 }, { path: '/a/../b', archiveMode: 0 }, { nodeId: 8, archiveMode: 0, recursive: true }]) {
      expect(() => normalizeAgentNodeConfigureInput(input)).toThrow();
    }
  });
  it('exposes configuration actions through the existing bounded batch schema', () => {
    expect(registry.validateInput('library.batch', { actions: [{ operation: 'node.configure', nodeId: 8, builtInType: 'AUDIO', archiveMode: 1 }] }).ok).toBe(true);
    expect(registry.validateInput('library.batch', { actions: [{ operation: 'node.configure', nodeId: 8, builtInType: 'HTML' }] }).ok).toBe(false);
  });
});
