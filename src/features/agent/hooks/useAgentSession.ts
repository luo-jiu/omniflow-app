import React from 'react';

import type {
  AgentAppContext,
  AgentChatStreamEvent,
  AgentInteractionResponse,
  AgentMessage,
  AgentOwnerScope,
  AgentPreparedActionPublic,
  AgentReasoningEffort,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
  AgentToolApprovalSnapshot,
  AgentToolExecutionRequest,
  AgentToolPrepareRequest,
} from '@/shared/agent/agent.types';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import {
  getAgentSession,
  completeAgentToolExecution,
  completeAgentToolPreparation,
  markAgentToolExecutionCommitted,
  resolveAgentToolApproval,
  submitAgentInteraction,
  startAgentChat,
  stopAgentChat,
  subscribeAgentChat,
} from '../services/agent.api';
import { readAgentPerception } from '../services/agent-context.api';
import { executeAgentRendererTool } from '../services/agent-tool-executor';
import { prepareAgentRendererTool } from '../services/agent-tool-preparer';
import {
  appendBufferedAgentEvent,
  reconcileCanonicalAgentRunMessages,
} from '../agent-stream-messages';
import {
  reconcileCanonicalAgentRunActivities,
  upsertAgentToolActivity,
} from '../agent-tool-activities';
import { upsertAgentRun } from '../agent-runs';

interface UseAgentSessionInput {
  appContext: AgentAppContext;
  model: string;
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
  onSessionChanged?: (sessionId: string) => void;
  ownerScope: AgentOwnerScope | null;
  profileId: string;
  reasoningEffort: AgentReasoningEffort;
}

function createMessageId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isAgentMessage(value: AgentMessage | null): value is AgentMessage {
  return Boolean(value);
}

function ensureToolTimelineAnchor(
  current: AgentMessage[],
  activity: AgentToolActivitySnapshot,
): AgentMessage[] {
  if (current.some(message => (
    message.runId === activity.runId
    && message.toolCallId === activity.call.id
  ))) return current;
  return [
    ...current,
    {
      content: `正在调用 ${activity.call.name}`,
      createdAt: activity.createdAt,
      id: `agent-tool-anchor-${activity.runId}-${activity.call.id}`,
      role: 'tool',
      runId: activity.runId,
      sessionId: activity.sessionId,
      toolCallId: activity.call.id,
      toolName: activity.call.name,
    },
  ];
}

