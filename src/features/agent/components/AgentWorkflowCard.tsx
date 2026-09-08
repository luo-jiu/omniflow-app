import {
  IconAlertCircle,
  IconChevronDown,
  IconClock,
  IconCommentStroked,
  IconList,
  IconMinusCircleStroked,
  IconSpin,
  IconTickCircle,
} from '@douyinfe/semi-icons';
import styled from 'styled-components';

import type {
  AgentWorkflowProjection,
  AgentWorkflowStepStatus,
} from '../agent-workflow-projection';
import { getAgentToolNameTitle } from '../agent-tool-presentation';

const WorkflowCard = styled.article`
  width: min(620px, 100%);
  align-self: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-medium);
  background: color-mix(in srgb, var(--semi-color-primary) 4%, var(--app-bg-elevated));

  &[data-variant='dock'] {
    width: 100%;
    padding: 9px 11px;
    background: color-mix(in srgb, var(--semi-color-primary) 5%, var(--app-bg-elevated));
    box-shadow: 0 1px 8px color-mix(in srgb, var(--app-text) 6%, transparent);
  }

  .agent-workflow-header {
    min-height: 22px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .agent-workflow-header-icon,
  .agent-workflow-status-icon,
  .agent-workflow-step-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }

  .agent-workflow-header-icon,
  .agent-workflow-status-icon,
  .agent-workflow-step-icon {
    width: 18px;
    height: 18px;
  }

  .agent-workflow-header-icon {
    color: var(--semi-color-primary);
  }

  .agent-workflow-title {
    min-width: 0;
    flex: 1;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.4;
    font-weight: 600;
  }

  .agent-workflow-summary {
    flex: none;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-workflow-status {
    min-height: 25px;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .agent-workflow-status-icon {
    color: var(--semi-color-primary);
  }

  .agent-workflow-status[data-kind='awaiting_approval'] .agent-workflow-status-icon,
  .agent-workflow-status[data-kind='awaiting_interaction'] .agent-workflow-status-icon {
    color: var(--semi-color-warning);
  }

  .agent-workflow-status[data-kind='tool'] .agent-workflow-status-icon svg,
  .agent-workflow-status[data-kind='thinking'] .agent-workflow-status-icon svg {
    animation: agent-workflow-spin 900ms linear infinite;
  }

  .agent-workflow-pointers {
    display: grid;
    gap: 4px;
    margin: 6px 0 0 26px;
  }

  .agent-workflow-pointer {
    min-width: 0;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 7px;
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
  }

  .agent-workflow-pointer-label {
    color: var(--app-text-muted);
  }

  .agent-workflow-pointer-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-workflow-deviation {
    margin: 5px 0 0 26px;
    color: var(--semi-color-warning);
    font-size: 12px;
  }

  .agent-workflow-plan {
    margin: 6px 0 0 26px;
  }

  .agent-workflow-plan-summary {
    width: max-content;
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 12px;
    list-style: none;
  }

  .agent-workflow-plan-summary::-webkit-details-marker {
    display: none;
  }

  .agent-workflow-plan-summary svg {
    transition: transform 140ms ease;
  }

  .agent-workflow-plan[open] .agent-workflow-plan-summary svg {
    transform: rotate(180deg);
  }

  .agent-workflow-steps {
    display: grid;
    gap: 2px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }

  .agent-workflow-step {
    min-height: 26px;
    display: grid;
    grid-template-columns: 18px minmax(90px, auto) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }

  .agent-workflow-step[data-status='completed'] .agent-workflow-step-icon {
    color: var(--semi-color-success);
  }

  .agent-workflow-step[data-status='failed'] .agent-workflow-step-icon,
  .agent-workflow-step[data-status='cancelled'] .agent-workflow-step-icon,
  .agent-workflow-step[data-status='interrupted'] .agent-workflow-step-icon {
    color: var(--semi-color-warning);
  }

  .agent-workflow-step[data-status='running'] .agent-workflow-step-icon,
  .agent-workflow-step[data-status='preparing'] .agent-workflow-step-icon,
  .agent-workflow-step[data-status='awaiting_approval'] .agent-workflow-step-icon,
  .agent-workflow-step[data-status='awaiting_interaction'] .agent-workflow-step-icon {
    color: var(--semi-color-primary);
  }

  .agent-workflow-step[data-status='running'] .agent-workflow-step-icon svg,
  .agent-workflow-step[data-status='preparing'] .agent-workflow-step-icon svg {
    animation: agent-workflow-spin 900ms linear infinite;
  }

  .agent-workflow-step[data-status='not_run'],
  .agent-workflow-step[data-status='planned'] {
    color: var(--app-text-muted);
  }

  .agent-workflow-step-title,
  .agent-workflow-step-detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .agent-workflow-step-title {
    font-weight: 500;
  }

  .agent-workflow-step-detail {
    color: var(--app-text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-workflow-status-icon svg,
    .agent-workflow-step-icon svg,
    .agent-workflow-plan-summary svg {
      animation: none !important;
      transition: none !important;
    }
  }

  @keyframes agent-workflow-spin {
    to { transform: rotate(360deg); }
  }
`;

