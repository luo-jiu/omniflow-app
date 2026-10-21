import type { AgentTool } from '../agent-tool-registry';
import { normalizeAgentFileWriteInput } from '../../../../src/shared/agent/agent-file-write';
import { normalizeAgentLocalPathExpression } from './agent-local-file';
import { executeAgentHostFileMutation } from './agent-local-file-mutation';
import { resolveAgentFileQuery } from '../agent-file-path-resolver';

export const fileWriteTool: AgentTool = {
  name: 'file.write', executor: 'main', risk: 'write', timeoutMs: 120_000,
  cancellationSettleTimeoutMs: 35_000,
  registrationId: 'builtin:file.write@2',
  description: '创建/完整替换 UTF-8 saved 文件。scope=library(默认)或host，父目录须存在。相对path：library用当前目录或basePath，host必须给绝对basePath。无revision仅新建；替换传file.read的revision/expectedRevision与完整正文，局部用file.patch。host普通单链接文件保留mode/owner，ACL/xattrs未保障，外部并发尽力检测。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: {
    scope: { type: 'string', enum: ['library', 'host'] }, path: { type: 'string', minLength: 1, maxLength: 4096 },
    basePath: { type: 'string', minLength: 1, maxLength: 4096 },
    view: { type: 'string', enum: ['saved'] }, mode: { type: 'string', enum: ['create', 'replace'] },
    content: { type: 'string', maxLength: 32000 }, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  } },
  async validate(input, context) {
    try {
      const normalized = normalizeAgentFileWriteInput(await resolveAgentFileQuery(input as { path: string }, context));
      if (normalized.scope === 'host') normalizeAgentLocalPathExpression(normalized.path);
      else if (!Number.isSafeInteger(context.appContext.libraryId) || Number(context.appContext.libraryId) <= 0) throw new Error('当前资料库不可用');
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '写入参数无效' }; }
  },
  async assess(input, context) {
    const normalized = normalizeAgentFileWriteInput(await resolveAgentFileQuery(input as { path: string }, context));
    const risk = 'write' as const;
    return { behavior: 'ask', risk, preview: {
      title: `${normalized.revision ? '修改' : '创建'}${normalized.scope === 'host' ? '本机' : '资料库'}文件`,
      description: normalized.path, risk,
      details: [{ label: '路径', value: normalized.path }, { label: '正文字符数', value: String(normalized.content.length) }],
    } };
  },
  async execute(input, context) {
    const normalized = normalizeAgentFileWriteInput(await resolveAgentFileQuery(input as { path: string }, context));
    if (normalized.scope === 'host') return executeAgentHostFileMutation(normalized, context);
    if (!context.executeLibraryFileMutation) throw new Error('当前运行时未接入资料库文件提交');
    return context.executeLibraryFileMutation(normalized, context.signal, context.commitSettlement);
  },
};
