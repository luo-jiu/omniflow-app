import React from 'react';
import {
  IconChevronLeft,
  IconClose,
  IconDelete,
  IconEdit,
  IconSave,
  IconSearch,
} from '@douyinfe/semi-icons';
import { Spin } from '@douyinfe/semi-ui';
import styled from 'styled-components';

import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { MAX_AGENT_MEMORY_QUERY_CHARACTERS } from '@/shared/agent/agent-memory-query';
import type { AgentMemoryItem } from '@/shared/agent/agent.types';

const Manager = styled.section`
  width: min(900px, 100%);
  min-height: 0;
  margin-inline: auto;
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 10px 0 28px;

  .agent-memory-header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    margin-bottom: 14px;
  }

  .agent-memory-heading {
    min-width: 0;
    flex: 1;
  }

  .agent-memory-title {
    margin: 0;
    color: var(--app-text);
    font-size: 18px;
    line-height: 1.25;
  }

  .agent-memory-count {
    margin-top: 3px;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-memory-icon-button {
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

  .agent-memory-icon-button:hover,
  .agent-memory-icon-button:focus-visible {
    background: var(--semi-color-fill-1);
    color: var(--app-text);
  }

  .agent-memory-icon-button.is-danger:hover,
  .agent-memory-icon-button.is-danger:focus-visible {
    background: color-mix(in srgb, var(--semi-color-danger) 12%, transparent);
    color: var(--semi-color-danger);
  }

  .agent-memory-icon-button:focus-visible,
  .agent-memory-button:focus-visible {
    outline: 1px solid var(--semi-color-primary);
    outline-offset: 1px;
  }

  .agent-memory-icon-button:disabled,
  .agent-memory-button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .agent-memory-search {
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

  .agent-memory-search:focus-within {
    border-color: var(--semi-color-primary);
  }

  .agent-memory-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
  }

  .agent-memory-search input::placeholder {
    color: var(--app-text-muted);
  }

  .agent-memory-list {
    min-height: 0;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    padding-right: 3px;
    ${workspaceScrollbarStyles}
  }

  .agent-memory-row {
    width: 100%;
    min-width: 0;
    padding: 12px 13px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg-elevated) 68%, transparent);
    color: var(--app-text);
  }

  .agent-memory-row:hover,
  .agent-memory-row:focus-within,
  .agent-memory-row.is-editing {
    border-color: var(--app-border);
    background: var(--app-bg-elevated);
  }

  .agent-memory-row-header {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .agent-memory-row-heading {
    min-width: 0;
    flex: 1;
  }

  .agent-memory-row-title {
    overflow: hidden;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-memory-badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    margin-top: 5px;
  }

  .agent-memory-badge {
    min-height: 20px;
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: var(--app-radius-small);
    background: var(--semi-color-fill-0);
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.2;
  }

  .agent-memory-badge.kind-preference {
    background: color-mix(in srgb, var(--semi-color-primary) 12%, transparent);
    color: var(--semi-color-primary);
  }

  .agent-memory-badge.kind-project {
    background: color-mix(in srgb, var(--semi-color-success) 12%, transparent);
    color: var(--semi-color-success);
  }

  .agent-memory-badge.kind-reference {
    background: color-mix(in srgb, var(--semi-color-warning) 13%, transparent);
    color: var(--semi-color-warning);
  }

  .agent-memory-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .agent-memory-row:hover .agent-memory-actions,
  .agent-memory-row:focus-within .agent-memory-actions {
    opacity: 1;
  }

  .agent-memory-content {
    margin: 11px 0 0;
    color: var(--app-text);
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .agent-memory-details {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 10px;
  }

  .agent-memory-detail {
    min-width: 0;
    padding: 8px 9px;
    border-radius: 7px;
    background: var(--semi-color-fill-0);
  }

  .agent-memory-detail-label {
    display: block;
    margin-bottom: 3px;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .agent-memory-detail-value {
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.55;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .agent-memory-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .agent-memory-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .agent-memory-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .agent-memory-field {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .agent-memory-field.is-wide {
    grid-column: 1 / -1;
  }

  .agent-memory-field label {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-memory-field input,
  .agent-memory-field textarea {
    width: 100%;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    outline: 0;
    background: var(--app-bg);
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
    line-height: 1.55;
  }

  .agent-memory-field input {
    height: 34px;
    padding: 0 9px;
  }

  .agent-memory-field textarea {
    min-height: 70px;
    max-height: 180px;
    padding: 8px 9px;
    resize: vertical;
    ${workspaceScrollbarStyles}
  }

  .agent-memory-field input:focus,
  .agent-memory-field textarea:focus {
    border-color: var(--semi-color-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--semi-color-primary) 20%, transparent);
  }

  .agent-memory-form-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
  }

  .agent-memory-button {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 11px;
    border: 0;
    border-radius: var(--app-radius-medium);
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .agent-memory-button:hover,
  .agent-memory-button:focus-visible {
    background: var(--semi-color-fill-1);
    color: var(--app-text);
  }

  .agent-memory-button.is-primary {
    background: var(--semi-color-primary);
    color: #fff;
  }

  .agent-memory-button.is-primary:hover,
  .agent-memory-button.is-primary:focus-visible {
    background: var(--semi-color-primary-hover);
    color: #fff;
  }

  .agent-memory-button.is-danger {
    background: var(--semi-color-danger);
    color: #fff;
  }

  .agent-memory-button.is-danger:hover,
  .agent-memory-button.is-danger:focus-visible {
    background: var(--semi-color-danger-hover);
    color: #fff;
  }

  .agent-memory-error {
    min-width: 0;
    flex: 1;
    color: var(--semi-color-danger);
    font-size: 12px;
    line-height: 1.45;
  }

  .agent-memory-empty,
  .agent-memory-loading,
  .agent-memory-load-error {
    flex: 1;
    min-height: 220px;
    display: grid;
    place-items: center;
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .agent-memory-load-error {
    align-content: center;
    gap: 10px;
    text-align: center;
  }

  .agent-memory-load-error p {
    max-width: 460px;
    margin: 0;
    color: var(--semi-color-danger);
    line-height: 1.55;
  }

  .agent-memory-load-more {
    align-self: center;
    margin: 5px 0 2px;
  }

  .agent-memory-load-more-error {
    align-self: center;
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 5px 0 2px;
    color: var(--semi-color-danger);
    font-size: 12px;
  }

  @media (max-width: 660px) {
    .agent-memory-details,
    .agent-memory-form-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .agent-memory-field.is-wide {
      grid-column: auto;
    }
  }
`;

