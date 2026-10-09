import type { AgentTool } from '../agent-tool-registry';
import { AGENT_BUILT_IN_TYPES, normalizeAgentNodeConfigureInput } from '../../../../src/shared/agent/agent-node-config';

export const nodeConfigureTool: AgentTool = {
  name: 'node.configure', executor: 'renderer', risk: 'write', timeoutMs: 60_000,
  description: '设置当前资料库目录的内置类型和归档模式。path 或 nodeId 二选一，builtInType/ archiveMode 至少一个；未指定字段保持原值。DEF 自动关闭归档，DEF 不能与 archiveMode=1 组合。只修改该目录配置，不递归、不移动文件、不改封面或阅读进度；多个目录可用 library.batch。',
  inputSchema: { type: 'object', additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 2048, description: '当前资料库绝对路径，可使用 /。' },
      nodeId: { type: 'integer', minimum: 1 },
      builtInType: { type: 'string', enum: [...AGENT_BUILT_IN_TYPES] },
      archiveMode: { type: 'integer', enum: [0, 1], description: '0 为作品/普通浏览，1 为归档聚合；开启时需要非 DEF 内置类型。' },
    },
    oneOf: [{ properties: { path: {} }, required: ['path'] }, { properties: { nodeId: {} }, required: ['nodeId'] }],
    anyOf: [{ properties: { builtInType: {} }, required: ['builtInType'] }, { properties: { archiveMode: {} }, required: ['archiveMode'] }],
  },
  validate(input, context) {
    try {
      normalizeAgentNodeConfigureInput(input);
      if (!Number.isSafeInteger(context.appContext.libraryId) || Number(context.appContext.libraryId) <= 0) throw new Error('当前资料库不可用');
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '目录配置参数无效' }; }
  },
  assess(input) {
    const query = normalizeAgentNodeConfigureInput(input);
    return { behavior: 'ask', risk: 'write', preview: {
      title: '设置资源类型', risk: 'write', description: `设置“${query.path || `节点 ${query.nodeId}`}”的资源配置。`,
      details: [
        ...(query.builtInType !== undefined ? [{ label: '内置类型', value: query.builtInType }] : []),
        ...(query.archiveMode !== undefined ? [{ label: '归档模式', value: query.archiveMode === 1 ? '开启' : '关闭' }] : []),
      ],
    } };
  },
  createRendererRequest(input, context) {
    const query = normalizeAgentNodeConfigureInput(input);
    const observedSource = context.perception?.knownNodes?.find(node => node.libraryId === context.appContext.libraryId
      && (query.nodeId !== undefined ? node.id === query.nodeId : node.path === query.path));
    return { libraryId: context.appContext.libraryId, ...query, ...(observedSource ? { observedSource } : {}) };
  },
};
