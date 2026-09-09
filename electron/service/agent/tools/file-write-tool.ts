import type { AgentTool } from '../agent-tool-registry';
import { normalizeAgentFileWriteInput } from '../../../../src/shared/agent/agent-file-write';

export const fileWriteTool: AgentTool = {
  name: 'file.write', executor: 'renderer', risk: 'write', timeoutMs: 120_000,
  description: '直接创建或修改资料库文本/源码文件，无需Shell和file.publish。path为资料库绝对路径，父目录须存在。省略revision仅新建且不覆盖；修改时先file.read取得revision，再传完整新正文和revision。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: {
    scope: { type: 'string', enum: ['library'] }, path: { type: 'string', minLength: 2, maxLength: 2048 },
    content: { type: 'string', maxLength: 32000 }, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  } },
  validate(input, context) {
    try {
      normalizeAgentFileWriteInput(input);
      if (!Number.isSafeInteger(context.appContext.libraryId) || Number(context.appContext.libraryId) <= 0) throw new Error('当前资料库不可用');
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '写入参数无效' }; }
  },
  assess(input) {
    const normalized = normalizeAgentFileWriteInput(input);
    const risk = 'write' as const;
    return { behavior: 'ask', risk, preview: {
      title: normalized.revision ? '修改资料库文件' : '创建资料库文件',
      description: normalized.path, risk,
      details: [{ label: '路径', value: normalized.path }, { label: '正文字符数', value: String(normalized.content.length) }],
    } };
  },
  createRendererRequest(input, context) {
    return { libraryId: Number(context.appContext.libraryId), ...normalizeAgentFileWriteInput(input) };
  },
};
