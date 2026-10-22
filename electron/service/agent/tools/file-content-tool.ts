import type { AgentTool, AgentToolExecutionContext, AgentToolPermissionDecision } from '../agent-tool-registry';
import { AGENT_TEXT_MAX_BYTES, AGENT_READ_DEFAULT_OUTPUT_TOKENS, AGENT_READ_OUTPUT_MAX_BYTES,
  decodeAgentText, type AgentTextReadQuery } from '../agent-text-reader';
import { packAgentTextResult } from '../agent-text-result';
import { openAgentLocalFile, verifyOpenedAgentLocalFileUnchanged } from './agent-local-file';
import { resolveAgentFileQuery } from '../agent-file-path-resolver';

export async function assessFileScope(input: unknown, context: AgentToolExecutionContext): Promise<AgentToolPermissionDecision> {
  const query = await resolveAgentFileQuery(input as { scope?: 'library' | 'host'; path?: string }, context);
  if (query.scope !== 'host' || context.runCapabilitySnapshot?.shellPermissionMode === 'full-access') {
    return { behavior: 'allow', risk: 'read' };
  }
  return { behavior: 'ask', risk: 'read', preview: { risk: 'read', title: '读取本机文件',
    description: '将读取指定本机路径并把脱敏结果交给当前模型。',
    details: [{ label: '路径', value: query.path || '' }] } };
}

export async function readAgentFileBytes(query: Pick<AgentTextReadQuery, 'scope' | 'path'> & { nodeId?: number }, context: AgentToolExecutionContext) {
    query = await resolveAgentFileQuery(query, context);
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
  description: '读取library/host已保存UTF-8（最多8MiB），默认library。offset/column从1开始，column按Unicode字符；limit是行数，省略尽量读完。默认10000tokens，受剩余预算约束。返回原字节revision/sizeBytes/encoding/hasBom/lineEnding/endsWithNewline；L行号前缀不属于正文。hasMore按nextOffset/nextColumn/revision续读；PDF/二进制用文档工具。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: {
    scope: { type: 'string', enum: ['library', 'host'] },
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    basePath: { type: 'string', minLength: 1, maxLength: 4096 },
    offset: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1 },
    maxOutputTokens: { type: 'integer', minimum: 1, maximum: AGENT_READ_OUTPUT_MAX_BYTES / 4,
      description: '输出 token 预算，默认10000；更大请求仍受模型策略和剩余上下文限制。' },
    revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  } },
  assess: assessFileScope,
  async execute(input, context) {
    const query = await resolveAgentFileQuery(input as AgentTextReadQuery, context);
    const bytes = await readAgentFileBytes(query, context);
    const decoded = decodeAgentText(bytes);
    const requested = query.maxOutputTokens ?? AGENT_READ_DEFAULT_OUTPUT_TOKENS;
    if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('输出预算无效');
    const budget = Math.min(requested, context.readOutputTokenBudget ?? AGENT_READ_DEFAULT_OUTPUT_TOKENS);
    const { encoding, hasBom, lineEnding, endsWithNewline, sizeBytes } = decoded;
    return packAgentTextResult(decoded, query, budget, { encoding, hasBom, lineEnding, endsWithNewline, sizeBytes });
  },
};
