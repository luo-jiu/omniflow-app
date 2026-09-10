import type { AgentTool } from '../agent-tool-registry';
import { normalizeAgentLibraryAction, type AgentLibraryMutationName } from '../../../../src/shared/agent/agent-library-actions';

const source = { path: { type: 'string', minLength: 2, maxLength: 2048 }, nodeId: { type: 'integer', minimum: 1 } };
const parent = { parentPath: { type: 'string', minLength: 1, maxLength: 2048 }, parentId: { type: 'integer', minimum: 1 } };
const nameProperty = { type: 'string', minLength: 1, maxLength: 240, description: '完整的新文件名，包含后缀；不是路径。' };
const descriptions: Record<string, string> = {
  'file.rename': '重命名当前资料库文件或文件夹。源用path或nodeId二选一，name为完整新名称（含后缀）。不移动，不覆盖同名节点。',
  'file.move': '移动当前资料库文件或整个文件夹到parentPath或parentId目标目录，源用path或nodeId二选一。保留名称和内容，目标同名报冲突，不覆盖；无需下载文件。',
  'file.copy': '独立复制当前资料库文件到parentPath或parentId。文件夹需明确recursive=true；name可指定副本名称，conflictPolicy默认error，可选auto_rename。复制存储对象而非共享同一可变文件，源存储必须可达。',
  'recycle.restore': '按回收站条目nodeId恢复文件或整个文件夹到原位置。先recycle.list确定条目；原父目录必须存在，同名时报告冲突，不覆盖。',
};
const titles: Record<string, string> = { 'file.rename': '重命名', 'file.move': '移动', 'file.copy': '复制', 'recycle.restore': '恢复文件' };

function mutation(toolName: Exclude<AgentLibraryMutationName, 'directory.create'>): AgentTool {
  return {
    name: toolName, executor: 'renderer', risk: 'write', timeoutMs: toolName === 'file.copy' ? 180000 : 60000,
    description: descriptions[toolName],
    inputSchema: { type: 'object', additionalProperties: false,
      properties: toolName === 'recycle.restore' ? { nodeId: source.nodeId } : { ...source,
        ...(toolName === 'file.rename' ? { name: nameProperty } : parent),
        ...(toolName === 'file.copy' ? { name: nameProperty, recursive: { type: 'boolean' }, conflictPolicy: { type: 'string', enum: ['error', 'auto_rename'] } } : {}),
      },
      ...(toolName === 'recycle.restore' ? { required: ['nodeId'] } : {
        oneOf: [{ properties: { path: {} }, required: ['path'] }, { properties: { nodeId: {} }, required: ['nodeId'] }],
        ...(toolName === 'file.rename' ? { required: ['name'] } : { anyOf: [{ properties: { parentPath: {} }, required: ['parentPath'] }, { properties: { parentId: {} }, required: ['parentId'] }] }),
      }),
    },
    validate(input, context) {
      try {
        normalizeAgentLibraryAction(toolName, input);
        if (!Number.isSafeInteger(context.appContext.libraryId) || Number(context.appContext.libraryId) <= 0) throw new Error('当前资料库不可用');
        return { ok: true };
      } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '文件操作参数无效' }; }
    },
    assess(input, context) {
      const query = normalizeAgentLibraryAction(toolName, input);
      const observed = context.perception?.knownNodes?.find(node => node.id === query.nodeId && node.libraryId === context.appContext.libraryId);
      const target = query.path || observed?.path || `节点 ${query.nodeId}`;
      return { behavior: 'ask', risk: 'write', preview: { title: titles[toolName], risk: 'write',
        description: `${titles[toolName]}“${target}”${query.name ? `为“${query.name}”` : ''}${query.parentPath || query.parentId ? `，目标目录：${query.parentPath || query.parentId}` : ''}。不覆盖同名内容。`,
        details: [{ label: '范围', value: '当前资料库' }, ...(query.recursive ? [{ label: '目录内容', value: '包含整个子树' }] : [])],
      } };
    },
    createRendererRequest(input, context) {
      const query = normalizeAgentLibraryAction(toolName, input);
      const observedSource = context.perception?.knownNodes?.find(node => node.id === query.nodeId && node.libraryId === context.appContext.libraryId);
      return { libraryId: context.appContext.libraryId, ...query, ...(observedSource ? { observedSource } : {}) };
    },
  };
}

export const recycleListTool: AgentTool = {
  name: 'recycle.list', executor: 'renderer', risk: 'read', timeoutMs: 30000,
  description: '浏览或按文件名搜索当前资料库回收站的顶层条目，返回可用于recycle.restore的nodeId。limit默认50最多100；hasMore时保持keyword和revision，使用nextOffset继续。不会返回存储签名URL或物理路径。',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    keyword: { type: 'string', maxLength: 256 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0 }, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  } },
  assess: () => ({ behavior: 'allow', risk: 'read' }),
  createRendererRequest: (input, context) => ({ ...(input as object), libraryId: context.appContext.libraryId }),
};
export const libraryActionTools = [mutation('file.rename'), mutation('file.move'), mutation('file.copy'), recycleListTool, mutation('recycle.restore')];
