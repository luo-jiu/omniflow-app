import React from 'react';
import styled from 'styled-components';

import type {
  AgentMessage,
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
import AgentWorkflowCard from './AgentWorkflowCard';

const MessageBubble = styled.article<{ $role: 'user' | 'assistant' | 'tool' }>`
  align-self: ${({ $role }) => ($role === 'user' ? 'flex-end' : 'flex-start')};
  max-width: ${({ $role }) => ($role === 'tool' ? 'min(560px, 76%)' : 'min(760px, 84%)')};
  padding: ${({ $role }) => ($role === 'tool' ? '8px 12px' : '11px 14px')};
  border: 1px solid ${({ $role }) => (
    $role === 'user'
      ? 'color-mix(in srgb, var(--semi-color-primary) 42%, var(--app-border))'
      : 'var(--app-border)'
  )};
  border-radius: ${({ $role }) => (
    $role === 'tool' ? '8px' : $role === 'user' ? '16px 16px 5px 16px' : '16px 16px 16px 5px'
  )};
  background: ${({ $role }) => (
    $role === 'user'
      ? 'color-mix(in srgb, var(--semi-color-primary) 16%, var(--app-bg-elevated))'
      : $role === 'tool'
        ? 'color-mix(in srgb, var(--app-text-muted) 7%, var(--app-bg))'
        : 'var(--app-bg-elevated)'
  )};
  color: ${({ $role }) => ($role === 'tool' ? 'var(--app-text-muted)' : 'var(--app-text)')};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: ${({ $role }) => ($role === 'tool' ? '13px' : '14px')};
  line-height: 1.6;
`;

interface AgentTimelineProps {
  approvalBusyIds: Set<string>;
  interactionBusyIds: Set<string>;
  libraryId: number;
  messages: AgentMessage[];
  onAction?: (action: AgentPresentationAction) => void;
  onResolveApproval: (approval: AgentToolApprovalSnapshot, approved: boolean) => void;
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
  runs,
  toolActivities,
}: AgentTimelineProps) {
  const prepared = React.useMemo(
    () => prepareAgentTimelineProjection(runs, toolActivities),
    [runs, toolActivities],
  );
  const items = React.useMemo(
    () => buildAgentTimelineItemsFromProjection(messages, prepared),
    [messages, prepared],
  );

  return (
    <>
      {items.map((item) => {
        if (item.type === 'workflow') {
          return <AgentWorkflowCard key={item.key} workflow={item.workflow} />;
        }
        if (item.type === 'tool-activity') {
          return (
            <AgentToolActivityCard
              activity={item.activity}
              approvalBusy={Boolean(
                item.activity.approval
                && approvalBusyIds.has(item.activity.approval.approvalId)
              )}
              key={item.key}
              interactionBusy={Boolean(
                item.activity.interaction
                && interactionBusyIds.has(item.activity.interaction.interactionId)
              )}
              libraryId={libraryId}
              onAction={onAction}
              onResolveApproval={onResolveApproval}
            />
          );
        }
        const role = item.message.role === 'user'
          ? 'user'
          : item.message.role === 'tool'
            ? 'tool'
            : 'assistant';
        return (
          <MessageBubble key={item.key} $role={role}>
            {item.message.toolName
              ? `${item.message.toolName} · ${item.message.content}`
              : item.message.content}
          </MessageBubble>
        );
      })}
    </>
  );
}
