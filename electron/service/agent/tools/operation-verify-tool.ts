import type { AgentTool } from '../agent-tool-registry';

export const operationVerifyTool: AgentTool = {
  name: 'operation.verify', risk: 'read', timeoutMs: 30000,
  description: '核对一次资料库写操作的实际结果。提供 operationId、nodeId 和预期存在状态/父目录/名称；工具重新读取当前节点或目录，不会重复执行写操作。适用于 commit_unknown、网络中断和批量逐项核对。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['operationId', 'nodeId', 'expectedExists'], properties: {
    operationId: { type: 'string', minLength: 1, maxLength: 200 }, nodeId: { type: 'integer', minimum: 1 },
    expectedExists: { type: 'boolean' }, expectedParentId: { type: 'integer', minimum: 0 }, expectedName: { type: 'string', maxLength: 512 },
  } },
  async execute(input, context) {
    const query = input as { operationId: string; nodeId: number; expectedExists: boolean; expectedParentId?: number; expectedName?: string };
    if (!context.readLibraryMetadata) return { ok: false, message: '当前运行时未接入资料库核对' };
    try {
      const result = await context.readLibraryMetadata({ kind: 'stat', nodeId: query.nodeId }, context.signal);
      const node = result.node;
      const matches = query.expectedExists && Boolean(node)
        && (query.expectedParentId === undefined || node!.parentId === query.expectedParentId)
        && (query.expectedName === undefined || `${node!.name}${node!.ext ? `.${node!.ext}` : ''}` === query.expectedName);
      const committed = query.expectedExists ? matches : !node;
      return { ok: true, message: `已核对操作 ${query.operationId}`, data: { operationId: query.operationId, status: committed ? 'committed' : 'not_committed', node: node || null } };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '操作结果仍无法确认', data: { operationId: query.operationId, status: 'commit_unknown' } };
    }
  },
};
