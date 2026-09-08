import React from 'react';
import { IconAlertCircle, IconCommentStroked, IconSpin } from '@douyinfe/semi-icons';
import styled from 'styled-components';

import type {
  AgentMessage,
  AgentOwnerScope,
  AgentPreparedActionPublic,
  AgentPresentationAction,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import {
  buildAgentTimelineItemsFromProjection,
  prepareAgentTimelineProjection,
} from '../agent-timeline';
import AgentToolActivityCard from './AgentToolActivityCard';
import AgentToolActivityGroup from './AgentToolActivityGroup';
import AgentMessageContent from './AgentMessageContent';

const UserMessageBubble = styled.article`
  align-self: flex-end;
  max-width: min(760px, 84%);
  padding: 11px 14px;
  border: 1px solid color-mix(in srgb, var(--semi-color-primary) 42%, var(--app-border));
  border-radius: 16px 16px 5px 16px;
  background: color-mix(in srgb, var(--semi-color-primary) 16%, var(--app-bg-elevated));
  color: var(--app-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.6;
`;

const AssistantItemSurface = styled.article`
  align-self: flex-start;
  max-width: min(760px, 84%);
  padding: 11px 14px;
  border: 1px solid var(--app-border);
  border-radius: 16px 16px 16px 5px;
  background: var(--app-bg-elevated);
  color: var(--app-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.6;

  &[data-variant='conversation'] {
    width: 100%;
    max-width: 100%;
    padding: 4px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  &[data-variant='work'] {
    width: min(720px, 88%);
    max-width: none;
    min-height: 24px;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
    padding: 2px 4px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.55;
  }

  .agent-work-item-icon {
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
    color: var(--semi-color-primary);
  }

  &[data-status='streaming'] .agent-work-item-icon svg {
    animation: agent-work-item-spin 900ms linear infinite;
  }

  &[data-status='failed'] .agent-work-item-icon,
  &[data-status='cancelled'] .agent-work-item-icon,
  &[data-status='interrupted'] .agent-work-item-icon {
    color: var(--semi-color-warning);
  }

  .agent-work-item-content {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .agent-work-item-state {
    padding-top: 1px;
    font-size: 11px;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-work-item-icon svg { animation: none !important; }
  }

  @keyframes agent-work-item-spin {
    to { transform: rotate(360deg); }
  }
`;

const WORK_ITEM_STATUS_LABELS = {
  cancelled: '已取消',
  failed: '失败',
  interrupted: '已中断',
} as const;

interface AgentTimelineProps {
  approvalBusyIds: Set<string>;
  interactionBusyIds: Set<string>;
  libraryId: number;
  messages: AgentMessage[];
  onAction?: (action: AgentPresentationAction) => void;
  ownerScope: AgentOwnerScope | null;
  onResolveApproval: (
    approval: AgentToolApprovalSnapshot,
    approved: boolean,
    preparedAction?: AgentPreparedActionPublic,
  ) => void;
  runs: AgentRunSnapshot[];
  toolActivities: AgentToolActivitySnapshot[];
}

export default function AgentTimeline({
  approvalBusyIds,
  interactionBusyIds,
  libraryId,
  messages,
  onAction,
  onResolveApproval,
  ownerScope,
  runs,
  toolActivities,
}: AgentTimelineProps) {
  const prepared = React.useMemo(
    () => prepareAgentTimelineProjection(messages, runs, toolActivities),
    [messages, runs, toolActivities],
  );
  const items = React.useMemo(
    () => buildAgentTimelineItemsFromProjection(messages, prepared),
    [messages, prepared],
  );

  return (
    <>
      {items.map((item) => {
        if (item.type === 'run-status') {
          const labels: Record<string, string> = { failed: '执行失败', cancelled: '已停止', interrupted: '任务已中断' };
          return (
            <AssistantItemSurface data-status={item.run.status} data-variant="work" key={item.key}>
              <span className="agent-work-item-icon"><IconAlertCircle aria-hidden="true" /></span>
              <span className="agent-work-item-content">
                {item.run.error || labels[item.run.status]}
              </span>
            </AssistantItemSurface>
          );
        }
        if (item.type === 'workflow') {
          return null;
        }
        if (item.type === 'tool-group') {
          return (
            <AgentToolActivityGroup
              activities={item.activities}
              approvalBusyIds={approvalBusyIds}
              interactionBusyIds={interactionBusyIds}
              key={item.key}
              libraryId={libraryId}
              onAction={onAction}
              onResolveApproval={onResolveApproval}
              ownerScope={ownerScope}
            />
          );
        }
        if (item.type === 'tool-activity') {
          return (
            <AgentToolActivityCard
              activity={item.activity}
              approvalBusy={Boolean(
                item.activity.approval
                && approvalBusyIds.has(item.activity.approval.approvalId)
              )}
              interactionBusy={Boolean(
                item.activity.interaction
                && interactionBusyIds.has(item.activity.interaction.interactionId)
              )}
              key={item.key}
              libraryId={libraryId}
              onAction={onAction}
              ownerScope={ownerScope}
              onResolveApproval={onResolveApproval}
            />
          );
        }
        if (item.type === 'assistant-work-item') {
          const status = item.item.assistantItem.status;
          const failed = status === 'failed' || status === 'cancelled' || status === 'interrupted';
          return (
            <AssistantItemSurface data-status={status} data-variant="work" key={item.key}>
              <span className="agent-work-item-icon">
                {failed
                  ? <IconAlertCircle aria-hidden="true" />
                  : status === 'streaming'
                    ? <IconSpin aria-hidden="true" />
                    : <IconCommentStroked aria-hidden="true" />}
              </span>
              <span className="agent-work-item-content">{item.item.content || '正在思考'}</span>
              {failed ? (
                <span className="agent-work-item-state">{WORK_ITEM_STATUS_LABELS[status]}</span>
              ) : null}
            </AssistantItemSurface>
          );
        }
        if (item.message.role === 'user') {
          return (
            <UserMessageBubble key={item.key}>{item.message.content}</UserMessageBubble>
          );
        }
        return (
          <AssistantItemSurface data-variant="conversation" key={item.key}>
            <AgentMessageContent content={item.message.content} />
          </AssistantItemSurface>
        );
      })}
    </>
  );
}
