import crypto from 'node:crypto';
import type { WebContents } from 'electron';

import type {
  AgentAppContext,
  AgentChatRequest,
  AgentChatStartResult,
  AgentChatStreamEvent,
  AgentMediaArtifactReleaseRequest,
  AgentMediaAudioExtractionRequest,
  AgentMediaAudioExtractionResult,
  AgentMessage,
  AgentMediaInspectionRequest,
  AgentOwnerScope,
  AgentReasoningEffort,
  AgentSessionCursor,
  AgentSessionPage,
  AgentSessionSnapshot,
  AgentSessionSummary,
  AgentToolApprovalDecisionRequest,
  AgentToolApprovalDecisionResult,
  AgentToolExecutionCompletion,
  AgentToolExecutionCommit,
  AgentToolExecutionProgressRequest,
  AgentToolApprovalSnapshot,
  AgentToolProgress,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { streamAIServiceProfile } from '../aiServiceClient';
import type { AIServiceRuntimeConnection } from '../aiServiceClientModel';
import { aiServiceRunSessionRegistry } from '../aiServiceRunSession';
import { getAIServiceRuntimeProfile } from '../aiServiceStore';
import { streamAgentProviderTurn } from './agent-provider-client';
import type { AgentProviderMessage, AgentProviderToolCall } from './agent-provider-model';
import { buildAgentFallbackSystemPrompt, buildAgentSystemPrompt } from './agent-prompt-assembler';
import { extractAgentMediaAudio } from './agent-media-audio-extractor';
import { agentMediaArtifactStore, type AgentMediaArtifactStore } from './agent-media-artifact-store';
import { inspectAgentMediaSource } from './agent-media-inspector';
import { assessAgentToolPermission } from './agent-permission-gate';
import { getAgentSessionStore } from './agent-session-store-runtime';
import type { AgentSessionStore } from './agent-session-store';
import {
  createAgentToolBroker,
  type AgentToolBroker,
  type AgentToolExecutionOutcome,
} from './agent-tool-broker';
import {
  agentToolRegistry,
  type AgentToolExecutionContext,
  type AgentToolExecutor,
} from './agent-tool-registry';
import { getBuiltInActionTools } from './tools/directory-create-tool';
import { getBuiltInReadTools } from './tools/file-read-tools';
import {
  mediaExtractAudioTool,
  normalizeAgentAudioOutputFormat,
} from './tools/media-extract-audio-tool';
import { mediaInspectTool } from './tools/media-inspect-tool';

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 8;
const TOOL_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

[...getBuiltInReadTools(), mediaInspectTool, mediaExtractAudioTool, ...getBuiltInActionTools()].forEach((tool) => {
  if (!agentToolRegistry.get(tool.name)) agentToolRegistry.register(tool);
});

interface ActiveAgentRun {
  controller: AbortController;
  ownerWebContentsId: number;
  runId: string;
}

interface StartingAgentRun {
  controller: AbortController;
  ownerWebContentsId: number;
}

type AgentApprovalOutcome =
  | { approved: false }
  | { approved: true; execution?: Promise<AgentToolExecutionOutcome> };

interface PendingAgentApproval {
  appContext: AgentAppContext;
  approval: AgentToolApprovalSnapshot;
  executor: AgentToolExecutor;
  executionInput: unknown;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  onProgress: (progress: AgentToolProgress) => void;
  onCancel: (executionId: string) => void;
  resolve: (outcome: AgentApprovalOutcome) => void;
  signal: AbortSignal;
  store: AgentSessionStore;
  timeoutMs: number;
}

interface AgentOrchestratorOptions {
  approvalTimeoutMs?: number;
  extractMediaAudio?: typeof extractAgentMediaAudio;
  getRuntimeProfile?: (profileId: string) => AIServiceRuntimeConnection;
  getSessionStore?: () => Promise<AgentSessionStore>;
  inspectMediaSource?: typeof inspectAgentMediaSource;
  mediaArtifactStore?: Pick<AgentMediaArtifactStore, 'release' | 'releaseOwner' | 'releaseRun'>
    & Partial<Pick<AgentMediaArtifactStore, 'touchExecution'>>;
  runSessionRegistry?: Pick<typeof aiServiceRunSessionRegistry, 'begin' | 'end'>;
  toolBroker?: AgentToolBroker;
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

function hashToolInput(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function sameOwnerScope(left: AgentOwnerScope, right: AgentOwnerScope): boolean {
  return left.accountScope === right.accountScope && left.backendScope === right.backendScope;
}

function abortError(message = 'Agent 任务已取消'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function createAgentOrchestrator(options: AgentOrchestratorOptions = {}) {
  const resolveRuntimeProfile = options.getRuntimeProfile || getAIServiceRuntimeProfile;
  const resolveSessionStore = options.getSessionStore || getAgentSessionStore;
  const runSessionRegistry = options.runSessionRegistry || aiServiceRunSessionRegistry;
  const inspectMediaSource = options.inspectMediaSource || inspectAgentMediaSource;
  const extractMediaAudioSource = options.extractMediaAudio || extractAgentMediaAudio;
  const mediaArtifactStore = options.mediaArtifactStore || agentMediaArtifactStore;
  const approvalTimeoutMs = Math.max(1, options.approvalTimeoutMs || TOOL_APPROVAL_TIMEOUT_MS);
  const toolBroker = options.toolBroker || createAgentToolBroker({ normalizePerception });
  const activeRuns = new Map<string, ActiveAgentRun>();
  const startingRuns = new Map<string, StartingAgentRun>();
  const startingSessions = new Set<string>();
  const pendingApprovals = new Map<string, PendingAgentApproval>();

  function emit(sender: WebContents, event: AgentChatStreamEvent): void {
    if (!sender.isDestroyed()) {
      sender.send('agent:chat:event', event);
    }
  }

  function waitForApproval(input: {
    appContext: AgentAppContext;
    approval: AgentToolApprovalSnapshot;
    executor: AgentToolExecutor;
    executionInput: unknown;
    ownerScope: AgentOwnerScope;
    ownerWebContentsId: number;
    onProgress: (progress: AgentToolProgress) => void;
    onCancel: (executionId: string) => void;
    signal: AbortSignal;
    store: AgentSessionStore;
    timeoutMs: number;
  }): Promise<AgentApprovalOutcome> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler();
      };
      const handleAbort = () => {
        void input.store.resolveToolApproval(
          input.approval.approvalId,
          'cancelled',
          now(),
        ).catch(() => undefined);
        finish(() => reject(abortError()));
      };
      const timer = setTimeout(() => {
        void input.store.resolveToolApproval(
          input.approval.approvalId,
          'expired',
          now(),
        ).catch(() => undefined);
        finish(() => reject(new Error('用户确认已超时')));
      }, approvalTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        input.signal.removeEventListener('abort', handleAbort);
        pendingApprovals.delete(input.approval.approvalId);
      };
      pendingApprovals.set(input.approval.approvalId, {
        ...input,
        resolve: outcome => finish(() => resolve(outcome)),
      });
      if (input.signal.aborted) handleAbort();
      else input.signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  async function resolveToolApproval(
    ownerWebContentsId: number,
    input: AgentToolApprovalDecisionRequest,
  ): Promise<AgentToolApprovalDecisionResult> {
    const approvalId = String(input?.approvalId || '').trim();
    const pending = pendingApprovals.get(approvalId);
    if (!pending) throw new Error('Agent 确认请求不存在或已经失效');
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    if (
      pending.ownerWebContentsId !== ownerWebContentsId
      || pending.approval.runId !== String(input.runId || '')
      || pending.approval.sessionId !== String(input.sessionId || '')
      || Number(pending.appContext.libraryId) !== Number(input.libraryId)
      || !sameOwnerScope(pending.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权处理该 Agent 确认请求');
    }
    if (pending.signal.aborted) throw abortError();

    const approved = input.approved === true;
    await pending.store.resolveToolApproval(approvalId, approved ? 'approved' : 'denied', now());
    await pending.store.updateRun(pending.approval.runId, {
      currentStep: approved ? `执行 ${pending.approval.call.name}` : '用户已取消操作',
      status: 'running',
      updatedAt: now(),
    });

    if (!approved) {
      pending.resolve({ approved: false });
      return { approved: false };
    }

    if (pending.executor !== 'renderer') {
      pending.resolve({ approved: true });
      return { approved: true };
    }

    const execution = toolBroker.prepareRendererExecution({
      appContext: pending.appContext,
      executionInput: pending.executionInput,
      ownerScope: pending.ownerScope,
      ownerWebContentsId: pending.ownerWebContentsId,
      onProgress: pending.onProgress,
      onCancel: pending.onCancel,
      runId: pending.approval.runId,
      sessionId: pending.approval.sessionId,
      signal: pending.signal,
      timeoutMs: pending.timeoutMs,
      toolName: pending.approval.call.name,
    });
    pending.resolve({ approved: true, execution: execution.outcome });
    return { approved: true, execution: execution.request };
  }

  function completeToolExecution(
    ownerWebContentsId: number,
    input: AgentToolExecutionCompletion,
  ): boolean {
    return toolBroker.completeRendererExecution(ownerWebContentsId, input);
  }

  function markToolExecutionCommitted(
    ownerWebContentsId: number,
    input: AgentToolExecutionCommit,
  ): boolean {
    return toolBroker.markRendererExecutionCommitted(ownerWebContentsId, input);
  }

  function reportToolExecutionProgress(
    ownerWebContentsId: number,
    input: AgentToolExecutionProgressRequest,
  ): boolean {
    const reported = toolBroker.reportRendererProgress(ownerWebContentsId, input);
    mediaArtifactStore.touchExecution?.({
      executionId: String(input?.executionId || ''),
      ownerWebContentsId,
      runId: String(input?.runId || ''),
      sessionId: String(input?.sessionId || ''),
    });
    return reported;
  }

  function normalizeMediaSourceUrl(input: unknown): string {
    const sourceUrl = String(input || '').trim();
    if (!sourceUrl || sourceUrl.length > 16 * 1024) throw new Error('媒体临时访问链接无效');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      throw new Error('媒体临时访问链接无效');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('媒体临时访问链接仅支持 HTTP(S)');
    }
    return sourceUrl;
  }

  async function inspectMedia(
    ownerWebContentsId: number,
    input: AgentMediaInspectionRequest,
  ): Promise<AgentToolResult> {
    const capability = toolBroker.claimRendererCapability(ownerWebContentsId, {
      capability: 'media.inspect.source',
      executionId: input?.executionId,
      libraryId: Number(input?.libraryId),
      ownerScope: input?.ownerScope,
      runId: input?.runId,
      sessionId: input?.sessionId,
    }, 'media.inspect');
    if (!capability.executionInput || typeof capability.executionInput !== 'object') {
      throw new Error('媒体检查执行参数无效');
    }
    const executionInput = capability.executionInput as Record<string, unknown>;
    const nodeId = Number(executionInput.nodeId);
    const fileName = String(executionInput.fileName || '').trim();
    const libraryId = Number(executionInput.libraryId);
    if (
      !Number.isFinite(nodeId)
      || nodeId <= 0
      || !fileName
      || libraryId !== Number(input.libraryId)
      || nodeId !== Number(input.nodeId)
      || fileName !== String(input.fileName || '').trim()
    ) {
      throw new Error('媒体检查目标与受权节点不匹配');
    }
    const sourceUrl = normalizeMediaSourceUrl(input.sourceUrl);
    return inspectMediaSource({
      fileName,
      ...(executionInput.mimeType ? { mimeType: String(executionInput.mimeType) } : {}),
      nodeId,
      sourceUrl,
    }, capability.signal);
  }

  async function extractMediaAudio(
    ownerWebContentsId: number,
    input: AgentMediaAudioExtractionRequest,
  ): Promise<AgentMediaAudioExtractionResult> {
    const capability = toolBroker.claimRendererCapability(ownerWebContentsId, {
      capability: 'media.extractAudio.source',
      executionId: input?.executionId,
      libraryId: Number(input?.libraryId),
      ownerScope: input?.ownerScope,
      runId: input?.runId,
      sessionId: input?.sessionId,
    }, 'media.extractAudio');
    if (!capability.executionInput || typeof capability.executionInput !== 'object') {
      throw new Error('音频提取执行参数无效');
    }
    const executionInput = capability.executionInput as Record<string, unknown>;
    const nodeId = Number(executionInput.nodeId);
    const fileName = String(executionInput.sourceFileName || '').trim();
    const outputFileName = String(executionInput.outputFileName || '').trim();
    const outputFormat = normalizeAgentAudioOutputFormat({
      format: executionInput.outputFormat,
    });
    const libraryId = Number(executionInput.libraryId);
    if (
      !Number.isFinite(nodeId)
      || nodeId <= 0
      || !fileName
      || !outputFileName
      || libraryId !== Number(input.libraryId)
      || nodeId !== Number(input.nodeId)
      || fileName !== String(input.fileName || '').trim()
      || outputFileName !== String(input.outputFileName || '').trim()
      || outputFormat !== input.outputFormat
    ) {
      throw new Error('音频提取目标与受权节点不匹配');
    }
    return extractMediaAudioSource({
      executionId: input.executionId,
      fileName,
      ...(executionInput.mimeType ? { mimeType: String(executionInput.mimeType) } : {}),
      outputFileName,
      outputFormat,
      ownerWebContentsId,
      runId: input.runId,
      sessionId: input.sessionId,
      sourceUrl: normalizeMediaSourceUrl(input.sourceUrl),
    }, capability.signal, capability.onProgress);
  }

  async function releaseMediaArtifact(
    ownerWebContentsId: number,
    input: AgentMediaArtifactReleaseRequest,
  ): Promise<boolean> {
    return mediaArtifactStore.release(String(input?.artifactId || ''), {
      executionId: String(input?.executionId || ''),
      ownerWebContentsId,
      runId: String(input?.runId || ''),
      sessionId: String(input?.sessionId || ''),
    });
  }

  async function executeToolCall(
    sender: WebContents,
    store: AgentSessionStore,
    sessionId: string,
    runId: string,
    call: AgentProviderToolCall,
    input: AgentChatRequest,
    signal: AbortSignal,
    perception: AgentChatRequest['perception'],
    onPerception: (next: AgentChatRequest['perception']) => void,
  ): Promise<AgentToolResult> {
    const toolRunId = crypto.randomUUID();
    const tool = agentToolRegistry.get(call.name);
    const executionContext: AgentToolExecutionContext = {
      appContext: input.appContext,
      onProgress: progress => emit(sender, {
        callId: call.id,
        progress,
        runId,
        sessionId,
        type: 'tool-progress',
      }),
      perception,
      signal,
    };
    const cancelRendererExecution = (executionId: string) => emit(sender, {
      executionId,
      runId,
      sessionId,
      type: 'tool-execution-cancelled',
    });
    let decision = call.inputError
      ? { behavior: 'deny' as const, message: call.inputError, risk: tool?.risk || 'read' as const }
      : tool
        ? await assessAgentToolPermission(tool, call.input, executionContext)
        : {
            behavior: 'deny' as const,
            message: `Agent Tool 不存在：${call.name}`,
            risk: 'read' as const,
          };
    let rendererExecutionInput: unknown;
    if (
      decision.behavior !== 'deny'
      && (tool?.executor || 'main') === 'renderer'
    ) {
      if (!tool?.createRendererRequest) {
        decision = {
          behavior: 'deny',
          message: `工具 ${call.name} 缺少 Renderer 执行契约`,
          risk: tool?.risk || 'write',
        };
      } else {
        try {
          rendererExecutionInput = tool.createRendererRequest(call.input, executionContext);
        } catch (error) {
          decision = {
            behavior: 'deny',
            message: error instanceof Error ? error.message : `${call.name} 执行参数无效`,
            risk: tool.risk,
          };
        }
      }
    }
    const approvalId = decision.behavior === 'ask' ? crypto.randomUUID() : undefined;
    await store.createToolRun({
      ...(approvalId ? { approvalId } : {}),
      ...(decision.behavior === 'ask'
        ? {
            approvalInputHash: hashToolInput(call.input),
            approvalPreview: decision.preview,
          }
        : {}),
      callId: call.id,
      id: toolRunId,
      input: call.input,
      now: now(),
      permissionBehavior: decision.behavior,
      runId,
      status: decision.behavior === 'ask' ? 'awaiting_approval' : 'running',
      toolName: call.name,
    });
    emit(sender, {
      call: { id: call.id, input: call.input, name: call.name },
      runId,
      sessionId,
      type: 'tool-started',
    });
    await store.updateRun(runId, {
      currentStep: decision.behavior === 'ask'
        ? `等待确认 ${call.name}`
        : `执行 ${call.name}`,
      status: decision.behavior === 'ask' ? 'awaiting_approval' : 'running',
      updatedAt: now(),
    });

    let result: AgentToolResult;
    try {
      if (decision.behavior === 'deny') {
        result = { message: decision.message, ok: false };
      } else if (!tool) {
        result = { message: `Agent Tool 不存在：${call.name}`, ok: false };
      } else if (decision.behavior === 'ask' && approvalId) {
        const approval: AgentToolApprovalSnapshot = {
          approvalId,
          call: { id: call.id, input: call.input, name: call.name },
          preview: decision.preview,
          runId,
          sessionId,
        };
        const approvalResult = waitForApproval({
          appContext: input.appContext,
          approval,
          executor: tool.executor || 'main',
          executionInput: rendererExecutionInput,
          ownerScope: input.ownerScope,
          ownerWebContentsId: sender.id,
          onProgress: executionContext.onProgress,
          onCancel: cancelRendererExecution,
          signal,
          store,
          timeoutMs: Math.max(1_000, tool.timeoutMs || 30_000),
        });
        emit(sender, {
          approval,
          runId,
          sessionId,
          type: 'tool-approval-required',
        });
        const approved = await approvalResult;
        emit(sender, {
          approvalId,
          approved: approved.approved,
          runId,
          sessionId,
          type: 'tool-approval-resolved',
        });
        if (!approved.approved) {
          result = { message: `用户取消了 ${decision.preview.title}`, ok: false };
        } else if ((tool.executor || 'main') === 'renderer') {
          if (!approved.execution) throw new Error(`工具 ${call.name} 缺少 Renderer 执行请求`);
          const outcome = await approved.execution;
          if (outcome.perception) onPerception(outcome.perception);
          result = outcome.result;
        } else {
          result = await toolBroker.executeMain(call.name, call.input, {
            ...executionContext,
            perception,
          }, tool.timeoutMs);
        }
      } else if ((tool.executor || 'main') === 'renderer') {
        const execution = toolBroker.prepareRendererExecution({
          appContext: input.appContext,
          executionInput: rendererExecutionInput,
          ownerScope: input.ownerScope,
          ownerWebContentsId: sender.id,
          onProgress: executionContext.onProgress,
          onCancel: cancelRendererExecution,
          runId,
          sessionId,
          signal,
          timeoutMs: Math.max(1_000, tool.timeoutMs || 30_000),
          toolName: call.name,
        });
        emit(sender, {
          execution: execution.request,
          runId,
          sessionId,
          type: 'tool-execution-requested',
        });
        const outcome = await execution.outcome;
        if (outcome.perception) onPerception(outcome.perception);
        result = outcome.result;
      } else {
        result = await toolBroker.executeMain(
          call.name,
          call.input,
          executionContext,
          tool.timeoutMs,
        );
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
      const capabilities = tools.map(tool => tool.name);
      const plainMessages = messages.map(message => ({
        content: message.content,
        role: message.role as 'user' | 'assistant',
      }));
      let toolCallCount = 0;
      let completed = false;
      let currentPerception = input.perception;
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
            systemPrompt: buildAgentSystemPrompt(
              input.appContext,
              currentPerception,
              capabilities,
            ),
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
            systemPrompt: buildAgentFallbackSystemPrompt(input.appContext, currentPerception),
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
            currentPerception,
            (nextPerception) => {
              currentPerception = nextPerception;
            },
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
      await mediaArtifactStore.releaseRun(runId).catch(() => undefined);
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
    toolBroker.releaseOwner(ownerWebContentsId);
    void mediaArtifactStore.releaseOwner(ownerWebContentsId);
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
    completeToolExecution,
    deleteSession,
    extractMediaAudio,
    getSession,
    inspectMedia,
    listSessions,
    markToolExecutionCommitted,
    releaseMediaArtifact,
    releaseOwner,
    renameSession,
    reportToolExecutionProgress,
    resolveToolApproval,
    start,
    stop,
  };
}

export const agentOrchestrator = createAgentOrchestrator();
