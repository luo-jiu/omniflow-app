import type { AgentTool, AgentToolExecutionContext, AgentToolPermissionDecision } from '../agent-tool-registry';
import { AGENT_TEXT_MAX_BYTES, AGENT_READ_DEFAULT_OUTPUT_TOKENS, AGENT_READ_OUTPUT_MAX_BYTES,
  decodeAgentText, sliceDecodedAgentText, type AgentTextReadQuery } from '../agent-text-reader';
import { projectAgentToolResultForProvider } from '../agent-tool-result-projection';
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
  description: '读取 UTF-8 正文（源文件最多8MiB），scope 默认 library，host 明确读取本机。直接给路径，不必先 resolve/stat。省略 limit 从 offset 读到文件末尾，只有输出预算不足才分段；limit 是主动选择的行数，没有200/2000行限制。默认输出10000 tokens，受当前上下文和运行时策略约束。content 为带行号文本；offset/column 从1开始，column 按Unicode字符计数；hasMore 时用 nextOffset/nextColumn/revision 续读。不读取PDF或二进制正文。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: {
    scope: { type: 'string', enum: ['library', 'host'] },
    path: { type: 'string', minLength: 1, maxLength: 2048 },
    offset: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1 },
    maxOutputTokens: { type: 'integer', minimum: 1, maximum: AGENT_READ_OUTPUT_MAX_BYTES / 4,
      description: '输出 token 预算，默认10000；更大请求仍受模型策略和剩余上下文限制。' },
    revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  } },
  assess: assessFileScope,
  async execute(input, context) {
    const query = input as AgentTextReadQuery;
    const bytes = await readAgentFileBytes(query, context);
    const decoded = decodeAgentText(bytes);
    const requested = query.maxOutputTokens ?? AGENT_READ_DEFAULT_OUTPUT_TOKENS;
    if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('输出预算无效');
    const budget = Math.min(requested, context.readOutputTokenBudget ?? AGENT_READ_DEFAULT_OUTPUT_TOKENS);
    let low = 0, high = Math.min(AGENT_READ_OUTPUT_MAX_BYTES, budget * 4);
    const maximumBytes = high;
    let firstAttempt = true;
    const fileName = query.path.replace(/\\/g, '/').split('/').pop() || query.path;
    let best: Awaited<ReturnType<NonNullable<AgentTool['execute']>>> | undefined;
    // Pack the actual result envelope, not per-line JSON, into the provider budget.
    while (low <= high) {
      const size = firstAttempt ? high : Math.floor((low + high) / 2);
      firstAttempt = false;
      const { lines, ...data } = sliceDecodedAgentText(decoded, query, size);
      const result = { ok: true, data: { ...data, fileName }, message: `已读取 ${fileName}` };
      const fits = !projectAgentToolResultForProvider(result, budget).truncated;
      if (fits && (lines.length || decoded.lines.length === 0)) {
        best = result;
        if (size === maximumBytes) break;
        low = size + 1;
      } else high = size - 1;
    }
    if (!best) throw new Error('当前上下文不足以交付正文，请缩小请求或整理上下文');
    return best;
  },
};
