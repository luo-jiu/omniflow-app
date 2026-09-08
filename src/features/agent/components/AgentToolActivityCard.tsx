import React from 'react';
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconSpin,
  IconTickCircle,
} from '@douyinfe/semi-icons';
import styled from 'styled-components';

import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { normalizeAgentPreparedActionPublic } from '@/shared/agent/agent-prepared-action';
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
  buildAgentToolSummary,
} from '../agent-tool-presentation';
import { formatAgentShellCommandForDisplay } from '../agent-shell-command-display';
import AgentConfirmationCard from './AgentConfirmationCard';
import AgentInteractionBlock from './AgentInteractionBlock';
import { readAgentShellLogPage } from '../services/agent.api';

const ActivityCard = styled.article`
  width: min(620px, 100%);
  align-self: flex-start;
  min-width: 0;
  padding: 2px 3px;
  border: 0;
  border-radius: 0;
  background: transparent;

  .agent-activity-header {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 28px;
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
    color: var(--app-text-muted);
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
    font-size: 13px;
    line-height: 1.4;
    font-weight: 400;
    color: var(--app-text-muted);
    display: flex;
    align-items: baseline;
    gap: 5px;
  }

  .agent-activity-title > span:first-child { flex: none; }
  .agent-activity-subject {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background: transparent; border: 0; padding: 0; color: inherit; font: inherit;
  }
  button.agent-activity-subject { text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .agent-activity-expand { width: 24px; height: 24px; flex: none; padding: 0; border: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; color: var(--app-text-muted); cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--semi-color-primary); outline-offset: 2px; }

  .agent-activity-state {
    flex: none;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-activity-body {
    display: grid;
    gap: 6px;
    margin: 4px 0 4px 27px;
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

  .agent-activity-details dd[data-output-preview] {
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .agent-activity-details dd[data-output-stream='stderr'] {
    color: var(--semi-color-danger);
  }

  .agent-activity-artifact {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 0;
    border-radius: 0;
    background: transparent;
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

  @media (prefers-reduced-motion: reduce) {
    .agent-activity-status-icon svg {
      animation: none !important;
    }
  }

  @keyframes agent-activity-spin {
    to { transform: rotate(360deg); }
  }
`;

