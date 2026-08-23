import type {
  AgentMemoryProposal,
  AgentMemoryScope,
} from '@/shared/agent/agent.types';
import { containsAgentSensitiveData } from './agent-sensitive-data';

export const AGENT_MEMORY_LIMITS = Object.freeze({
  applicationCharacters: 500,
  contentCharacters: 2_000,
  reasonCharacters: 500,
  titleCharacters: 120,
});

const MEMORY_KINDS = new Set(['preference', 'project', 'reference']);
const MEMORY_SCOPES = new Set(['global', 'library']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符`);
  return text;
}

function assertAllowedKeys(source: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(source).some(key => !allowed.has(key))) {
    throw new Error('长期记忆提案包含未知字段');
  }
}

function assertNoSensitiveData(proposal: AgentMemoryProposal): void {
  const fields = [
    proposal.title,
    proposal.content,
    proposal.reason,
    proposal.application,
  ];
  if (fields.some(containsAgentSensitiveData)) {
    throw new Error('长期记忆不能保存 API Key、密码、Cookie、令牌、私钥或签名链接');
  }
}

export function normalizeAgentMemoryProposal(input: unknown): AgentMemoryProposal {
  const source = asRecord(input);
  if (!source) throw new Error('长期记忆提案格式无效');
  assertAllowedKeys(source, ['application', 'content', 'kind', 'reason', 'scope', 'title']);

  const kind = String(source.kind || '').trim();
  if (!MEMORY_KINDS.has(kind)) throw new Error('长期记忆类型无效');
  const scope = String(source.scope || '').trim();
  if (!MEMORY_SCOPES.has(scope)) throw new Error('长期记忆作用域无效');
  if (kind === 'project' && scope !== 'library') {
    throw new Error('项目记忆必须绑定当前资料库');
  }

  const proposal: AgentMemoryProposal = {
    application: requiredText(
      source.application,
      '长期记忆适用场景',
      AGENT_MEMORY_LIMITS.applicationCharacters,
    ),
    content: requiredText(
      source.content,
      '长期记忆内容',
      AGENT_MEMORY_LIMITS.contentCharacters,
    ),
    kind: kind as AgentMemoryProposal['kind'],
    reason: requiredText(
      source.reason,
      '长期记忆原因',
      AGENT_MEMORY_LIMITS.reasonCharacters,
    ),
    scope: scope as AgentMemoryScope,
    title: requiredText(
      source.title,
      '长期记忆标题',
      AGENT_MEMORY_LIMITS.titleCharacters,
    ),
  };
  assertNoSensitiveData(proposal);
  return proposal;
}

export function normalizeAgentMemoryEditableFields(input: unknown): Pick<
  AgentMemoryProposal,
  'application' | 'content' | 'reason' | 'title'
> {
  const source = asRecord(input);
  if (!source) throw new Error('长期记忆修改内容无效');
  const fields = {
    application: requiredText(
      source.application,
      '长期记忆适用场景',
      AGENT_MEMORY_LIMITS.applicationCharacters,
    ),
    content: requiredText(
      source.content,
      '长期记忆内容',
      AGENT_MEMORY_LIMITS.contentCharacters,
    ),
    reason: requiredText(
      source.reason,
      '长期记忆原因',
      AGENT_MEMORY_LIMITS.reasonCharacters,
    ),
    title: requiredText(
      source.title,
      '长期记忆标题',
      AGENT_MEMORY_LIMITS.titleCharacters,
    ),
  };
  assertNoSensitiveData({
    ...fields,
    kind: 'preference',
    scope: 'global',
  });
  return fields;
}
