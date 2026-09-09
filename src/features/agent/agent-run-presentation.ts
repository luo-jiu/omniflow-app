import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import type { AgentTimelineItem } from './agent-timeline';

export function isAgentRunActive(run: AgentRunSnapshot): boolean {
  return ['preparing', 'running', 'awaiting_approval', 'awaiting_interaction'].includes(run.status);
}

export function formatAgentRunElapsed(run: AgentRunSnapshot, now: number): string {
  const end = isAgentRunActive(run) ? now : Date.parse(run.finishedAt || run.updatedAt);
  const elapsed = Math.max(0, Math.floor((end - Date.parse(run.createdAt)) / 1000));
  if (!Number.isFinite(elapsed)) return run.status === 'cancelled' ? '任务已停止' : '用时 --';
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor(elapsed % 3600 / 60);
  const seconds = elapsed % 60;
  const duration = `${hours ? `${hours}h ` : ''}${minutes}m ${seconds}s`;
  return run.status === 'cancelled' ? `你在 ${duration} 停止了任务` : `用时 ${duration}`;
}

export function timelineItemRunId(item: AgentTimelineItem): string | undefined {
  switch (item.type) {
    case 'message': return item.message.runId;
    case 'assistant-work-item': return item.item.runId;
    case 'tool-activity': return item.activity.runId;
    case 'tool-group': return item.runId;
    case 'run-status': return item.run.id;
    case 'workflow': return undefined;
  }
}

export function canCollapseAgentProcess(run: AgentRunSnapshot, items: AgentTimelineItem[]): boolean {
  if (run.status !== 'completed') return false;
  const hasFinal = items.some(item => item.type === 'message' && item.message.role === 'assistant'
    && item.message.runId === run.id && item.message.assistantItem.phase === 'final'
    && item.message.assistantItem.status === 'completed' && Boolean(item.message.content.trim()));
  if (!hasFinal) return false;
  return items.every(item => {
    if (item.type === 'assistant-work-item' && item.item.assistantItem.status === 'streaming') return false;
    const activities = item.type === 'tool-group' ? item.activities
      : item.type === 'tool-activity' ? [item.activity] : [];
    return activities.every(activity => ['completed', 'failed', 'cancelled', 'interrupted'].includes(activity.status)
      && activity.approval?.status !== 'pending' && activity.interaction?.status !== 'pending');
  });
}

export function shouldAutoCollapseAgentProcess(run: AgentRunSnapshot, items: AgentTimelineItem[]): boolean {
  return canCollapseAgentProcess(run, items);
}
