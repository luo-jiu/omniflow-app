import React from 'react';
import {
  IconChevronRightStroked,
  IconSearch,
} from '@douyinfe/semi-icons';
import styled from 'styled-components';

import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import type {
  AgentOwnerScope,
  AgentPreparedActionPublic,
  AgentPresentationAction,
  AgentToolActivitySnapshot,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import AgentToolActivityCard from './AgentToolActivityCard';

const ActivityGroup = styled.section`
  --agent-tool-record-color: color-mix(
    in srgb,
    var(--app-text-muted) 88%,
    var(--app-text-secondary)
  );
  --agent-tool-record-hover-color: var(--agent-tool-record-color);

  width: min(620px, 100%);
  align-self: flex-start;

  .agent-activity-group-toggle {
    width: fit-content;
    max-width: 100%;
    min-height: 23px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 3px;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--agent-tool-record-color);
    cursor: pointer;
    text-align: left;
  }

  .agent-activity-group-toggle:hover,
  .agent-activity-group-toggle:focus-visible {
    background: var(--app-hover-bg);
    color: var(--agent-tool-record-hover-color);
  }

  .agent-activity-group-toggle:focus-visible {
    outline: 2px solid var(--semi-color-focus-border);
    outline-offset: 1px;
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
    color: var(--agent-tool-record-color);
  }

  .agent-activity-group-icon .semi-icon,
  .agent-activity-group-icon svg,
  .agent-activity-group-icon svg *,
  .agent-activity-group-chevron .semi-icon,
  .agent-activity-group-chevron svg,
  .agent-activity-group-chevron svg * {
    color: var(--agent-tool-record-color);
  }

  .agent-activity-group-title {
    min-width: 0;
    height: 20px;
    flex: none;
    display: inline-flex;
    align-items: center;
    color: var(--agent-tool-record-color);
    -webkit-text-fill-color: var(--agent-tool-record-color);
    font-size: 13px;
    font-weight: 400;
    line-height: 20px;
  }

  .agent-activity-group-chevron {
    margin-left: -5px;
    margin-right: -20px;
    opacity: 0;
    pointer-events: none;
    color: var(--agent-tool-record-color);
    transition: opacity 120ms ease;
  }

  .agent-activity-group-chevron .semi-icon {
    transform: rotate(0deg);
    transform-origin: center;
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .agent-activity-group-toggle[aria-expanded='true'] .agent-activity-group-chevron .semi-icon {
    transform: rotate(90deg);
  }

  .agent-activity-group-toggle:hover .agent-activity-group-chevron,
  .agent-activity-group-toggle:focus-visible .agent-activity-group-chevron {
    opacity: 1;
  }

  .agent-activity-group-collapse {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 150ms ease,
      visibility 0s linear 220ms;
  }

  .agent-activity-group-collapse[data-open='true'] {
    grid-template-rows: 1fr;
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0s;
  }

  .agent-activity-group-collapse-inner {
    min-height: 0;
    overflow: hidden;
    transform: translateY(-2px);
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .agent-activity-group-collapse[data-open='true'] .agent-activity-group-collapse-inner {
    transform: translateY(0);
  }

  .agent-activity-group-items {
    ${workspaceScrollbarStyles}

    display: grid;
    gap: 0;
    max-height: 156px;
    margin-top: 0;
    padding-left: 0;
    padding-right: 4px;
    overflow-x: hidden;
    overflow-y: auto;
    overflow-anchor: none;
  }

  .agent-activity-group-items > article {
    padding-top: 0;
    padding-bottom: 0;
  }

  .agent-activity-group-items .agent-activity-header {
    min-height: 23px;
    gap: 5px;
  }

  .agent-activity-group-items .agent-activity-status-icon {
    width: 18px;
    height: 18px;
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-activity-group-chevron,
    .agent-activity-group-chevron .semi-icon,
    .agent-activity-group-collapse,
    .agent-activity-group-collapse-inner {
      transition: none;
    }
  }
`;

interface AgentToolActivityGroupProps {
  activities: AgentToolActivitySnapshot[];
  approvalBusyIds: Set<string>;
  interactionBusyIds: Set<string>;
  libraryId: number;
  onAction?: (action: AgentPresentationAction) => void;
  onExpand?: () => void;
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
      onExpand={props.onExpand}
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

  const toggleOpen = () => {
    if (!open) props.onExpand?.();
    setOpen(current => !current);
  };

  return (
    <ActivityGroup>
      <button
        aria-expanded={open}
        className="agent-activity-group-toggle"
        onClick={toggleOpen}
        type="button"
      >
        <span className="agent-activity-group-icon"><IconSearch aria-hidden="true" /></span>
        <span className="agent-activity-group-title">读取了 {activities.length} 项</span>
        <span className="agent-activity-group-chevron">
          <IconChevronRightStroked aria-hidden="true" />
        </span>
      </button>
      <div
        aria-hidden={!open}
        className="agent-activity-group-collapse"
        data-open={open ? true : undefined}
      >
        <div className="agent-activity-group-collapse-inner">
          <div className="agent-activity-group-items">
            {activities.map(activity => activityCard(activity, props))}
          </div>
        </div>
      </div>
    </ActivityGroup>
  );
}
