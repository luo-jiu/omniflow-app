import React from 'react';
import { IconAlertCircle, IconShrink } from '@douyinfe/semi-icons';
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
import { AgentMessageAttachments } from './AgentAttachmentStrip';
import AgentActivityText from './AgentActivityText';
import { selectAgentLiveStatus } from '../agent-live-status';
import { canCollapseAgentProcess, isAgentRunActive, shouldAutoCollapseAgentProcess, timelineItemRunId } from '../agent-run-presentation';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import { useAgentProcessExpansion } from '../hooks/useAgentProcessExpansion';
import type { AgentTimelineItem } from '../agent-timeline';
import AgentRunElapsed from './AgentRunElapsed';

const Timeline = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  > [data-agent-elapsed] { margin-bottom: 8px; }
  .agent-timeline-entry {
    display: grid;
    grid-template-rows: 1fr;
    min-width: 0;
    padding-bottom: 8px;
    opacity: 1;
    visibility: visible;
    transition: grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1),
      padding-bottom 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease,
      visibility 0s;
  }
  .agent-timeline-entry-inner { min-height: 0; overflow: hidden; }
  .agent-timeline-entry[data-empty='true'] { display: none; }
  .agent-timeline-entry-content { display: flex; flex-direction: column; min-width: 0; }
  .agent-timeline-entry[aria-hidden='true'] {
    grid-template-rows: 0fr;
    padding-bottom: 0;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1),
      padding-bottom 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease,
      visibility 0s linear 220ms;
  }
  .agent-timeline-entry[data-user='true'] { margin: 8px 0; }
  @media (prefers-reduced-motion: reduce) {
    .agent-timeline-entry,
    .agent-timeline-entry[aria-hidden='true'] { transition: none; }
  }
`;

const LiveStatus = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  padding: 4px 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.65;
  color: var(--app-text-muted);
  > .semi-icon { flex: none; width: 20px; height: 20px; }
`;

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

  &[data-work-kind='commentary'] {
    width: 100%;
    max-width: 100%;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding: 4px 0;
    color: var(--app-text);
    font-size: 14px;
    line-height: 1.6;
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
    color: var(--app-text-muted);
    font-size: 11px;
    white-space: nowrap;
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
  onToolExpand?: () => void;
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
  onToolExpand,
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
  const liveStatus = selectAgentLiveStatus(runs, messages, toolActivities);
  const expansionScope = JSON.stringify([serializeAgentOwnerScope(ownerScope), libraryId, messages[0]?.sessionId || runs[0]?.sessionId || '']);
  const { expanded: expandedRuns, setExpanded: setRunExpanded } = useAgentProcessExpansion(expansionScope);
  const restoredRuns = React.useRef(new Set(runs.filter(run => !isAgentRunActive(run)).map(run => run.id)));
  const runPresentations = React.useMemo(() => {
    const byRun = new Map<string, AgentTimelineItem[]>();
    items.forEach(item => {
      const id = timelineItemRunId(item);
      if (!id) return;
      const group = byRun.get(id) || [];
      group.push(item);
      byRun.set(id, group);
    });
    return new Map(runs.map(run => {
      const group = byRun.get(run.id) || [];
      const autoCollapse = restoredRuns.current.has(run.id) || shouldAutoCollapseAgentProcess(run, group);
      return [run.id, {
        run,
        autoCollapse,
        expansionKey: run.id,
        firstKey: group[0]?.key,
        collapsible: canCollapseAgentProcess(run, group) && group.some(item => item.layer !== 'conversation'),
      }];
    }));
  }, [items, runs]);

  const renderItem = (item: AgentTimelineItem) => {
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
              onExpand={onToolExpand}
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
              onExpand={onToolExpand}
              ownerScope={ownerScope}
              onResolveApproval={onResolveApproval}
            />
          );
        }
        if (item.type === 'assistant-work-item') {
          const status = item.item.assistantItem.status;
          const failed = status === 'failed' || status === 'cancelled' || status === 'interrupted';
          return (
            <AssistantItemSurface
              data-status={status}
              data-variant="work"
              data-work-kind="commentary"
              key={item.key}
            >
              <div className="agent-work-item-content"><AgentMessageContent content={item.item.content} showCopy={false} /></div>
              {failed ? (
                <span className="agent-work-item-state">{WORK_ITEM_STATUS_LABELS[status]}</span>
              ) : null}
            </AssistantItemSurface>
          );
        }
        if (item.message.role === 'user') {
          return (
            <UserMessageBubble key={item.key}><AgentMessageAttachments attachments={item.message.attachments}
              scope={ownerScope ? { ownerScope, libraryId } : null} sessionId={item.message.sessionId} />{item.message.content}</UserMessageBubble>
          );
        }
        return (
          <AssistantItemSurface data-variant="conversation" key={item.key}>
            <AgentMessageContent content={item.message.content} />
          </AssistantItemSurface>
        );
  };

  return (
    <Timeline>
      {items.map(item => {
        const runId = timelineItemRunId(item);
        const presentation = runId ? runPresentations.get(runId) : undefined;
        const user = item.type === 'message' && item.message.role === 'user';
        const expanded = presentation
          ? expandedRuns.get(presentation.expansionKey) ?? !presentation.autoCollapse : true;
        const collapsed = Boolean(presentation?.collapsible && !expanded
          && item.layer !== 'conversation');
        const elapsed = presentation?.firstKey === item.key ? (
          <AgentRunElapsed run={presentation.run} collapsible={presentation.collapsible}
            expanded={expanded} onToggle={() => {
              onToolExpand?.();
              setRunExpanded(presentation.expansionKey, !expanded);
            }} />
        ) : null;
        return <React.Fragment key={item.key}>
          {!user ? elapsed : null}
          <div className="agent-timeline-entry" data-user={user}
            data-empty={item.type === 'assistant-work-item' && item.item.assistantItem.status === 'streaming' && !item.item.content.trim() || undefined}
            data-agent-question={user && item.type === 'message' ? item.message.id : undefined}
            aria-hidden={collapsed || undefined} {...(collapsed ? { inert: '' } : {})}>
            <div className="agent-timeline-entry-inner">
              <div className="agent-timeline-entry-content">{renderItem(item)}</div>
            </div>
          </div>
          {user ? elapsed : null}
        </React.Fragment>;
      })}
      {[...runPresentations.values()].filter(presentation => !presentation.firstKey).map(({ run }) => (
        <AgentRunElapsed key={run.id} run={run} collapsible={false} expanded={false} onToggle={() => {}} />
      ))}
      {liveStatus ? (
        <LiveStatus role="status" aria-live="polite" data-agent-live-status={liveStatus.kind} key={`live:${liveStatus.runId}`}>
          {liveStatus.kind === 'compaction' ? <IconShrink aria-hidden="true" /> : null}
          <AgentActivityText $active>{liveStatus.label}</AgentActivityText>
        </LiveStatus>
      ) : null}
    </Timeline>
  );
}
