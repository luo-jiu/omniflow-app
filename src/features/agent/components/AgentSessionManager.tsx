import React from 'react';
import {
  IconChevronLeft,
  IconDelete,
  IconEdit,
  IconPlus,
  IconSearch,
} from '@douyinfe/semi-icons';
import { Spin } from '@douyinfe/semi-ui';
import styled from 'styled-components';

import type { AgentRunStatus, AgentSessionSummary } from '@/shared/agent/agent.types';

const Manager = styled.section`
  width: min(900px, 100%);
  min-height: 100%;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  padding: 10px 0 28px;

  .agent-session-header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    margin-bottom: 14px;
  }

  .agent-session-heading {
    min-width: 0;
    flex: 1;
  }

  .agent-session-title {
    margin: 0;
    color: var(--app-text);
    font-size: 18px;
    line-height: 1.25;
  }

  .agent-session-count {
    margin-top: 3px;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-session-icon-button {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .agent-session-icon-button:hover,
  .agent-session-icon-button:focus-visible {
    background: var(--semi-color-fill-1);
    color: var(--app-text);
  }

  .agent-session-icon-button:focus-visible {
    outline: 1px solid var(--semi-color-primary);
  }

  .agent-session-search {
    height: 34px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding: 0 11px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    color: var(--app-text-muted);
  }

  .agent-session-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
  }

  .agent-session-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .agent-session-row {
    width: 100%;
    min-width: 0;
    min-height: 64px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px 9px 13px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg-elevated) 68%, transparent);
    color: var(--app-text);
    text-align: left;
  }

  .agent-session-row:hover,
  .agent-session-row.is-active {
    border-color: var(--app-border);
    background: var(--app-bg-elevated);
  }

  .agent-session-open {
    min-width: 0;
    flex: 1;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .agent-session-row-title {
    overflow: hidden;
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-session-preview {
    overflow: hidden;
    color: var(--app-text-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-session-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text-muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .agent-session-status {
    color: var(--semi-color-warning);
  }

  .agent-session-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .agent-session-row:hover .agent-session-actions,
  .agent-session-row:focus-within .agent-session-actions {
    opacity: 1;
  }

  .agent-session-rename {
    min-width: 0;
    flex: 1;
    height: 34px;
    padding: 0 9px;
    border: 1px solid var(--semi-color-primary);
    border-radius: 7px;
    outline: 0;
    background: var(--app-bg);
    color: var(--app-text);
    font: inherit;
    font-size: 14px;
  }

  .agent-session-empty,
  .agent-session-loading {
    flex: 1;
    min-height: 220px;
    display: grid;
    place-items: center;
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .agent-session-load-more {
    align-self: center;
    min-width: 108px;
    min-height: 32px;
    margin-top: 8px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--semi-color-primary);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }

  .agent-session-load-more:hover,
  .agent-session-load-more:focus-visible {
    background: var(--semi-color-fill-1);
  }

  .agent-session-load-more:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const RUN_STATUS_LABELS: Partial<Record<AgentRunStatus, string>> = {
  awaiting_approval: '等待确认',
  awaiting_interaction: '等待输入',
  failed: '上一轮失败',
  interrupted: '上一轮已中断',
  running: '正在运行',
};

function formatSessionTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '';
  const now = new Date();
  const sameDay = timestamp.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat('zh-CN', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(timestamp);
}

interface AgentSessionManagerProps {
  activeSessionId: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  onBack: () => void;
  onDelete: (session: AgentSessionSummary) => void;
  onLoadMore: () => void;
  onNew: () => void;
  onOpen: (session: AgentSessionSummary) => void;
  onQueryChange: (query: string) => void;
  onRename: (session: AgentSessionSummary, title: string) => Promise<boolean>;
  query: string;
  sessions: AgentSessionSummary[];
  total: number;
}

export default function AgentSessionManager({
  activeSessionId,
  hasMore,
  loading,
  loadingMore,
  onBack,
  onDelete,
  onLoadMore,
  onNew,
  onOpen,
  onQueryChange,
  onRename,
  query,
  sessions,
  total,
}: AgentSessionManagerProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingTitle, setEditingTitle] = React.useState('');

  const beginRename = (session: AgentSessionSummary) => {
    setEditingId(session.id);
    setEditingTitle(session.title);
  };

  const finishRename = async (session: AgentSessionSummary) => {
    const title = editingTitle.trim();
    if (!title || title === session.title) {
      setEditingId(null);
      return;
    }
    if (await onRename(session, title)) setEditingId(null);
  };

  return (
    <Manager>
      <header className="agent-session-header">
        <button
          aria-label="返回当前会话"
          className="agent-session-icon-button"
          onClick={onBack}
          title="返回当前会话"
          type="button"
        >
          <IconChevronLeft aria-hidden="true" />
        </button>
        <div className="agent-session-heading">
          <h2 className="agent-session-title">会话记录</h2>
          <div className="agent-session-count">
            {query ? `${total} 个匹配会话` : `${total} 个本机会话`}
          </div>
        </div>
        <button
          aria-label="新建 Agent 会话"
          className="agent-session-icon-button"
          onClick={onNew}
          title="新建会话"
          type="button"
        >
          <IconPlus aria-hidden="true" />
        </button>
      </header>

      <label className="agent-session-search">
        <IconSearch aria-hidden="true" />
        <input
          aria-label="搜索 Agent 会话"
          onChange={event => onQueryChange(event.target.value)}
          placeholder="搜索会话"
          value={query}
        />
      </label>

      {loading ? (
        <div className="agent-session-loading"><Spin size="middle" /></div>
      ) : sessions.length === 0 ? (
        <div className="agent-session-empty">{query ? '没有匹配的会话' : '还没有历史会话'}</div>
      ) : (
        <div className="agent-session-list">
          {sessions.map((session) => {
            const statusLabel = session.lastRunStatus
              ? RUN_STATUS_LABELS[session.lastRunStatus]
              : null;
            return (
              <article
                className={`agent-session-row ${session.id === activeSessionId ? 'is-active' : ''}`}
                key={session.id}
              >
                {editingId === session.id ? (
                  <input
                    aria-label="会话标题"
                    autoFocus
                    className="agent-session-rename"
                    maxLength={80}
                    onBlur={() => { void finishRename(session); }}
                    onChange={event => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void finishRename(session);
                      }
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                    value={editingTitle}
                  />
                ) : (
                  <button className="agent-session-open" onClick={() => onOpen(session)} type="button">
                    <span className="agent-session-row-title">{session.title}</span>
                    <span className="agent-session-preview">
                      {session.lastMessagePreview || '尚无消息'}
                    </span>
                    <span className="agent-session-meta">
                      <span>{formatSessionTime(session.updatedAt)}</span>
                      <span>{session.messageCount} 条消息</span>
                      {statusLabel ? <span className="agent-session-status">{statusLabel}</span> : null}
                    </span>
                  </button>
                )}
                {editingId !== session.id ? (
                  <div className="agent-session-actions">
                    <button
                      aria-label={`重命名 ${session.title}`}
                      className="agent-session-icon-button"
                      onClick={() => beginRename(session)}
                      title="重命名"
                      type="button"
                    >
                      <IconEdit aria-hidden="true" />
                    </button>
                    <button
                      aria-label={`删除 ${session.title}`}
                      className="agent-session-icon-button"
                      onClick={() => onDelete(session)}
                      title="删除"
                      type="button"
                    >
                      <IconDelete aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
          {hasMore ? (
            <button
              className="agent-session-load-more"
              disabled={loadingMore}
              onClick={onLoadMore}
              type="button"
            >
              {loadingMore ? <Spin size="small" /> : '加载更多'}
            </button>
          ) : null}
        </div>
      )}
    </Manager>
  );
}
