import React from 'react';
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
import AgentDisclosureChevron from './AgentDisclosureChevron';
import AgentActivityText from './AgentActivityText';
import { buildAgentToolSummary } from '../agent-tool-presentation';
import AgentToolIcon from './AgentToolIcon';
import type { AgentComputerPointerPlan } from '../agent-computer-pointer-plan';
import { AgentToolDetailLayoutContext, type AgentToolDetailLayout } from '../agent-tool-detail-layout';

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
    min-height: 20px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--agent-tool-record-color);
    cursor: pointer;
    font: inherit;
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
    width: 16px;
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
    flex: 0 1 auto;
    display: block;
    color: var(--agent-tool-record-color);
    -webkit-text-fill-color: var(--agent-tool-record-color);
    font-size: 13px;
    font-weight: 400;
    line-height: 20px;
  }
  .agent-activity-group-live {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-activity-group-chevron {
    margin-left: -5px;
    margin-right: -20px;
    opacity: 0;
    pointer-events: none;
    color: var(--agent-tool-record-color);
    transition: opacity 120ms ease;
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

    max-height: 256px;
    margin-top: 2px;
    padding-left: 0;
    padding-right: 4px;
    overflow-x: hidden;
    overflow-y: auto;
    overflow-anchor: none;
    transition: max-height 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .agent-activity-group-content {
    display: grid;
    gap: 2px;
  }

  .agent-activity-group-content > article {
    padding-top: 0;
    padding-bottom: 0;
  }

  .agent-activity-group-items .agent-activity-header {
    min-height: 20px;
    gap: 7px;
  }

  .agent-activity-group-items .agent-activity-status-icon {
    width: 16px;
    height: 20px;
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-activity-group-chevron,
    .agent-activity-group-chevron .semi-icon,
    .agent-activity-group-collapse,
    .agent-activity-group-collapse-inner,
    .agent-activity-group-items {
      transition: none;
    }
  }
`;

interface AgentToolActivityGroupProps {
  pointerPlans?: ReadonlyMap<string, AgentComputerPointerPlan>;
  activities: AgentToolActivitySnapshot[];
  approvalBusyIds: Set<string>;
  detailsVisible?: boolean;
  receiptBusyIds?: ReadonlySet<string>;
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
  detailsVisible: boolean,
) {
  return (
    <AgentToolActivityCard
      detailsVisible={detailsVisible}
      receiptBusy={props.receiptBusyIds?.has(activity.id)}
      activity={activity}
      pointerPlan={props.pointerPlans?.get(activity.id)}
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
  const itemsRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const detailLayouts = React.useRef(new Map<string, AgentToolDetailLayout>());
  const updateGroupHeight = React.useCallback(() => {
    const items = itemsRef.current;
    const content = contentRef.current;
    if (!items || !content) return;
    const details = [...detailLayouts.current.values()];
    if (!details.some(entry => entry.observation)) {
      items.style.maxHeight = '256px';
      return;
    }
    // Include every summary row, even when the observation is last in a long group.
    // Only open, naturally sized bodies are read; no animation-frame DOM scan.
    const height = details.reduce((total, entry) => {
      const collapse = entry.body.closest<HTMLElement>('.agent-activity-collapse');
      const style = window.getComputedStyle(entry.body);
      const naturalHeight = entry.body.getBoundingClientRect().height
        + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
      return total + naturalHeight - (collapse?.getBoundingClientRect().height || 0);
    }, content.getBoundingClientRect().height);
    items.style.maxHeight = `${Math.max(256, Math.ceil(height))}px`;
  }, []);
  const reportDetailLayout = React.useCallback((id: string, detail: AgentToolDetailLayout | null) => {
    if (detail) detailLayouts.current.set(id, detail);
    else detailLayouts.current.delete(id);
    updateGroupHeight();
  }, [updateGroupHeight]);
  React.useLayoutEffect(updateGroupHeight, [activities, updateGroupHeight]);
  const toggleOpen = () => {
    props.onExpand?.();
    setOpen(current => !current);
  };
  const latest = activities[activities.length - 1];
  if (!latest) return null;
  const latestSummary = buildAgentToolSummary(latest, props.libraryId);
  const latestIsActive = latest.status === 'running' || latest.status === 'preparing';

  return (
    <ActivityGroup>
      <button
        aria-expanded={open}
        className="agent-activity-group-toggle"
        onClick={toggleOpen}
        type="button"
      >
        <span className="agent-activity-group-icon"><AgentToolIcon activity={latest} /></span>
        <span className="agent-activity-group-title agent-activity-group-live">
          {latestIsActive ? <AgentActivityText $active>{latestSummary.label}{latestSummary.subject ? ` ${latestSummary.subject}` : ''}</AgentActivityText>
            : `${latestSummary.label}${latestSummary.subject ? ` ${latestSummary.subject}` : ''}`}
        </span>
        <span className="agent-activity-group-chevron">
          <AgentDisclosureChevron expanded={open} />
        </span>
      </button>
      <div
        aria-hidden={!open}
        className="agent-activity-group-collapse"
        data-open={open ? true : undefined}
      >
        <div className="agent-activity-group-collapse-inner">
          <div ref={itemsRef} className="agent-activity-group-items">
            <AgentToolDetailLayoutContext.Provider value={reportDetailLayout}>
              <div ref={contentRef} className="agent-activity-group-content">
                {activities.map(activity => activityCard(activity, props, open && props.detailsVisible !== false))}
              </div>
            </AgentToolDetailLayoutContext.Provider>
          </div>
        </div>
      </div>
    </ActivityGroup>
  );
}
