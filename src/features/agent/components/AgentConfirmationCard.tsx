import React from 'react';
import { IconFolder } from '@douyinfe/semi-icons';
import styled from 'styled-components';

import type { AgentToolApprovalSnapshot } from '@/shared/agent/agent.types';

const ConfirmationCard = styled.article`
  width: min(620px, 100%);
  align-self: flex-start;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--semi-color-warning) 42%, var(--app-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--semi-color-warning-light-default) 35%, var(--app-bg-elevated));

  .agent-confirmation-heading {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .agent-confirmation-icon {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border-radius: var(--app-radius-small);
    background: color-mix(in srgb, var(--semi-color-warning) 14%, transparent);
    color: var(--semi-color-warning);
  }

  h3 {
    margin: 0;
    font-size: 14px;
    line-height: 1.35;
  }

  p {
    margin: 8px 0 0;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.55;
  }

  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 12px;
    margin: 12px 0 0;
    font-size: 13px;
  }

  dt {
    color: var(--app-text-muted);
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .agent-confirmation-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }

  button {
    min-width: 68px;
    height: 32px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--app-radius-medium);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .agent-confirmation-cancel {
    background: var(--semi-color-fill-1);
    color: var(--app-text);
  }

  .agent-confirmation-allow {
    background: var(--semi-color-primary);
    color: #fff;
  }
`;

interface AgentConfirmationCardProps {
  approval: AgentToolApprovalSnapshot;
  busy: boolean;
  onResolve: (approved: boolean) => void;
}

export default function AgentConfirmationCard({
  approval,
  busy,
  onResolve,
}: AgentConfirmationCardProps) {
  return (
    <ConfirmationCard>
      <div className="agent-confirmation-heading">
        <span className="agent-confirmation-icon"><IconFolder aria-hidden="true" /></span>
        <h3>{approval.preview.title}</h3>
      </div>
      <p>{approval.preview.description}</p>
      {approval.preview.details?.length ? (
        <dl>
          {approval.preview.details.map(detail => (
            <React.Fragment key={`${detail.label}:${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
      <div className="agent-confirmation-actions">
        <button
          className="agent-confirmation-cancel"
          disabled={busy}
          onClick={() => onResolve(false)}
          type="button"
        >
          取消
        </button>
        <button
          className="agent-confirmation-allow"
          disabled={busy}
          onClick={() => onResolve(true)}
          type="button"
        >
          {busy ? '处理中' : '允许'}
        </button>
      </div>
    </ConfirmationCard>
  );
}
