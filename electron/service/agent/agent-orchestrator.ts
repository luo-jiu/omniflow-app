import crypto from 'node:crypto';
import type { WebContents } from 'electron';

import type {
  AgentAppContext,
  AgentChatRequest,
  AgentChatStartResult,
  AgentChatStreamEvent,
  AgentMessage,
  AgentOwnerScope,
  AgentReasoningEffort,
  AgentSessionCursor,
  AgentSessionPage,
  AgentSessionSnapshot,
  AgentSessionSummary,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { streamAIServiceProfile } from '../aiServiceClient';
import type { AIServiceRuntimeConnection } from '../aiServiceClientModel';
import { aiServiceRunSessionRegistry } from '../aiServiceRunSession';
import { getAIServiceRuntimeProfile } from '../aiServiceStore';
import { streamAgentProviderTurn } from './agent-provider-client';
import type { AgentProviderMessage, AgentProviderToolCall } from './agent-provider-model';
import { getAgentSessionStore } from './agent-session-store-runtime';
import type { AgentSessionStore } from './agent-session-store';
import { agentToolRegistry } from './agent-tool-registry';
import { getBuiltInReadTools } from './tools/file-read-tools';

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 8;

getBuiltInReadTools().forEach((tool) => {
  if (!agentToolRegistry.get(tool.name)) agentToolRegistry.register(tool);
});

const AGENT_SYSTEM_PROMPT = [
  '你是 OmniFlow 内置 Agent。',
  '你负责帮助用户理解当前工作区，并在获得工具能力后组织 OmniFlow 的受控工具流程。',
  '当前阶段只提供当前工作区的只读感知快照，不要声称已经执行命令、修改文件或完成未提供的工具操作。',
  '凡是涉及当前目录内容或节点元数据的事实，必须先调用 file.list 或 file.stat，不要仅根据节点 ID 或名称猜测。',
  '回答要直接、简洁；如果用户要求当前阶段尚未提供的能力，要明确说明限制。',
].join('\n');

interface ActiveAgentRun {
  controller: AbortController;
  ownerWebContentsId: number;
  runId: string;
}

interface StartingAgentRun {
  controller: AbortController;
  ownerWebContentsId: number;
}

interface AgentOrchestratorOptions {
  getRuntimeProfile?: (profileId: string) => AIServiceRuntimeConnection;
  getSessionStore?: () => Promise<AgentSessionStore>;
  runSessionRegistry?: Pick<typeof aiServiceRunSessionRegistry, 'begin' | 'end'>;
}

function now(): string {
  return new Date().toISOString();
}

function normalizeContext(input: AgentAppContext): AgentAppContext {
  const platform = input?.platform === 'darwin'
    || input?.platform === 'win32'
    || input?.platform === 'linux'
    ? input.platform
    : 'unknown';
  const selectedNodeIds = Array.isArray(input?.selectedNodeIds)
    ? Array.from(new Set(input.selectedNodeIds
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)))
    : [];
  const directoryId = Number(input?.currentDirectory?.id);
  return {
    activeToolId: String(input?.activeToolId || '').trim() || undefined,
    currentDirectory: Number.isFinite(directoryId) && directoryId > 0
      ? {
          id: directoryId,
          name: String(input.currentDirectory?.name || '').trim(),
        }
      : undefined,
    libraryId: Number.isFinite(Number(input?.libraryId)) && Number(input.libraryId) > 0
      ? Number(input.libraryId)
      : undefined,
    platform,
    selectedNodeIds,
  };
}

function normalizeReasoningEffort(value: unknown): AgentReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'auto';
}

function buildSystemPrompt(
  context: AgentAppContext,
  perception: AgentChatRequest['perception'],
): string {
  const perceptionScope = perception
    ? '\n\n本轮只读感知范围已经准备好；需要目录或节点事实时调用提供的 Tool。'
    : '\n\n本轮没有可用的文件感知范围，相关问题应明确说明无法读取。';
  return `${AGENT_SYSTEM_PROMPT}\n\n当前应用上下文：\n${JSON.stringify(context)}${perceptionScope}`;
}

function buildFallbackSystemPrompt(
  context: AgentAppContext,
  perception: AgentChatRequest['perception'],
): string {
  const snapshot = perception
    ? `\n\n本轮只读感知快照：\n${JSON.stringify(perception)}`
    : '';
  return `${AGENT_SYSTEM_PROMPT}\n\n当前应用上下文：\n${JSON.stringify(context)}${snapshot}\n\n当前模型不支持 Tool Calling，请直接依据快照回答，不能把未列出的内容当作已知。`;
}

