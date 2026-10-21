import type { AgentTool } from '../agent-tool-registry';
import { AGENT_FILE_PATCH_MAX_CHARACTERS, normalizeAgentFilePatchInput } from '../../../../src/shared/agent/agent-file-patch';
import { normalizeAgentLocalPathExpression } from './agent-local-file';
import { executeAgentHostFileMutation } from './agent-local-file-mutation';
import { resolveAgentFileToolInput } from '../agent-file-path-resolver';

export const filePatchTool: AgentTool = {
  name: 'file.patch', executor: 'main', risk: 'write', timeoutMs: 120_000,
  cancellationSettleTimeoutMs: 35_000,
  registrationId: 'builtin:file.patch@1',
  description: '用file.read的revision/expectedRevision对单个library/host saved文件应用unified-v1局部补丁。@@行号和上下文须精确；正文行以空格/-/+开头，无尾换行用标准标记。header可省略，提供时须指同一path；只修改现有UTF-8文件，不模糊匹配。保留BOM与未改动换行，host限制同file.write。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'patch'], properties: {
    scope: { type: 'string', enum: ['library', 'host'] }, path: { type: 'string', minLength: 1, maxLength: 4096 },
    basePath: { type: 'string', minLength: 1, maxLength: 4096 },
    view: { type: 'string', enum: ['saved'] }, format: { type: 'string', enum: ['unified-v1'] },
    revision: { type: 'string', pattern: '^[a-f0-9]{64}$' }, expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    patch: { type: 'string', minLength: 1, maxLength: AGENT_FILE_PATCH_MAX_CHARACTERS },
  } },
  async validate(input, context) {
    try {
      const normalized = normalizeAgentFilePatchInput(await resolveAgentFileToolInput('file.patch', input, context));
      if (normalized.scope === 'host') normalizeAgentLocalPathExpression(normalized.path);
      else if (!Number.isSafeInteger(context.appContext.libraryId) || Number(context.appContext.libraryId) <= 0) throw new Error('当前资料库不可用');
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '补丁参数无效' }; }
  },
  async assess(input, context) {
    const normalized = normalizeAgentFilePatchInput(await resolveAgentFileToolInput('file.patch', input, context));
    return { behavior: 'ask', risk: 'write', preview: { title: `修改${normalized.scope === 'host' ? '本机' : '资料库'}文件`,
      description: normalized.path, risk: 'write', details: [
        { label: '路径', value: normalized.path }, { label: '补丁字符数', value: String(normalized.patch.length) },
      ] } };
  },
  async execute(input, context) {
    const normalized = normalizeAgentFilePatchInput(await resolveAgentFileToolInput('file.patch', input, context));
    if (normalized.scope === 'host') return executeAgentHostFileMutation(normalized, context);
    if (!context.executeLibraryFileMutation) throw new Error('当前运行时未接入资料库文件提交');
    return context.executeLibraryFileMutation(normalized, context.signal, context.commitSettlement);
  },
};