const ShellActivity = styled.section`
  width: min(620px, 100%);
  min-width: 0;
  align-self: flex-start;

  .agent-shell-summary {
    width: 100%;
    min-width: 0;
    min-height: 28px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 2px 3px;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--app-text);
    font: inherit;
    text-align: left;
  }

  button.agent-shell-summary {
    cursor: pointer;
  }

  button.agent-shell-summary:hover .agent-shell-summary-command {
    color: var(--app-text);
  }

  button.agent-shell-summary:focus-visible {
    outline: 2px solid var(--semi-color-focus-border);
    outline-offset: 1px;
  }

  &[data-status='failed'] .agent-shell-summary-label {
    color: var(--semi-color-danger);
  }

  &[data-status='cancelled'] .agent-shell-summary-label,
  &[data-status='interrupted'] .agent-shell-summary-label {
    color: var(--semi-color-warning);
  }

  .agent-shell-summary-label {
    flex: none;
    color: var(--app-text-secondary);
    font-size: 13px;
    line-height: 1.4;
  }

  .agent-shell-summary-command {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--app-text);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
    text-overflow: ellipsis;
    white-space: pre;
    direction: ltr;
    unicode-bidi: isolate;
  }

  .agent-shell-terminal {
    ${workspaceScrollbarStyles}

    max-height: 156px;
    margin-top: 4px;
    padding: 8px 10px;
    overflow: auto;
    border: 1px solid var(--app-border);
    border-radius: var(--app-radius-small);
    background: color-mix(in srgb, var(--app-text) 5%, var(--app-bg));
    color: var(--app-text);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
  }

  .agent-shell-terminal-command,
  .agent-shell-terminal-output {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .agent-shell-terminal-command {
    direction: ltr;
    unicode-bidi: isolate;
  }

  .agent-shell-terminal-prompt {
    color: var(--semi-color-primary);
    user-select: none;
  }

  .agent-shell-terminal-output {
    margin-top: 7px;
    padding-top: 7px;
    border-top: 1px solid var(--app-border);
  }

  .agent-shell-terminal-output [data-stream='stderr'] {
    color: var(--semi-color-danger);
  }

  .agent-shell-log-empty,
  .agent-shell-log-notice {
    margin: 7px 0 0;
    padding-top: 7px;
    border-top: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
  }

  .agent-shell-log-more {
    min-height: 24px;
    margin-top: 7px;
    padding: 0 7px;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--app-text-secondary);
    font: inherit;
    cursor: pointer;
  }

  .agent-shell-log-more:hover,
  .agent-shell-log-more:focus-visible {
    outline: 0;
    background: var(--app-hover-bg);
    color: var(--app-text);
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
  interactive: boolean,
  interactionBusy: boolean,
  onAction?: (action: AgentPresentationAction) => void,
) {
  if (block.type === 'choice' || block.type === 'form') {
    if (!interactive) {
      return (
        <p className="agent-activity-message" key={`${block.type}:${block.interactionId}`}>
          请在当前任务栏中完成输入
        </p>
      );
    }
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
            <dd
              data-output-preview={
                entry.label === '标准输出' || entry.label === '错误输出' ? true : undefined
              }
              data-output-stream={entry.label === '错误输出' ? 'stderr' : undefined}
            >
              {entry.value}
            </dd>
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
  interactive?: boolean;
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

interface AgentShellActivityProps {
  activity: AgentToolActivitySnapshot;
  libraryId: number;
  ownerScope: AgentOwnerScope | null;
}

const SHELL_ACTIVITY_LABELS: Record<AgentToolActivitySnapshot['status'], string> = {
  preparing: '准备执行',
  awaiting_approval: '等待执行',
  awaiting_interaction: '等待执行',
  cancelled: '已取消',
  completed: '执行了',
  failed: '执行失败',
  interrupted: '执行中断',
  running: '正在执行',
};

function shellCommand(activity: AgentToolActivitySnapshot): string {
  try {
    const action = normalizeAgentPreparedActionPublic(activity.preparation?.action);
    return action.kind === 'shell.run' ? action.command : '';
  } catch {
    return '';
  }
}

function AgentShellActivity({ activity, libraryId, ownerScope }: AgentShellActivityProps) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [frames, setFrames] = React.useState<readonly AgentShellOutputFrameV1[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | undefined>();
  const [expired, setExpired] = React.useState(false);
  const [unavailableThrough, setUnavailableThrough] = React.useState<number | null>(null);
  const [error, setError] = React.useState('');
  const requestGenerationRef = React.useRef(0);
  const loadingRef = React.useRef(false);
  const command = shellCommand(activity);
  const displayCommand = formatAgentShellCommandForDisplay(command);
  const commandSummary = displayCommand || 'Shell 命令';
  const canExpand = Boolean(activity.result && ownerScope);

  React.useLayoutEffect(() => {
    requestGenerationRef.current += 1;
    loadingRef.current = false;
    setOpen(false);
    setLoaded(false);
    setLoading(false);
    setFrames([]);
    setNextCursor(undefined);
    setExpired(false);
    setUnavailableThrough(null);
    setError('');
    return () => {
      requestGenerationRef.current += 1;
      loadingRef.current = false;
    };
  }, [
    activity.id,
    libraryId,
    ownerScope?.accountScope,
    ownerScope?.backendScope,
  ]);

  const loadPage = async (cursor?: string) => {
    if (loadingRef.current || !ownerScope) return;
    const generation = requestGenerationRef.current;
    const requestOwnerScope = { ...ownerScope };
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await readAgentShellLogPage({
        ...(cursor ? { cursor } : {}),
        libraryId,
        maxBytes: 128 * 1024,
        maxFrames: 128,
        ownerScope: requestOwnerScope,
        runId: activity.runId,
        sessionId: activity.sessionId,
        toolRunId: activity.id,
        version: 1,
      });
      if (generation !== requestGenerationRef.current) return;
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
    } catch {
      if (generation !== requestGenerationRef.current) return;
      setError('详细输出读取失败');
    } finally {
      if (generation === requestGenerationRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  };

  const toggle = () => {
    if (!canExpand) return;
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !loaded && !loading) void loadPage();
  };

  const summaryContent = (
    <>
      <span className="agent-shell-summary-label">{SHELL_ACTIVITY_LABELS[activity.status]}</span>
      <code className="agent-shell-summary-command" title={commandSummary}>
        {commandSummary}
      </code>
    </>
  );

  return (
    <ShellActivity data-status={activity.status}>
      {canExpand ? (
        <button
          aria-expanded={open}
          aria-label={`${SHELL_ACTIVITY_LABELS[activity.status]} ${commandSummary}`}
          className="agent-shell-summary"
          onClick={toggle}
          type="button"
        >
          {summaryContent}
        </button>
      ) : (
        <div className="agent-shell-summary">{summaryContent}</div>
      )}
      {open ? (
        <div aria-label="Shell 输出" className="agent-shell-terminal" role="region">
          <pre className="agent-shell-terminal-command">
            <span aria-hidden="true" className="agent-shell-terminal-prompt">$ </span>
            {displayCommand || '命令内容不可用'}
          </pre>
          {expired ? (
            <p className="agent-shell-log-notice">详细输出已清理</p>
          ) : unavailableThrough !== null ? (
            <p className="agent-shell-log-notice">部分早期输出不可用</p>
          ) : null}
          {frames.length > 0 ? (
            <pre className="agent-shell-terminal-output">
              {frames.map(frame => (
                <span data-stream={frame.stream} key={frame.sequence}>{frame.text}</span>
              ))}
            </pre>
          ) : loaded && !loading && !error && !expired ? (
            <p className="agent-shell-log-empty">命令没有产生输出</p>
          ) : null}
          {error ? <p className="agent-shell-log-notice" role="alert">{error}</p> : null}
          {loading ? <p className="agent-shell-log-notice" role="status">正在读取输出...</p> : null}
          {!loading && nextCursor ? (
            <button
              className="agent-shell-log-more"
              onClick={() => { void loadPage(nextCursor); }}
              type="button"
            >
              继续读取
            </button>
          ) : null}
        </div>
      ) : null}
    </ShellActivity>
  );
}

export default function AgentToolActivityCard({
  activity,
  approvalBusy,
  interactive = true,
  interactionBusy,
  libraryId,
  onAction,
  onResolveApproval,
  ownerScope,
}: AgentToolActivityCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  if (
    interactive
    && activity.status === 'awaiting_approval'
    && activity.approval?.status === 'pending'
  ) {
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

  if (activity.call.name === 'shell.run') {
    return (
      <AgentShellActivity
        activity={activity}
        libraryId={libraryId}
        ownerScope={ownerScope}
      />
    );
  }

  const blocks = buildAgentToolPresentation(activity, libraryId);
  const summary = buildAgentToolSummary(activity, libraryId);
  const forcedBody = activity.status === 'failed' || activity.status === 'interrupted'
    || activity.status === 'cancelled' || Boolean(activity.interaction)
    || (activity.status === 'running' && Boolean(activity.progress));
  const showBody = expanded || forcedBody;
  return (
    <ActivityCard data-status={activity.status}>
      <div className="agent-activity-header">
        <span className="agent-activity-status-icon">
          {activity.status === 'completed' && activity.toolMetadata?.risk === 'read'
            ? <IconFile aria-hidden="true" /> : <ActivityStatusIcon status={activity.status} />}
        </span>
        <div className="agent-activity-title">
          <span>{summary.label}</span>
          {summary.subject ? summary.action && onAction ? (
            <button className="agent-activity-subject" type="button" title={summary.subject}
              onClick={() => onAction(summary.action!)}>{summary.subject}</button>
          ) : <span className="agent-activity-subject" title={summary.subject}>{summary.subject}</span> : null}
        </div>
        {activity.status !== 'completed' ? <span className="agent-activity-state">{STATUS_LABELS[activity.status]}</span> : null}
        {blocks.length > 0 && !forcedBody ? <button type="button" className="agent-activity-expand"
          aria-label={expanded ? '收起工具详情' : '展开工具详情'} title={expanded ? '收起工具详情' : '展开工具详情'}
          aria-expanded={showBody} onClick={() => setExpanded(value => !value)}>
          {showBody ? <IconChevronDown aria-hidden="true" /> : <IconChevronRight aria-hidden="true" />}
        </button> : null}
      </div>
      {blocks.length > 0 && showBody ? (
        <div className="agent-activity-body">
          {blocks.map((block, index) => renderBlock(
            block,
            index,
            interactive,
            interactionBusy,
            onAction,
          ))}
        </div>
      ) : null}
    </ActivityCard>
  );
}