function normalizePerception(
  input: AgentChatRequest['perception'],
): AgentChatRequest['perception'] {
  if (!input || typeof input !== 'object') return undefined;
  const normalizeEntry = (value: unknown) => {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    const id = Number(source.id);
    const name = String(source.name || '').trim();
    if (!Number.isFinite(id) || id <= 0 || !name) return null;
    const type = source.type === 'dir' || source.type === 'file' ? source.type : null;
    if (!type) return null;
    const fileSize = Number(source.fileSize);
    return {
      ...(source.ext ? { ext: String(source.ext).slice(0, 80) } : {}),
      ...(Number.isFinite(fileSize) && fileSize >= 0 ? { fileSize } : {}),
      id,
      ...(source.mimeType ? { mimeType: String(source.mimeType).slice(0, 160) } : {}),
      name: name.slice(0, 500),
      type: type as 'dir' | 'file',
      ...(source.updatedAt ? { updatedAt: String(source.updatedAt).slice(0, 80) } : {}),
    };
  };
  const entries = Array.isArray(input.currentDirectory?.entries)
    ? input.currentDirectory.entries
      .slice(0, 200)
      .map(normalizeEntry)
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeEntry>> => entry !== null)
    : [];
  const selectedNodes = Array.isArray(input.selectedNodes)
    ? input.selectedNodes
      .slice(0, 20)
      .map(normalizeEntry)
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeEntry>> => entry !== null)
    : [];
  const directoryId = Number(input.currentDirectory?.id);
  const directoryName = String(input.currentDirectory?.name || '').trim();
  return {
    ...(Number.isFinite(directoryId) && directoryId > 0 && directoryName
      ? {
          currentDirectory: {
            entryCount: entries.length,
            entries,
            id: directoryId,
            name: directoryName.slice(0, 500),
          },
        }
      : {}),
    selectedNodes,
    collectedAt: String(input.collectedAt || '').slice(0, 80),
  };
}

function createMessage(
  sessionId: string,
  runId: string,
  role: AgentMessage['role'],
  content: string,
  tool?: { callId: string; name: string },
): AgentMessage {
  return {
    content,
    createdAt: now(),
    id: crypto.randomUUID(),
    role,
    runId,
    sessionId,
    ...(tool ? { toolCallId: tool.callId, toolName: tool.name } : {}),
  };
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Agent 任务已取消');
  error.name = 'AbortError';
  throw error;
}

function isToolProtocolUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    /(tools?|functions?).*(unsupported|not supported|does not support|not support|unknown|unrecognized)/.test(message)
    || /(unsupported|not supported|does not support|not support|unknown|unrecognized).*(tools?|functions?)/.test(message)
  );
}

function sessionTitleFromPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function createAgentOrchestrator(options: AgentOrchestratorOptions = {}) {
  const resolveRuntimeProfile = options.getRuntimeProfile || getAIServiceRuntimeProfile;
  const resolveSessionStore = options.getSessionStore || getAgentSessionStore;
  const runSessionRegistry = options.runSessionRegistry || aiServiceRunSessionRegistry;
  const activeRuns = new Map<string, ActiveAgentRun>();
  const startingRuns = new Map<string, StartingAgentRun>();
  const startingSessions = new Set<string>();

  function emit(sender: WebContents, event: AgentChatStreamEvent): void {
    if (!sender.isDestroyed()) {
      sender.send('agent:chat:event', event);
    }
  }

  async function executeToolCall(
    sender: WebContents,
    store: AgentSessionStore,
    sessionId: string,
    runId: string,
    call: AgentProviderToolCall,
    input: AgentChatRequest,
    signal: AbortSignal,
  ): Promise<AgentToolResult> {
    const toolRunId = crypto.randomUUID();
    await store.createToolRun({
      callId: call.id,
      id: toolRunId,
      input: call.input,
      now: now(),
      runId,
      toolName: call.name,
    });
    emit(sender, {
      call: { id: call.id, input: call.input, name: call.name },
      runId,
      sessionId,
      type: 'tool-started',
    });
    await store.updateRun(runId, {
      currentStep: `执行 ${call.name}`,
      status: 'running',
      updatedAt: now(),
    });

    let result: AgentToolResult;
    try {
      if (call.inputError) {
        result = { message: call.inputError, ok: false };
      } else {
        const tool = agentToolRegistry.get(call.name);
        if (!tool) {
          result = { message: `Agent Tool 不存在：${call.name}`, ok: false };
        } else if (tool.risk !== 'read') {
          result = { message: `工具 ${call.name} 需要用户确认，当前阶段尚未开放`, ok: false };
        } else {
          result = await agentToolRegistry.execute(call.name, call.input, {
            appContext: input.appContext,
            onProgress: progress => emit(sender, {
              callId: call.id,
              progress,
              runId,
              sessionId,
              type: 'tool-progress',
            }),
            perception: input.perception,
            signal,
          });
        }
      }
    } catch (error) {
      if (isAbortError(error, signal)) {
        await store.completeToolRun(toolRunId, { message: 'Agent Tool 已取消', ok: false }, now());
        throw error;
      }
      result = {
        message: error instanceof Error ? error.message : `${call.name} 执行失败`,
        ok: false,
      };
    }

    await store.completeToolRun(toolRunId, result, now());
    await store.appendMessage(createMessage(
      sessionId,
      runId,
      'tool',
      result.message || (result.ok ? `${call.name} 已完成` : `${call.name} 执行失败`),
      { callId: call.id, name: call.name },
    ));
    emit(sender, {
      call: { id: call.id, input: call.input, name: call.name },
      result,
      runId,
      sessionId,
      type: 'tool-completed',
    });
    return result;
  }

  async function run(
    sender: WebContents,
    store: AgentSessionStore,
    session: AgentSessionSnapshot,
    runId: string,
    input: AgentChatRequest,
    runtimeConnection: AIServiceRuntimeConnection,
    controller: AbortController,
  ): Promise<void> {
    const sessionId = session.id;
    let content = '';
    let persistedContentLength = 0;
    const persistPendingAssistantContent = async () => {
      const pendingContent = content.slice(persistedContentLength);
      if (!pendingContent) return;
      await store.appendMessage(createMessage(sessionId, runId, 'assistant', pendingContent));
      persistedContentLength = content.length;
    };
    const readCanonicalRunMessages = async (): Promise<AgentMessage[] | undefined> => {
      try {
        const snapshot = await store.getSession(
          sessionId,
          input.ownerScope,
          Number(input.appContext.libraryId),
        );
        return snapshot?.messages.filter(message => message.runId === runId);
      } catch {
        return undefined;
      }
    };
    try {
      const messages: AgentProviderMessage[] = session.messages
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => ({
          content: message.content,
          role: message.role as 'user' | 'assistant',
        }));
      const tools = agentToolRegistry.list();
      const plainMessages = messages.map(message => ({
        content: message.content,
        role: message.role as 'user' | 'assistant',
      }));
      let toolCallCount = 0;
      let completed = false;
      const seenToolCallIds = new Set<string>();

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        await store.updateRun(runId, {
          currentStep: round === 0 ? '请求 AI 服务' : '根据工具结果继续思考',
          status: 'running',
          updatedAt: now(),
        });
        const contentBeforeTurn = content;
        let turn;
        try {
          turn = await streamAgentProviderTurn(runtimeConnection, {
            messages,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            systemPrompt: buildSystemPrompt(input.appContext, input.perception),
            tools,
          }, (delta) => {
            content += delta;
            emit(sender, { delta, runId, sessionId, type: 'delta' });
          }, controller.signal);
        } catch (error) {
          if (round !== 0 || content !== contentBeforeTurn || !isToolProtocolUnsupported(error)) {
            throw error;
          }
          await streamAIServiceProfile({
            messages: plainMessages,
            model: input.model,
            profileId: input.profileId,
            reasoningEffort: input.reasoningEffort,
            systemPrompt: buildFallbackSystemPrompt(input.appContext, input.perception),
          }, (delta) => {
            content += delta;
            emit(sender, { delta, runId, sessionId, type: 'delta' });
          }, runtimeConnection, controller.signal);
          completed = true;
          break;
        }

        const toolCalls = turn.toolCalls.map((call, callIndex) => {
          let id = call.id || `tool-call-${round + 1}-${callIndex + 1}`;
          if (seenToolCallIds.has(id)) id = `${id}-${round + 1}-${callIndex + 1}`;
          seenToolCallIds.add(id);
          return { ...call, id };
        });
        messages.push({
          content: turn.content,
          role: 'assistant',
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        });
        if (toolCalls.length === 0) {
          completed = true;
          break;
        }
        await persistPendingAssistantContent();
        if (round === MAX_TOOL_ROUNDS) {
          throw new Error('Agent 工具调用轮数超过安全上限');
        }

        for (const call of toolCalls) {
          toolCallCount += 1;
          if (toolCallCount > MAX_TOOL_CALLS) {
            throw new Error('Agent 工具调用次数超过安全上限');
          }
          const result = await executeToolCall(
            sender,
            store,
            sessionId,
            runId,
            call,
            input,
            controller.signal,
          );
          messages.push({
            content: JSON.stringify(result),
            name: call.name,
            role: 'tool',
            toolCallId: call.id,
          });
        }
      }

      if (!completed) throw new Error('Agent 未能在安全轮数内完成任务');
      await persistPendingAssistantContent();
      const finishedAt = now();
      await store.updateRun(runId, {
        currentStep: '已完成',
        finishedAt,
        status: 'completed',
        updatedAt: finishedAt,
      });
      emit(sender, {
        content,
        messages: await readCanonicalRunMessages(),
        runId,
        sessionId,
        type: 'completed',
      });
    } catch (error) {
      const finishedAt = now();
      if (isAbortError(error, controller.signal)) {
        await persistPendingAssistantContent();
        await store.updateRun(runId, {
          currentStep: '已取消',
          finishedAt,
          status: 'cancelled',
          updatedAt: finishedAt,
        });
        emit(sender, {
          content,
          messages: await readCanonicalRunMessages(),
          runId,
          sessionId,
          type: 'cancelled',
        });
      } else {
        const message = error instanceof Error ? error.message : 'Agent 请求失败';
        await persistPendingAssistantContent();
        await store.updateRun(runId, {
          currentStep: '执行失败',
          error: message,
          finishedAt,
          status: 'failed',
          updatedAt: finishedAt,
        });
        emit(sender, {
          content,
          message,
          messages: await readCanonicalRunMessages(),
          runId,
          sessionId,
          type: 'error',
        });
      }
    } finally {
      const active = activeRuns.get(sessionId);
      if (active?.runId === runId) activeRuns.delete(sessionId);
      runSessionRegistry.end(runId, sender.id);
    }
  }

  async function start(sender: WebContents, input: AgentChatRequest): Promise<AgentChatStartResult> {
    const userPrompt = String(input?.userPrompt || '').trim();
    const profileId = String(input?.profileId || '').trim();
    const model = String(input?.model || '').trim();
    const reasoningEffort = normalizeReasoningEffort(input?.reasoningEffort);
    if (!userPrompt) throw new Error('请求内容不能为空');
    if (userPrompt.length > 100_000) throw new Error('请求内容过长');
    if (!profileId) throw new Error('请先启用 AI 服务配置');
    if (!model) throw new Error('请先选择模型');

    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    const context = normalizeContext(input.appContext);
    const libraryId = Number(context.libraryId);
    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      throw new Error('当前 Agent 缺少有效的资料库上下文');
    }
    const perception = normalizePerception(input.perception);
    const requestedSessionId = String(input?.sessionId || '').trim();
    if (requestedSessionId && (
      activeRuns.has(requestedSessionId)
      || startingSessions.has(requestedSessionId)
    )) {
      throw new Error('Agent 正在处理上一条消息');
    }

    if (requestedSessionId) startingSessions.add(requestedSessionId);
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    startingRuns.set(runId, {
      controller,
      ownerWebContentsId: sender.id,
    });
    let runSessionStarted = false;
    let createdSession = false;
    let runCreated = false;
    let store: AgentSessionStore | null = null;
    let session: AgentSessionSnapshot | null = null;
    try {
      const runtimeConnection = { ...resolveRuntimeProfile(profileId) };
      runSessionRegistry.begin({
        connection: runtimeConnection,
        ownerWebContentsId: sender.id,
        profileId,
      }, runId);
      runSessionStarted = true;
      store = await resolveSessionStore();
      throwIfAborted(controller.signal);
      session = requestedSessionId
        ? await store.getSession(requestedSessionId, ownerScope, libraryId)
        : null;
      throwIfAborted(controller.signal);
      if (requestedSessionId && !session) {
        throw new Error('Agent 会话不存在或不属于当前资料库');
      }
      const startedAt = now();
      if (!session) {
        session = await store.createSession({
          appContext: context,
          id: crypto.randomUUID(),
          now: startedAt,
          ownerScope,
          title: sessionTitleFromPrompt(userPrompt),
        });
        createdSession = true;
      } else {
        await store.updateSessionContext(session.id, ownerScope, libraryId, context, startedAt);
      }
      throwIfAborted(controller.signal);

      await store.createRun({
        id: runId,
        model,
        now: startedAt,
        profileId,
        reasoningEffort,
        sessionId: session.id,
        userPrompt,
      });
      runCreated = true;
      throwIfAborted(controller.signal);
      session = await store.getSession(session.id, ownerScope, libraryId);
      if (!session) throw new Error('Agent 会话初始化失败');
      throwIfAborted(controller.signal);

      startingRuns.delete(runId);
      activeRuns.set(session.id, {
        controller,
        ownerWebContentsId: sender.id,
        runId,
      });
      emit(sender, { runId, sessionId: session.id, type: 'started' });
      void run(sender, store, session, runId, {
        appContext: context,
        model,
        ownerScope,
        perception,
        profileId,
        reasoningEffort,
        sessionId: session.id,
        userPrompt,
      }, runtimeConnection, controller);
      return { runId, sessionId: session.id };
    } catch (error) {
      if (session && store && isAbortError(error, controller.signal)) {
        if (runCreated) {
          const cancelledAt = now();
          await store.updateRun(runId, {
            currentStep: '已取消',
            finishedAt: cancelledAt,
            status: 'cancelled',
            updatedAt: cancelledAt,
          }).catch(() => undefined);
        } else if (createdSession) {
          await store.deleteSession(session.id, ownerScope, libraryId).catch(() => undefined);
        }
      }
      if (session && activeRuns.get(session.id)?.runId === runId) {
        activeRuns.delete(session.id);
      }
      if (runSessionStarted) runSessionRegistry.end(runId, sender.id);
      throw error;
    } finally {
      startingRuns.delete(runId);
      if (requestedSessionId) startingSessions.delete(requestedSessionId);
    }
  }

  function stop(sessionId: string, ownerWebContentsId: number): boolean {
    const runtime = activeRuns.get(String(sessionId || ''));
    if (!runtime) return false;
    if (runtime.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('当前窗口无权停止该 Agent 会话');
    }
    runtime.controller.abort();
    return true;
  }

  function releaseOwner(ownerWebContentsId: number): void {
    startingRuns.forEach((runtime) => {
      if (runtime.ownerWebContentsId === ownerWebContentsId) {
        runtime.controller.abort();
      }
    });
    activeRuns.forEach((runtime) => {
      if (runtime.ownerWebContentsId === ownerWebContentsId) {
        runtime.controller.abort();
      }
    });
  }

  async function listSessions(
    ownerScope: AgentOwnerScope,
    libraryId: number,
    query = '',
    cursor?: AgentSessionCursor,
  ): Promise<AgentSessionPage> {
    return (await resolveSessionStore()).listSessions(
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      query,
      cursor,
    );
  }

  async function getSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ): Promise<AgentSessionSnapshot> {
    const session = await (await resolveSessionStore()).getSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
    );
    if (!session) throw new Error('Agent 会话不存在或不属于当前资料库');
    return session;
  }

  async function renameSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
    title: string,
  ): Promise<AgentSessionSummary> {
    return (await resolveSessionStore()).renameSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
      title,
      now(),
    );
  }

  async function deleteSession(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ): Promise<boolean> {
    if (activeRuns.has(sessionId) || startingSessions.has(sessionId)) {
      throw new Error('Agent 正在处理消息，暂时不能删除该会话');
    }
    const deleted = await (await resolveSessionStore()).deleteSession(
      sessionId,
      normalizeAgentOwnerScope(ownerScope),
      libraryId,
    );
    if (!deleted) throw new Error('Agent 会话不存在或不属于当前资料库');
    return true;
  }

  return {
    deleteSession,
    getSession,
    listSessions,
    releaseOwner,
    renameSession,
    start,
    stop,
  };
}

export const agentOrchestrator = createAgentOrchestrator();
