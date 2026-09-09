import React from 'react';
import { createPortal } from 'react-dom';
import OutlineIcon from '@/components/ui/outline-icon';
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
import type { AgentShellPermissionMode } from '@/shared/agent/shell/agent-shell.types';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import AgentMemoryManager, {
  type AgentMemoryDeleteInput,
  type AgentMemoryUpdateInput,
} from './components/AgentMemoryManager';
import AgentSessionManager from './components/AgentSessionManager';
import AgentTimeline from './components/AgentTimeline';
import AgentSubmitButton from './components/AgentSubmitButton';
import AgentPermissionControl from './components/AgentPermissionControl';
import { createAgentCompositionGuard, shouldSubmitAgentComposer } from './agent-composer-keyboard';
import AgentConversationIndex from './components/AgentConversationIndex';
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
} from './agent-composer-layout';
import { useAgentMemories } from './hooks/useAgentMemories';
import { useAgentSession } from './hooks/useAgentSession';
import { useAgentSessionResume } from './hooks/useAgentSessionResume';
import { loadAgentSessionSelection, saveAgentSessionSelection } from './agent-session-selection';
import {
  deleteAgentSession,
  getAgentShellSettings,
  listAgentSessions,
  renameAgentSession,
  updateAgentShellPermissionMode,
} from './services/agent.api';

const AgentRoot = styled.section`
  position: relative;
  isolation: isolate;
  container-type: inline-size;
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
  overflow-x: hidden;
  overflow-y: scroll;
  overflow-anchor: none;
  ${workspaceScrollbarStyles}
  padding: 24px 16px 18px;
  padding-bottom: var(--agent-dock-space, 18px);
  scroll-padding-bottom: var(--agent-dock-space, 18px);
  @container (max-width: 720px) { padding-left: 52px; }
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

const RecoveryNotice = styled.div`
  ${agentColumnStyles}
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  color: var(--app-text-muted);
  font-size: 12px;
  button {
    flex: none; height: 28px; padding: 0 10px; border: 1px solid var(--app-border);
    border-radius: var(--app-radius-medium); background: var(--app-bg-elevated);
    color: var(--app-text); cursor: pointer;
  }
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
  position: absolute;
  z-index: 1;
  bottom: 0;
  left: 0;
  right: var(--agent-scrollbar-width, 8px);
  min-width: 0;
  padding: 0 16px 18px;
  @container (max-width: 720px) { padding-left: 52px; }
  pointer-events: none;

  &::before {
    content: '';
    position: absolute;
    inset: calc((100% - 18px) / 2) 0 0;
    background: var(--app-bg);
  }
