import type { AgentTool } from '../agent-tool-registry';
import { AgentFilePatchError, preflightAgentFilePatch } from '../../../../src/shared/agent/agent-file-patch';
import { AgentFileMutationError } from '../../../../src/shared/agent/agent-file-write';
import { AGENT_FILE_PATCH_MAX_CHARACTERS, AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS,
  assertAgentFilePatchArgumentBudget, normalizeAgentFilePatchInput } from '../../../../src/shared/agent/agent-file-patch-input';
import { normalizeAgentLocalPathExpression } from './agent-local-file';
import { executeAgentHostFileMutation } from './agent-local-file-mutation';
import { resolveAgentFileToolInput } from '../agent-file-path-resolver';

export const filePatchTool: AgentTool = {
  name: 'file.patch', executor: 'main', risk: 'write', timeoutMs: 120_000,
  cancellationSettleTimeoutMs: 35_000,
  registrationId: 'builtin:file.patch@2',
  description: '局部修改单个library/host saved UTF-8。传format=context-v1与file.read的revision。例：@@\n-old\n+new\n。@@独占行，空格/-/+为连续上下文/删除/新增，不写行数、锚点或header。须唯一匹配；仅+追加EOF；*** End of File限定尾部。正文最多32000字符，总JSON含转义最多64000。保留BOM与未改行；按诊断补读。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'patch'], properties: {
    scope: { type: 'string', enum: ['library', 'host'] }, path: { type: 'string', minLength: 1, maxLength: 4096 },
    basePath: { type: 'string', minLength: 1, maxLength: 4096 },
    view: { type: 'string', enum: ['saved'] }, format: { type: 'string', enum: ['context-v1', 'unified-v1'] },
    finalNewline: { type: 'string', enum: ['preserve', 'ensure', 'remove'], description: 'context-v1默认preserve；ensure/remove显式改变尾换行，remove遇真实末尾空行拒绝。' },
    revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$', description: '仅历史unified-v1的revision别名。' },
    patch: { type: 'string', minLength: 1, maxLength: AGENT_FILE_PATCH_MAX_CHARACTERS },
  }, oneOf: [
    { properties: { revision: {} }, required: ['revision'] },
    { properties: { expectedRevision: {} }, required: ['expectedRevision'] },
  ],
  if: { properties: { format: { const: 'context-v1' } }, required: ['format'] },
  then: { properties: { revision: {}, patch: { type: 'string', maxLength: AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS } }, required: ['revision'] },
  else: { not: { properties: { finalNewline: {} }, required: ['finalNewline'] } } },
  async validate(input, context) {
    try {
      assertAgentFilePatchArgumentBudget(input);
      const normalized = normalizeAgentFilePatchInput(await resolveAgentFileToolInput('file.patch', input, context));
      if (normalized.scope === 'host') normalizeAgentLocalPathExpression(normalized.path);
      else if (!Number.isSafeInteger(context.appContext.libraryId) || Number(context.appContext.libraryId) <= 0) throw new Error('当前资料库不可用');
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '补丁参数无效' }; }
  },
  async assess(input, context) {
    assertAgentFilePatchArgumentBudget(input);
    const normalized = normalizeAgentFilePatchInput(await resolveAgentFileToolInput('file.patch', input, context));
    return { behavior: 'ask', risk: 'write', preview: { title: `修改${normalized.scope === 'host' ? '本机' : '资料库'}文件`,
      description: normalized.path, risk: 'write', details: [
        { label: '路径', value: normalized.path }, { label: '补丁字符数', value: String(normalized.patch.length) },
      ] } };
  },
  async execute(input, context) {
    assertAgentFilePatchArgumentBudget(input);
    const normalized = normalizeAgentFilePatchInput(await resolveAgentFileToolInput('file.patch', input, context));
    try { preflightAgentFilePatch(normalized); }
    catch (error) {
      if (!(error instanceof AgentFileMutationError)) throw error;
      return { ok: false, message: error.message, data: {
        code: error.code, phase: 'parse', nextAction: 'fix_input',
        ...(error instanceof AgentFilePatchError
          ? Object.fromEntries(Object.entries(error.diagnostic).filter(([, value]) => value !== undefined)) : {}),
        scope: normalized.scope, path: normalized.path, view: 'saved',
        writeCommitState: 'uncommitted', mutationCommitState: 'uncommitted',
        ...(context.fileMutation ? { operationId: context.fileMutation.operationId } : {}),
      } };
    }
    if (normalized.scope === 'host') return executeAgentHostFileMutation(normalized, context);
    if (!context.executeLibraryFileMutation) throw new Error('当前运行时未接入资料库文件提交');
    return context.executeLibraryFileMutation(normalized, context.signal, context.commitSettlement);
  },
};
