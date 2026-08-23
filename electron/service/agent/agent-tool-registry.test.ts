import { describe, expect, it } from 'vitest';

import { createAgentToolRegistry } from './agent-tool-registry';

describe('Agent Tool registry', () => {
  it('registers and executes only known tools', async () => {
    const registry = createAgentToolRegistry([
      {
        description: 'List the current directory',
        execute: async (input, context) => {
          context.onProgress({ message: '读取目录' });
          return { data: input, ok: true };
        },
        inputSchema: { type: 'object' },
        name: 'file.list',
        risk: 'read',
      },
    ]);
    const controller = new AbortController();
    const result = await registry.execute('file.list', { nodeId: 3 }, {
      appContext: {
        libraryId: 2,
        platform: 'darwin',
        selectedNodeIds: [],
      },
      onProgress: () => undefined,
      signal: controller.signal,
    });

    expect(result).toEqual({ data: { nodeId: 3 }, ok: true });
    expect(registry.list()).toHaveLength(1);
    await expect(registry.execute('media.extractAudio', {}, {
      appContext: { platform: 'darwin', selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: controller.signal,
    })).rejects.toThrow('Agent Tool 不存在');
  });

  it('rejects duplicate names and cancelled executions', async () => {
    const tool = {
      description: 'No-op',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'file.stat',
      risk: 'read' as const,
    };
    const registry = createAgentToolRegistry([tool]);
    expect(() => registry.register(tool)).toThrow('Agent Tool 已注册');

    const controller = new AbortController();
    controller.abort();
    await expect(registry.execute('file.stat', {}, {
      appContext: { platform: 'unknown', selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: controller.signal,
    })).rejects.toThrow('执行已取消');
  });
});
