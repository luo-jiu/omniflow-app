import type { AgentMessage, AgentRunSnapshot, AgentToolActivitySnapshot } from '@/shared/agent/agent.types';

function toolHandoffLabel(step: string | undefined) {
  // Main can still be checking access before a ToolActivity exists. Keep that
  // wait visible without claiming the model is thinking or the tool succeeded.
  if (step === '准备执行工具' || /^准备 /u.test(step || '')) return '正在准备工具';
  if (/^(?:执行|继续执行) /u.test(step || '')) return '正在调用工具';
  if (step === '准备工具续接') return '正在处理工具结果';
  return null;
}

export function selectAgentLiveStatus(runs: AgentRunSnapshot[], messages: AgentMessage[], activities: AgentToolActivitySnapshot[]) {
  const run = runs.filter(item => item.status === 'running' || item.status === 'preparing')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!run) return null;
  const tools = activities.filter(item => item.runId === run.id);
  if (tools.some(item => item.status === 'awaiting_approval' || item.status === 'awaiting_interaction')) return null;
  if (tools.some(item => item.status === 'preparing' || item.status === 'running')) return null;
  if (run.currentStep === '整理当前任务上下文' || run.currentStep === '正在压缩上下文') {
    return { runId: run.id, kind: 'compaction' as const, label: '正在压缩上下文' };
  }
  if (messages.some(item => item.runId === run.id && item.role === 'assistant'
    && 'assistantItem' in item && item.assistantItem?.status === 'streaming' && item.content.trim())) return null;
  const handoff = toolHandoffLabel(run.currentStep);
  if (handoff) return { runId: run.id, kind: 'working' as const, label: handoff };
  if (run.currentStep === '处理模型响应' || /^(?:等待确认|等待用户输入) /u.test(run.currentStep || '')) return null;
  if (/^正在重新连接 \d+\/\d+$/u.test(run.currentStep || '') || run.currentStep === '正在核对结果') {
    return { runId: run.id, kind: 'working' as const, label: run.currentStep! };
  }
  return { runId: run.id, kind: 'working' as const,
    label: '正在思考' };
}
