import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import { normalizeAgentContextUsage } from '@/shared/agent/agent-context-usage';

const number = (value: number | undefined) => value === undefined ? '未知' : value.toLocaleString('zh-CN');
const sources = { provider: '服务端实测', 'provider-plus-estimate': '实测基准 + 增量估算', estimate: '本地估算' };
const windows = { provider: '服务端元数据', catalog: '内置目录默认值', fallback: '保守回退', internal: '内部配置' };

export default function AgentContextUsage({ run, busy }: { run?: AgentRunSnapshot; busy: boolean }) {
  const usage = normalizeAgentContextUsage(run?.contextUsage);
  if (!usage) return <div className="agent-context-usage">上下文：{busy ? '计量中' : '暂无统计'}</div>;
  const previous = !busy;
  const title = [
    `${previous ? '上次运行快照' : '本次运行快照'}，不包含未发送草稿。`,
    '生成期间尚未计入未完成的响应；累计用量不是上下文占用。',
    `计数来源：${sources[usage.source]}；窗口来源：${windows[usage.windowSource]}`,
    `本地估算：${number(usage.localInputTokens)}；安全计数：${number(usage.safetyInputTokens)}`,
    `回答预留：${number(usage.outputReserveTokens)}；工具预留：${number(usage.toolReserveTokens)}`,
    `最近实测输入：${number(usage.lastObservedInputTokens)}（响应 ${number(usage.lastObservedResponse)}）`,
    `最近输出：${number(usage.lastUsage?.outputTokens)}；其中推理：${number(usage.lastUsage?.reasoningOutputTokens)}`,
    `最近缓存输入：${number(usage.lastUsage?.cachedInputTokens)}（仍占上下文）`,
    `本 Run 已报告累计用量：${number(usage.reportedTotalTokens)}${usage.usageIncomplete ? '，统计不完整' : ''}；不含辅助摘要和未报告重试`,
    `上下文整理：${usage.compactionCount} 次；更新时间：${usage.updatedAt}`,
  ].join('\n');
  return <div className="agent-context-usage" title={title} aria-label={title}>
    <span>{previous ? '上次上下文' : usage.phase === 'before-request' ? '请求上下文' : '上下文'} ≈ {number(usage.estimatedInputTokens)} / {number(usage.windowTokens)}</span>
    <span>安全可追加 ≈ {number(usage.remainingTokens)} tokens</span>
    <span>{sources[usage.source]}</span>
  </div>;
}
