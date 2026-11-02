import styled from 'styled-components';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import { normalizeAgentContextUsage } from '@/shared/agent/agent-context-usage';

const number = (value: number) => value.toLocaleString('zh-CN');
const sources = { provider: '服务端实测', 'provider-plus-estimate': '实测基准 + 增量估算', estimate: '本地估算' };
const windows = { provider: '服务端元数据', catalog: '内置目录默认值', fallback: '默认预算，模型实际上限未知', internal: '内部配置' };

const Indicator = styled.span`
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 0 2px;
  border-radius: 4px;
  color: var(--app-text-muted);
  font-size: 12px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: default;
  svg { display: block; width: 16px; height: 16px; flex: none; }
  &:focus-visible { outline: 2px solid var(--semi-color-primary-light-active); outline-offset: 2px; }
`;

export default function AgentContextUsage({ run, busy }: { run?: AgentRunSnapshot; busy: boolean }) {
  const normalized = normalizeAgentContextUsage(run?.contextUsage);
  const usage = normalized && normalized.windowTokens > 0 ? normalized : undefined;
  const percent = usage ? usage.estimatedInputTokens / usage.windowTokens * 100 : undefined;
  const percentage = percent === undefined ? '—' : percent > 100 ? '>100%' : percent > 0 && percent < 1 ? '<1%' : `${Math.floor(percent)}%`;
  const label = percent === undefined ? '上下文使用量未知' : `上下文已用约 ${percentage}`;
  const title = usage ? [
    `${label} · ${number(usage.estimatedInputTokens)} / ${number(usage.windowTokens)} tokens`,
    `${busy ? '本次运行快照' : '上次运行快照'}；不含未发送草稿，生成中不含尚未完成的响应。`,
    `计数：${sources[usage.source]}；窗口：${windows[usage.windowSource]}。`,
    `安全可追加约 ${number(usage.remainingTokens)} tokens；预留回答 ${number(usage.outputReserveTokens)}、工具 ${number(usage.toolReserveTokens)}。`,
    '缓存输入仍占上下文；累计调用用量不是上下文占用。压缩会在窗口用满前触发。',
  ].join('\n') : `${label}；${busy ? '正在等待本次运行计量' : '当前模型和服务配置暂无快照'}。发送后更新，不将未知显示为 0%。`;
  return <Indicator className="agent-context-usage" title={title} aria-label={title} tabIndex={0}>
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2.5" opacity="0.25"
        strokeDasharray={usage ? undefined : '2 3'} />
      {percent !== undefined && <circle cx="10" cy="10" r="7" pathLength="100" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="butt" strokeDasharray={`${Math.min(100, percent)} 100`}
        transform="rotate(-90 10 10)" />}
    </svg>
    <span aria-hidden="true">{percentage}</span>
  </Indicator>;
}