const MEMORY_KIND_LABELS: Record<AgentMemoryItem['kind'], string> = {
  preference: '偏好',
  project: '项目',
  reference: '参考',
};

interface MemoryDraft {
  application: string;
  content: string;
  reason: string;
  title: string;
}

interface EditingMemory {
  draft: MemoryDraft;
  id: string;
  original: MemoryDraft;
  revision: number;
}

export interface AgentMemoryUpdateInput extends MemoryDraft {
  id: string;
  revision: number;
}

export interface AgentMemoryDeleteInput {
  id: string;
  revision: number;
  title: string;
}

export interface AgentMemoryManagerProps {
  error: string | null;
  hasMore: boolean;
  loadMoreError: string | null;
  loading: boolean;
  loadingMore: boolean;
  memories: AgentMemoryItem[];
  onBack: () => void;
  onDelete: (input: AgentMemoryDeleteInput) => void;
  onLoadMore: () => void;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onSave: (input: AgentMemoryUpdateInput) => Promise<boolean>;
  query: string;
  total: number;
}

function createDraft(memory: AgentMemoryItem): MemoryDraft {
  return {
    application: memory.application ?? '',
    content: memory.content,
    reason: memory.reason ?? '',
    title: memory.title,
  };
}

function draftsEqual(left: MemoryDraft, right: MemoryDraft): boolean {
  return left.application === right.application
    && left.content === right.content
    && left.reason === right.reason
    && left.title === right.title;
}

function formatMemoryTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '';
  const now = new Date();
  const sameDay = timestamp.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat('zh-CN', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(timestamp);
}

function getScopeLabel(memory: AgentMemoryItem): string {
  if (memory.scope === 'global') return '全局';
  return memory.libraryId === undefined ? '当前资料库' : `资料库 ${memory.libraryId}`;
}

