import { AGENT_READ_OUTPUT_MAX_BYTES, sliceDecodedAgentText, type AgentTextReadQuery, type decodeAgentText } from './agent-text-reader';
import { projectAgentToolResultForProvider } from './agent-tool-result-projection';

export function packAgentTextResult(decoded: ReturnType<typeof decodeAgentText>, query: AgentTextReadQuery,
  budget: number, metadata: Record<string, unknown> = {}) {
  const fileName = query.path.replace(/\\/g, '/').split('/').pop() || query.path;
  const build = (size: number) => {
    const { lines, ...data } = sliceDecodedAgentText(decoded, query, size);
    return { lines, result: { ok: true as const, data: { ...data, fileName, ...metadata }, message: `已读取 ${fileName}` } };
  };
  let low = 0, high = Math.min(AGENT_READ_OUTPUT_MAX_BYTES, budget * 4);
  const maximum = high;
  let first = true;
  let best: ReturnType<typeof build>['result'] | undefined;
  while (low <= high) {
    const size = first ? high : Math.floor((low + high) / 2); first = false;
    const { lines, result } = build(size);
    if (!projectAgentToolResultForProvider(result, budget).truncated && (lines.length || decoded.lines.length === 0)) {
      best = result;
      if (size === maximum) break;
      low = size + 1;
    } else high = size - 1;
  }
  if (!best) throw new Error('当前上下文不足以交付正文，请缩小请求或整理上下文');
  return best;
}
