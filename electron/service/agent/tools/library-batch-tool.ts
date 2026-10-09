import type { AgentTool } from '../agent-tool-registry';
import { AGENT_BUILT_IN_TYPES, normalizeAgentNodeConfigureInput } from '../../../../src/shared/agent/agent-node-config';

export const libraryBatchTool: AgentTool = {
  name: 'library.batch', executor: 'renderer', risk: 'write', timeoutMs: 120_000,
  description: '批量整理资料库文件。每项独立执行并继续后续项；commit_unknown 必须先核对，不能盲目重试。支持 file.rename、file.move、file.copy、tag.update、node.configure。',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['actions'],
    properties: {
      libraryId: { type: 'integer', minimum: 1 },
      actions: {
        type: 'array', minItems: 1, maxItems: 50,
        items: {
          type: 'object', additionalProperties: false, required: ['operation'],
          properties: {
            operation: { type: 'string', enum: ['file.rename', 'file.move', 'file.copy', 'tag.update', 'node.configure'] },
            builtInType: { type: 'string', enum: [...AGENT_BUILT_IN_TYPES] }, archiveMode: { type: 'integer', enum: [0, 1] },
            path: { type: 'string' }, nodeId: { type: 'integer', minimum: 1 },
            parentPath: { type: 'string' }, parentId: { type: 'integer', minimum: 1 }, name: { type: 'string' },
            addTagIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
            removeTagIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
            conflictPolicy: { type: 'string', enum: ['error', 'auto_rename'] },
          },
        },
      },
    },
  },
  validate(input, context) {
    const value = input as { actions?: unknown[]; libraryId?: number };
    if (Number(value?.libraryId ?? context.appContext.libraryId) !== context.appContext.libraryId
      || !Array.isArray(value?.actions) || value.actions.length < 1 || value.actions.length > 50) return { ok: false, message: '批量操作参数无效' };
    for (const item of value.actions) {
      if (!item || typeof item !== 'object' || (item as { operation?: string }).operation !== 'node.configure') continue;
      const config = { ...item } as Record<string, unknown>;
      delete config.operation;
      try { normalizeAgentNodeConfigureInput(config); }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : '目录配置参数无效' }; }
    }
    return { ok: true };
  },
  assess() { return { behavior: 'ask', risk: 'write', preview: { title: '批量整理资料库', description: '逐项执行并保留部分成功结果', risk: 'write' } }; },
  createRendererRequest(input, context) { return { ...(input as object), libraryId: Number(context.appContext.libraryId) }; },
};
