import {
  IconAlertCircle,
  IconClock,
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
  padding: 12px 14px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--semi-color-primary) 4%, var(--app-bg-elevated));

  .agent-workflow-header {
    min-height: 24px;
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .agent-workflow-header-icon,
  .agent-workflow-step-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: var(--app-text-muted);
  }

  .agent-workflow-header-icon {
    width: 20px;
    height: 20px;
    color: var(--semi-color-primary);
  }

  .agent-workflow-title {
    min-width: 0;
    flex: 1;
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 600;
  }

  .agent-workflow-summary {
    flex: none;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-workflow-current {
    margin: 7px 0 0 29px;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .agent-workflow-steps {
    display: grid;
    gap: 3px;
    margin: 9px 0 0;
    padding: 0;
    list-style: none;
  }

  .agent-workflow-step {
    min-height: 30px;
    display: grid;
    grid-template-columns: 20px minmax(90px, auto) minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    padding: 3px 0;
  }

  .agent-workflow-step-icon {
    width: 20px;
    height: 20px;
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

  .agent-workflow-step[data-status='planned'] .agent-workflow-step-icon {
    color: color-mix(in srgb, var(--semi-color-primary) 58%, var(--app-text-muted));
  }

  .agent-workflow-step[data-status='not_run'] .agent-workflow-step-icon,
  .agent-workflow-step[data-status='not_run'] .agent-workflow-step-title,
  .agent-workflow-step[data-status='not_run'] .agent-workflow-step-detail {
    color: color-mix(in srgb, var(--app-text-muted) 72%, transparent);
  }

  .agent-workflow-step[data-status='running'] .agent-workflow-step-icon svg,
  .agent-workflow-step[data-status='preparing'] .agent-workflow-step-icon svg {
    animation: agent-workflow-spin 900ms linear infinite;
  }

  .agent-workflow-step-title,
  .agent-workflow-step-detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-workflow-step-title {
    color: var(--app-text);
    font-size: 13px;
    font-weight: 500;
  }

  .agent-workflow-step-detail {
    color: var(--app-text-muted);
    font-size: 13px;
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
  workflow: AgentWorkflowProjection;
}

export default function AgentWorkflowCard({ workflow }: AgentWorkflowCardProps) {
  const summary = workflow.totalStepCount > 0
    ? `${workflow.settledStepCount}/${workflow.totalStepCount} · ${RUN_STATUS_LABELS[workflow.status]}`
    : RUN_STATUS_LABELS[workflow.status];

  return (
    <WorkflowCard aria-label="Agent 任务进度" aria-live="polite">
      <div className="agent-workflow-header">
        <span className="agent-workflow-header-icon"><IconList aria-hidden="true" /></span>
        <h2 className="agent-workflow-title">{workflow.title || '任务进度'}</h2>
        <span className="agent-workflow-summary">{summary}</span>
      </div>
      {workflow.currentStep ? (
        <p className="agent-workflow-current">{workflow.currentStep}</p>
      ) : null}
      {workflow.steps.length > 0 ? (
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
      ) : null}
    </WorkflowCard>
  );
}
