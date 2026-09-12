import type { AgentMessage, AgentRunSnapshot, AgentToolActivitySnapshot } from '@/shared/agent/agent.types';

export function selectAgentLiveStatus(runs: AgentRunSnapshot[], messages: AgentMessage[], activities: AgentToolActivitySnapshot[]) {
  const run = runs.filter(item => item.status === 'running' || item.status === 'preparing')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!run) return null;
  const tools = activities.filter(item => item.runId === run.id);
  if (tools.some(item => item.status === 'awaiting_approval' || item.status === 'awaiting_interaction')) return null;
  if (run.currentStep === '整理当前任务上下文' || run.currentStep === '正在压缩上下文') {
    return { runId: run.id, kind: 'compaction' as const, label: '正在压缩上下文' };
  }
  if (tools.some(item => item.status === 'preparing' || item.status === 'running')) return null;
  if (messages.some(item => item.runId === run.id && item.role === 'assistant'
    && 'assistantItem' in item && item.assistantItem?.status === 'streaming' && item.content.trim())) return null;
  if (/^正在重新连接 \d+\/\d+$/u.test(run.currentStep || '') || run.currentStep === '正在核对结果') {
    return { runId: run.id, kind: 'working' as const, label: run.currentStep! };
  }
  return { runId: run.id, kind: 'working' as const,
    label: '正在思考' };
}
