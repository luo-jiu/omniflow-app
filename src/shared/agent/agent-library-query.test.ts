import { describe, expect, it } from 'vitest';
import { normalizeAgentLibraryNode, normalizeAgentLibraryReadResult } from './agent-library-query';

const node = { id: 8, libraryId: 3, parentId: 1, name: '作品', type: 'dir', path: '/作品', updatedAt: '2026-10-01T00:00:00.123456Z' };
describe('Agent library resource metadata', () => {
  it('preserves real configuration and full timestamp precision for list/stat/resolve/search projections', () => {
    const input = { ...node, builtInType: 'ASMR', archiveMode: 1, viewMeta: 'private reading progress' };
    const result = normalizeAgentLibraryReadResult({ libraryId: 3, node: input, directory: input, entries: [input] }, 3);
    for (const item of [result.node, result.directory, result.entries?.[0]]) {
      expect(item).toMatchObject({ builtInType: 'ASMR', archiveMode: 1, updatedAt: node.updatedAt });
      expect(item).not.toHaveProperty('viewMeta');
    }
  });
  it('does not invent configuration for old servers or accept invalid fields', () => {
    for (const input of [node, { ...node, builtInType: 'constructor', archiveMode: 9 }, { ...node, builtInType: null, archiveMode: '1' }]) {
      const result = normalizeAgentLibraryNode(input, 3);
      expect(result).not.toHaveProperty('builtInType'); expect(result).not.toHaveProperty('archiveMode');
    }
  });
});
