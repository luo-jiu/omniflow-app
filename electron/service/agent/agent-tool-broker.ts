import crypto from 'node:crypto';

import type {
  AgentAppContext,
  AgentOwnerScope,
  AgentPerceptionSnapshot,
  AgentToolExecutionCompletion,
  AgentToolExecutionCommit,
  AgentToolExecutionProgressRequest,
  AgentToolExecutionRequest,
  AgentToolProgress,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import {
  agentToolRegistry,
  type AgentToolDispatchContext,
  type AgentToolRegistrySnapshot,
} from './agent-tool-registry';
import {
  sanitizeAgentSensitiveText,
  sanitizeAgentSensitiveValue,
} from './agent-sensitive-data';

const MAX_TOOL_RESULT_JSON_LENGTH = 100_000;
const DEFAULT_MAIN_EXECUTION_TIMEOUT_MS = 30_000;
const MAX_MAIN_EXECUTION_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const MAIN_CANCELLATION_SETTLE_TIMEOUT_MS = 6_000;
const MIN_RENDERER_EXECUTION_TIMEOUT_MS = 1_000;
const MAX_RENDERER_EXECUTION_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const RENDERER_COMMIT_SETTLE_TIMEOUT_MS = 30_000;

export interface AgentToolExecutionOutcome {
  perception?: AgentPerceptionSnapshot;
  result: AgentToolResult;
}

interface AgentToolRegistryExecutor {
  execute: (
    name: string,
    input: unknown,
    context: AgentToolDispatchContext,
    expectedRegistrationId?: string,
  ) => Promise<AgentToolResult>;
}

interface AgentToolBrokerOptions {
  createId?: () => string;
  normalizePerception?: (
    input: AgentPerceptionSnapshot | undefined,
  ) => AgentPerceptionSnapshot | undefined;
  toolRegistry?: AgentToolRegistryExecutor;
}

interface PrepareRendererExecutionInput {
  appContext: AgentAppContext;
  executionInput: unknown;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  onProgress: (progress: AgentToolProgress) => void;
  onCancel: (executionId: string) => void;
  runId: string;
  sessionId: string;
  signal: AbortSignal;
  timeoutMs: number;
  toolName: string;
}

interface PendingRendererExecution {
  cancel: () => void;
  claimedCapabilities: Set<string>;
  committedResult?: AgentToolResult;
  executionInput: unknown;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  onProgress: (progress: AgentToolProgress) => void;
  markCommitted: (result: AgentToolResult) => void;
  resolve: (outcome: AgentToolExecutionOutcome) => void;
  runId: string;
  sessionId: string;
  signal: AbortSignal;
  toolName: string;
}

export interface ClaimRendererCapabilityInput {
  capability: string;
  executionId: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  runId: string;
  sessionId: string;
}

export interface ClaimedRendererCapability {
  executionInput: unknown;
  onProgress: (progress: AgentToolProgress) => void;
  signal: AbortSignal;
}

function abortError(message = 'Agent 任务已取消'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function sameOwnerScope(left: AgentOwnerScope, right: AgentOwnerScope): boolean {
  return left.accountScope === right.accountScope && left.backendScope === right.backendScope;
}

export function normalizeAgentToolResult(input: AgentToolResult): AgentToolResult {
  const message = input?.message === undefined
    ? undefined
    : sanitizeAgentSensitiveText(String(input.message).slice(0, 2_000));
  let data = input?.data;
  if (data !== undefined) {
    try {
      const sanitized = sanitizeAgentSensitiveValue(data);
      const serialized = JSON.stringify(sanitized);
      data = serialized.length <= MAX_TOOL_RESULT_JSON_LENGTH
        ? JSON.parse(serialized)
        : { truncated: true };
    } catch {
      data = { serializationFailed: true };
    }
  }
  return {
    ...(data !== undefined ? { data } : {}),
    ...(message !== undefined ? { message } : {}),
    ok: input?.ok === true,
  };
}

export function createAgentToolBroker(options: AgentToolBrokerOptions = {}) {
  const createId = options.createId || crypto.randomUUID;
  const toolRegistry = options.toolRegistry || agentToolRegistry;
  const pendingExecutions = new Map<string, PendingRendererExecution>();

  function executeMain(
    name: string,
    input: unknown,
    context: AgentToolDispatchContext,
    timeoutMs = DEFAULT_MAIN_EXECUTION_TIMEOUT_MS,
    runToolRegistry?: AgentToolRegistryExecutor | AgentToolRegistrySnapshot,
  ): Promise<AgentToolResult> {
    const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs, MAX_MAIN_EXECUTION_TIMEOUT_MS));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let cancellationError: Error | undefined;
      let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler();
      };
      const requestCancellation = (error: Error) => {
        if (settled || cancellationError) return;
        cancellationError = error;
        controller.abort();
        cancellationTimer = setTimeout(() => {
          finish(() => reject(error));
        }, MAIN_CANCELLATION_SETTLE_TIMEOUT_MS);
        cancellationTimer.unref?.();
      };
      const handleAbort = () => requestCancellation(abortError());
      const timer = setTimeout(() => {
        requestCancellation(new Error(`工具 ${name} 执行超时`));
      }, boundedTimeoutMs);
      timer.unref?.();
      const cleanup = () => {
        clearTimeout(timer);
        if (cancellationTimer) clearTimeout(cancellationTimer);
        context.signal.removeEventListener('abort', handleAbort);
      };
      if (context.signal.aborted) {
        controller.abort();
        finish(() => reject(abortError()));
        return;
      }
      context.signal.addEventListener('abort', handleAbort, { once: true });
      const executionRegistry = runToolRegistry || toolRegistry;
      const expectedRegistrationId = context.runCapabilitySnapshot
        ?.getTool(name, context.activeSkillId)?.registrationId;
      const executionContext = {
        ...context,
        onProgress: (progress: AgentToolProgress) => {
          if (!settled && !cancellationError) context.onProgress(progress);
        },
        signal: controller.signal,
      };
      void Promise.resolve().then(() => expectedRegistrationId === undefined
        ? executionRegistry.execute(name, input, executionContext)
        : executionRegistry.execute(name, input, executionContext, expectedRegistrationId)
      ).then(
        result => finish(() => resolve(result)),
        error => finish(() => reject(cancellationError || error)),
      );
    });
  }

  function prepareRendererExecution(input: PrepareRendererExecutionInput): {
    outcome: Promise<AgentToolExecutionOutcome>;
    request: AgentToolExecutionRequest;
  } {
    const executionId = createId();
    const timeoutMs = Math.max(
      MIN_RENDERER_EXECUTION_TIMEOUT_MS,
      Math.min(input.timeoutMs, MAX_RENDERER_EXECUTION_TIMEOUT_MS),
    );
    const outcome = new Promise<AgentToolExecutionOutcome>((resolve, reject) => {
      const executionController = new AbortController();
      let settled = false;
      let committedResult: AgentToolResult | undefined;
      let cancellationNotified = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler();
      };
      const notifyCancellation = () => {
        if (cancellationNotified) return;
        cancellationNotified = true;
        input.onCancel(executionId);
      };
      const settleAfterCancellation = (error: Error) => {
        executionController.abort();
        notifyCancellation();
        if (committedResult) {
          finish(() => resolve({ result: committedResult as AgentToolResult }));
          return;
        }
        finish(() => reject(error));
      };
      const handleAbort = () => settleAfterCancellation(abortError());
      const handleTimeout = () => settleAfterCancellation(
        new Error(`工具 ${input.toolName} 执行超时`),
      );
      const scheduleTimeout = (delayMs: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(handleTimeout, delayMs);
        timer.unref?.();
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        input.signal.removeEventListener('abort', handleAbort);
        pendingExecutions.delete(executionId);
      };
      pendingExecutions.set(executionId, {
        cancel: handleAbort,
        claimedCapabilities: new Set(),
        executionInput: input.executionInput,
        libraryId: Number(input.appContext.libraryId),
        ownerScope: input.ownerScope,
        ownerWebContentsId: input.ownerWebContentsId,
        onProgress: input.onProgress,
        markCommitted: (result) => {
          if (settled || committedResult) return;
          committedResult = normalizeAgentToolResult(result);
          const pending = pendingExecutions.get(executionId);
          if (pending) pending.committedResult = committedResult;
          scheduleTimeout(RENDERER_COMMIT_SETTLE_TIMEOUT_MS);
        },
        resolve: value => finish(() => resolve(value)),
        runId: input.runId,
        sessionId: input.sessionId,
        signal: executionController.signal,
        toolName: input.toolName,
      });
      scheduleTimeout(timeoutMs);
      if (input.signal.aborted) handleAbort();
      else input.signal.addEventListener('abort', handleAbort, { once: true });
    });

    return {
      outcome,
      request: {
        appContext: input.appContext,
        executionId,
        input: input.executionInput,
        ownerScope: input.ownerScope,
        runId: input.runId,
        sessionId: input.sessionId,
        toolName: input.toolName,
      },
    };
  }

  function claimRendererCapability(
    ownerWebContentsId: number,
    input: ClaimRendererCapabilityInput,
    expectedToolName: string,
  ): ClaimedRendererCapability {
    const executionId = String(input?.executionId || '').trim();
    const pending = pendingExecutions.get(executionId);
    if (!pending) throw new Error('Agent Tool 执行请求不存在或已经失效');
    const capability = String(input?.capability || '').trim();
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    if (
      !capability
      || pending.ownerWebContentsId !== ownerWebContentsId
      || pending.libraryId !== Number(input.libraryId)
      || pending.runId !== String(input.runId || '')
      || pending.sessionId !== String(input.sessionId || '')
      || pending.toolName !== String(expectedToolName || '').trim()
      || !sameOwnerScope(pending.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权使用该 Agent Tool 能力');
    }
    if (pending.signal.aborted) throw abortError();
    if (pending.claimedCapabilities.has(capability)) {
      throw new Error('Agent Tool 能力已经使用');
    }
    pending.claimedCapabilities.add(capability);
    return {
      executionInput: pending.executionInput,
      onProgress: pending.onProgress,
      signal: pending.signal,
    };
  }

  function reportRendererProgress(
    ownerWebContentsId: number,
    input: AgentToolExecutionProgressRequest,
  ): boolean {
    const executionId = String(input?.executionId || '').trim();
    const pending = pendingExecutions.get(executionId);
    if (!pending) throw new Error('Agent Tool 执行请求不存在或已经失效');
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    if (
      pending.ownerWebContentsId !== ownerWebContentsId
      || pending.libraryId !== Number(input.libraryId)
      || pending.runId !== String(input.runId || '')
      || pending.sessionId !== String(input.sessionId || '')
      || !sameOwnerScope(pending.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权提交该 Agent Tool 进度');
    }
    if (pending.signal.aborted) throw abortError();
    const message = String(input.progress?.message || '').trim().slice(0, 500);
    if (!message) throw new Error('Agent Tool 进度消息不能为空');
    const percentValue = Number(input.progress?.percent);
    pending.onProgress({
      message,
      ...(Number.isFinite(percentValue)
        ? { percent: Math.max(0, Math.min(100, percentValue)) }
        : {}),
    });
    return true;
  }

  function completeRendererExecution(
    ownerWebContentsId: number,
    input: AgentToolExecutionCompletion,
  ): boolean {
    const executionId = String(input?.executionId || '').trim();
    const pending = pendingExecutions.get(executionId);
    if (!pending) throw new Error('Agent Tool 执行请求不存在或已经失效');
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    if (
      pending.ownerWebContentsId !== ownerWebContentsId
      || pending.libraryId !== Number(input.libraryId)
      || pending.runId !== String(input.runId || '')
      || pending.sessionId !== String(input.sessionId || '')
      || !sameOwnerScope(pending.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权提交该 Agent Tool 结果');
    }
    if (pending.signal.aborted && !pending.committedResult) throw abortError();
    pending.resolve({
      perception: options.normalizePerception?.(input.perception),
      result: normalizeAgentToolResult(input.result),
    });
    return true;
  }

  function markRendererExecutionCommitted(
    ownerWebContentsId: number,
    input: AgentToolExecutionCommit,
  ): boolean {
    const executionId = String(input?.executionId || '').trim();
    const pending = pendingExecutions.get(executionId);
    if (!pending) throw new Error('Agent Tool 执行请求不存在或已经失效');
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    if (
      pending.ownerWebContentsId !== ownerWebContentsId
      || pending.libraryId !== Number(input.libraryId)
      || pending.runId !== String(input.runId || '')
      || pending.sessionId !== String(input.sessionId || '')
      || !sameOwnerScope(pending.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权提交该 Agent Tool 写入结果');
    }
    const result = normalizeAgentToolResult(input.result);
    if (!result.ok) throw new Error('Agent Tool 已提交结果必须为成功状态');
    if (pending.committedResult) throw new Error('Agent Tool 写入结果已经提交');
    pending.markCommitted(result);
    return true;
  }

  function releaseOwner(ownerWebContentsId: number): void {
    pendingExecutions.forEach((pending) => {
      if (pending.ownerWebContentsId === ownerWebContentsId) pending.cancel();
    });
  }

  return {
    claimRendererCapability,
    completeRendererExecution,
    executeMain,
    markRendererExecutionCommitted,
    prepareRendererExecution,
    reportRendererProgress,
    releaseOwner,
  };
}

export type AgentToolBroker = ReturnType<typeof createAgentToolBroker>;
