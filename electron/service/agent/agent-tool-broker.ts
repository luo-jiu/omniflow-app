import crypto from 'node:crypto';
import { isAgentRendererMutationTool } from '../../../src/shared/agent/agent-library-actions';
import { normalizeAgentLibraryNode } from '../../../src/shared/agent/agent-library-query';
import { normalizeAgentNodeConfigFields } from '../../../src/shared/agent/agent-node-config';

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
  type AgentMainCommitSettlement,
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
const MAX_MAIN_CANCELLATION_SETTLE_TIMEOUT_MS = 90_000;
const MIN_RENDERER_EXECUTION_TIMEOUT_MS = 1_000;
const MAX_RENDERER_EXECUTION_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const RENDERER_COMMIT_SETTLE_TIMEOUT_MS = 30_000;
const MAIN_COMMIT_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  verifyAccess?: () => Promise<void>;
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
  verifyAccess?: () => Promise<void>;
  beginCriticalSettlement: () => void;
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
  beginCriticalSettlement: () => void;
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

/** Add the post-write observation without replacing the acknowledged operation or commit state. */
function settleNodeConfiguration(pending: PendingRendererExecution, executionId: string, result: AgentToolResult): AgentToolResult {
  const committed = pending.committedResult!;
  const original = committed.data as Record<string, unknown> | undefined;
  const final = result.data as Record<string, unknown> | undefined;
  if (!result.ok || original?.mutationCommitState !== 'committed' || final?.mutationCommitState !== 'committed'
    || original.operation !== 'node.configure' || final.operation !== 'node.configure'
    || original.operationId !== executionId || final.operationId !== original.operationId
    || original.libraryId !== pending.libraryId || final.libraryId !== original.libraryId
    || !Number.isSafeInteger(original.nodeId) || Number(original.nodeId) <= 0 || final.nodeId !== original.nodeId) return committed;
  if (final.configVerification === 'unavailable' && final.node === undefined) {
    return { ...committed, ...(result.message ? { message: result.message } : {}) };
  }
  if (!['verified', 'changed'].includes(String(final.configVerification))) return committed;
  try {
    const node = normalizeAgentLibraryNode(final.node, pending.libraryId);
    if (node.id !== original.nodeId || node.type !== 'dir') return committed;
    const config = normalizeAgentNodeConfigFields(node);
    const expected = normalizeAgentNodeConfigFields(original.requestedConfig);
    const matches = config.builtInType !== undefined && config.archiveMode !== undefined
      && config.builtInType === expected.builtInType && config.archiveMode === expected.archiveMode;
    if ((final.configVerification === 'verified') !== matches) return committed;
    const affectedParentIds = Array.isArray(original.affectedParentIds) ? original.affectedParentIds : [];
    return { ...committed, ...(result.message ? { message: result.message } : {}), data: { ...original,
      node, configVerification: final.configVerification,
      affectedParentIds: [...new Set([...affectedParentIds, node.parentId].filter(id => Number.isSafeInteger(id) && Number(id) > 0))],
    } };
  } catch { return committed; }
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

function normalizeMainCommitResult(input: AgentToolResult, operationId?: string): AgentToolResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || !Object.prototype.hasOwnProperty.call(input, 'ok') || typeof input.ok !== 'boolean') {
    throw new Error('无效的 Agent Tool 提交回执');
  }
  const result = normalizeAgentToolResult(input);
  const data = result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('无效的 Agent Tool 提交回执');
  const { mutationCommitState: state, operationId: id } = data as Record<string, unknown>;
  if (typeof id !== 'string' || !MAIN_COMMIT_OPERATION_ID.test(id)
    || (operationId !== undefined && id !== operationId)
    || typeof state !== 'string' || !['committed', 'uncommitted', 'commit_unknown'].includes(state)
    || result.ok !== (state === 'committed')) throw new Error('无效的 Agent Tool 提交回执');
  return result;
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
    cancellationSettleTimeoutMs = MAIN_CANCELLATION_SETTLE_TIMEOUT_MS,
  ): Promise<AgentToolResult> {
    const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs, MAX_MAIN_EXECUTION_TIMEOUT_MS));
    const boundedCancellationSettleTimeoutMs = Math.max(1, Math.min(
      cancellationSettleTimeoutMs,
      MAX_MAIN_CANCELLATION_SETTLE_TIMEOUT_MS,
    ));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let cancellationError: Error | undefined;
      let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let commitFallback: AgentToolResult | undefined;
      let commitReceipt: AgentToolResult | undefined;
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
        if (settled) return;
        if (commitReceipt) {
          finish(() => resolve(commitReceipt as AgentToolResult));
          return;
        }
        cancellationTimer = setTimeout(() => {
          finish(() => commitFallback ? resolve(commitFallback) : reject(error));
        }, boundedCancellationSettleTimeoutMs);
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
      const registeredTool = context.runCapabilitySnapshot?.getTool(name, context.activeSkillId);
      const expectedRegistrationId = registeredTool?.registrationId;
      const computerInput = ['computer.click', 'computer.setText', 'computer.scroll'].includes(name);
      const supportsCommitSettlement = ((!computerInput && (registeredTool?.pluginOperation === 'rename' || registeredTool?.pluginOperation === 'file-output'))
        || (computerInput && registeredTool?.name === name && registeredTool.registrationId === `builtin:${name}@1`
          && registeredTool.kind === 'business' && !registeredTool.pluginSource && !registeredTool.pluginOperation
          && typeof registeredTool.prepareMain === 'function'))
        && registeredTool?.risk === 'write' && registeredTool.executor === 'main';
      const commitSettlement: AgentMainCommitSettlement | undefined = supportsCommitSettlement ? {
        begin: fallback => {
          if (settled || cancellationError || controller.signal.aborted) throw abortError('Agent Tool 提交请求已失效');
          if (commitFallback) throw new Error('Agent Tool 提交已经开始');
          const normalized = normalizeMainCommitResult(fallback);
          if ((normalized.data as Record<string, unknown>).mutationCommitState !== 'commit_unknown') {
            throw new Error('Agent Tool 提交开始必须保留未知回执');
          }
          commitFallback = normalized;
        },
        settle: receipt => {
          if (settled || !commitFallback || commitReceipt) throw new Error('Agent Tool 提交回执不存在或已经结束');
          commitReceipt = normalizeMainCommitResult(receipt, (commitFallback.data as Record<string, unknown>).operationId as string);
          if (cancellationError) finish(() => resolve(commitReceipt as AgentToolResult));
        },
      } : undefined;
      const executionContext: AgentToolDispatchContext = {
        ...context,
        // This fresh main-owned closure never inherits authority from an upstream context.
        commitSettlement,
        onProgress: (progress: AgentToolProgress) => {
          if (!settled && !cancellationError) context.onProgress(progress);
        },
        signal: controller.signal,
      };
      void Promise.resolve().then(() => expectedRegistrationId === undefined
        ? executionRegistry.execute(name, input, executionContext)
        : executionRegistry.execute(name, input, executionContext, expectedRegistrationId)
      ).then(
        result => finish(() => (
          commitReceipt || commitFallback ? resolve((commitReceipt || commitFallback) as AgentToolResult)
            : cancellationError ? reject(cancellationError) : resolve(result)
        )),
        error => finish(() => commitReceipt || commitFallback
          ? resolve((commitReceipt || commitFallback) as AgentToolResult) : reject(cancellationError || error)),
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
      let cancellationError: Error | undefined;
      let criticalSettlement = false;
      let cancellationNotified = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        executionController.abort();
        cleanup();
        handler();
      };
      const notifyCancellation = () => {
        if (cancellationNotified) return;
        cancellationNotified = true;
        input.onCancel(executionId);
      };
      const settleAfterCancellation = (error: Error) => {
        if (settled || cancellationError) return;
        cancellationError = error;
        executionController.abort();
        notifyCancellation();
        if (committedResult) {
          finish(() => resolve({ result: committedResult as AgentToolResult }));
          return;
        }
        if (criticalSettlement) {
          scheduleTimeout(RENDERER_COMMIT_SETTLE_TIMEOUT_MS, finishCriticalSettlement);
          return;
        }
        finish(() => reject(error));
      };
      const handleAbort = () => settleAfterCancellation(abortError());
      const handleTimeout = () => settleAfterCancellation(
        new Error(`工具 ${input.toolName} 执行超时`),
      );
      const finishCriticalSettlement = () => {
        if (settled) return;
        if (committedResult) {
          finish(() => resolve({ result: committedResult as AgentToolResult }));
          return;
        }
        finish(() => reject(cancellationError || new Error(
          `工具 ${input.toolName} 提交状态确认超时`,
        )));
      };
      const scheduleTimeout = (delayMs: number, handler = handleTimeout) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(handler, delayMs);
        timer.unref?.();
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        input.signal.removeEventListener('abort', handleAbort);
        pendingExecutions.delete(executionId);
      };
      pendingExecutions.set(executionId, {
        beginCriticalSettlement: () => {
          if (settled) throw new Error('Agent Tool 执行请求不存在或已经失效');
          criticalSettlement = true;
        },
        cancel: handleAbort,
        claimedCapabilities: new Set(),
        verifyAccess: input.verifyAccess,
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
          if (cancellationError) {
            finish(() => resolve({ result: committedResult as AgentToolResult }));
            return;
          }
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
        ...(input.verifyAccess ? { requireAccessCheck: true } : {}),
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
      beginCriticalSettlement: pending.beginCriticalSettlement,
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
    if (input.phase !== undefined) {
      if (input.phase !== 'committing' || !isAgentRendererMutationTool(pending.toolName)) {
        throw new Error('该工具不支持提交阶段通知');
      }
      pending.beginCriticalSettlement();
    }
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
    const result = normalizeAgentToolResult(input.result);
    const data = result.data as { writeCommitState?: string; deleteCommitState?: string; mutationCommitState?: string } | undefined;
    const state = pending.toolName === 'file.delete' ? data?.deleteCommitState : pending.toolName === 'file.write' ? data?.writeCommitState : data?.mutationCommitState;
    const writeSettled = isAgentRendererMutationTool(pending.toolName) && !result.ok
      && (state === 'uncommitted' || state === 'commit_unknown');
    if (pending.signal.aborted && !pending.committedResult && !writeSettled) throw abortError();
    const committedResult = pending.committedResult && pending.toolName === 'node.configure'
      ? settleNodeConfiguration(pending, executionId, result)
      : pending.committedResult && isAgentRendererMutationTool(pending.toolName) && result.ok && result.message
        ? { ...pending.committedResult, message: result.message } : pending.committedResult;
    pending.resolve({
      perception: options.normalizePerception?.(input.perception),
      result: committedResult || result,
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

  async function verifyRendererAccess(ownerWebContentsId: number, input: Omit<AgentToolExecutionCommit, 'result'>): Promise<boolean> {
    const pending = pendingExecutions.get(input.executionId);
    if (!pending || pending.ownerWebContentsId !== ownerWebContentsId || pending.libraryId !== input.libraryId
      || pending.runId !== input.runId || pending.sessionId !== input.sessionId
      || !sameOwnerScope(pending.ownerScope, normalizeAgentOwnerScope(input.ownerScope))) throw new Error('文件访问校验请求已失效');
    pending.signal.throwIfAborted();
    await pending.verifyAccess?.();
    pending.signal.throwIfAborted();
    return true;
  }

  function releaseOwner(ownerWebContentsId: number): void {
    pendingExecutions.forEach((pending) => {
      if (pending.ownerWebContentsId === ownerWebContentsId) pending.cancel();
    });
  }

  return {
    verifyRendererAccess,
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
