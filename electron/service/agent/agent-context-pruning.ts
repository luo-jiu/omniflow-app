import type { AgentProviderMessage } from './agent-provider-model';
import type { AgentActiveToolResultRecord } from './agent-active-context';
import { estimateAgentTextTokens } from './agent-token-estimator';

// OpenCode's prune/protect split, scoped here to recoverable read bodies only.
export const AGENT_PRUNE_PROTECT_TOKENS = 40_000;
export const AGENT_PRUNE_MINIMUM_TOKENS = 20_000;

function prunedReadBody(record: AgentActiveToolResultRecord): string | undefined {
  if (!record.consumed || !record.allowCompaction || !['file.read', 'attachment.read'].includes(record.toolName)) return;
  try {
    const result = JSON.parse(record.message.content);
    const data = result?.data;
    if (result?.ok !== true || !data || data.hasMore !== false || data.contentPruned
      || !['library', 'host', 'attachment'].includes(data.scope) || typeof data.path !== 'string' || !data.path
      || (data.scope === 'attachment' && (typeof data.attachmentId !== 'string' || !data.attachmentId))
      || typeof data.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(data.revision)
      || typeof data.content !== 'string' || !data.content) return;
    const { content, ...metadata } = data;
    return JSON.stringify({ ...result, data: { ...metadata,
      contentPruned: true,
      originalContentCharacters: content.length,
      sourceToolCallId: record.message.toolCallId,
      contentNotice: data.scope === 'attachment'
        ? '此前读取成功；旧正文已从当前模型上下文移除。需要时按 attachmentId、page（若有）和 revision 重新读取，不是空文件。'
        : '此前读取成功；旧正文已从当前模型上下文移除，不是空文件。需要正文时按原路径和 revision 重新读取，文件变化时不能猜测原内容。',
    } });
  } catch { return; }
}

export function pruneAgentReadBodies(input: {
  messages: AgentProviderMessage[];
  toolResults: AgentActiveToolResultRecord[];
  eligibleCallIds: ReadonlySet<string>;
}): string[] {
  let protectedTokens = 0;
  let savedTokens = 0;
  const replacements = new Map<AgentProviderMessage, Extract<AgentProviderMessage, { role: 'tool' }>>();
  for (let i = input.toolResults.length - 1; i >= 0; i -= 1) {
    const record = input.toolResults[i];
    const tokens = estimateAgentTextTokens(record.message.content);
    protectedTokens += tokens;
    // Protect the entire result crossing the tail boundary, not a fragment of it.
    if (protectedTokens - tokens < AGENT_PRUNE_PROTECT_TOKENS) continue;
    if (!input.eligibleCallIds.has(record.message.toolCallId)) continue;
    const content = prunedReadBody(record);
    if (!content) continue;
    const saved = tokens - estimateAgentTextTokens(content);
    if (saved <= 0) continue;
    savedTokens += saved;
    replacements.set(record.message, { ...record.message, content });
  }
  if (savedTokens < AGENT_PRUNE_MINIMUM_TOKENS) return [];
  const ids: string[] = [];
  for (let i = 0; i < input.messages.length; i += 1) {
    const replacement = replacements.get(input.messages[i]);
    if (replacement) input.messages[i] = replacement;
  }
  for (let i = 0; i < input.toolResults.length; i += 1) {
    const record = input.toolResults[i];
    const replacement = replacements.get(record.message);
    if (!replacement) continue;
    ids.push(record.message.toolCallId);
    input.toolResults[i] = { ...record, message: replacement };
  }
  return ids;
}
