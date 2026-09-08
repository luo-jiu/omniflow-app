import type { AgentTool, AgentToolExecutionContext, AgentToolPermissionDecision } from '../agent-tool-registry';
import { AGENT_TEXT_MAX_BYTES, sliceAgentText, type AgentTextReadQuery } from '../agent-text-reader';
import { openAgentLocalFile, verifyOpenedAgentLocalFileUnchanged } from './agent-local-file';

export function assessFileScope(input: unknown, context: AgentToolExecutionContext): AgentToolPermissionDecision {
  const query = input as { scope?: string; path?: string };
  if (query.scope !== 'host' || context.runCapabilitySnapshot?.shellPermissionMode === 'full-access') {
    return { behavior: 'allow', risk: 'read' };
  }
  return { behavior: 'ask', risk: 'read', preview: { risk: 'read', title: '读取本机文件',
    description: '将读取指定本机路径并把脱敏结果交给当前模型。',
    details: [{ label: '路径', value: query.path || '' }] } };
}

export async function readAgentFileBytes(query: Pick<AgentTextReadQuery, 'scope' | 'path'> & { nodeId?: number }, context: AgentToolExecutionContext) {
    let bytes: Uint8Array;
    if (query.scope === 'host') {
      const opened = await openAgentLocalFile(query.path, context.signal);
      try {
        if (opened.snapshot.statIdentity.sizeBytes > AGENT_TEXT_MAX_BYTES) throw new Error('文本超过 8 MiB 读取上限');
        const buffer = Buffer.alloc(opened.snapshot.statIdentity.sizeBytes + 1);
        let length = 0;
        while (length < buffer.length) {
          context.signal.throwIfAborted();
          const result = await opened.fileHandle.read(buffer, length, buffer.length - length, length);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        await verifyOpenedAgentLocalFileUnchanged(opened);
        bytes = buffer.subarray(0, length);
      } finally { await opened.fileHandle.close(); }
    } else {
      if (!context.readLibraryMetadata || !context.readLibraryText) throw new Error('当前运行时未接入资料库正文读取');
      const { node } = await context.readLibraryMetadata({ kind: 'resolve', path: query.path, nodeType: 'file' }, context.signal);
      if (!node || node.type !== 'file') throw new Error('目标不是资料库文件');
      if (query.nodeId !== undefined && node.id !== query.nodeId) throw new Error('路径对应的节点已变化，请重新搜索');
      bytes = await context.readLibraryText(node.id, context.signal);
      const fresh = await context.readLibraryMetadata({ kind: 'stat', nodeId: node.id }, context.signal);
      if (fresh.node?.path !== node.path || fresh.node?.parentId !== node.parentId) throw new Error('读取期间文件路径已变化，请重新读取');
    }
    context.signal.throwIfAborted();
    return bytes;
}

export const fileContentTool: AgentTool = {
  name: 'file.read', risk: 'read', timeoutMs: 30_000,
  presentation: { groupKind: 'resource-read', operationKind: 'stat' },
  description: '按行读取 UTF-8 文本正文（最多 8 MiB），不是元数据。scope 默认 library；host 明确读取本机。直接提供路径，无需先 resolve/stat。offset 和 column 从 1 开始，column 按 Unicode 字符计数；默认 200 行、最多 2000 行。结果有行号、revision、hasMore；续读原路径并传 nextOffset/nextColumn/revision，长行也不会跳过。不能读取二进制、PDF 或媒体正文。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: {
    scope: { type: 'string', enum: ['library', 'host'] },
    path: { type: 'string', minLength: 1, maxLength: 2048 },
    offset: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 2000 },
    revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  } },
  assess: assessFileScope,
  async execute(input, context) {
    const query = input as AgentTextReadQuery;
    const bytes = await readAgentFileBytes(query, context);
    return { ok: true, data: sliceAgentText(bytes, query), message: `已读取 ${query.path} 的正文` };
  },
};
