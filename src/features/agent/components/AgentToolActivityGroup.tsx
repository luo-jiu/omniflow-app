import React from 'react';
import { IconChevronDown, IconChevronRight, IconSearch } from '@douyinfe/semi-icons';
import styled from 'styled-components';

import type {
  AgentOwnerScope,
  AgentPreparedActionPublic,
  AgentPresentationAction,
  AgentToolActivitySnapshot,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import AgentToolActivityCard from './AgentToolActivityCard';

const ActivityGroup = styled.section`
  width: min(620px, 100%);
  align-self: flex-start;

  .agent-activity-group-toggle {
    width: 100%;
    min-height: 28px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 2px 3px;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
    text-align: left;
  }

  .agent-activity-group-toggle:hover,
  .agent-activity-group-toggle:focus-visible {
    outline: 0;
    background: var(--app-hover-bg);
  }

  .agent-activity-group-icon,
  .agent-activity-group-chevron {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }

  .agent-activity-group-icon {
    color: var(--app-text-muted);
  }

  .agent-activity-group-title {
    min-width: 0;
    flex: 1;
    font-size: 13px;
    font-weight: 400;
  }

  .agent-activity-group-summary {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-activity-group-chevron {
    color: var(--app-text-muted);
  }

  .agent-activity-group-items {
    display: grid;
    gap: 2px;
    margin-top: 6px;
    padding-left: 12px;
  }
`;

interface AgentToolActivityGroupProps {
  activities: AgentToolActivitySnapshot[];
  approvalBusyIds: Set<string>;
  interactionBusyIds: Set<string>;
  libraryId: number;
  onAction?: (action: AgentPresentationAction) => void;
  onResolveApproval: (
    approval: AgentToolApprovalSnapshot,
    approved: boolean,
    preparedAction?: AgentPreparedActionPublic,
  ) => void;
  ownerScope: AgentOwnerScope | null;
  readOnlyActivityId?: string;
}

function activityCard(
  activity: AgentToolActivitySnapshot,
  props: Omit<AgentToolActivityGroupProps, 'activities'>,
) {
  return (
    <AgentToolActivityCard
      activity={activity}
      approvalBusy={Boolean(
        activity.approval && props.approvalBusyIds.has(activity.approval.approvalId)
      )}
      interactionBusy={Boolean(
        activity.interaction
        && props.interactionBusyIds.has(activity.interaction.interactionId)
      )}
      interactive={activity.id !== props.readOnlyActivityId}
      key={activity.id}
      libraryId={props.libraryId}
      onAction={props.onAction}
      ownerScope={props.ownerScope}
      onResolveApproval={props.onResolveApproval}
    />
  );
}

export default function AgentToolActivityGroup({
  activities,
  ...props
}: AgentToolActivityGroupProps) {
  const [open, setOpen] = React.useState(false);
  if (activities.length === 1) return activityCard(activities[0], props);

  const operationCounts = activities.reduce<Record<string, number>>((counts, activity) => {
    const operation = activity.toolMetadata?.operationKind || 'read';
    counts[operation] = (counts[operation] || 0) + 1;
    return counts;
  }, {});
  const operationLabels = [
    operationCounts.list ? `列出 ${operationCounts.list}` : '',
    operationCounts.stat ? `检查 ${operationCounts.stat}` : '',
    operationCounts.read ? `读取 ${operationCounts.read}` : '',
    operationCounts.search ? `搜索 ${operationCounts.search}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <ActivityGroup>
      <button
        aria-expanded={open}
        className="agent-activity-group-toggle"
        onClick={() => setOpen(current => !current)}
        type="button"
      >
        <span className="agent-activity-group-icon"><IconSearch aria-hidden="true" /></span>
        <span className="agent-activity-group-title">读取了 {activities.length} 项</span>
        <span className="agent-activity-group-summary">{operationLabels}</span>
        <span className="agent-activity-group-chevron">
          {open ? <IconChevronDown aria-hidden="true" /> : <IconChevronRight aria-hidden="true" />}
        </span>
      </button>
      {open ? (
        <div className="agent-activity-group-items">
          {activities.map(activity => activityCard(activity, props))}
        </div>
      ) : null}
    </ActivityGroup>
  );
}
