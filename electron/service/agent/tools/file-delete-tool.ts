import type { AgentTool, AgentToolExecutionContext } from '../agent-tool-registry';
import { normalizeAgentLibraryDirectoryPath } from '../../../../src/shared/agent/agent-library-path';

function requestedPath(input: unknown): string | undefined {
  const query = input as { path?: unknown; nodeId?: unknown };
  if (query.path === undefined) return undefined;
  if (query.nodeId !== undefined) throw new Error('path 和 nodeId 不能同时提供');
  const path = normalizeAgentLibraryDirectoryPath(query.path);
  if (path === '/') throw new Error('不能删除资料库根目录');
  return path;
}

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
  description: '将当前资料库文件移入回收站，可用recycle.restore恢复。提供资料库绝对path，或先用file.stat/file.resolve确认nodeId，二选一。文件夹仅在用户要求删除整个目录时传recursive=true。不下载或彻底删除存储对象；不是本机文件删除。',
  inputSchema: { type: 'object', additionalProperties: false, oneOf: [{ properties: { nodeId: {} }, required: ['nodeId'] }, { properties: { path: {} }, required: ['path'] }], properties: {
    path: { type: 'string', minLength: 2, maxLength: 2048 },
    nodeId: { type: 'integer', minimum: 1 }, recursive: { type: 'boolean', description: '明确删除文件夹及全部内容时设为 true。' },
  } },
  validate(input, context) {
    try { if (!requestedPath(input)) target(input, context); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '删除目标无效' }; }
  },
  assess(input, context) {
    const path = requestedPath(input);
    if (path) return { behavior: 'ask', risk: 'write', preview: { title: '移入回收站', risk: 'write',
      description: `将“${path}”${(input as { recursive?: boolean }).recursive ? '及其全部内容' : ''}移入回收站，可恢复。`, details: [{ label: '位置', value: path }] } };
    const node = target(input, context);
    return { behavior: 'ask', risk: 'write', preview: { title: '移入回收站', risk: 'write',
      description: `将“${node.path || node.name}”${node.type === 'dir' ? '及其全部内容' : ''}移入回收站，可恢复。`,
      details: [{ label: '节点', value: String(node.id) }, { label: '位置', value: node.path || node.name }],
    } };
  },
  createRendererRequest(input, context) {
    const path = requestedPath(input);
    if (path) return { libraryId: context.appContext.libraryId, path, recursive: (input as { recursive?: boolean }).recursive === true };
    const node = target(input, context);
    return { libraryId: node.libraryId, nodeId: node.id, parentId: node.parentId, name: node.name,
      ext: node.ext || '', type: node.type, path: node.path, updatedAt: node.updatedAt,
      recursive: (input as { recursive?: boolean }).recursive === true };
  },
};
