import React from 'react';
import { IconBookmark, IconHistory, IconPlus, IconSend, IconStop } from '@douyinfe/semi-icons';
import { Toast } from '@douyinfe/semi-ui';
import styled, { css } from 'styled-components';

import AIModelSettingsControl from '@/features/ai-services/components/AIModelSettingsControl';
import { openCompactConfirm } from '@/components/ui/compact-confirm';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import type { SelectedTreeNode } from '@/features/file-explorer';
import { locateNodeInDirectoryTree } from '@/features/file-explorer/services/tree-locate';
import {
  fetchActiveAIServiceModels,
  fetchAIServiceProfiles,
} from '@/features/ai-services/ai-service.api';
import type { AIServiceSnapshot } from '@/features/ai-services/ai-service.types';
import type {
  AgentAppContext,
  AgentOwnerScope,
  AgentPresentationAction,
  AgentSessionCursor,
  AgentSessionSummary,
} from '@/shared/agent/agent.types';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import AgentMemoryManager, {
  type AgentMemoryDeleteInput,
  type AgentMemoryUpdateInput,
} from './components/AgentMemoryManager';
import AgentSessionManager from './components/AgentSessionManager';
import AgentTimeline from './components/AgentTimeline';
import {
  loadAgentModelPreferences,
  saveAgentModelPreferences,
  type AgentModelPreferences,
} from './agent-model-preferences';
import {
  clampAgentComposerHeight,
  INITIAL_AGENT_COMPOSER_HEIGHT,
  MAX_AGENT_COMPOSER_HEIGHT,
  MIN_AGENT_COMPOSER_HEIGHT,
  resolveAgentComposerDragHeight,
} from './agent-composer-layout';
import { useAgentMemories } from './hooks/useAgentMemories';
import { useAgentSession } from './hooks/useAgentSession';
import {
  deleteAgentSession,
  listAgentSessions,
  renameAgentSession,
} from './services/agent.api';

const AgentRoot = styled.section`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  color: var(--app-text);
`;

const AgentScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  ${workspaceScrollbarStyles}
  padding: 24px 16px 12px;
  display: flex;
  flex-direction: column;
`;

const agentColumnStyles = css`
  width: clamp(560px, 72%, 900px);
  max-width: 100%;
  min-width: min(560px, 100%);
  margin-inline: auto;
`;

const AgentContent = styled.div`
  ${agentColumnStyles}
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const AgentEmpty = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  pointer-events: none;

  .agent-empty-title {
    margin: 0 0 8px;
    font-size: 26px;
    line-height: 1.2;
    font-weight: 700;
    text-align: center;
  }

  .agent-empty-subtitle {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 13px;
    text-align: center;
  }
`;

const ComposerFrame = styled.div`
  flex: none;
  min-width: 0;
  padding: 0 16px 18px;
