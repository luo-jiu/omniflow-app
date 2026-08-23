import type {
  AgentMemoryKind,
  AgentMemoryScope,
} from '@/shared/agent/agent.types';
import type { AgentTool } from '../agent-tool-registry';
import { normalizeAgentMemoryProposal } from '../agent-memory-model';

const KIND_LABELS: Record<AgentMemoryKind, string> = {
  preference: '个人偏好',
  project: '资料库约定',
  reference: '参考位置',
};

const SCOPE_LABELS: Record<AgentMemoryScope, string> = {
  global: '所有资料库',
  library: '当前资料库',
};

function previewDetails(label: string, value: string): Array<{ label: string; value: string }> {
  const chunks = value.match(/[\s\S]{1,500}/g) || [''];
  return chunks.map((chunk, index) => ({
    label: chunks.length === 1 ? label : `${label} ${index + 1}/${chunks.length}`,
    value: chunk,
  }));
}

export const memoryProposeTool: AgentTool = {
  assess(input) {
    const proposal = normalizeAgentMemoryProposal(input);
    return {
      behavior: 'ask',
      preview: {
        description: '这条内容会在用户确认后保存到本机，并可能在后续相关会话中作为低权限历史背景出现。',
        details: [
          { label: '类型', value: KIND_LABELS[proposal.kind] },
          { label: '范围', value: SCOPE_LABELS[proposal.scope] },
          { label: '标题', value: proposal.title },
          ...previewDetails('记忆内容', proposal.content),
          ...previewDetails('保存原因', proposal.reason),
          ...previewDetails('适用场景', proposal.application),
        ],
        risk: 'write',
        title: '保存这条长期记忆？',
      },
      risk: 'write',
    };
  },
  description: '仅当用户明确要求“记住”“以后都这样”或同义表达时，提交一条长期记忆提案。提案必须经过用户确认才会保存；不要从普通对话、当前文件状态或 Tool 结果中自动提取。',
  inputSchema: {
    additionalProperties: false,
    properties: {
      application: { maxLength: 500, minLength: 1, type: 'string' },
      content: { maxLength: 2_000, minLength: 1, type: 'string' },
      kind: { enum: ['preference', 'project', 'reference'], type: 'string' },
      reason: { maxLength: 500, minLength: 1, type: 'string' },
      scope: { enum: ['global', 'library'], type: 'string' },
      title: { maxLength: 120, minLength: 1, type: 'string' },
    },
    required: ['application', 'content', 'kind', 'reason', 'scope', 'title'],
    type: 'object',
  },
  name: 'memory.propose',
  risk: 'write',
  validate(input) {
    try {
      normalizeAgentMemoryProposal(input);
      return { ok: true };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : '长期记忆提案无效',
        ok: false,
      };
    }
  },
  async execute(input, context) {
    if (!context.saveMemoryProposal) {
      return { message: '当前 Agent 运行时不支持长期记忆', ok: false };
    }
    const proposal = normalizeAgentMemoryProposal(input);
    const saved = await context.saveMemoryProposal(proposal, context.signal);
    return {
      data: {
        id: saved.id,
        kind: saved.kind,
        revision: saved.revision,
        scope: saved.scope,
        title: saved.title,
      },
      message: `已保存长期记忆“${saved.title}”`,
      ok: true,
    };
  },
};