function statusIcon(status: AgentWorkflowStepStatus) {
  if (status === 'completed') return <IconTickCircle aria-hidden="true" />;
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') {
    return <IconAlertCircle aria-hidden="true" />;
  }
  if (status === 'planned') return <IconClock aria-hidden="true" />;
  if (status === 'not_run') return <IconMinusCircleStroked aria-hidden="true" />;
  return <IconSpin aria-hidden="true" />;
}

function primaryStatusIcon(workflow: AgentWorkflowProjection) {
  const kind = workflow.primaryStatus?.kind;
  if (kind === 'awaiting_approval' || kind === 'awaiting_interaction') {
    return <IconAlertCircle aria-hidden="true" />;
  }
  if (kind === 'commentary') return <IconCommentStroked aria-hidden="true" />;
  if (kind === 'plan' || kind === 'run') return <IconClock aria-hidden="true" />;
  return <IconSpin aria-hidden="true" />;
}

const RUN_STATUS_LABELS: Record<AgentWorkflowProjection['status'], string> = {
  preparing: '准备中',
  awaiting_approval: '等待确认',
  awaiting_interaction: '等待输入',
  cancelled: '已取消',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
  running: '进行中',
};

interface AgentWorkflowCardProps {
  variant?: 'dock' | 'timeline';
  workflow: AgentWorkflowProjection;
}

export default function AgentWorkflowCard({
  variant = 'timeline',
  workflow,
}: AgentWorkflowCardProps) {
  const summary = workflow.totalStepCount > 0
    ? `${workflow.settledStepCount}/${workflow.totalStepCount} · ${RUN_STATUS_LABELS[workflow.status]}`
    : RUN_STATUS_LABELS[workflow.status];

  return (
    <WorkflowCard
      aria-label={variant === 'dock' ? 'Agent 当前任务' : 'Agent 任务进度'}
      data-variant={variant}
    >
      <div className="agent-workflow-header">
        <span className="agent-workflow-header-icon"><IconList aria-hidden="true" /></span>
        <h2 className="agent-workflow-title">{workflow.title || '任务进度'}</h2>
        <span className="agent-workflow-summary">{summary}</span>
      </div>
      {workflow.primaryStatus ? (
        <div
          aria-atomic={variant === 'dock' ? 'true' : undefined}
          aria-live={variant === 'dock' && workflow.primaryStatus.kind !== 'commentary'
            ? 'polite'
            : undefined}
          className="agent-workflow-status"
          data-kind={workflow.primaryStatus.kind}
        >
          <span className="agent-workflow-status-icon">
            {primaryStatusIcon(workflow)}
          </span>
          <span>{workflow.primaryStatus.label}</span>
        </div>
      ) : null}
      {workflow.currentPlanStep || workflow.nextPlanStep ? (
        <div className="agent-workflow-pointers">
          {workflow.currentPlanStep ? (
            <div className="agent-workflow-pointer">
              <span className="agent-workflow-pointer-label">当前</span>
              <span className="agent-workflow-pointer-value">{workflow.currentPlanStep.title}</span>
            </div>
          ) : null}
          {workflow.nextPlanStep ? (
            <div className="agent-workflow-pointer">
              <span className="agent-workflow-pointer-label">下一步</span>
              <span className="agent-workflow-pointer-value">{workflow.nextPlanStep.title}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {workflow.offPlanActivityIds.length > 0 ? (
        <p className="agent-workflow-deviation">
          {workflow.offPlanActivityIds.length} 个计划外步骤
        </p>
      ) : null}
      {workflow.steps.length > 0 ? (
        <details className="agent-workflow-plan">
          <summary className="agent-workflow-plan-summary">
            <span>查看完整计划</span>
            <IconChevronDown aria-hidden="true" />
          </summary>
          <ol className="agent-workflow-steps">
            {workflow.steps.map(step => (
              <li className="agent-workflow-step" data-status={step.status} key={step.key}>
                <span className="agent-workflow-step-icon">{statusIcon(step.status)}</span>
                <span className="agent-workflow-step-title">
                  {step.title || getAgentToolNameTitle(step.toolName)}
                </span>
                <span className="agent-workflow-step-detail" title={step.detail}>{step.detail}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </WorkflowCard>
  );
}
