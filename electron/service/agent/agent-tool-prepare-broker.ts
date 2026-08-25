import crypto from 'node:crypto';

import type {
  AgentAppContext,
  AgentOwnerScope,
  AgentToolPrepareCompletion,
  AgentToolPrepareRequest,
} from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { sanitizeAgentSensitiveValue } from './agent-sensitive-data';

const DEFAULT_PREPARE_TIMEOUT_MS = 30_000;
const MAX_PREPARE_RESULT_JSON_LENGTH = 64_000;

interface AgentToolPrepareBrokerOptions {
  createId?: () => string;
  timeoutMs?: number;
}

interface PrepareRendererToolInput {
  appContext: AgentAppContext;
  callId: string;
  inputHash: string;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  onCancel: (prepareId: string) => void;
  prepareInput: unknown;
  runId: string;
  sessionId: string;
  signal: AbortSignal;
  toolRunId: string;
  toolName: string;
}

interface PendingPreparation {
  callId: string;
  cancel: () => void;
  inputHash: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  runId: string;
  sessionId: string;
  toolRunId: string;
}

function abortError(): Error {
  const error = new Error('Agent Tool 准备已取消');
  error.name = 'AbortError';
  return error;
}

function sameOwnerScope(left: AgentOwnerScope, right: AgentOwnerScope): boolean {
  return left.accountScope === right.accountScope && left.backendScope === right.backendScope;
}

function normalizePreparationResult(input: unknown): unknown {
  const sanitized = sanitizeAgentSensitiveValue(input);
  const serialized = JSON.stringify(sanitized);
  if (serialized === undefined || serialized.length > MAX_PREPARE_RESULT_JSON_LENGTH) {
    throw new Error('Agent Tool 准备结果超过安全上限');
  }
  return JSON.parse(serialized);
}

export function createAgentToolPrepareBroker(options: AgentToolPrepareBrokerOptions = {}) {
  const createId = options.createId || crypto.randomUUID;
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || DEFAULT_PREPARE_TIMEOUT_MS);
  const pendingPreparations = new Map<string, PendingPreparation>();

  function prepareRenderer(input: PrepareRendererToolInput): {
    outcome: Promise<unknown>;
    request: AgentToolPrepareRequest;
  } {
    if (
      !String(input.callId || '').trim()
      || !String(input.toolRunId || '').trim()
      || !/^[a-f0-9]{64}$/u.test(String(input.inputHash || ''))
    ) {
      throw new Error('Agent Tool 准备身份无效');
    }
    const prepareId = createId();
    const outcome = new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let cancellationNotified = false;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal.removeEventListener('abort', handleAbort);
        pendingPreparations.delete(prepareId);
        handler();
      };
      const notifyCancellation = () => {
        if (cancellationNotified) return;
        cancellationNotified = true;
        input.onCancel(prepareId);
      };
      const handleAbort = () => {
        notifyCancellation();
        finish(() => reject(abortError()));
      };
      const timer = setTimeout(() => {
        notifyCancellation();
        finish(() => reject(new Error(`工具 ${input.toolName} 准备超时`)));
      }, timeoutMs);
      timer.unref?.();
      pendingPreparations.set(prepareId, {
        callId: input.callId,
        cancel: handleAbort,
        inputHash: input.inputHash,
        libraryId: Number(input.appContext.libraryId),
        ownerScope: normalizeAgentOwnerScope(input.ownerScope),
        ownerWebContentsId: input.ownerWebContentsId,
        reject: error => finish(() => reject(error)),
        resolve: result => finish(() => resolve(result)),
        runId: input.runId,
        sessionId: input.sessionId,
        toolRunId: input.toolRunId,
      });
      if (input.signal.aborted) handleAbort();
      else input.signal.addEventListener('abort', handleAbort, { once: true });
    });

    return {
      outcome,
      request: {
        appContext: input.appContext,
        callId: input.callId,
        input: input.prepareInput,
        inputHash: input.inputHash,
        ownerScope: normalizeAgentOwnerScope(input.ownerScope),
        prepareId,
        runId: input.runId,
        sessionId: input.sessionId,
        toolRunId: input.toolRunId,
        toolName: input.toolName,
      },
    };
  }

  function completeRenderer(
    ownerWebContentsId: number,
    input: AgentToolPrepareCompletion,
  ): boolean {
    const prepareId = String(input?.prepareId || '').trim();
    const pending = pendingPreparations.get(prepareId);
    if (!pending) throw new Error('Agent Tool 准备请求不存在或已经失效');
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    if (
      pending.ownerWebContentsId !== ownerWebContentsId
      || pending.callId !== String(input.callId || '')
      || pending.inputHash !== String(input.inputHash || '')
      || pending.libraryId !== Number(input.libraryId)
      || pending.runId !== String(input.runId || '')
      || pending.sessionId !== String(input.sessionId || '')
      || pending.toolRunId !== String(input.toolRunId || '')
      || !sameOwnerScope(pending.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权提交该 Agent Tool 准备结果');
    }
    try {
      pending.resolve(normalizePreparationResult(input.result));
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error('Agent Tool 准备结果无效'));
    }
    return true;
  }

  function releaseOwner(ownerWebContentsId: number): void {
    pendingPreparations.forEach((pending) => {
      if (pending.ownerWebContentsId === ownerWebContentsId) pending.cancel();
    });
  }

  return { completeRenderer, prepareRenderer, releaseOwner };
}

export type AgentToolPrepareBroker = ReturnType<typeof createAgentToolPrepareBroker>;
