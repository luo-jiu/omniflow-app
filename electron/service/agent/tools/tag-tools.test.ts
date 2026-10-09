import { describe, expect, it } from 'vitest';
import { getAgentTagTools } from './tag-tools';
import { createAgentToolRegistry } from '../agent-tool-registry';

const node = { id: 9, libraryId: 3, parentId: 8, name: 'report', type: 'file' as const, path: '/report' };
const context = { appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
  perception: { knownNodes: [node], selectedNodes: [], collectedAt: '2026-09-10' },
  signal: new AbortController().signal, onProgress: () => undefined };
describe('tag tool contracts', () => {
  it('advertises only available reads and directly allows them', async () => {
    const tools = getAgentTagTools(); expect(tools.map(tool => tool.name)).toEqual(['tag.list', 'tag.update']);
    expect(await tools[0].assess?.({}, context)).toEqual({ behavior: 'allow', risk: 'read' });
    expect(tools[0].createRendererRequest?.({ nodeId: 9 }, context)).toMatchObject({ libraryId: 3, nodeId: 9, target: node });
    expect(await tools[0].validate?.({ nodeId: 10 }, context)).toMatchObject({ ok: false });
  });
  it('asks for writes and validates non-overlapping deltas', async () => {
    const tool = getAgentTagTools()[1]; const registry = createAgentToolRegistry([tool]);
    expect(registry.validateInput('tag.update', { nodeId: 9, addTagIds: [1] }).ok).toBe(true);
    expect(registry.validateInput('tag.update', { nodeId: 9, tagIds: [1] }).ok).toBe(false);
    expect(await tool.assess?.({ nodeId: 9, addTagIds: [1] }, context)).toMatchObject({ behavior: 'ask', risk: 'write' });
    expect(await tool.validate?.({ nodeId: 9, addTagIds: [1], removeTagIds: [1] }, context)).toMatchObject({ ok: false });
    expect(await tool.validate?.({ nodeId: 9 }, context)).toMatchObject({ ok: false });
  });
  it('uses strict schemas and rejects cross-library targets', async () => {
    const tools = getAgentTagTools(); const registry = createAgentToolRegistry(tools);
    expect(registry.validateInput('tag.list', { limit: 10, cursor: 'opaque-server-cursor', dimension: 'new-category' }).ok).toBe(true);
    for (const input of [{ keyword: 'a'.repeat(65) }, { cursor: 'a'.repeat(257) }, { limit: 11 }, { offset: 1 }, { revision: 'old' }, { cursor: '' }, { nodeId: 0 }, { libraryId: 4 }, { addTagIds: [1] }]) {
      expect(registry.validateInput('tag.list', input).ok).toBe(false);
    }
    expect(await tools[0].validate?.({ nodeId: 9 }, { ...context, appContext: { ...context.appContext, libraryId: 4 } }))
      .toMatchObject({ ok: false });
  });
});
