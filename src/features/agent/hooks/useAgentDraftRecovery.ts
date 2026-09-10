import React from 'react';
import type { AgentAttachmentScope } from '@/shared/agent/agent-attachments';
import type { AgentAttachmentDraft } from './useAgentAttachments';
import { discardAgentAttachment } from '../services/agent.api';

export interface FailedAgentDraft { prompt: string; attachments: AgentAttachmentDraft[] }
interface RecoveryInput {
  scope: AgentAttachmentScope | null;
  draft: string;
  entries: readonly AgentAttachmentDraft[];
  busy: boolean;
  readDraft: () => string;
  readEntries: () => readonly AgentAttachmentDraft[];
  setDraft: (value: string) => void;
  restoreAttachments: (entries: AgentAttachmentDraft[]) => void;
  notify: (message: string) => void;
}

export function useAgentDraftRecovery(input: RecoveryInput) {
  const actions = React.useRef(input); actions.current = input;
  const pending = React.useRef<Array<FailedAgentDraft & { scope: AgentAttachmentScope }>>([]);
  const [revision, markPending] = React.useReducer(value => value + 1, 0);
  const clear = React.useCallback(() => {
    const discarded = pending.current.splice(0);
    for (const draft of discarded) for (const entry of draft.attachments) if (entry.attachment) {
      void Promise.resolve().then(() => discardAgentAttachment({ ...draft.scope, id: entry.attachment!.id })).catch(() => undefined);
    }
  }, []);
  const scopeKey = JSON.stringify(input.scope);
  React.useEffect(() => clear, [scopeKey, clear]);
  const recover = React.useCallback((failed: FailedAgentDraft) => {
    const current = actions.current;
    if (!current.scope) return;
    pending.current.push({ ...failed, scope: current.scope });
    markPending();
    current.notify('发送失败的原消息已保留，当前草稿处理完后会恢复。');
  }, []);
  React.useEffect(() => {
    const current = actions.current;
    if (current.busy || current.readDraft().trim() || current.readEntries().length) return;
    const next = pending.current.shift();
    if (!next) return;
    current.setDraft(next.prompt);
    current.restoreAttachments(next.attachments);
    current.notify('已恢复此前发送失败的正文和附件，请确认后重新发送。');
  }, [input.busy, input.draft, input.entries, revision]);
  return { recover, clear };
}