export function useAgentSession({
  appContext,
  model,
  onRefreshDirectory,
  onSessionChanged,
  ownerScope,
  profileId,
  reasoningEffort,
}: UseAgentSessionInput) {
  const [messages, setMessages] = React.useState<AgentMessage[]>([]);
  const [draft, setDraft] = React.useState('');
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [isPreparing, setIsPreparing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [runs, setRuns] = React.useState<AgentRunSnapshot[]>([]);
  const [toolActivities, setToolActivities] = React.useState<AgentToolActivitySnapshot[]>([]);
  const [approvalBusyIds, setApprovalBusyIds] = React.useState<Set<string>>(() => new Set());
  const [interactionBusyIds, setInteractionBusyIds] = React.useState<Set<string>>(() => new Set());
  const ownerScopeKey = serializeAgentOwnerScope(ownerScope);
  const sessionScopeKey = `${ownerScopeKey}\u0000${Number(appContext.libraryId)}`;
  const sessionScopeKeyRef = React.useRef(sessionScopeKey);
  const sessionIdRef = React.useRef<string | null>(null);
  const optimisticMessageIdRef = React.useRef<string | null>(null);
  const streamMessageIdRef = React.useRef<string | null>(null);
  const streamedContentLengthRef = React.useRef<Map<string, number>>(new Map());
  const pendingEventsRef = React.useRef<Map<string, AgentChatStreamEvent[]>>(new Map());
  const acceptPendingEventsRef = React.useRef(false);
  const restoringSessionIdRef = React.useRef<string | null>(null);
  const preparationTokenRef = React.useRef(0);
  const isPreparingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const approvalsInFlightRef = React.useRef<Set<string>>(new Set());
  const interactionsInFlightRef = React.useRef<Set<string>>(new Set());
  const rendererPreparationsInFlightRef = React.useRef<Map<string, {
    controller: AbortController;
    runId: string;
    sessionId: string;
  }>>(new Map());
  const rendererExecutionsInFlightRef = React.useRef<Map<string, {
    committed: boolean;
    controller: AbortController;
    runId: string;
    sessionId: string;
    stopAfterCommit: boolean;
  }>>(new Map());

  const setPreparing = React.useCallback((value: boolean) => {
    isPreparingRef.current = value;
    setIsPreparing(value);
  }, []);

  const executeRendererRequest = React.useCallback(async (
    request: AgentToolExecutionRequest,
  ) => {
    if (rendererExecutionsInFlightRef.current.has(request.executionId)) return;
    const controller = new AbortController();
    rendererExecutionsInFlightRef.current.set(request.executionId, {
      committed: false,
      controller,
      runId: request.runId,
      sessionId: request.sessionId,
      stopAfterCommit: false,
    });
    try {
      const outcome = await executeAgentRendererTool(request, {
        onCommitted: async (result) => {
          const active = rendererExecutionsInFlightRef.current.get(request.executionId);
          if (active?.controller === controller) active.committed = true;
          await markAgentToolExecutionCommitted({
            executionId: request.executionId,
            libraryId: Number(request.appContext.libraryId),
            ownerScope: request.ownerScope,
            result,
            runId: request.runId,
            sessionId: request.sessionId,
          });
        },
        onRefreshDirectory,
        signal: controller.signal,
      });
      if (controller.signal.aborted && !outcome.committed) return;
      await completeAgentToolExecution({
        executionId: request.executionId,
        libraryId: Number(request.appContext.libraryId),
        ownerScope: request.ownerScope,
        perception: outcome.perception,
        result: outcome.result,
        runId: request.runId,
        sessionId: request.sessionId,
      });
    } catch (executionError) {
      const cancelled = controller.signal.aborted
        || (executionError instanceof Error && executionError.name === 'AbortError');
      if (mountedRef.current && !cancelled) {
        setError(executionError instanceof Error ? executionError.message : 'Agent Tool 执行失败');
      }
    } finally {
      const active = rendererExecutionsInFlightRef.current.get(request.executionId);
      if (active?.controller === controller) {
        rendererExecutionsInFlightRef.current.delete(request.executionId);
        if (active.stopAfterCommit) {
          await stopAgentChat(active.sessionId).catch(() => false);
        }
      }
    }
  }, [onRefreshDirectory]);

  const prepareRendererRequest = React.useCallback(async (
    request: AgentToolPrepareRequest,
  ) => {
    if (rendererPreparationsInFlightRef.current.has(request.prepareId)) return;
    const controller = new AbortController();
    rendererPreparationsInFlightRef.current.set(request.prepareId, {
      controller,
      runId: request.runId,
      sessionId: request.sessionId,
    });
    try {
      const result = await prepareAgentRendererTool(request, { signal: controller.signal });
      if (controller.signal.aborted) return;
      await completeAgentToolPreparation({
        callId: request.callId,
        inputHash: request.inputHash,
        libraryId: Number(request.appContext.libraryId),
        ownerScope: request.ownerScope,
        prepareId: request.prepareId,
        result,
        runId: request.runId,
        sessionId: request.sessionId,
        toolRunId: request.toolRunId,
      });
    } catch (preparationError) {
      const cancelled = controller.signal.aborted
        || (preparationError instanceof Error && preparationError.name === 'AbortError');
      if (mountedRef.current && !cancelled) {
        setError(preparationError instanceof Error
          ? preparationError.message
          : 'Agent Tool 准备失败');
      }
    } finally {
      const active = rendererPreparationsInFlightRef.current.get(request.prepareId);
      if (active?.controller === controller) {
        rendererPreparationsInFlightRef.current.delete(request.prepareId);
      }
    }
  }, []);

  const applyEvent = React.useCallback((event: AgentChatStreamEvent) => {
    if (event.type === 'started') {
      if (!streamedContentLengthRef.current.has(event.runId)) {
        streamedContentLengthRef.current.set(event.runId, 0);
      }
      const optimisticMessageId = optimisticMessageIdRef.current;
      if (optimisticMessageId) {
        setMessages(current => current.map(message => (
          message.id === optimisticMessageId
            ? { ...message, runId: event.runId, sessionId: event.sessionId }
            : message
        )));
        optimisticMessageIdRef.current = null;
      }
      setIsStreaming(true);
      setError(null);
      setRuns(current => upsertAgentRun(current, event.run));
      return;
    }
    if (event.type === 'run-updated') {
      setRuns(current => upsertAgentRun(current, event.run));
      return;
    }
    if (event.type === 'delta') {
      streamedContentLengthRef.current.set(
        event.runId,
        (streamedContentLengthRef.current.get(event.runId) || 0) + event.delta.length,
      );
      setIsStreaming(true);
      setMessages((current) => {
        const messageId = streamMessageIdRef.current || createMessageId('agent-stream');
        streamMessageIdRef.current = messageId;
        const existing = current.find(message => message.id === messageId);
        if (!existing) {
          return [
            ...current,
            {
              content: event.delta,
              createdAt: new Date().toISOString(),
              id: messageId,
              role: 'assistant',
              runId: event.runId,
              sessionId: event.sessionId,
            },
          ];
        }
        return current.map(message => message.id === messageId
          ? { ...message, content: `${message.content}${event.delta}` }
          : message);
      });
      return;
    }
    if (event.type === 'tool-started') {
      setIsStreaming(true);
      const activity = event.activity || {
        call: event.call,
        createdAt: new Date().toISOString(),
        id: `agent-tool-${event.runId}-${event.call.id}`,
        ordinal: 0,
        permissionBehavior: 'allow' as const,
        revision: 0,
        runId: event.runId,
        sessionId: event.sessionId,
        status: 'running' as const,
      };
      setMessages(current => ensureToolTimelineAnchor(current, activity));
      streamMessageIdRef.current = null;
      setToolActivities(current => upsertAgentToolActivity(current, activity));
      return;
    }
    if (event.type === 'tool-progress') {
      setToolActivities((current) => {
        if (event.activity) return upsertAgentToolActivity(current, event.activity);
        return current.map(activity => (
          activity.runId === event.runId && activity.call.id === event.callId
            ? {
                ...activity,
                progress: event.progress,
                progressUpdatedAt: new Date().toISOString(),
              }
            : activity
        ));
      });
      return;
    }
    if (event.type === 'tool-prepare-requested') {
      void prepareRendererRequest(event.preparation);
      return;
    }
    if (event.type === 'tool-prepare-cancelled') {
      rendererPreparationsInFlightRef.current.get(event.prepareId)?.controller.abort();
      return;
    }
    if (event.type === 'tool-execution-requested') {
      void executeRendererRequest(event.execution);
      return;
    }
    if (event.type === 'tool-execution-cancelled') {
      rendererExecutionsInFlightRef.current.get(event.executionId)?.controller.abort();
      return;
    }
    if (event.type === 'tool-approval-required') {
      setIsStreaming(true);
      const activity = event.activity || {
        approval: {
          approvalId: event.approval.approvalId,
          preview: event.approval.preview,
          status: 'pending' as const,
        },
        call: event.approval.call,
        createdAt: new Date().toISOString(),
        id: `agent-tool-${event.runId}-${event.approval.call.id}`,
        ordinal: 0,
        permissionBehavior: 'ask' as const,
        ...(event.approval.preparation ? { preparation: event.approval.preparation } : {}),
        revision: 0,
        runId: event.runId,
        sessionId: event.sessionId,
        status: 'awaiting_approval' as const,
      };
      setToolActivities(current => upsertAgentToolActivity(current, activity));
      return;
    }
    if (event.type === 'tool-approval-resolved') {
      setToolActivities((current) => {
        if (event.activity) return upsertAgentToolActivity(current, event.activity);
        return current.map(activity => activity.approval?.approvalId === event.approvalId
          ? {
              ...activity,
              approval: {
                ...activity.approval,
                decidedAt: new Date().toISOString(),
                status: event.approved ? 'approved' as const : 'denied' as const,
              },
              status: event.approved ? 'running' as const : 'failed' as const,
            }
          : activity);
      });
      return;
    }
    if (event.type === 'tool-interaction-required') {
      setIsStreaming(true);
      setToolActivities(current => upsertAgentToolActivity(current, event.activity));
      return;
    }
    if (event.type === 'tool-interaction-resolved') {
      setToolActivities(current => upsertAgentToolActivity(current, event.activity));
      return;
    }
    if (event.type === 'tool-completed') {
      const activity = event.activity || {
        call: event.call,
        createdAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        id: `agent-tool-${event.runId}-${event.call.id}`,
        ordinal: 0,
        permissionBehavior: 'allow' as const,
        revision: 0,
        result: event.result,
        runId: event.runId,
        sessionId: event.sessionId,
        status: event.result.ok ? 'completed' as const : 'failed' as const,
      };
      setToolActivities(current => upsertAgentToolActivity(current, activity));
      streamMessageIdRef.current = null;
      return;
    }
    if (event.type === 'completed' || event.type === 'cancelled' || event.type === 'error') {
      rendererPreparationsInFlightRef.current.forEach((preparation) => {
        if (preparation.runId === event.runId) preparation.controller.abort();
      });
      rendererExecutionsInFlightRef.current.forEach((execution) => {
        if (execution.runId === event.runId) execution.controller.abort();
      });
      const renderedLength = streamedContentLengthRef.current.get(event.runId) || 0;
      const missingContent = event.content.slice(Math.min(renderedLength, event.content.length));
      streamedContentLengthRef.current.set(
        event.runId,
        Math.max(renderedLength, event.content.length),
      );
      setIsStreaming(false);
      if (event.run) {
        const runSnapshot = event.run;
        setRuns(current => upsertAgentRun(current, runSnapshot));
      }
      if (event.toolActivities) {
        setToolActivities(current => reconcileCanonicalAgentRunActivities(
          current,
          event.runId,
          event.toolActivities || [],
        ));
      }
      setMessages((current) => {
        if (event.messages) {
          return reconcileCanonicalAgentRunMessages(current, event.runId, event.messages);
        }
        const messageId = streamMessageIdRef.current;
        if (!messageId) {
          if (!missingContent) return current;
          return [
            ...current,
            {
              content: missingContent,
              createdAt: new Date().toISOString(),
              id: createMessageId('agent-complete'),
              role: 'assistant',
              runId: event.runId,
              sessionId: event.sessionId,
            },
          ];
        }
        const existing = current.find(message => message.id === messageId);
        if (!existing && !missingContent) return current;
        if (!existing) {
          return [
            ...current,
            {
              content: missingContent,
              createdAt: new Date().toISOString(),
              id: messageId,
              role: 'assistant',
              runId: event.runId,
              sessionId: event.sessionId,
            },
          ];
        }
        if (!missingContent) return current;
        return current.map(message => message.id === messageId
          ? { ...message, content: `${message.content}${missingContent}` }
          : message);
      });
      streamMessageIdRef.current = null;
      streamedContentLengthRef.current.delete(event.runId);
      if (event.type === 'error') setError(event.message);
      else if (event.type === 'cancelled') setError(null);
      onSessionChanged?.(event.sessionId);
      return;
    }
  }, [executeRendererRequest, onSessionChanged, prepareRendererRequest]);

  React.useEffect(() => {
    const pendingEvents = pendingEventsRef.current;
    const approvalsInFlight = approvalsInFlightRef.current;
    const interactionsInFlight = interactionsInFlightRef.current;
    const rendererPreparationsInFlight = rendererPreparationsInFlightRef.current;
    const rendererExecutionsInFlight = rendererExecutionsInFlightRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preparationTokenRef.current += 1;
      acceptPendingEventsRef.current = false;
      restoringSessionIdRef.current = null;
      pendingEvents.clear();
      approvalsInFlight.clear();
      interactionsInFlight.clear();
      rendererPreparationsInFlight.forEach(preparation => preparation.controller.abort());
      rendererPreparationsInFlight.clear();
      const sessionsToStop = new Set<string>();
      rendererExecutionsInFlight.forEach((execution) => {
        if (execution.committed) {
          execution.stopAfterCommit = true;
        } else {
          execution.controller.abort();
          sessionsToStop.add(execution.sessionId);
        }
      });
      sessionsToStop.forEach(activeSessionId => {
        void stopAgentChat(activeSessionId).catch(() => undefined);
      });
    };
  }, []);

  React.useEffect(() => subscribeAgentChat((event) => {
    if (restoringSessionIdRef.current === event.sessionId) {
      const pending = pendingEventsRef.current.get(event.sessionId) || [];
      pendingEventsRef.current.set(event.sessionId, appendBufferedAgentEvent(pending, event));
      return;
    }
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      if (!acceptPendingEventsRef.current) return;
      const pending = pendingEventsRef.current.get(event.sessionId) || [];
      pendingEventsRef.current.set(event.sessionId, appendBufferedAgentEvent(pending, event));
      return;
    }
    if (activeSessionId !== event.sessionId) return;
    applyEvent(event);
  }), [applyEvent]);

  React.useLayoutEffect(() => {
    if (sessionScopeKeyRef.current === sessionScopeKey) return;
    sessionScopeKeyRef.current = sessionScopeKey;
    preparationTokenRef.current += 1;
    acceptPendingEventsRef.current = false;
    restoringSessionIdRef.current = null;
    pendingEventsRef.current.clear();
    rendererPreparationsInFlightRef.current.forEach(preparation => preparation.controller.abort());
    rendererPreparationsInFlightRef.current.clear();
    const sessionsToStop = new Set<string>();
    rendererExecutionsInFlightRef.current.forEach((execution) => {
      if (execution.committed) {
        execution.stopAfterCommit = true;
      } else {
        execution.controller.abort();
        sessionsToStop.add(execution.sessionId);
      }
    });
    sessionsToStop.forEach(activeSessionId => {
      void stopAgentChat(activeSessionId).catch(() => undefined);
    });
    streamedContentLengthRef.current.clear();
    sessionIdRef.current = null;
    optimisticMessageIdRef.current = null;
    streamMessageIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    setDraft('');
    setError(null);
    setWarning(null);
    setRuns([]);
    setToolActivities([]);
    setApprovalBusyIds(new Set());
    setInteractionBusyIds(new Set());
    approvalsInFlightRef.current.clear();
    interactionsInFlightRef.current.clear();
    setIsStreaming(false);
    setPreparing(false);
  }, [sessionScopeKey, setPreparing]);

  const flushPendingEvents = React.useCallback((nextSessionId: string) => {
    const pending = pendingEventsRef.current.get(nextSessionId) || [];
    pendingEventsRef.current.delete(nextSessionId);
    pending.forEach(applyEvent);
  }, [applyEvent]);

  const restore = React.useCallback(async (nextSessionId: string) => {
    const libraryId = Number(appContext.libraryId);
    if (
      !ownerScope
      || !ownerScopeKey
      || !Number.isFinite(libraryId)
      || libraryId <= 0
      || isPreparingRef.current
    ) return false;
    const restoreScopeKey = sessionScopeKey;
    const preparationToken = preparationTokenRef.current + 1;
    preparationTokenRef.current = preparationToken;
    restoringSessionIdRef.current = nextSessionId;
    pendingEventsRef.current.delete(nextSessionId);
    setPreparing(true);
    setError(null);
    setWarning(null);
    try {
      const snapshot = await getAgentSession(ownerScope, libraryId, nextSessionId);
      if (
        preparationTokenRef.current !== preparationToken
        || sessionScopeKeyRef.current !== restoreScopeKey
        || snapshot.libraryId !== libraryId
      ) return false;
      sessionIdRef.current = snapshot.id;
      setSessionId(snapshot.id);
      setMessages(snapshot.messages);
      setRuns(snapshot.runs);
      setToolActivities(snapshot.toolActivities);
      approvalsInFlightRef.current.clear();
      interactionsInFlightRef.current.clear();
      setApprovalBusyIds(new Set());
      setInteractionBusyIds(new Set());
      const restoredContentLengths = new Map<string, number>();
      snapshot.messages.forEach((message) => {
        if (message.role !== 'assistant' || !message.runId) return;
        restoredContentLengths.set(
          message.runId,
          (restoredContentLengths.get(message.runId) || 0) + message.content.length,
        );
      });
      streamedContentLengthRef.current = restoredContentLengths;
      setDraft('');
      streamMessageIdRef.current = null;
      const running = snapshot.lastRunStatus === 'running'
        || snapshot.lastRunStatus === 'preparing'
        || snapshot.lastRunStatus === 'awaiting_approval'
        || snapshot.lastRunStatus === 'awaiting_interaction';
      setIsStreaming(running);
      if (snapshot.lastRunStatus === 'interrupted') {
        setWarning('上一轮在应用退出时中断，可以继续对话或重新发送请求');
      }
      restoringSessionIdRef.current = null;
      flushPendingEvents(snapshot.id);
      return true;
    } catch (restoreError) {
      if (preparationTokenRef.current === preparationToken) {
        setError(restoreError instanceof Error ? restoreError.message : 'Agent 会话恢复失败');
      }
      return false;
    } finally {
      if (preparationTokenRef.current === preparationToken) {
        if (restoringSessionIdRef.current === nextSessionId) {
          restoringSessionIdRef.current = null;
          pendingEventsRef.current.delete(nextSessionId);
        }
        setPreparing(false);
      }
    }
  }, [
    appContext.libraryId,
    flushPendingEvents,
    ownerScope,
    ownerScopeKey,
    sessionScopeKey,
    setPreparing,
  ]);

  const submit = React.useCallback(async (value = draft) => {
    const userPrompt = String(value || '').trim();
    if (!userPrompt || isStreaming || isPreparingRef.current) return;
    if (!profileId || !model) {
      setError('请先在 AI 服务配置中启用配置并选择模型');
      return;
    }
    if (!ownerScope || !ownerScopeKey) {
      setError('当前账号身份不完整，无法使用 Agent 会话');
      return;
    }

    const optimisticId = createMessageId('agent-user');
    const optimisticSessionId = sessionIdRef.current || '';
    const userMessage: AgentMessage = {
      content: userPrompt,
      createdAt: new Date().toISOString(),
      id: optimisticId,
      role: 'user',
      sessionId: optimisticSessionId,
    };
    optimisticMessageIdRef.current = optimisticId;
    setMessages(current => [...current, userMessage]);
    setDraft('');
    setError(null);
    setWarning(null);
    streamMessageIdRef.current = null;
    const preparationToken = preparationTokenRef.current + 1;
    preparationTokenRef.current = preparationToken;
    const submissionScopeKey = sessionScopeKey;
    const startsNewSession = !sessionIdRef.current;
    acceptPendingEventsRef.current = startsNewSession;
    setPreparing(true);

    try {
      let perception;
      try {
        perception = await readAgentPerception(appContext);
      } catch {
        if (
          mountedRef.current
          && preparationTokenRef.current === preparationToken
          && sessionScopeKeyRef.current === submissionScopeKey
        ) {
          setWarning('当前文件上下文读取失败，本次仍可继续对话');
        }
      }
      if (
        !mountedRef.current
        || preparationTokenRef.current !== preparationToken
        || sessionScopeKeyRef.current !== submissionScopeKey
      ) return;
      const result = await startAgentChat({
        appContext,
        model,
        ownerScope,
        perception,
        profileId,
        reasoningEffort,
        sessionId: sessionIdRef.current || undefined,
        userPrompt,
      });
      if (
        !mountedRef.current
        || preparationTokenRef.current !== preparationToken
        || sessionScopeKeyRef.current !== submissionScopeKey
      ) {
        void stopAgentChat(result.sessionId).catch(() => undefined);
        return;
      }
      sessionIdRef.current = result.sessionId;
      setSessionId(result.sessionId);
      setMessages(current => current.map(message => (
        message.id === optimisticId
          ? { ...message, runId: result.runId, sessionId: result.sessionId }
          : message
      )));
      flushPendingEvents(result.sessionId);
      if (optimisticMessageIdRef.current === optimisticId) {
        optimisticMessageIdRef.current = null;
      }
      acceptPendingEventsRef.current = false;
      onSessionChanged?.(result.sessionId);
    } catch (submitError) {
      if (preparationTokenRef.current === preparationToken) {
        if (optimisticMessageIdRef.current === optimisticId) {
          optimisticMessageIdRef.current = null;
        }
        setMessages(current => current.filter(message => message.id !== optimisticId));
        setDraft(userPrompt);
        setError(submitError instanceof Error ? submitError.message : 'Agent 请求失败');
        setIsStreaming(false);
      }
    } finally {
      if (preparationTokenRef.current === preparationToken) {
        acceptPendingEventsRef.current = false;
        setPreparing(false);
      }
    }
  }, [
    appContext,
    draft,
    flushPendingEvents,
    isStreaming,
    model,
    onSessionChanged,
    ownerScope,
    ownerScopeKey,
    profileId,
    reasoningEffort,
    sessionScopeKey,
    setPreparing,
  ]);

  const stop = React.useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId || !isStreaming) return;
    let deferStopUntilCommitReceipt = false;
    rendererPreparationsInFlightRef.current.forEach((preparation) => {
      if (preparation.sessionId === currentSessionId) preparation.controller.abort();
    });
    rendererExecutionsInFlightRef.current.forEach((execution) => {
      if (execution.sessionId !== currentSessionId) return;
      if (execution.committed) {
        execution.stopAfterCommit = true;
        deferStopUntilCommitReceipt = true;
      } else {
        execution.controller.abort();
      }
    });
    if (deferStopUntilCommitReceipt) return;
    await stopAgentChat(currentSessionId);
  }, [isStreaming]);

  const resolveApproval = React.useCallback(async (
    approval: AgentToolApprovalSnapshot,
    approved: boolean,
    preparedAction?: AgentPreparedActionPublic,
  ) => {
    const libraryId = Number(appContext.libraryId);
    if (
      approvalsInFlightRef.current.has(approval.approvalId)
      || !ownerScope
      || !Number.isFinite(libraryId)
      || libraryId <= 0
    ) return;

    approvalsInFlightRef.current.add(approval.approvalId);
    setApprovalBusyIds(current => new Set(current).add(approval.approvalId));
    setError(null);
    try {
      const decision = await resolveAgentToolApproval({
        approvalId: approval.approvalId,
        approved,
        libraryId,
        ownerScope,
        ...(approval.preparation
          ? {
              preparedAction: preparedAction || approval.preparation.action,
              preparedActionId: approval.preparation.preparedActionId,
            }
          : {}),
        runId: approval.runId,
        sessionId: approval.sessionId,
      });
      if (decision.approved && decision.execution) {
        if (
          !mountedRef.current
          || sessionScopeKeyRef.current !== sessionScopeKey
        ) {
          await stopAgentChat(decision.execution.sessionId).catch(() => false);
          return;
        }
        await executeRendererRequest(decision.execution);
      }
    } catch (approvalError) {
      if (mountedRef.current) {
        setError(approvalError instanceof Error ? approvalError.message : 'Agent 操作确认失败');
      }
    } finally {
      approvalsInFlightRef.current.delete(approval.approvalId);
      if (mountedRef.current) {
        setApprovalBusyIds((current) => {
          const next = new Set(current);
          next.delete(approval.approvalId);
          return next;
        });
      }
    }
  }, [appContext.libraryId, executeRendererRequest, ownerScope, sessionScopeKey]);

  const submitInteraction = React.useCallback(async (
    activity: AgentToolActivitySnapshot,
    response: AgentInteractionResponse,
  ) => {
    const interactionId = activity.interaction?.interactionId;
    const libraryId = Number(appContext.libraryId);
    if (
      !interactionId
      || activity.interaction?.status !== 'pending'
      || interactionsInFlightRef.current.has(interactionId)
      || !ownerScope
      || !Number.isFinite(libraryId)
      || libraryId <= 0
    ) return;

    interactionsInFlightRef.current.add(interactionId);
    setInteractionBusyIds(current => new Set(current).add(interactionId));
    setError(null);
    try {
      const result = await submitAgentInteraction({
        interactionId,
        libraryId,
        ownerScope,
        response,
        runId: activity.runId,
        sessionId: activity.sessionId,
      });
      if (mountedRef.current && sessionScopeKeyRef.current === sessionScopeKey) {
        setToolActivities(current => upsertAgentToolActivity(current, result.activity));
      }
    } catch (interactionError) {
      if (mountedRef.current && sessionScopeKeyRef.current === sessionScopeKey) {
        setError(interactionError instanceof Error
          ? interactionError.message
          : 'Agent 交互回答提交失败');
      }
    } finally {
      interactionsInFlightRef.current.delete(interactionId);
      if (mountedRef.current && sessionScopeKeyRef.current === sessionScopeKey) {
        setInteractionBusyIds((current) => {
          const next = new Set(current);
          next.delete(interactionId);
          return next;
        });
      }
    }
  }, [appContext.libraryId, ownerScope, sessionScopeKey]);

  const reset = React.useCallback(() => {
    if (isStreaming) return;
    preparationTokenRef.current += 1;
    acceptPendingEventsRef.current = false;
    pendingEventsRef.current.clear();
    rendererPreparationsInFlightRef.current.forEach(preparation => preparation.controller.abort());
    rendererPreparationsInFlightRef.current.clear();
    rendererExecutionsInFlightRef.current.forEach(execution => execution.controller.abort());
    rendererExecutionsInFlightRef.current.clear();
    restoringSessionIdRef.current = null;
    streamedContentLengthRef.current.clear();
    sessionIdRef.current = null;
    optimisticMessageIdRef.current = null;
    streamMessageIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    setDraft('');
    setError(null);
    setWarning(null);
    setRuns([]);
    setToolActivities([]);
    setApprovalBusyIds(new Set());
    setInteractionBusyIds(new Set());
    approvalsInFlightRef.current.clear();
    interactionsInFlightRef.current.clear();
    setPreparing(false);
  }, [isStreaming, setPreparing]);

  return {
    draft,
    error,
    isBusy: isPreparing || isStreaming,
    isPreparing,
    isStreaming,
    messages: messages.filter(isAgentMessage),
    runs,
    toolActivities,
    approvalBusyIds,
    interactionBusyIds,
    reset,
    resolveApproval,
    submitInteraction,
    restore,
    sessionId,
    setDraft,
    stop,
    submit,
    warning,
  };
}
