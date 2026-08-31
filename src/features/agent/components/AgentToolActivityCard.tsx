import React from 'react';
import {
  IconAlertCircle,
  IconFile,
  IconFolder,
  IconSpin,
  IconTickCircle,
} from '@douyinfe/semi-icons';
import styled from 'styled-components';

import type {
  AgentOwnerScope,
  AgentPresentationAction,
  AgentPresentationBlock,
  AgentPreparedActionPublic,
  AgentToolActivitySnapshot,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import type { AgentShellOutputFrameV1 } from '@/shared/agent/shell/agent-shell.types';
import {
  buildAgentToolPresentation,
  getAgentToolTitle,
} from '../agent-tool-presentation';
import AgentConfirmationCard from './AgentConfirmationCard';
import AgentInteractionBlock from './AgentInteractionBlock';
import { readAgentShellLogPage } from '../services/agent.api';

const ActivityCard = styled.article`
  width: min(620px, 100%);
  align-self: flex-start;
  padding: 12px 14px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-bg-elevated);

  .agent-activity-header {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 24px;
  }

  .agent-activity-status-icon {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: var(--app-text-muted);
  }

  &[data-status='completed'] .agent-activity-status-icon {
    color: var(--semi-color-success);
  }

  &[data-status='failed'] .agent-activity-status-icon {
    color: var(--semi-color-danger);
  }

  &[data-status='cancelled'] .agent-activity-status-icon,
  &[data-status='interrupted'] .agent-activity-status-icon {
    color: var(--semi-color-warning);
  }

  &[data-status='running'] .agent-activity-status-icon {
    color: var(--semi-color-primary);
  }

  &[data-status='preparing'] .agent-activity-status-icon {
    color: var(--semi-color-primary);
  }

  &[data-status='preparing'] .agent-activity-status-icon svg,
  &[data-status='running'] .agent-activity-status-icon svg {
    animation: agent-activity-spin 900ms linear infinite;
  }

  .agent-activity-title {
    min-width: 0;
    flex: 1;
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 600;
  }

  .agent-activity-state {
    flex: none;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-activity-body {
    display: grid;
    gap: 10px;
    margin-top: 10px;
  }

  .agent-activity-message {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .agent-activity-progress-track {
    height: 4px;
    margin-top: 8px;
    overflow: hidden;
    border-radius: var(--app-radius-large);
    background: var(--semi-color-fill-1);
  }

  .agent-activity-progress-value {
    height: 100%;
    border-radius: inherit;
    background: var(--semi-color-primary);
    transition: width 160ms ease;
  }

  .agent-activity-details {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 5px 12px;
    margin: 0;
    font-size: 13px;
  }

  .agent-activity-details dt {
    color: var(--app-text-muted);
  }

  .agent-activity-details dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .agent-activity-artifact {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--app-radius-small);
    background: color-mix(in srgb, var(--app-text-muted) 7%, transparent);
  }

  .agent-activity-artifact-icon {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: var(--semi-color-primary);
  }

  .agent-activity-artifact-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .agent-activity-action {
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--app-text-muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .agent-activity-action:hover,
  .agent-activity-action:focus-visible {
    outline: 0;
    background: var(--semi-color-fill-1);
    color: var(--app-text);
  }

  .agent-shell-log-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .agent-shell-log {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--app-border);
    border-radius: var(--app-radius-small);
    background: color-mix(in srgb, var(--app-text) 5%, var(--app-bg));
  }

  .agent-shell-log-output {
    max-height: 280px;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    color: var(--app-text);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .agent-shell-log-output [data-stream='stderr'] {
    color: var(--semi-color-danger);
  }

  .agent-shell-log-empty,
  .agent-shell-log-notice {
    margin: 0;
    padding: 9px 12px;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .agent-shell-log-notice + .agent-shell-log-output,
  .agent-shell-log-output + .agent-shell-log-notice {
    border-top: 1px solid var(--app-border);
  }

  @keyframes agent-activity-spin {
    to { transform: rotate(360deg); }
  }
`;

const STATUS_LABELS: Record<AgentToolActivitySnapshot['status'], string> = {
  preparing: '准备中',
  awaiting_approval: '等待确认',
  awaiting_interaction: '等待输入',
  cancelled: '已取消',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
  running: '执行中',
};

function ActivityStatusIcon({ status }: { status: AgentToolActivitySnapshot['status'] }) {
  if (status === 'completed') return <IconTickCircle aria-hidden="true" />;
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') {
    return <IconAlertCircle aria-hidden="true" />;
  }
  return <IconSpin aria-hidden="true" />;
}

