import type { AgentTool, AgentToolExecutionContext } from '../agent-tool-registry';

function target(input: unknown, context: AgentToolExecutionContext) {
  const query = input as { nodeId?: number; recursive?: boolean };
  const node = context.perception?.knownNodes?.find(item => item.id === query.nodeId && item.libraryId === context.appContext.libraryId);
  if (!node) throw new Error('请先使用 file.stat 或 file.resolve 获取目标节点，再用返回的 nodeId 删除');
  if (!node.parentId || node.path === '/') throw new Error('不能删除资料库根目录');
  if (node.type === 'dir' && query.recursive !== true) throw new Error('删除文件夹及其内容需要明确 recursive=true');
  return node;
}

export const fileDeleteTool: AgentTool = {
  name: 'file.delete', executor: 'renderer', risk: 'write', timeoutMs: 60000,
  description: '将当前 OmniFlow 资料库的文件移入回收站，可在系统回收站恢复，不彻底删除存储对象。先用 file.stat/file.resolve 确认 nodeId。文件夹仅在用户要求删除整个目录时传 recursive=true。无需下载文件，存储离线也可操作元数据；不是本机文件删除工具。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['nodeId'], properties: {
    nodeId: { type: 'integer', minimum: 1 }, recursive: { type: 'boolean', description: '明确删除文件夹及全部内容时设为 true。' },
  } },
  validate(input, context) {
    try { target(input, context); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '删除目标无效' }; }
  },
  assess(input, context) {
    const node = target(input, context);
    return { behavior: 'ask', risk: 'write', preview: { title: '移入回收站', risk: 'write',
      description: `将“${node.path || node.name}”${node.type === 'dir' ? '及其全部内容' : ''}移入回收站，可恢复。`,
      details: [{ label: '节点', value: String(node.id) }, { label: '位置', value: node.path || node.name }],
    } };
  },
  createRendererRequest(input, context) {
    const node = target(input, context);
    return { libraryId: node.libraryId, nodeId: node.id, parentId: node.parentId, name: node.name,
      ext: node.ext || '', type: node.type, path: node.path, updatedAt: node.updatedAt,
      recursive: (input as { recursive?: boolean }).recursive === true };
  },
};