`;

const Composer = styled.form`
  ${agentColumnStyles}
  position: relative;
  pointer-events: auto;
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

  .agent-submit {
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

  .agent-composer-footer .model-name,
  .agent-composer-footer .reasoning-label {
    font-size: 12px;
    font-weight: 400;
    line-height: 20px;
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

  .agent-submit:not(:disabled):hover {
    filter: brightness(1.08);
  }
`;

type AgentWorkspaceProps = {
  toolbarTarget?: HTMLDivElement | null;
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
  toolbarTarget,
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
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const compositionGuard = React.useRef(createAgentCompositionGuard());
  const composerFrameRef = React.useRef<HTMLDivElement>(null);
  const [composerDockHeight, setComposerDockHeight] = React.useState(0);
  const [scrollbarWidth, setScrollbarWidth] = React.useState(8);
  const [shellPermissionMode, setShellPermissionMode] = React.useState<AgentShellPermissionMode>('ask');
  const [shellSettingsLoading, setShellSettingsLoading] = React.useState(true);
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
  const indexNavigationRef = React.useRef(false);
  const sessionsRequestIdRef = React.useRef(0);
  const ownerScopeKey = serializeAgentOwnerScope(ownerScope);
  const sessionScopeKey = `${ownerScopeKey}\u0000${libraryId}`;
  const currentSessionScopeKeyRef = React.useRef(sessionScopeKey);
  currentSessionScopeKeyRef.current = sessionScopeKey;
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
  const handleSessionChanged = React.useCallback((id: string) => {
    saveAgentSessionSelection(sessionScopeKey, id);
    void loadSessions();
  }, [loadSessions, sessionScopeKey]);
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
  const resume = useAgentSessionResume({
    scope: ownerScopeKey ? sessionScopeKey : null,
    loadLatest: async () => ownerScope ? (await listAgentSessions(ownerScope, libraryId)).sessions[0]?.id || null : null,
    restore: restoreSession,
  });
  const selectSession = resume.select;
  const sessionBusy = session.isBusy || resume.loading;
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
    let active = true;
    setShellSettingsLoading(true);
    void getAgentShellSettings().then((settings) => {
      if (active) setShellPermissionMode(settings.permissionMode);
    }).catch((error) => {
      if (active) {
        Toast.error(error instanceof Error ? error.message : '读取 Agent 权限模式失败');
      }
    }).finally(() => {
      if (active) setShellSettingsLoading(false);
    });
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    setSessions([]);
    setSessionsNextCursor(null);
    setSessionsTotal(0);
    setManagerMode(null);
    setSessionQuery('');
  }, [sessionScopeKey]);

  React.useEffect(() => {
    if (managerMode !== 'sessions') return;
    const timer = window.setTimeout(() => {
      void loadSessions(sessionQuery);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [loadSessions, managerMode, sessionQuery]);

  React.useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const finishNavigation = () => { indexNavigationRef.current = false; };
    scroll.addEventListener('scrollend', finishNavigation);
    return () => scroll.removeEventListener('scrollend', finishNavigation);
  }, []);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const measure = () => {
      textarea.style.height = `${INITIAL_AGENT_COMPOSER_HEIGHT}px`;
      const height = clampAgentComposerHeight(textarea.scrollHeight);
      textarea.style.height = `${height}px`;
      setComposerHeight(height);
    };
    measure();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === textarea.clientWidth) return;
      width = textarea.clientWidth;
      measure();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [session.draft, managerMode]);

  React.useLayoutEffect(() => {
    const frame = composerFrameRef.current;
    if (!frame) return;
    const measure = () => {
      setComposerDockHeight(frame.getBoundingClientRect().height);
      const scroll = scrollRef.current;
      if (scroll) setScrollbarWidth(scroll.offsetWidth - scroll.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [managerMode]);

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
  }, [
    composerHeight,
    composerDockHeight,
    managerMode,
    session.isStreaming,
    session.messages,
    session.runs,
    session.toolActivities,
  ]);

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

  const handleShellPermissionModeChange = React.useCallback(async (
    permissionMode: AgentShellPermissionMode,
  ) => {
    if (permissionMode === shellPermissionMode || shellSettingsLoading) return;
    setShellSettingsLoading(true);
    try {
      const settings = await updateAgentShellPermissionMode(permissionMode);
      setShellPermissionMode(settings.permissionMode);
      if (session.isBusy) Toast.info('权限模式将在下一次 Agent 任务中生效');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '更新 Agent 权限模式失败');
    } finally {
      setShellSettingsLoading(false);
    }
  }, [session.isBusy, shellPermissionMode, shellSettingsLoading]);

  const contextLabel = selectedTreeNode
    ? `当前上下文：${selectedTreeNode.name}`
    : rootNodeId
      ? '当前上下文：资料库根目录'
      : '当前上下文：未选择文件';
  const canSubmit = Boolean(
    ownerScope && session.draft.trim() && modelPreferences.model && activeProfile && !loadingConfig
    && !resume.loading && !resume.failed,
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

  const handleToolExpand = React.useCallback(() => {
    shouldFollowScrollRef.current = false;
  }, []);

  const handleOpenSession = React.useCallback(async (target: AgentSessionSummary) => {
    if (await restoreSession(target.id)) {
      selectSession(target.id);
      shouldFollowScrollRef.current = true;
      setManagerMode(null);
    }
  }, [restoreSession, selectSession]);

  const handleNewSession = React.useCallback(() => {
    if (sessionBusy) {
      Toast.warning('请先停止当前 Agent 任务');
      return;
    }
    resetSession();
    selectSession(null);
    setSessionQuery('');
    setManagerMode(null);
  }, [resetSession, sessionBusy, selectSession]);

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
          if (currentSessionId === target.id) { resetSession(); selectSession(null); }
          else if (loadAgentSessionSelection(sessionScopeKey) === target.id) selectSession(null);
          await loadSessions(sessionQuery);
        } catch (error) {
          Toast.error(error instanceof Error ? error.message : 'Agent 会话删除失败');
          throw error;
        }
      },
      title: '删除 Agent 会话',
    });
  }, [currentSessionId, libraryId, loadSessions, ownerScope, resetSession, sessionQuery, selectSession, sessionScopeKey]);

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
    <AgentRoot style={{
      '--agent-dock-space': managerMode ? '18px' : `${composerDockHeight + 18}px`,
      '--agent-scrollbar-width': `${scrollbarWidth}px`,
    } as React.CSSProperties}>
      {toolbarTarget ? createPortal(<>
            <button
              aria-label="管理 Agent 会话"
              className="toolbar-action-btn"
              disabled={sessionBusy}
              onClick={() => {
                setSessionQuery('');
                setSessionsLoading(true);
                setManagerMode('sessions');
              }}
              title="会话记录"
              type="button"
            >
              <OutlineIcon name="history" />
            </button>
            <button
              aria-label="管理 Agent 长期记忆"
              className="toolbar-action-btn"
              disabled={sessionBusy || !ownerScope}
              onClick={() => {
                setMemoryQuery('');
                setManagerMode('memories');
              }}
              title="长期记忆"
              type="button"
            >
              <OutlineIcon name="bookmark" />
            </button>
              <button
                aria-label="新建 Agent 会话"
                disabled={sessionBusy}
                className="toolbar-action-btn"
                onClick={handleNewSession}
                title="新建会话"
                type="button"
              >
                <OutlineIcon name="plus" />
              </button>
      </>, toolbarTarget) : null}
      <AgentScroll
        onWheel={() => { indexNavigationRef.current = false; }}
        onPointerDown={() => { indexNavigationRef.current = false; }}
        onKeyDown={event => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) indexNavigationRef.current = false;
        }}
        onScroll={(event) => {
          if (managerMode || indexNavigationRef.current) return;
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
              <p className="agent-empty-subtitle">{resume.loading ? '正在恢复上次聊天…' : '描述你想完成的工作'}</p>
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
              onToolExpand={handleToolExpand}
              ownerScope={ownerScope}
              onResolveApproval={(approval, approved, preparedAction) => {
                void session.resolveApproval(approval, approved, preparedAction);
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
        {resume.failed ? <RecoveryNotice role="alert">
          上次聊天恢复失败，请重试或从会话记录中选择聊天。
          <button type="button" onClick={resume.retry}>重试</button>
        </RecoveryNotice> : null}
      </AgentScroll>
      {!managerMode && session.sessionId ? <AgentConversationIndex
        key={`${sessionScopeKey}:${session.sessionId}`}
        storageKey={`agent-index-marks:v1:${encodeURIComponent(sessionScopeKey)}:${session.sessionId}`}
        messages={session.messages} runs={session.runs} scrollRef={scrollRef}
        onNavigate={() => { indexNavigationRef.current = true; shouldFollowScrollRef.current = false; }}
      /> : null}
        {!managerMode ? <ComposerFrame ref={composerFrameRef}>
          <Composer onSubmit={(event) => {
            event.preventDefault();
            if (resume.loading || resume.failed) return;
            shouldFollowScrollRef.current = true;
            void session.submit();
          }}>
          <textarea
            ref={textareaRef}
            aria-label="Agent 输入"
            onCompositionStart={() => compositionGuard.current.start()}
            onCompositionEnd={event => compositionGuard.current.end(event.timeStamp)}
            onKeyUp={event => compositionGuard.current.keyUp(event.key)}
            onBlur={() => compositionGuard.current.reset()}
            onChange={(event) => session.setDraft(event.target.value)}
            onKeyDown={(event) => {
              const composing = compositionGuard.current.keyDown(event.key, event.timeStamp);
              if (shouldSubmitAgentComposer(event, sessionBusy || resume.failed, composing)) {
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
              disabled={sessionBusy || loadingConfig}
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
            <AgentPermissionControl value={shellPermissionMode} disabled={shellSettingsLoading}
              onChange={mode => { void handleShellPermissionModeChange(mode); }} />
            <AgentSubmitButton streaming={session.isStreaming} busy={sessionBusy}
              canSubmit={canSubmit} onStop={() => { void session.stop(); }} />
          </div>
          </Composer>
        </ComposerFrame> : null}
    </AgentRoot>
  );
}
