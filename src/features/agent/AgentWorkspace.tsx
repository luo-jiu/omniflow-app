import React from 'react';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { AgentAttachmentStrip } from './components/AgentAttachmentStrip';
import OutlineIcon from '@/components/ui/outline-icon';
import { Toast } from '@douyinfe/semi-ui';
import styled, { css } from 'styled-components';

import AIModelSettingsControl from '@/features/ai-services/components/AIModelSettingsControl';
import { openCompactConfirm } from '@/components/ui/compact-confirm';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import type { SelectedTreeNode } from '@/features/file-explorer';
import { locateNodeInDirectoryTree } from '@/features/file-explorer/services/tree-locate';
import { AgentFileLinkContext } from './agent-file-link-context';
import type { AgentFileLink } from '@/shared/agent/agent-file-link';
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
import type { AgentSessionGroup, AgentSessionGroupInput, AgentSessionPermissionMode } from '@/shared/agent/agent-session-management';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import { buildFileFullName } from '@/utils/fileTreeSettings';
import AgentMemoryManager, {
  type AgentMemoryDeleteInput,
  type AgentMemoryUpdateInput,
} from './components/AgentMemoryManager';
import AgentSessionManager from './components/AgentSessionManager';
import AgentTimeline from './components/AgentTimeline';
import AgentSubmitButton from './components/AgentSubmitButton';
import AgentPermissionControl from './components/AgentPermissionControl';
import AgentSessionPeek from './components/AgentSessionPeek';
import AgentSessionGroupEditor from './components/AgentSessionGroupEditor';
import AgentSessionGroupPicker from './components/AgentSessionGroupPicker';
import { useAgentSessionGroups } from './hooks/useAgentSessionGroups';
import {
  AGENT_CHAT_INDEX_INSET,
  AGENT_CHAT_MAX_WIDTH,
  AGENT_CHAT_MIN_WIDTH,
  AGENT_DIRECTORY_BREAKPOINT,
  AGENT_DIRECTORY_BUBBLE_RESERVED_WIDTH,
  AGENT_DIRECTORY_LAYOUT_MS,
  AGENT_DIRECTORY_RESERVED_WIDTH,
} from './agent-session-directory-layout';
import { createAgentCompositionGuard, shouldSubmitAgentComposer } from './agent-composer-keyboard';
import AgentConversationIndex from './components/AgentConversationIndex';
import {
  loadAgentModelPreferences,
  saveAgentModelPreferences,
  type AgentModelPreferences,
} from './agent-model-preferences';
import {
  clampAgentComposerHeight,
  AGENT_COMPOSER_CHROME_HEIGHT,
  INITIAL_AGENT_COMPOSER_HEIGHT,
  MAX_AGENT_COMPOSER_HEIGHT,
  MIN_AGENT_COMPOSER_HEIGHT,
} from './agent-composer-layout';
import { useAgentMemories } from './hooks/useAgentMemories';
import { useAgentSession } from './hooks/useAgentSession';
import { useAgentSessionResume } from './hooks/useAgentSessionResume';
import { isAgentComputerRunCurrent, useAgentComputerControls } from './hooks/useAgentComputerControls';
import { useAgentWorkspaceRendering } from './hooks/useAgentWorkspaceRendering';
import { loadAgentSessionSelection, saveAgentSessionSelection } from './agent-session-selection';
import {
  deleteAgentSession,
  getAgentSession,
  archiveAgentSession,
  organizeAgentSession,
  saveAgentSessionGroup,
  deleteAgentSessionGroup,
  listAgentSessions,
  renameAgentSession,
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
  display: flex;
  flex-direction: column;

  &[data-directory-visible='true'] {
    transition: padding-right ${AGENT_DIRECTORY_LAYOUT_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
    padding-left: ${AGENT_CHAT_INDEX_INSET}px;
    padding-right: ${AGENT_DIRECTORY_RESERVED_WIDTH}px;
  }

  @container (max-width: ${AGENT_DIRECTORY_BREAKPOINT}px) {
    &[data-directory-visible='true'] {
      padding-right: ${AGENT_DIRECTORY_BUBBLE_RESERVED_WIDTH}px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    &[data-directory-visible='true'] { transition: none; }
  }
`;

const agentColumnStyles = css`
  /* Keep text width independent of the directory's animated reservation. */
  width: min(${AGENT_CHAT_MAX_WIDTH}px, max(${AGENT_CHAT_MIN_WIDTH}px, calc(
    100cqw - ${AGENT_CHAT_INDEX_INSET + AGENT_DIRECTORY_BUBBLE_RESERVED_WIDTH}px
    - var(--agent-scrollbar-width, 8px)
  )));
  max-width: none;
  min-width: ${AGENT_CHAT_MIN_WIDTH}px;
  flex-shrink: 0;
  margin-inline: auto;
`;

const AgentContent = styled.div`
  ${agentColumnStyles}
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const ArchiveHeader = styled.header`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  font-size: 14px;
  .archive-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 28px; padding: 0 6px;
    border: 0; border-radius: 5px; background: transparent; color: var(--app-text-secondary); font-size: 12px; cursor: pointer; }
  button:hover, button:focus-visible { background: var(--semi-color-fill-1); color: var(--app-text); }
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
  padding: 0 ${AGENT_DIRECTORY_RESERVED_WIDTH}px 18px ${AGENT_CHAT_INDEX_INSET}px;
  transition: padding-right ${AGENT_DIRECTORY_LAYOUT_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
  @container (max-width: ${AGENT_DIRECTORY_BREAKPOINT}px) {
    padding-right: ${AGENT_DIRECTORY_BUBBLE_RESERVED_WIDTH}px;
  }
  @media (prefers-reduced-motion: reduce) { transition: none; }
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
  border: 1px solid transparent;
  border-radius: 20px;
  background: var(--app-bg-elevated);
  overflow: hidden;

  textarea {
    display: block;
    width: 100%;
    min-height: ${MIN_AGENT_COMPOSER_HEIGHT - AGENT_COMPOSER_CHROME_HEIGHT}px;
    max-height: ${MAX_AGENT_COMPOSER_HEIGHT - AGENT_COMPOSER_CHROME_HEIGHT}px;
    overflow-y: auto;
    resize: none;
    border: 0;
    outline: 0;
    padding: 10px 10px 8px;
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
    height: 42px;
    flex: none;
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
    color: var(--app-accent-foreground);
  }

  .agent-submit.stop {
    background: #e58b32;
    color: #fff;
  }
  .agent-submit .app-outline-icon { color: inherit; }

  .agent-submit:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .agent-submit:not(:disabled):hover {
    filter: brightness(1.08);
  }
`;

type AgentWorkspaceProps = {
  onOpenFileLink?: (link: AgentFileLink) => void;
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
  onOpenFileLink,
  libraryId,
  onRefreshDirectory,
  ownerScope,
  rootNodeId,
  selectedTreeNode,
}: AgentWorkspaceProps) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  useAgentWorkspaceRendering({ active: workspaceActive, ownerScope, libraryId });
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
  const attachmentInputRef = React.useRef<HTMLInputElement>(null);
  const compositionGuard = React.useRef(createAgentCompositionGuard());
  const composerFrameRef = React.useRef<HTMLDivElement>(null);
  const [composerDockHeight, setComposerDockHeight] = React.useState(0);
  const [scrollbarWidth, setScrollbarWidth] = React.useState(8);
  const [draftGroupId, setDraftGroupId] = React.useState<string | null>(null);
  const [draftPermissionMode, setDraftPermissionMode] = React.useState<AgentSessionPermissionMode>('ask');
  const [permissionsSaving, setPermissionsSaving] = React.useState(false);
  const [sessionMutationBusy, setSessionMutationBusy] = React.useState(false);
  const [groupEditor, setGroupEditor] = React.useState<AgentSessionGroup | null | undefined>();
  const [groupPicker, setGroupPicker] = React.useState<{ kind: 'new' | 'move'; session?: AgentSessionSummary } | null>(null);
  const [revealGroupId, setRevealGroupId] = React.useState<string | null>(null);
  const [archivedPreview, setArchivedPreview] = React.useState<import('@/shared/agent/agent.types').AgentSessionSnapshot | null>(null);
  const archivePreviewRequest = React.useRef<symbol>();
  const [sessions, setSessions] = React.useState<AgentSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(true);
  const [sessionsLoadingMore, setSessionsLoadingMore] = React.useState(false);
  const [sessionsNextCursor, setSessionsNextCursor] = React.useState<AgentSessionCursor | null>(null);
  const [sessionsTotal, setSessionsTotal] = React.useState(0);
  const [managerMode, setManagerMode] = React.useState<'memories' | 'sessions' | 'archives' | null>(null);
  const [sessionQuery, setSessionQuery] = React.useState('');
  const [managerGroupFilter, setManagerGroupFilter] = React.useState('all');
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = React.useRef<number | null>(null);
  const shouldFollowScrollRef = React.useRef(true);
  const indexNavigationRef = React.useRef(false);
  const computerScrollRef = React.useRef(false);
  const pointerInteractionRef = React.useRef(false);
  const sessionsRequestIdRef = React.useRef(0);
  const ownerScopeKey = serializeAgentOwnerScope(ownerScope);
  const sessionScopeKey = `${ownerScopeKey}\u0000${libraryId}`;
  const currentSessionScopeKeyRef = React.useRef(sessionScopeKey);
  currentSessionScopeKeyRef.current = sessionScopeKey;
  React.useEffect(() => {
    currentSessionScopeKeyRef.current = sessionScopeKey;
    return () => { currentSessionScopeKeyRef.current = ''; };
  }, [sessionScopeKey]);
  const groupDirectory = useAgentSessionGroups(ownerScope, libraryId);
  const refreshGroups = groupDirectory.refresh;
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
    archived = false,
    groupFilter = 'all',
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
      const page = await listAgentSessions(ownerScope, requestedLibraryId, query, cursor, {
        archived, ...(groupFilter === 'all' ? {} : { groupId: groupFilter === '__ungrouped' ? null : groupFilter }),
      });
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
    void loadSessions(managerMode === 'sessions' || managerMode === 'archives' ? sessionQuery : '', undefined, managerMode === 'archives', managerMode ? managerGroupFilter : 'all');
    void refreshGroups();
  }, [loadSessions, managerGroupFilter, managerMode, refreshGroups, sessionQuery, sessionScopeKey]);
  const handleSessionTitleChanged = React.useCallback(() => {
    void loadSessions(managerMode === 'sessions' || managerMode === 'archives' ? sessionQuery : '', undefined, managerMode === 'archives', managerMode ? managerGroupFilter : 'all');
    void refreshGroups();
  }, [loadSessions, managerGroupFilter, managerMode, refreshGroups, sessionQuery]);
  const session = useAgentSession({
    groupId: draftGroupId,
    permissionMode: draftPermissionMode,
    appContext,
    model: modelPreferences.model,
    onRefreshDirectory,
    onSessionChanged: handleSessionChanged,
    onSessionTitleChanged: handleSessionTitleChanged,
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
  const sessionBusy = session.isBusy || resume.loading || permissionsSaving || sessionMutationBusy;
  const currentSessionId = session.sessionId;
  const activeSessionIdRef = React.useRef(currentSessionId);
  activeSessionIdRef.current = currentSessionId;
  const currentGroupId = currentSessionId ? session.sessionInfo?.groupId || null : draftGroupId;
  const permissionMode = currentSessionId ? session.sessionInfo?.permissionMode || 'ask' : draftPermissionMode;
  React.useLayoutEffect(() => {
    computerScrollRef.current = false;
    pointerInteractionRef.current = false;
    indexNavigationRef.current = false;
    shouldFollowScrollRef.current = true;
    compositionGuard.current.reset();
  }, [sessionScopeKey, currentSessionId]);
  React.useEffect(() => {
    const finishPointer = () => { pointerInteractionRef.current = false; };
    window.addEventListener('pointerup', finishPointer);
    window.addEventListener('pointercancel', finishPointer);
    return () => {
      window.removeEventListener('pointerup', finishPointer);
      window.removeEventListener('pointercancel', finishPointer);
    };
  }, []);

  const configRequestId = React.useRef(0);
  const modelRequestId = React.useRef(0);
  const loadConfig = React.useCallback(async () => {
    const requestId = ++configRequestId.current;
    modelRequestId.current += 1;
    setLoadingModels(false);
    setLoadingConfig(true);
    setConfigError(null);
    try {
      const snapshot = await fetchAIServiceProfiles();
      if (requestId !== configRequestId.current) return;
      setAIServices(snapshot);
      setModels([]);
    } catch (error) {
      if (requestId !== configRequestId.current) return;
      setAIServices(null);
      setConfigError(error instanceof Error ? error.message : '读取 AI 服务配置失败');
      setModels([]);
    } finally {
      if (requestId === configRequestId.current) setLoadingConfig(false);
    }
  }, []);

  React.useEffect(() => {
    if (!workspaceActive) return;
    void loadConfig();
    return () => { configRequestId.current += 1; modelRequestId.current += 1; };
  }, [loadConfig, workspaceActive]);

  React.useEffect(() => {
    setSessions([]);
    setSessionsNextCursor(null);
    setSessionsTotal(0);
    setManagerMode(null);
    setSessionQuery('');
    setManagerGroupFilter('all');
    setDraftGroupId(null);
    setDraftPermissionMode('ask');
    setGroupEditor(undefined);
    setGroupPicker(null);
    setArchivedPreview(null);
    setPermissionsSaving(false);
    setSessionMutationBusy(false);
  }, [loadSessions, sessionScopeKey]);

  React.useEffect(() => {
    if (managerMode === 'memories') return;
    const timer = window.setTimeout(() => {
      void loadSessions(managerMode === 'sessions' || managerMode === 'archives' ? sessionQuery : '', undefined, managerMode === 'archives', managerMode ? managerGroupFilter : 'all');
    }, managerMode ? 160 : 0);
    return () => window.clearTimeout(timer);
  }, [loadSessions, managerGroupFilter, managerMode, sessionQuery]);

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
      textarea.style.height = `${INITIAL_AGENT_COMPOSER_HEIGHT - AGENT_COMPOSER_CHROME_HEIGHT}px`;
      const height = clampAgentComposerHeight(textarea.scrollHeight + AGENT_COMPOSER_CHROME_HEIGHT);
      textarea.style.height = `${height - AGENT_COMPOSER_CHROME_HEIGHT}px`;
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
    if (!element || !workspaceActive) return;
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
    workspaceActive,
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
    const requestId = ++modelRequestId.current;
    if (!activeProfile) {
      Toast.warning('请先在 AI 服务配置中启用一个服务');
      return false;
    }
    setLoadingModels(true);
    try {
      const nextModels = await fetchActiveAIServiceModels();
      if (requestId !== modelRequestId.current) return false;
      setModels(nextModels);
      if (!modelPreferences.model && nextModels.length > 0) {
        persistModelPreferences({ ...modelPreferences, model: nextModels[0] });
      }
      return true;
    } catch (error) {
      if (requestId === modelRequestId.current) Toast.error(error instanceof Error ? error.message : '获取模型列表失败');
      return false;
    } finally {
      if (requestId === modelRequestId.current) setLoadingModels(false);
    }
  }, [activeProfile, modelPreferences, persistModelPreferences]);

  const handlePermissionModeChange = async (
    nextMode: AgentSessionPermissionMode,
  ) => {
    if (nextMode === permissionMode || permissionsSaving || sessionBusy) return;
    if (!currentSessionId) { setDraftPermissionMode(nextMode); return; }
    if (!ownerScope || !session.sessionInfo) return;
    setPermissionsSaving(true);
    try {
      const updated = await organizeAgentSession(ownerScope, libraryId, currentSessionId, {
        revision: session.sessionInfo.revision || 1, groupId: currentGroupId, permissionMode: nextMode,
      });
      if (currentSessionScopeKeyRef.current !== sessionScopeKey) return;
      session.updateSessionInfo(updated);
      void refreshGroups();
    } catch (error) {
      if (currentSessionScopeKeyRef.current === sessionScopeKey) Toast.error(error instanceof Error ? error.message : '更新会话权限失败');
    } finally {
      if (currentSessionScopeKeyRef.current === sessionScopeKey) setPermissionsSaving(false);
    }
  };

  const selectedNodeLabel = selectedTreeNode
    ? selectedTreeNode.type === 'file'
      ? buildFileFullName(selectedTreeNode.name, selectedTreeNode.ext)
      : selectedTreeNode.name
    : rootNodeId
      ? '资料库根目录'
      : '未选择文件';
  const contextLabel = `选中：${selectedNodeLabel}`;
  const canSubmit = Boolean(
    ownerScope && (session.draft.trim() || session.attachments.entries.length) && session.attachments.ready && modelPreferences.model && activeProfile && !loadingConfig
    && !resume.loading && !resume.failed,
  );
  const showResume = Boolean(session.resumableRunId && !session.draft.trim() && !session.attachments.entries.length);
  const canResume = Boolean(ownerScope && modelPreferences.model && activeProfile && !loadingConfig && !resume.loading && !resume.failed);
  const workspaceError = ownerScope
    ? configError
    : '当前账号身份不完整，Agent 会话暂不可用';
  const scrollContentVersion = React.useMemo(() => ({ messages: session.messages, composerHeight, composerDockHeight }),
    [session.messages, composerHeight, composerDockHeight]);
  useAgentComputerControls({
    context: ownerScope && currentSessionId ? { ownerScope, libraryId, sessionId: currentSessionId } : null,
    active: workspaceActive && !managerMode,
    blocked: session.isPreparing || resume.loading || resume.failed || sessionMutationBusy || permissionsSaving
      || groupEditor !== undefined || !!groupPicker || !!archivedPreview,
    textareaRef, scrollRef,
    readDraft: session.readComputerDraft,
    compareAndSetDraft: session.compareAndSetComputerDraft,
    compositionActive: () => compositionGuard.current.isActive(),
    navigationActive: () => indexNavigationRef.current || pointerInteractionRef.current,
    isRunCurrent: runId => isAgentComputerRunCurrent(session.runs, currentSessionId, runId),
    applyScroll: (top, beginApply) => {
      const element = scrollRef.current;
      if (!element || !workspaceActive || managerMode || pointerInteractionRef.current || indexNavigationRef.current) return false;
      beginApply();
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      shouldFollowScrollRef.current = false;
      computerScrollRef.current = true;
      element.scrollTo({ top, behavior: 'instant' });
      return true;
    },
    scrollContentVersion,
  });
  const hasTimelineContent = session.messages.length > 0
    || session.runs.length > 0
    || session.toolActivities.length > 0;
  const submitInteraction = session.submitInteraction;
  const reconcileOperation = session.reconcileOperation;
  const toolActivities = session.toolActivities;
  const handlePresentationAction = React.useCallback((action: AgentPresentationAction) => {
    if (action.action === 'agent.operation.reconcile') {
      const activity = toolActivities.find(item => item.id === action.toolRunId && item.sessionId === action.sessionId && item.revision === action.expectedRevision);
      if (!activity || action.libraryId !== libraryId) { Toast.warning('该操作回执不属于当前会话或已更新'); return; }
      void reconcileOperation(activity); return;
    }
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
  }, [libraryId, submitInteraction, toolActivities, reconcileOperation]);

  const handleToolExpand = React.useCallback(() => {
    shouldFollowScrollRef.current = false;
  }, []);

  const handleOpenSession = React.useCallback(async (target: AgentSessionSummary) => {
    if (await restoreSession(target.id)) {
      selectSession(target.id);
      shouldFollowScrollRef.current = true;
      setManagerMode(null);
      return true;
    }
    return false;
  }, [restoreSession, selectSession]);

  const resetToGroup = React.useCallback((groupId: string | null) => {
    resetSession();
    selectSession(null);
    setSessionQuery('');
    setDraftGroupId(groupId);
    setDraftPermissionMode(groupId ? 'group' : 'ask');
    setManagerMode(null);
  }, [resetSession, selectSession]);
  const startNewSession = (groupId: string | null) => {
    if (sessionBusy) { Toast.warning('请先等待当前操作结束'); return; }
    resetToGroup(groupId);
  };
  const handleNewSession = () => { if (!sessionBusy) setGroupPicker({ kind: 'new' }); };

  const handleRenameSession = React.useCallback(async (
    target: AgentSessionSummary,
    title: string,
  ): Promise<boolean> => {
    if (!ownerScope) return false;
    try {
      const updated = await renameAgentSession(ownerScope, libraryId, target.id, title);
      if (currentSessionScopeKeyRef.current !== sessionScopeKey) return false;
      session.updateSessionInfo(updated);
      await refreshGroups();
      await loadSessions(sessionQuery, undefined, false, managerGroupFilter);
      return true;
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : 'Agent 会话重命名失败');
      return false;
    }
  }, [libraryId, loadSessions, managerGroupFilter, ownerScope, refreshGroups, session, sessionQuery, sessionScopeKey]);

  const handleDeleteSession = React.useCallback((target: AgentSessionSummary) => {
    openCompactConfirm({
      cancelText: '取消',
      content: `永久删除“${target.title}”及其聊天和工具记录？此操作无法撤销，已生成到资料库的文件不会删除。`,
      okButtonProps: { type: 'danger' },
      okText: '删除',
      onOk: async () => {
        if (!ownerScope) return;
        try {
          await deleteAgentSession(ownerScope, libraryId, target.id);
          if (currentSessionScopeKeyRef.current !== sessionScopeKey) return;
          if (activeSessionIdRef.current === target.id) { resetSession(); selectSession(null); }
          else if (loadAgentSessionSelection(sessionScopeKey) === target.id) selectSession(null);
          setArchivedPreview(null);
          await loadSessions(sessionQuery, undefined, true, managerGroupFilter);
          await refreshGroups();
        } catch (error) {
          Toast.error(error instanceof Error ? error.message : 'Agent 会话删除失败');
          throw error;
        }
      },
      title: '永久删除会话',
    });
  }, [libraryId, loadSessions, managerGroupFilter, ownerScope, refreshGroups, resetSession, sessionQuery, selectSession, sessionScopeKey]);

  const handleArchiveSession = async (target: AgentSessionSummary, archived = true) => {
    if (!ownerScope) return;
    if (target.id === activeSessionIdRef.current && (session.draft.trim() || session.attachments.entries.length)) {
      Toast.warning('当前会话还有未发送内容，请先处理输入框中的草稿'); return;
    }
    const switching = archived && target.id === activeSessionIdRef.current;
    let committed = false;
    if (switching) setSessionMutationBusy(true);
    try {
      const archivedSession = await archiveAgentSession(ownerScope, libraryId, target.id, archived, target.revision || 1);
      committed = true;
      if (currentSessionScopeKeyRef.current !== sessionScopeKey) return;
      if (archived && activeSessionIdRef.current === target.id) {
        selectSession(null);
        const next = await listAgentSessions(ownerScope, libraryId, '', undefined, { groupId: archivedSession.groupId || null });
        if (currentSessionScopeKeyRef.current !== sessionScopeKey || activeSessionIdRef.current !== target.id) return;
        const opened = next.sessions[0] ? await handleOpenSession(next.sessions[0]) : false;
        if (currentSessionScopeKeyRef.current !== sessionScopeKey) return;
        if (!opened) resetToGroup(archivedSession.groupId || null);
      }
      if (!archived) setArchivedPreview(null);
      await refreshGroups();
      await loadSessions(sessionQuery, undefined, managerMode === 'archives', managerMode ? managerGroupFilter : 'all');
    } catch (error) {
      if (currentSessionScopeKeyRef.current === sessionScopeKey) {
        if (committed && switching && activeSessionIdRef.current === target.id) resetToGroup(null);
        Toast.error(error instanceof Error ? error.message : '归档操作失败');
      }
    } finally {
      if (switching && currentSessionScopeKeyRef.current === sessionScopeKey) setSessionMutationBusy(false);
    }
  };

  const handleSaveGroup = async (input: AgentSessionGroupInput) => {
    if (!ownerScope) throw new Error('当前账号不可用');
    const saved = await saveAgentSessionGroup(ownerScope, libraryId, input);
    if (currentSessionScopeKeyRef.current !== sessionScopeKey) return;
    await refreshGroups();
    if (currentSessionScopeKeyRef.current !== sessionScopeKey) return;
    setRevealGroupId(saved.id);
    setGroupEditor(undefined);
  };
  const handleDeleteGroup = (group: AgentSessionGroup) => {
    openCompactConfirm({ title: '删除会话组', content: `删除“${group.name}”？会话将移到未分组，组内自动授权失效，文件不会删除。`,
      okText: '删除组', cancelText: '取消', okButtonProps: { type: 'danger' }, onOk: async () => {
        if (!ownerScope) return;
        await deleteAgentSessionGroup(ownerScope, libraryId, group.id, group.revision);
        if (currentSessionScopeKeyRef.current !== sessionScopeKey) return;
        setGroupEditor(undefined);
        if (managerGroupFilter === group.id) setManagerGroupFilter('all');
        if (draftGroupId === group.id) { setDraftGroupId(null); setDraftPermissionMode('ask'); }
        if (activeSessionIdRef.current) {
          const fresh = await getAgentSession(ownerScope, libraryId, activeSessionIdRef.current);
          if (currentSessionScopeKeyRef.current === sessionScopeKey) session.updateSessionInfo(fresh);
        }
        await refreshGroups();
        await loadSessions(sessionQuery, undefined, managerMode === 'archives', managerGroupFilter === group.id ? 'all' : managerGroupFilter);
      } });
  };
  const handleChooseGroup = async (groupId: string | null) => {
    if (groupPicker?.kind === 'new') {
      if (sessionBusy) throw new Error('请先停止当前任务');
      startNewSession(groupId);
    } else if (groupPicker?.session && ownerScope) {
      const target = groupPicker.session;
      const updated = await organizeAgentSession(ownerScope, libraryId, target.id, {
        revision: target.revision || 1, groupId,
        permissionMode: target.permissionMode === 'full-access' ? 'full-access' : groupId ? 'group' : 'ask',
      });
      if (currentSessionScopeKeyRef.current !== sessionScopeKey) return;
      session.updateSessionInfo(updated);
      await refreshGroups();
      await loadSessions(sessionQuery, undefined, false, managerGroupFilter);
    }
    if (currentSessionScopeKeyRef.current === sessionScopeKey) setGroupPicker(null);
  };
  const openArchives = () => {
    setSessionQuery(''); setSessionsLoading(true); setArchivedPreview(null); setManagerMode('archives');
  };
  const openArchivedSession = async (target: AgentSessionSummary) => {
    if (!ownerScope) return;
    const request = Symbol(target.id);
    archivePreviewRequest.current = request;
    try {
      const snapshot = await getAgentSession(ownerScope, libraryId, target.id, true);
      if (archivePreviewRequest.current === request && currentSessionScopeKeyRef.current === sessionScopeKey) setArchivedPreview(snapshot);
    } catch (error) { if (currentSessionScopeKeyRef.current === sessionScopeKey) Toast.error(error instanceof Error ? error.message : '读取归档失败'); }
  };
  React.useEffect(() => {
    if (managerMode !== 'archives') { archivePreviewRequest.current = undefined; setArchivedPreview(null); }
  }, [managerMode]);

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
      {!managerMode ? <AgentSessionPeek
        key={sessionScopeKey}
        sessions={sessions}
        total={groupDirectory.summary.total}
        activeSessionId={currentSessionId}
        loading={groupDirectory.loading}
        busy={sessionBusy || !ownerScope}
        onOpen={target => { void handleOpenSession(target); }}
        onManage={() => {
          setSessionQuery('');
          setSessionsLoading(true);
          setManagerMode('sessions');
        }}
        onNew={handleNewSession}
        directory={groupDirectory.summary}
        pages={groupDirectory.pages}
        currentGroupId={currentGroupId}
        revealGroupId={revealGroupId}
        storageKey={`agent-group-collapse:v1:${encodeURIComponent(sessionScopeKey)}`}
        error={groupDirectory.error}
        onRetry={() => { void refreshGroups(); }}
        onLoadGroup={(id, more) => { void groupDirectory.loadGroup(id, more); }}
        onCreateGroup={() => setGroupEditor(null)}
        onEditGroup={group => { if (!sessionMutationBusy) setGroupEditor(group); }}
        onNewInGroup={startNewSession}
        onArchive={target => { void handleArchiveSession(target); }}
        onArchives={openArchives}
        onMemories={() => {
          setMemoryQuery('');
          setManagerMode('memories');
        }}
      /> : null}
      <AgentScroll
        data-directory-visible={!managerMode ? true : undefined}
        onWheel={() => { indexNavigationRef.current = false; computerScrollRef.current = false; }}
        onPointerDown={() => { indexNavigationRef.current = false; computerScrollRef.current = false; pointerInteractionRef.current = true; }}
        onKeyDown={event => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
            indexNavigationRef.current = false;
            computerScrollRef.current = false;
          }
        }}
        onScroll={(event) => {
          if (managerMode || indexNavigationRef.current || computerScrollRef.current) return;
          const element = event.currentTarget;
          shouldFollowScrollRef.current = (
            element.scrollHeight - element.scrollTop - element.clientHeight <= 48
          );
        }}
        ref={scrollRef}
      >
        {managerMode === 'archives' && archivedPreview ? <AgentContent>
          <ArchiveHeader>
            <button type="button" onClick={() => setArchivedPreview(null)} title="返回归档" aria-label="返回归档"><OutlineIcon name="back" /></button>
            <span className="archive-title" title={archivedPreview.title}>{archivedPreview.title}</span>
            <button type="button" onClick={() => { void handleArchiveSession(archivedPreview, false); }}><OutlineIcon name="archive-restore" />恢复会话</button>
          </ArchiveHeader>
          <AgentTimeline approvalBusyIds={new Set()} interactionBusyIds={new Set()} libraryId={libraryId}
            ownerScope={ownerScope} messages={archivedPreview.messages} runs={archivedPreview.runs} toolActivities={archivedPreview.toolActivities}
            onResolveApproval={() => undefined} />
        </AgentContent> : managerMode === 'sessions' || managerMode === 'archives' ? (
          <AgentSessionManager
            groupFilter={managerGroupFilter}
            onGroupFilterChange={setManagerGroupFilter}
            archived={managerMode === 'archives'}
            groups={groupDirectory.summary.groups}
            onArchive={target => { void handleArchiveSession(target); }}
            onRestore={target => { void handleArchiveSession(target, false); }}
            onMove={target => setGroupPicker({ kind: 'move', session: target })}
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
              if (sessionsNextCursor) void loadSessions(sessionQuery, sessionsNextCursor, managerMode === 'archives', managerGroupFilter);
            }}
            onOpen={target => { if (managerMode === 'archives') void openArchivedSession(target); else void handleOpenSession(target); }}
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
            <AgentFileLinkContext.Provider value={onOpenFileLink}><AgentTimeline
              approvalBusyIds={session.approvalBusyIds}
              interactionBusyIds={session.interactionBusyIds}
              receiptBusyIds={session.receiptBusyIds}
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
            /></AgentFileLinkContext.Provider>
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
        onNavigate={() => { indexNavigationRef.current = true; computerScrollRef.current = false; shouldFollowScrollRef.current = false; }}
      /> : null}
        {!managerMode ? <ComposerFrame ref={composerFrameRef}>
          <Composer onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
            onDrop={event => { if (!sessionMutationBusy && event.dataTransfer.files.length) { event.preventDefault(); session.attachments.add(Array.from(event.dataTransfer.files)); } }}
            onSubmit={(event) => {
            event.preventDefault();
            if (resume.loading || resume.failed || sessionMutationBusy) return;
            computerScrollRef.current = false;
            shouldFollowScrollRef.current = true;
            void session.submit();
          }}>
          <AgentAttachmentStrip entries={session.attachments.entries} onRemove={session.attachments.remove}
            scope={ownerScope ? { ownerScope, libraryId } : null} />
          {session.attachments.error && <div role="alert">{session.attachments.error}</div>}
          <input ref={attachmentInputRef} type="file" multiple hidden disabled={sessionMutationBusy} aria-label="选择图片或文本文件"
            onChange={event => { session.attachments.add(Array.from(event.target.files || [])); event.target.value = ''; }} />
          <textarea
            ref={textareaRef}
            disabled={sessionMutationBusy}
            aria-label="Agent 输入"
            onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); session.attachments.add(files); } }}
            onCompositionStart={() => compositionGuard.current.start()}
            onCompositionEnd={event => compositionGuard.current.end(event.timeStamp)}
            onKeyUp={event => compositionGuard.current.keyUp(event.key)}
            onBlur={() => compositionGuard.current.reset()}
            onChange={(event) => session.setDraft(event.target.value)}
            onKeyDown={(event) => {
              const composing = compositionGuard.current.keyDown(event.key, event.timeStamp);
              if (shouldSubmitAgentComposer(event, sessionBusy || resume.failed, composing)) {
                event.preventDefault();
                computerScrollRef.current = false;
                shouldFollowScrollRef.current = true;
                void session.submit();
              }
            }}
            placeholder="从这里开始..."
            style={{ height: `${composerHeight - AGENT_COMPOSER_CHROME_HEIGHT}px` }}
            value={session.draft}
          />
          <div className="agent-composer-footer">
            <button type="button" aria-label="添加图片或文本文件" title="添加图片或文本文件"
              disabled={sessionMutationBusy}
              onClick={() => attachmentInputRef.current?.click()}
              style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, flexShrink: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
              <OutlineIcon name="plus" />
            </button>
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
            <AgentPermissionControl value={permissionMode} grouped={Boolean(currentGroupId)} disabled={sessionBusy}
              onChange={mode => { void handlePermissionModeChange(mode); }} />
            <AgentSubmitButton streaming={session.isStreaming} busy={sessionBusy}
              canSubmit={canSubmit} onStop={() => { void session.stop(); }}
              resumable={showResume} canResume={canResume} onResume={() => { void session.continueTask(); }} />
          </div>
          </Composer>
        </ComposerFrame> : null}
      {groupEditor !== undefined ? <AgentSessionGroupEditor key={groupEditor?.id || `new:${sessionScopeKey}`}
        group={groupEditor || undefined} libraryId={libraryId} onSave={handleSaveGroup} onCancel={() => setGroupEditor(undefined)}
        onDelete={groupEditor ? () => handleDeleteGroup(groupEditor) : undefined} /> : null}
      {groupPicker ? <AgentSessionGroupPicker key={`${groupPicker.kind}:${groupPicker.session?.id || sessionScopeKey}`}
        title={groupPicker.kind === 'new' ? '新建会话' : '移动会话到组'} groups={groupDirectory.summary.groups}
        initialGroupId={groupPicker.kind === 'move' ? groupPicker.session?.groupId || null : currentGroupId} onChoose={handleChooseGroup} onCancel={() => setGroupPicker(null)} /> : null}
    </AgentRoot>
  );
}