function renderBlock(
  block: AgentPresentationBlock,
  index: number,
  interactionBusy: boolean,
  onAction?: (action: AgentPresentationAction) => void,
) {
  if (block.type === 'choice' || block.type === 'form') {
    return (
      <AgentInteractionBlock
        block={block}
        busy={interactionBusy}
        key={`${block.type}:${block.interactionId}`}
        onAction={onAction}
      />
    );
  }
  if (block.type === 'progress') {
    const percent = block.percent === undefined ? null : Math.max(0, Math.min(100, block.percent));
    return (
      <div key={`progress:${index}`}>
        <p className="agent-activity-message">{block.label}</p>
        {percent !== null ? (
          <div
            aria-label={`${block.label} ${Math.round(percent)}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(percent)}
            className="agent-activity-progress-track"
            role="progressbar"
          >
            <div className="agent-activity-progress-value" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
    );
  }
  if (block.type === 'details') {
    return (
      <dl className="agent-activity-details" key={`details:${index}`}>
        {block.entries.map(entry => (
          <React.Fragment key={`${entry.label}:${entry.value}`}>
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }
  if (block.type === 'artifact') {
    return (
      <div className="agent-activity-artifact" key={`artifact:${block.artifact.id}`}>
        <span className="agent-activity-artifact-icon">
          {block.artifact.kind === 'directory'
            ? <IconFolder aria-hidden="true" />
            : <IconFile aria-hidden="true" />}
        </span>
        <span className="agent-activity-artifact-name" title={block.artifact.name}>
          {block.artifact.name}
        </span>
        {onAction ? block.actions?.map(action => (
          <button
            className="agent-activity-action"
            key={`${action.action}:${action.label}`}
            onClick={() => onAction(action)}
            type="button"
          >
            {action.label}
          </button>
        )) : null}
      </div>
    );
  }
  if (block.type === 'notice') {
    return <p className="agent-activity-message" key={`notice:${index}`}>{block.message}</p>;
  }
  if (block.type === 'status') {
    return <p className="agent-activity-message" key={`status:${index}`}>{block.label}</p>;
  }
  return null;
}

interface AgentToolActivityCardProps {
  activity: AgentToolActivitySnapshot;
  approvalBusy: boolean;
  interactionBusy: boolean;
  libraryId: number;
  onAction?: (action: AgentPresentationAction) => void;
  ownerScope: AgentOwnerScope | null;
  onResolveApproval: (
    approval: AgentToolApprovalSnapshot,
    approved: boolean,
    preparedAction?: AgentPreparedActionPublic,
  ) => void;
}

interface AgentShellLogDetailsProps {
  activity: AgentToolActivitySnapshot;
  libraryId: number;
  ownerScope: AgentOwnerScope;
}

function AgentShellLogDetails({ activity, libraryId, ownerScope }: AgentShellLogDetailsProps) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [frames, setFrames] = React.useState<readonly AgentShellOutputFrameV1[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | undefined>();
  const [expired, setExpired] = React.useState(false);
  const [unavailableThrough, setUnavailableThrough] = React.useState<number | null>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    setOpen(false);
    setLoaded(false);
    setLoading(false);
    setFrames([]);
    setNextCursor(undefined);
    setExpired(false);
    setUnavailableThrough(null);
    setError('');
  }, [activity.id]);

  const loadPage = async (cursor?: string) => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const page = await readAgentShellLogPage({
        ...(cursor ? { cursor } : {}),
        libraryId,
        maxBytes: 128 * 1024,
        maxFrames: 128,
        ownerScope,
        runId: activity.runId,
        sessionId: activity.sessionId,
        toolRunId: activity.id,
        version: 1,
      });
      setFrames(current => {
        const merged = new Map(current.map(frame => [frame.sequence, frame]));
        page.frames.forEach(frame => merged.set(frame.sequence, frame));
        return Array.from(merged.values()).sort((left, right) => left.sequence - right.sequence);
      });
      setNextCursor(page.nextCursor);
      setExpired(page.expired);
      setUnavailableThrough(current => (
        page.unavailableThrough === null
          ? current
          : Math.max(current || 0, page.unavailableThrough)
      ));
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '详细日志读取失败');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !loaded && !loading) void loadPage();
  };

  return (
    <>
      <div className="agent-shell-log-actions">
        <button className="agent-activity-action" onClick={toggle} type="button">
          {open ? '收起详细日志' : '查看详细日志'}
        </button>
      </div>
      {open ? (
        <div className="agent-shell-log">
          {expired ? (
            <p className="agent-shell-log-notice">详细日志已过期</p>
          ) : unavailableThrough !== null ? (
            <p className="agent-shell-log-notice">
              序号 {unavailableThrough} 及以前的部分输出已不可用
            </p>
          ) : null}
          {frames.length > 0 ? (
            <pre className="agent-shell-log-output">
              {frames.map(frame => (
                <span data-stream={frame.stream} key={frame.sequence}>{frame.text}</span>
              ))}
            </pre>
          ) : loaded && !loading && !error && !expired ? (
            <p className="agent-shell-log-empty">命令没有产生输出</p>
          ) : null}
          {error ? <p className="agent-shell-log-notice" role="alert">{error}</p> : null}
          {loading ? <p className="agent-shell-log-notice" role="status">正在读取日志...</p> : null}
          {!loading && nextCursor ? (
            <button
              className="agent-activity-action"
              onClick={() => { void loadPage(nextCursor); }}
              type="button"
            >
              加载更多
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export default function AgentToolActivityCard({
  activity,
  approvalBusy,
  interactionBusy,
  libraryId,
  onAction,
  onResolveApproval,
  ownerScope,
}: AgentToolActivityCardProps) {
  if (activity.status === 'awaiting_approval' && activity.approval?.status === 'pending') {
    const approval: AgentToolApprovalSnapshot = {
      approvalId: activity.approval.approvalId,
      call: activity.call,
      ...(activity.preparation ? { preparation: activity.preparation } : {}),
      preview: activity.approval.preview,
      runId: activity.runId,
      sessionId: activity.sessionId,
    };
    return (
      <AgentConfirmationCard
        approval={approval}
        busy={approvalBusy}
        libraryId={libraryId}
        onResolve={(approved, preparedAction) => (
          onResolveApproval(approval, approved, preparedAction)
        )}
      />
    );
  }

  const blocks = buildAgentToolPresentation(activity, libraryId);
  return (
    <ActivityCard data-status={activity.status}>
      <div className="agent-activity-header">
        <span className="agent-activity-status-icon">
          <ActivityStatusIcon status={activity.status} />
        </span>
        <h3 className="agent-activity-title">{getAgentToolTitle(activity)}</h3>
        <span className="agent-activity-state">{STATUS_LABELS[activity.status]}</span>
      </div>
      {blocks.length > 0 ? (
        <div className="agent-activity-body">
          {blocks.map((block, index) => renderBlock(block, index, interactionBusy, onAction))}
        </div>
      ) : null}
      {activity.call.name === 'shell.run' && activity.result && ownerScope ? (
        <div className="agent-activity-body">
          <AgentShellLogDetails
            activity={activity}
            libraryId={libraryId}
            ownerScope={ownerScope}
          />
        </div>
      ) : null}
    </ActivityCard>
  );
}
