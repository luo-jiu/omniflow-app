import type { AgentTool, AgentToolExecutionContext } from '../agent-tool-registry';

function target(input: unknown, context: AgentToolExecutionContext) {
  const query = input as { nodeId?: number };
  if (query.nodeId === undefined) return undefined;
  const node = context.perception?.knownNodes?.find(item => item.id === query.nodeId
    && item.libraryId === context.appContext.libraryId);
  if (!node) throw new Error('请先使用 file.stat/file.resolve 确认当前资料库节点');
  return node;
}

const tagListTool: AgentTool = {
  name: 'tag.list', executor: 'renderer', risk: 'read', timeoutMs: 30000,
  description: '查询当前资料库的已启用资源标签，或已确认 nodeId 的正式直接标签（包含停用项）。legacy=true 是未迁移的旧定义，只可查看或移除现有绑定，不可新增绑定。支持名称关键词及可选分类；分类不限制可绑定的资源类型。服务端游标分页，每页最多10项；继续时原样传 nextCursor，保持 nodeId/keyword/dimension 不变。',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    nodeId: { type: 'integer', minimum: 1 }, keyword: { type: 'string', maxLength: 64 },
    dimension: { type: 'string', maxLength: 64 },
    cursor: { type: 'string', minLength: 1, maxLength: 256 },
    limit: { type: 'integer', minimum: 1, maximum: 10 },
  } },
  validate(input, context) {
    try { target(input, context); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '标签目标无效' }; }
  },
  assess: () => ({ behavior: 'allow', risk: 'read' }),
  createRendererRequest(input, context) {
    const node = target(input, context);
    return { ...(input as object), libraryId: context.appContext.libraryId,
      ...(node ? { target: { id: node.id, libraryId: node.libraryId, parentId: node.parentId,
        name: node.name, ext: node.ext || '', type: node.type, path: node.path, updatedAt: node.updatedAt } } : {}) };
  },
};

const tagUpdateTool: AgentTool = {
  name: 'tag.update', executor: 'renderer', risk: 'write', timeoutMs: 60000,
  description: '给当前资料库明确节点原子增加或移除已有标签，不覆盖其他标签或文件内容。先 file.stat/file.resolve 确认 nodeId，tag.list 查询标签 ID；不是创建、修改或删除标签定义。addTagIds/removeTagIds 各最多100项、不可重叠，至少一项非空。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['nodeId'], properties: {
    nodeId: { type: 'integer', minimum: 1 },
    addTagIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
    removeTagIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
  } },
  validate(input, context) {
    try {
      if (!target(input, context)) throw new Error('需要明确 nodeId');
      const query = input as { addTagIds?: number[]; removeTagIds?: number[] };
      const ids = [...(query.addTagIds || []), ...(query.removeTagIds || [])];
      if (!ids.length || new Set(ids).size !== ids.length) throw new Error('增删标签必须非空且不可重复或重叠');
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '标签修改参数无效' }; }
  },
  assess(input, context) {
    const node = target(input, context)!;
    const query = input as { addTagIds?: number[]; removeTagIds?: number[] };
    return { behavior: 'ask', risk: 'write', preview: { title: '更新节点标签', risk: 'write',
      description: `更新“${node.path || node.name}”的指定标签，保留其他标签。`,
      details: [{ label: '增加标签 ID', value: (query.addTagIds || []).join(', ') || '无' },
        { label: '移除标签 ID', value: (query.removeTagIds || []).join(', ') || '无' }] } };
  },
  createRendererRequest: tagListTool.createRendererRequest,
};

export function getAgentTagTools(): AgentTool[] { return [tagListTool, tagUpdateTool]; }
