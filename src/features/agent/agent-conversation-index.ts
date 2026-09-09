import type { AgentMessage, AgentRunSnapshot } from '@/shared/agent/agent.types';
import { isAgentRunActive } from './agent-run-presentation';

export type IndexTone = 'normal' | 'waiting' | 'error';
export interface ConversationIndexEntry {
  id: string;
  ordinal: number;
  title: string;
  summary: string;
  active: boolean;
  tone: IndexTone;
}

export function buildConversationIndex(messages: AgentMessage[], runs: AgentRunSnapshot[]): ConversationIndexEntry[] {
  const runMap = new Map(runs.map(run => [run.id, run]));
  const answers = new Map<string, string>();
  messages.forEach(message => {
    if (message.role === 'assistant' && message.content.trim()) answers.set(message.runId, message.content);
  });
  return messages.filter(message => message.role === 'user').map((message, index) => {
    const run = message.runId ? runMap.get(message.runId) : undefined;
    const active = Boolean(run && isAgentRunActive(run));
    const error = run && ['failed', 'cancelled', 'interrupted'].includes(run.status);
    const waiting = active && (run?.status === 'awaiting_approval' || run?.status === 'awaiting_interaction'
      || /^正在重新连接 \d+\/\d+$/u.test(run?.currentStep || ''));
    return {
      id: message.id, ordinal: index + 1, title: message.content.slice(0, 160),
      summary: (run?.error || answers.get(message.runId || '') || run?.currentStep || '').slice(0, 260),
      active, tone: error ? 'error' : waiting ? 'waiting' : 'normal',
    };
  });
}

export function indexMilestone(ordinal: number): 'major' | 'minor' | 'none' {
  return ordinal % 10 === 0 ? 'major' : ordinal % 10 === 5 ? 'minor' : 'none';
}

export function resolveIndexPreviewTop(nodeCenter: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(Math.max(bounds.min, bounds.max), nodeCenter - 24));
}

export function parseIndexMarks(raw: string | null): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, label]) =>
      key.length <= 200 && typeof label === 'string' && label.length <= 32).slice(0, 1000));
  } catch { return {}; }
}
