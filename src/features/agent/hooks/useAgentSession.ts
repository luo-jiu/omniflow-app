import React from 'react';

import type {
  AgentAppContext,
  AgentChatStreamEvent,
  AgentMessage,
  AgentOwnerScope,
  AgentReasoningEffort,
} from '@/shared/agent/agent.types';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import {
  getAgentSession,
  startAgentChat,
  stopAgentChat,
  subscribeAgentChat,
} from '../services/agent.api';
import { readAgentPerception } from '../services/agent-context.api';
import {
  appendBufferedAgentEvent,
  reconcileCanonicalAgentRunMessages,
} from '../agent-stream-messages';

interface UseAgentSessionInput {
  appContext: AgentAppContext;
  model: string;
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

export function useAgentSession({
  appContext,
  model,
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
  const ownerScopeKey = serializeAgentOwnerScope(ownerScope);
  const sessionScopeKey = `${ownerScopeKey}\u0000${Number(appContext.libraryId)}`;
  const sessionScopeKeyRef = React.useRef(sessionScopeKey);
  const sessionIdRef = React.useRef<string | null>(null);
  const streamMessageIdRef = React.useRef<string | null>(null);
  const streamedContentLengthRef = React.useRef<Map<string, number>>(new Map());
  const pendingEventsRef = React.useRef<Map<string, AgentChatStreamEvent[]>>(new Map());
  const acceptPendingEventsRef = React.useRef(false);
  const restoringSessionIdRef = React.useRef<string | null>(null);
  const preparationTokenRef = React.useRef(0);
  const isPreparingRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  const setPreparing = React.useCallback((value: boolean) => {
    isPreparingRef.current = value;
    setIsPreparing(value);
  }, []);

  const applyEvent = React.useCallback((event: AgentChatStreamEvent) => {
    if (event.type === 'started') {
      if (!streamedContentLengthRef.current.has(event.runId)) {
        streamedContentLengthRef.current.set(event.runId, 0);
      }
      setIsStreaming(true);
      setError(null);
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
      streamMessageIdRef.current = null;
      const messageId = `agent-tool-${event.runId}-${event.call.id}`;
      setMessages(current => current.some(message => (
        message.runId === event.runId && message.toolCallId === event.call.id
      ))
        ? current
        : [
            ...current,
            {
              content: `正在调用 ${event.call.name}`,
              createdAt: new Date().toISOString(),
              id: messageId,
              role: 'tool',
              runId: event.runId,
              sessionId: event.sessionId,
              toolCallId: event.call.id,
              toolName: event.call.name,
            },
          ]);
      return;
    }
    if (event.type === 'tool-progress') {
      setMessages(current => current.map(message => (
        message.runId === event.runId && message.toolCallId === event.callId
      )
        ? { ...message, content: event.progress.message }
        : message));
      return;
    }
    if (event.type === 'tool-completed') {
      const messageId = `agent-tool-${event.runId}-${event.call.id}`;
      const content = event.result.message
        || (event.result.ok ? `${event.call.name} 已完成` : `${event.call.name} 执行失败`);
      setMessages((current) => {
        const existing = current.some(message => (
          message.runId === event.runId && message.toolCallId === event.call.id
        ));
        if (existing) {
          return current.map(message => (
            message.runId === event.runId && message.toolCallId === event.call.id
          )
            ? { ...message, content }
            : message);
        }
        return [
          ...current,
          {
            content,
            createdAt: new Date().toISOString(),
            id: messageId,
            role: 'tool',
            runId: event.runId,
            sessionId: event.sessionId,
            toolCallId: event.call.id,
            toolName: event.call.name,
          },
        ];
      });
      streamMessageIdRef.current = null;
      return;
    }
    if (event.type === 'completed' || event.type === 'cancelled' || event.type === 'error') {
      const renderedLength = streamedContentLengthRef.current.get(event.runId) || 0;
      const missingContent = event.content.slice(Math.min(renderedLength, event.content.length));
      streamedContentLengthRef.current.set(
        event.runId,
        Math.max(renderedLength, event.content.length),
      );
      setIsStreaming(false);
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
  }, [onSessionChanged]);

  React.useEffect(() => {
    const pendingEvents = pendingEventsRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preparationTokenRef.current += 1;
      acceptPendingEventsRef.current = false;
      restoringSessionIdRef.current = null;
      pendingEvents.clear();
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
    streamedContentLengthRef.current.clear();
    sessionIdRef.current = null;
    streamMessageIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    setDraft('');
    setError(null);
    setWarning(null);
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
      const running = snapshot.lastRunStatus === 'running';
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
      acceptPendingEventsRef.current = false;
      onSessionChanged?.(result.sessionId);
    } catch (submitError) {
      if (preparationTokenRef.current === preparationToken) {
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
    await stopAgentChat(currentSessionId);
  }, [isStreaming]);

  const reset = React.useCallback(() => {
    if (isStreaming) return;
    preparationTokenRef.current += 1;
    acceptPendingEventsRef.current = false;
    pendingEventsRef.current.clear();
    restoringSessionIdRef.current = null;
    streamedContentLengthRef.current.clear();
    sessionIdRef.current = null;
    streamMessageIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    setDraft('');
    setError(null);
    setWarning(null);
    setPreparing(false);
  }, [isStreaming, setPreparing]);

  return {
    draft,
    error,
    isBusy: isPreparing || isStreaming,
    isPreparing,
    isStreaming,
    messages: messages.filter(isAgentMessage),
    reset,
    restore,
    sessionId,
    setDraft,
    stop,
    submit,
    warning,
  };
}