`;

const Composer = styled.form`
  ${agentColumnStyles}
  position: relative;
  border: 1px solid var(--app-border-strong);
  border-radius: 12px;
  background: var(--app-bg-elevated);
  box-shadow: var(--app-shadow);
  overflow: hidden;

  textarea {
    display: block;
    width: 100%;
    min-height: ${MIN_AGENT_COMPOSER_HEIGHT}px;
    max-height: ${MAX_AGENT_COMPOSER_HEIGHT}px;
    overflow-y: auto;
    resize: none;
    border: 0;
    outline: 0;
    padding: 18px 16px 8px;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    font-size: 14px;
    line-height: 1.55;
    ${workspaceScrollbarStyles}
  }

  textarea::placeholder {
    color: var(--app-text-muted);
  }

  .agent-composer-footer {
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px 8px 14px;
  }

  .agent-context-label {
    min-width: 0;
    flex: 1;
    color: var(--app-text-muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-submit,
  .agent-reset {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
  }

  .agent-submit {
    background: var(--semi-color-primary);
    color: #fff;
  }

  .agent-submit.stop {
    background: #e58b32;
  }

  .agent-submit:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .agent-reset {
    color: var(--app-text-muted);
    background: transparent;
  }

  .agent-reset:hover,
  .agent-submit:not(:disabled):hover {
    filter: brightness(1.08);
  }
`;

const ComposerResizeHandle = styled.button`
  position: absolute;
  top: 1px;
  left: 50%;
  z-index: 1;
  width: 46px;
  height: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  transform: translateX(-50%);
  cursor: ns-resize;
  touch-action: none;

  &::after {
    content: '';
    position: absolute;
    top: 4px;
    left: 50%;
    width: 28px;
    height: 3px;
    border-radius: var(--app-radius-large);
    background: color-mix(in srgb, var(--app-text-muted) 48%, transparent);
    transform: translateX(-50%);
    transition: background-color 120ms ease;
  }

  &:hover::after,
  &:focus-visible::after {
    background: color-mix(in srgb, var(--app-text) 68%, transparent);
  }

  &:focus-visible {
    outline: 0;
  }
`;

type AgentWorkspaceProps = {
  libraryId: number;
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
  ownerScope: AgentOwnerScope | null;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
};

function buildAppContext(
  libraryId: number,
  rootNodeId: number | null,
  selectedTreeNode: SelectedTreeNode | null,
): AgentAppContext {
  const currentDirectoryId = selectedTreeNode?.type === 'dir'
    ? selectedTreeNode.id
    : selectedTreeNode?.parentId || rootNodeId;
  return {
    activeToolId: 'agent',
    currentDirectory: currentDirectoryId && currentDirectoryId > 0
      ? {
          id: currentDirectoryId,
          name: selectedTreeNode?.type === 'dir'
            ? selectedTreeNode.name
            : selectedTreeNode
              ? '当前目录'
              : '资料库根目录',
        }
      : undefined,
    libraryId,
    platform: window.electronWindow?.platform || 'unknown',
    selectedNodeIds: selectedTreeNode ? [selectedTreeNode.id] : [],
  };
}

export default function AgentWorkspace({
  libraryId,
  onRefreshDirectory,
  ownerScope,
  rootNodeId,
  selectedTreeNode,
}: AgentWorkspaceProps) {
  const [aiServices, setAIServices] = React.useState<AIServiceSnapshot | null>(null);
  const [models, setModels] = React.useState<string[]>([]);
  const [modelPreferences, setModelPreferences] = React.useState<AgentModelPreferences>(
    loadAgentModelPreferences,
  );
  const [loadingConfig, setLoadingConfig] = React.useState(true);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [composerHeight, setComposerHeight] = React.useState(INITIAL_AGENT_COMPOSER_HEIGHT);
  const [sessions, setSessions] = React.useState<AgentSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(true);
  const [sessionsLoadingMore, setSessionsLoadingMore] = React.useState(false);
  const [sessionsNextCursor, setSessionsNextCursor] = React.useState<AgentSessionCursor | null>(null);
  const [sessionsTotal, setSessionsTotal] = React.useState(0);
  const [managerMode, setManagerMode] = React.useState<'memories' | 'sessions' | null>(null);
  const [sessionQuery, setSessionQuery] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = React.useRef<number | null>(null);
  const shouldFollowScrollRef = React.useRef(true);
  const restoredScopeKeyRef = React.useRef('');
  const sessionsRequestIdRef = React.useRef(0);
  const ownerScopeKey = serializeAgentOwnerScope(ownerScope);
  const sessionScopeKey = `${ownerScopeKey}\u0000${libraryId}`;
  const currentSessionScopeKeyRef = React.useRef(sessionScopeKey);
  currentSessionScopeKeyRef.current = sessionScopeKey;
  const resizeStateRef = React.useRef<{
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);
  const appContext = React.useMemo(
    () => buildAppContext(libraryId, rootNodeId, selectedTreeNode),
    [libraryId, rootNodeId, selectedTreeNode],
  );
  const activeProfile = aiServices?.profiles.find(profile => profile.id === aiServices.activeProfileId) || null;
  const {
    error: memoryLoadError,
    hasMore: memoriesHasMore,
    loadMore: loadMoreMemories,
    loadMoreError: memoryLoadMoreError,
    loading: memoriesLoading,
    loadingMore: memoriesLoadingMore,
    memories,
    query: memoryQuery,
    remove: removeMemory,
    retry: retryMemories,
    setQuery: setMemoryQuery,
    total: memoriesTotal,
    update: updateMemory,
  } = useAgentMemories({
    active: managerMode === 'memories',
    libraryId,
    ownerScope,
  });
  const loadSessions = React.useCallback(async (
    query = '',
    cursor?: AgentSessionCursor,
  ): Promise<AgentSessionSummary[]> => {
    if (!ownerScope || !ownerScopeKey) {
      setSessions([]);
      setSessionsNextCursor(null);
      setSessionsTotal(0);
      setSessionsLoading(false);
      setSessionsLoadingMore(false);
      return [];
    }
    const requestedLibraryId = libraryId;
    const requestedScopeKey = sessionScopeKey;
    const requestId = sessionsRequestIdRef.current + 1;
    sessionsRequestIdRef.current = requestId;
    if (cursor) setSessionsLoadingMore(true);
    else setSessionsLoading(true);
    try {
      const page = await listAgentSessions(ownerScope, requestedLibraryId, query, cursor);
      if (
        sessionsRequestIdRef.current !== requestId
        || currentSessionScopeKeyRef.current !== requestedScopeKey
      ) return [];
      setSessions((current) => {
        if (!cursor) return page.sessions;
        const existingIds = new Set(current.map(session => session.id));
        return [...current, ...page.sessions.filter(session => !existingIds.has(session.id))];
      });
      setSessionsNextCursor(page.nextCursor || null);
      setSessionsTotal(page.total);
      return page.sessions;
    } catch (error) {
      if (
        sessionsRequestIdRef.current === requestId
        && currentSessionScopeKeyRef.current === requestedScopeKey
      ) {
        Toast.error(error instanceof Error ? error.message : 'Agent 会话列表加载失败');
      }
      return [];
    } finally {
      if (sessionsRequestIdRef.current === requestId) {
        setSessionsLoading(false);
        setSessionsLoadingMore(false);
      }
    }
  }, [libraryId, ownerScope, ownerScopeKey, sessionScopeKey]);
  const handleSessionChanged = React.useCallback(() => {
    void loadSessions();
  }, [loadSessions]);
  const session = useAgentSession({
    appContext,
    model: modelPreferences.model,
    onRefreshDirectory,
    onSessionChanged: handleSessionChanged,
    ownerScope,
    profileId: aiServices?.activeProfileId || '',
    reasoningEffort: modelPreferences.reasoningEffort,
  });
  const restoreSession = session.restore;
  const resetSession = session.reset;
  const sessionBusy = session.isBusy;
  const currentSessionId = session.sessionId;

  const loadConfig = React.useCallback(async () => {
    setLoadingConfig(true);
    setConfigError(null);
    try {
      const snapshot = await fetchAIServiceProfiles();
      setAIServices(snapshot);
      setModels([]);
    } catch (error) {
      setAIServices(null);
      setConfigError(error instanceof Error ? error.message : '读取 AI 服务配置失败');
      setModels([]);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  React.useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  React.useEffect(() => {
    if (restoredScopeKeyRef.current === sessionScopeKey) return;
    restoredScopeKeyRef.current = sessionScopeKey;
    setSessions([]);
    setSessionsNextCursor(null);
    setSessionsTotal(0);
    setManagerMode(null);
    setSessionQuery('');
    let active = true;
    void loadSessions().then((nextSessions) => {
      if (!active || nextSessions.length === 0) return;
      void restoreSession(nextSessions[0].id);
    });
    return () => {
      active = false;
    };
  }, [loadSessions, restoreSession, sessionScopeKey]);

  React.useEffect(() => {
    if (managerMode !== 'sessions') return;
    const timer = window.setTimeout(() => {
      void loadSessions(sessionQuery);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [loadSessions, managerMode, sessionQuery]);

  React.useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    if (managerMode) {
      element.scrollTop = 0;
      shouldFollowScrollRef.current = true;
      return;
    }
    if (!shouldFollowScrollRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (shouldFollowScrollRef.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [managerMode, session.messages, session.runs, session.toolActivities, session.isStreaming]);

  const persistModelPreferences = React.useCallback((nextPreferences: AgentModelPreferences) => {
    setModelPreferences(nextPreferences);
    saveAgentModelPreferences(nextPreferences);
  }, []);

  const handleLoadModels = React.useCallback(async (): Promise<boolean> => {
    if (!activeProfile) {
      Toast.warning('请先在 AI 服务配置中启用一个服务');
      return false;
    }
    setLoadingModels(true);
    try {
      const nextModels = await fetchActiveAIServiceModels();
      setModels(nextModels);
      if (!modelPreferences.model && nextModels.length > 0) {
        persistModelPreferences({ ...modelPreferences, model: nextModels[0] });
      }
      return true;
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '获取模型列表失败');
      return false;
    } finally {
      setLoadingModels(false);
    }
  }, [activeProfile, modelPreferences, persistModelPreferences]);

  const handleComposerResizePointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startHeight: composerHeight,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [composerHeight]);

  const handleComposerResizePointerMove = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    setComposerHeight(resolveAgentComposerDragHeight(
      resizeState.startHeight,
      resizeState.startY,
      event.clientY,
    ));
  }, []);

  const handleComposerResizePointerUp = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const contextLabel = selectedTreeNode
    ? `当前上下文：${selectedTreeNode.name}`
    : rootNodeId
      ? '当前上下文：资料库根目录'
      : '当前上下文：未选择文件';
  const canSubmit = Boolean(
    ownerScope && session.draft.trim() && modelPreferences.model && activeProfile && !loadingConfig,
  );
  const workspaceError = ownerScope
    ? configError
    : '当前账号身份不完整，Agent 会话暂不可用';
  const hasTimelineContent = session.messages.length > 0
    || session.runs.length > 0
    || session.toolActivities.length > 0;
  const submitInteraction = session.submitInteraction;
  const toolActivities = session.toolActivities;

  const handlePresentationAction = React.useCallback((action: AgentPresentationAction) => {
    if (action.action === 'tree.revealNode') {
      if (
        action.libraryId !== libraryId
        || !Number.isInteger(action.nodeId)
        || action.nodeId <= 0
      ) {
        Toast.warning('该 Agent 结果不属于当前资料库');
        return;
      }
      locateNodeInDirectoryTree({ libraryId: action.libraryId, nodeId: action.nodeId });
      return;
    }
    if (action.action === 'agent.interaction.submit') {
      const activity = toolActivities.find(item => (
        item.interaction?.interactionId === action.interactionId
      ));
      if (!activity) {
        Toast.warning('该 Agent 交互请求已经失效');
        return;
      }
      void submitInteraction(activity, action.response);
      return;
    }
    Toast.info('该 Agent 结果操作尚未接入当前工作区');
  }, [libraryId, submitInteraction, toolActivities]);

  const handleOpenSession = React.useCallback(async (target: AgentSessionSummary) => {
    if (await restoreSession(target.id)) {
      shouldFollowScrollRef.current = true;
      setManagerMode(null);
    }
  }, [restoreSession]);

  const handleNewSession = React.useCallback(() => {
    if (sessionBusy) {
      Toast.warning('请先停止当前 Agent 任务');
      return;
    }
    resetSession();
    setSessionQuery('');
    setManagerMode(null);
  }, [resetSession, sessionBusy]);

  const handleRenameSession = React.useCallback(async (
    target: AgentSessionSummary,
    title: string,
  ): Promise<boolean> => {
    if (!ownerScope) return false;
    try {
      await renameAgentSession(ownerScope, libraryId, target.id, title);
      await loadSessions(sessionQuery);
      return true;
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : 'Agent 会话重命名失败');
      return false;
    }
  }, [libraryId, loadSessions, ownerScope, sessionQuery]);

  const handleDeleteSession = React.useCallback((target: AgentSessionSummary) => {
    openCompactConfirm({
      cancelText: '取消',
      content: `确定删除“${target.title}”吗？该会话和工具运行记录将从本机移除。`,
      okButtonProps: { type: 'danger' },
      okText: '删除',
      onOk: async () => {
        if (!ownerScope) return;
        try {
          await deleteAgentSession(ownerScope, libraryId, target.id);
          if (currentSessionId === target.id) resetSession();
          await loadSessions(sessionQuery);
        } catch (error) {
          Toast.error(error instanceof Error ? error.message : 'Agent 会话删除失败');
          throw error;
        }
      },
      title: '删除 Agent 会话',
    });
  }, [currentSessionId, libraryId, loadSessions, ownerScope, resetSession, sessionQuery]);

  const handleUpdateMemory = React.useCallback(async (
    input: AgentMemoryUpdateInput,
  ): Promise<boolean> => {
    const outcome = await updateMemory(input);
    if (!outcome.ok && outcome.error) {
      Toast.error(outcome.error);
    }
    return outcome.ok;
  }, [updateMemory]);

  const handleDeleteMemory = React.useCallback((
    input: AgentMemoryDeleteInput,
  ): void => {
    openCompactConfirm({
      cancelText: '取消',
      content: `确定删除“${input.title}”吗？删除后不会再用于后续 Agent 会话。`,
      okButtonProps: { type: 'danger' },
      okText: '删除',
      onOk: async () => {
        const outcome = await removeMemory({
          id: input.id,
          revision: input.revision,
        });
        if (!outcome.ok) {
          const message = outcome.error || '长期记忆删除失败';
          if (outcome.error) Toast.error(outcome.error);
          throw new Error(message);
        }
      },
      title: '删除长期记忆',
    });
  }, [removeMemory]);

  return (
    <AgentRoot>
      <AgentScroll
        onScroll={(event) => {
          if (managerMode) return;
          const element = event.currentTarget;
          shouldFollowScrollRef.current = (
            element.scrollHeight - element.scrollTop - element.clientHeight <= 48
          );
        }}
        ref={scrollRef}
      >
        {managerMode === 'sessions' ? (
          <AgentSessionManager
            activeSessionId={session.sessionId}
            hasMore={Boolean(sessionsNextCursor)}
            loading={sessionsLoading}
            loadingMore={sessionsLoadingMore}
            onBack={() => {
              shouldFollowScrollRef.current = true;
              setManagerMode(null);
            }}
            onDelete={handleDeleteSession}
            onNew={handleNewSession}
            onLoadMore={() => {
              if (sessionsNextCursor) void loadSessions(sessionQuery, sessionsNextCursor);
            }}
            onOpen={target => { void handleOpenSession(target); }}
            onQueryChange={setSessionQuery}
            onRename={handleRenameSession}
            query={sessionQuery}
            sessions={sessions}
            total={sessionsTotal}
          />
        ) : managerMode === 'memories' ? (
          <AgentMemoryManager
            error={memoryLoadError}
            hasMore={memoriesHasMore}
            loadMoreError={memoryLoadMoreError}
            loading={memoriesLoading}
            loadingMore={memoriesLoadingMore}
            memories={memories}
            onBack={() => {
              shouldFollowScrollRef.current = true;
              setManagerMode(null);
            }}
            onDelete={handleDeleteMemory}
            onLoadMore={() => { void loadMoreMemories(); }}
            onQueryChange={setMemoryQuery}
            onRetry={() => { void retryMemories(); }}
            onSave={handleUpdateMemory}
            query={memoryQuery}
            total={memoriesTotal}
          />
        ) : !hasTimelineContent ? (
          <AgentEmpty>
            <div>
              <h1 className="agent-empty-title">OmniFlow Agent</h1>
              <p className="agent-empty-subtitle">描述你想完成的工作</p>
            </div>
          </AgentEmpty>
        ) : (
          <AgentContent>
            <AgentTimeline
              approvalBusyIds={session.approvalBusyIds}
              interactionBusyIds={session.interactionBusyIds}
              libraryId={libraryId}
              messages={session.messages}
              onAction={handlePresentationAction}
              onResolveApproval={(approval, approved) => {
                void session.resolveApproval(approval, approved);
              }}
              runs={session.runs}
              toolActivities={session.toolActivities}
            />
            {workspaceError ? <div role="alert">{workspaceError}</div> : null}
            {session.warning ? <div role="status">{session.warning}</div> : null}
            {session.error ? <div role="alert">{session.error}</div> : null}
          </AgentContent>
        )}
        {!managerMode && !hasTimelineContent && workspaceError ? (
          <div role="alert">{workspaceError}</div>
        ) : null}
        {!managerMode && !hasTimelineContent && session.warning ? (
          <div role="status">{session.warning}</div>
        ) : null}
        {!managerMode && !hasTimelineContent && session.error ? (
          <div role="alert">{session.error}</div>
        ) : null}
      </AgentScroll>

      {!managerMode ? <ComposerFrame>
        <Composer onSubmit={(event) => {
          event.preventDefault();
          shouldFollowScrollRef.current = true;
          void session.submit();
        }}>
          <ComposerResizeHandle
            aria-label="调整 Agent 输入框高度"
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                setComposerHeight((current) => clampAgentComposerHeight(
                  current + (event.key === 'ArrowUp' ? 12 : -12),
                ));
              }
            }}
            onPointerCancel={handleComposerResizePointerUp}
            onPointerDown={handleComposerResizePointerDown}
            onPointerMove={handleComposerResizePointerMove}
            onPointerUp={handleComposerResizePointerUp}
            title="向上拖动增高，向下拖动缩小"
            type="button"
          />
          <textarea
            aria-label="Agent 输入"
            disabled={session.isBusy}
            onChange={(event) => session.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                shouldFollowScrollRef.current = true;
                void session.submit();
              }
            }}
            placeholder={loadingConfig ? '正在读取 AI 服务配置…' : '输入你想让 Agent 完成的事情…'}
            style={{ height: `${composerHeight}px` }}
            value={session.draft}
          />
          <div className="agent-composer-footer">
            <span className="agent-context-label" title={contextLabel}>{contextLabel}</span>
            <AIModelSettingsControl
              availableModels={models}
              disabled={session.isBusy || loadingConfig}
              loadingModels={loadingModels}
              model={modelPreferences.model}
              modelSourceKey={activeProfile?.id || ''}
              reasoningEffort={modelPreferences.reasoningEffort}
              onLoadModels={handleLoadModels}
              onModelChange={(model) => persistModelPreferences({
                ...modelPreferences,
                model,
              })}
              onReasoningEffortChange={(reasoningEffort) => persistModelPreferences({
                ...modelPreferences,
                reasoningEffort,
              })}
            />
            <button
              aria-label="管理 Agent 会话"
              className="agent-reset"
              disabled={session.isBusy}
              onClick={() => {
                setSessionQuery('');
                setSessionsLoading(true);
                setManagerMode('sessions');
              }}
              title="会话记录"
              type="button"
            >
              <IconHistory aria-hidden="true" />
            </button>
            <button
              aria-label="管理 Agent 长期记忆"
              className="agent-reset"
              disabled={session.isBusy || !ownerScope}
              onClick={() => {
                setMemoryQuery('');
                setManagerMode('memories');
              }}
              title="长期记忆"
              type="button"
            >
              <IconBookmark aria-hidden="true" />
            </button>
            {hasTimelineContent && !session.isBusy ? (
              <button
                aria-label="新建 Agent 会话"
                className="agent-reset"
                onClick={handleNewSession}
                title="新建会话"
                type="button"
              >
                <IconPlus aria-hidden="true" />
              </button>
            ) : null}
            <button
              aria-label={session.isStreaming ? '停止 Agent' : '发送消息'}
              className={`agent-submit ${session.isStreaming ? 'stop' : ''}`}
              disabled={session.isStreaming ? false : session.isBusy || !canSubmit}
              onClick={session.isStreaming ? () => { void session.stop(); } : undefined}
              title={session.isStreaming ? '停止' : session.isBusy ? '正在读取当前上下文' : '发送'}
              type={session.isStreaming ? 'button' : 'submit'}
            >
              {session.isStreaming ? <IconStop aria-hidden="true" /> : <IconSend aria-hidden="true" />}
            </button>
          </div>
        </Composer>
      </ComposerFrame> : null}
    </AgentRoot>
  );
}