export default function AgentMemoryManager({
  error,
  hasMore,
  loadMoreError,
  loading,
  loadingMore,
  memories,
  onBack,
  onDelete,
  onLoadMore,
  onQueryChange,
  onRetry,
  onSave,
  query,
  total,
}: AgentMemoryManagerProps) {
  const formId = React.useId();
  const [editing, setEditing] = React.useState<EditingMemory | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const mutationPending = savingId !== null;

  const beginEdit = (memory: AgentMemoryItem) => {
    const draft = createDraft(memory);
    setMutationError(null);
    setEditing({
      draft,
      id: memory.id,
      original: draft,
      revision: memory.revision,
    });
  };

  const cancelEdit = () => {
    if (savingId) return;
    setEditing(null);
    setMutationError(null);
  };

  const updateDraft = (field: keyof MemoryDraft, value: string) => {
    setEditing(current => current
      ? { ...current, draft: { ...current.draft, [field]: value } }
      : current);
  };

  const saveEditingMemory = async () => {
    if (!editing || savingId) return;
    const draft: MemoryDraft = {
      application: editing.draft.application.trim(),
      content: editing.draft.content.trim(),
      reason: editing.draft.reason.trim(),
      title: editing.draft.title.trim(),
    };
    if (!draft.title || !draft.content || !draft.reason || !draft.application) {
      setMutationError('标题、记忆内容、保存理由和适用场景均不能为空');
      return;
    }
    if (draftsEqual(draft, editing.original)) {
      setEditing(null);
      setMutationError(null);
      return;
    }

    setSavingId(editing.id);
    setMutationError(null);
    try {
      const saved = await onSave({
        ...draft,
        id: editing.id,
        revision: editing.revision,
      });
      if (saved) {
        setEditing(null);
      } else {
        setMutationError('记忆可能已经更新，请取消后重新编辑');
      }
    } catch {
      setMutationError('保存失败，请稍后重试');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Manager>
      <header className="agent-memory-header">
        <button
          aria-label="返回当前会话"
          className="agent-memory-icon-button"
          onClick={onBack}
          title="返回当前会话"
          type="button"
        >
          <IconChevronLeft aria-hidden="true" />
        </button>
        <div className="agent-memory-heading">
          <h2 className="agent-memory-title">长期记忆</h2>
          <div className="agent-memory-count">
            {query ? `${total} 条匹配记忆` : `${total} 条已保存记忆`}
          </div>
        </div>
      </header>

      <label className="agent-memory-search">
        <IconSearch aria-hidden="true" />
        <input
          aria-label="搜索长期记忆"
          disabled={editing !== null}
          maxLength={MAX_AGENT_MEMORY_QUERY_CHARACTERS}
          onChange={event => onQueryChange(event.target.value)}
          placeholder="搜索标题或内容"
          type="search"
          value={query}
        />
      </label>

      {loading ? (
        <div className="agent-memory-loading"><Spin size="middle" /></div>
      ) : error ? (
        <div className="agent-memory-load-error" role="alert">
          <p>{error}</p>
          <button className="agent-memory-button" onClick={onRetry} type="button">
            重试
          </button>
        </div>
      ) : memories.length === 0 ? (
        <div className="agent-memory-empty">{query ? '没有匹配的记忆' : '还没有保存长期记忆'}</div>
      ) : (
        <div aria-label="长期记忆列表" className="agent-memory-list" role="list">
          {memories.map((memory) => {
            const isEditing = editing?.id === memory.id;
            const busy = mutationPending;
            const titleId = `${formId}-${memory.id}-title`;
            const contentId = `${formId}-${memory.id}-content`;
            const reasonId = `${formId}-${memory.id}-reason`;
            const applicationId = `${formId}-${memory.id}-application`;

            return (
              <article
                aria-busy={busy}
                className={`agent-memory-row ${isEditing ? 'is-editing' : ''}`}
                key={memory.id}
                role="listitem"
              >
                {isEditing && editing ? (
                  <form
                    aria-label={`编辑记忆 ${memory.title}`}
                    className="agent-memory-form"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') cancelEdit();
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        event.currentTarget.requestSubmit();
                      }
                    }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEditingMemory();
                    }}
                  >
                    <div className="agent-memory-form-grid">
                      <div className="agent-memory-field is-wide">
                        <label htmlFor={titleId}>标题</label>
                        <input
                          autoFocus
                          disabled={busy}
                          id={titleId}
                          onChange={event => updateDraft('title', event.target.value)}
                          value={editing.draft.title}
                        />
                      </div>
                      <div className="agent-memory-field is-wide">
                        <label htmlFor={contentId}>记忆内容</label>
                        <textarea
                          disabled={busy}
                          id={contentId}
                          onChange={event => updateDraft('content', event.target.value)}
                          rows={4}
                          value={editing.draft.content}
                        />
                      </div>
                      <div className="agent-memory-field">
                        <label htmlFor={reasonId}>保存理由</label>
                        <textarea
                          disabled={busy}
                          id={reasonId}
                          onChange={event => updateDraft('reason', event.target.value)}
                          rows={3}
                          value={editing.draft.reason}
                        />
                      </div>
                      <div className="agent-memory-field">
                        <label htmlFor={applicationId}>适用场景</label>
                        <textarea
                          disabled={busy}
                          id={applicationId}
                          onChange={event => updateDraft('application', event.target.value)}
                          rows={3}
                          value={editing.draft.application}
                        />
                      </div>
                    </div>
                    <div className="agent-memory-form-footer">
                      {mutationError ? (
                        <span className="agent-memory-error" role="alert">{mutationError}</span>
                      ) : null}
                      <button
                        className="agent-memory-button"
                        disabled={busy}
                        onClick={cancelEdit}
                        type="button"
                      >
                        <IconClose aria-hidden="true" />
                        取消
                      </button>
                      <button
                        className="agent-memory-button is-primary"
                        disabled={busy}
                        type="submit"
                      >
                        {savingId === memory.id ? <Spin size="small" /> : <IconSave aria-hidden="true" />}
                        保存
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="agent-memory-row-header">
                      <div className="agent-memory-row-heading">
                        <div className="agent-memory-row-title">{memory.title}</div>
                        <div className="agent-memory-badges">
                          <span className={`agent-memory-badge kind-${memory.kind}`}>
                            {MEMORY_KIND_LABELS[memory.kind]}
                          </span>
                          <span className="agent-memory-badge">{getScopeLabel(memory)}</span>
                        </div>
                      </div>
                      <div className="agent-memory-actions">
                        <button
                          aria-label={`编辑 ${memory.title}`}
                          className="agent-memory-icon-button"
                          disabled={busy || editing !== null}
                          onClick={() => beginEdit(memory)}
                          title="编辑"
                          type="button"
                        >
                          <IconEdit aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`删除 ${memory.title}`}
                          className="agent-memory-icon-button is-danger"
                          disabled={busy || editing !== null}
                          onClick={() => onDelete({
                            id: memory.id,
                            revision: memory.revision,
                            title: memory.title,
                          })}
                          title="删除"
                          type="button"
                        >
                          <IconDelete aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <p className="agent-memory-content">{memory.content}</p>
                    {memory.reason || memory.application ? (
                      <div className="agent-memory-details">
                        {memory.reason ? (
                          <div className="agent-memory-detail">
                            <span className="agent-memory-detail-label">保存理由</span>
                            <div className="agent-memory-detail-value">{memory.reason}</div>
                          </div>
                        ) : null}
                        {memory.application ? (
                          <div className="agent-memory-detail">
                            <span className="agent-memory-detail-label">适用场景</span>
                            <div className="agent-memory-detail-value">{memory.application}</div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="agent-memory-meta">
                      <span>更新于 {formatMemoryTime(memory.updatedAt)}</span>
                      <span>版本 {memory.revision}</span>
                    </div>
                  </>
                )}
              </article>
            );
          })}
          {loadMoreError ? (
            <div className="agent-memory-load-more-error" role="alert">
              <span>{loadMoreError}</span>
              <button
                className="agent-memory-button"
                disabled={loadingMore || editing !== null}
                onClick={onLoadMore}
                type="button"
              >
                重试
              </button>
            </div>
          ) : hasMore ? (
            <button
              className="agent-memory-button agent-memory-load-more"
              disabled={loadingMore || editing !== null}
              onClick={onLoadMore}
              type="button"
            >
              {loadingMore ? <Spin size="small" /> : null}
              加载更多
            </button>
          ) : null}
        </div>
      )}
    </Manager>
  );
}
