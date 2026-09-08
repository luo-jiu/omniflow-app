import crypto from 'node:crypto';
import type { WebContents } from 'electron';

import type {
  AgentFileAuthorityCompletionV1,
  AgentFileAuthorityRequestV1,
  AgentFileAuthorityResultV1,
  AgentOwnerScope,
} from '@/shared/agent/agent.types';
import { normalizeAgentLibraryDirectoryPath } from '../../../src/shared/agent/agent-library-path';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { normalizeAgentLibraryReadResult } from '../../../src/shared/agent/agent-library-query';

const DEFAULT_TIMEOUT_MS = 30_000;

interface AgentFileAuthorityBrokerOptions {
  createId?: () => string;
  timeoutMs?: number;
}

const COMPLETION_FIELDS = [
  'authorityId',
  'error',
  'libraryId',
  'ownerScope',
  'result',
  'runId',
  'sessionId',
  'toolRunId',
  'version',
] as const;
const OWNER_SCOPE_FIELDS = ['accountScope', 'backendScope'] as const;

type AgentFileAuthorityRequestBaseKeys = keyof AgentFileAuthorityRequestBase;
type AgentFileAuthorityOperationInput =
  | Omit<Extract<AgentFileAuthorityRequestV1, { operation: 'query-library-metadata' }>, AgentFileAuthorityRequestBaseKeys>
  | Omit<Extract<AgentFileAuthorityRequestV1, { operation: 'stage-library-node' }>, AgentFileAuthorityRequestBaseKeys>
  | Omit<Extract<AgentFileAuthorityRequestV1, { operation: 'resolve-library-directory' }>, AgentFileAuthorityRequestBaseKeys>
  | Omit<Extract<AgentFileAuthorityRequestV1, { operation: 'publish-library-file' }>, AgentFileAuthorityRequestBaseKeys>;

export interface AgentFileAuthorityBrokerRequestInput {
  libraryId: number;
  operation: AgentFileAuthorityOperationInput;
  ownerScope: AgentOwnerScope;
  runId: string;
  sender: WebContents;
  sessionId: string;
  signal: AbortSignal;
  toolRunId: string;
}

type AgentFileAuthorityRequestBase = Pick<
  AgentFileAuthorityRequestV1,
  'authorityId' | 'libraryId' | 'ownerScope' | 'runId' | 'sessionId' | 'toolRunId' | 'version'
>;

interface PendingAuthority {
  cancel: () => void;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  operation: AgentFileAuthorityRequestV1['operation'];
  reject: (error: Error) => void;
  resolve: (result: AgentFileAuthorityResultV1) => void;
  runId: string;
  sessionId: string;
  toolRunId: string;
}

function strictObject(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label}无效`);
  }
  const source = input as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label}无效`);
  return source;
}

function exactKeys(source: Record<string, unknown>, allowed: readonly string[]): void {
  const fields = new Set(allowed);
  if (Object.keys(source).some(key => !fields.has(key))) {
    throw new Error('Agent 资料库文件授权结果包含未知字段');
  }
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} 无效`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\0\r\n]/u.test(normalized)) {
    throw new Error(`${label} 无效`);
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string, allowZero = false): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)
  ) {
    throw new Error(`${label} 无效`);
  }
  return value;
}

function normalizeNode(input: unknown) {
  const source = strictObject(input, 'Agent 资料库节点');
  exactKeys(source, [
    'ext', 'fileSize', 'id', 'libraryId', 'mimeType', 'name', 'parentId',
    'storageKey', 'storageProvider', 'type', 'updatedAt', 'version',
  ]);
  if (source.version !== 1 || (source.type !== 'dir' && source.type !== 'file')) {
    throw new Error('Agent 资料库节点无效');
  }
  return Object.freeze({
    ...(source.ext === undefined ? {} : { ext: boundedString(source.ext, '文件扩展名', 80) }),
    fileSize: positiveInteger(source.fileSize, '文件大小', true),
    id: positiveInteger(source.id, '节点 ID'),
    libraryId: positiveInteger(source.libraryId, '资料库 ID'),
    ...(source.mimeType === undefined
      ? {}
      : { mimeType: boundedString(source.mimeType, '内容类型', 256) }),
    name: boundedString(source.name, '节点名称', 512),
    parentId: positiveInteger(source.parentId, '父节点 ID', true),
    ...(source.storageKey === undefined
      ? {}
      : { storageKey: boundedString(source.storageKey, '存储对象身份', 2_048) }),
    ...(source.storageProvider === undefined
      ? {}
      : { storageProvider: boundedString(source.storageProvider, '存储服务', 256) }),
    type: source.type,
    ...(source.updatedAt === undefined
      ? {}
      : { updatedAt: boundedString(source.updatedAt, '节点更新时间', 100) }),
    version: 1 as const,
  });
}

function normalizeResult(
  input: unknown,
  expectedOperation: AgentFileAuthorityRequestV1['operation'],
  expectedLibraryId: number,
): AgentFileAuthorityResultV1 {
  const source = strictObject(input, 'Agent 资料库文件授权结果');
  if (source.version !== 1 || source.operation !== expectedOperation) {
    throw new Error('Agent 资料库文件授权结果类型不匹配');
  }
  if (expectedOperation === 'query-library-metadata') {
    exactKeys(source, ['operation', 'data', 'version']);
    return { operation: expectedOperation, version: 1, data: normalizeAgentLibraryReadResult(source.data, expectedLibraryId) };
  }
  if (expectedOperation === 'stage-library-node') {
    exactKeys(source, ['downloadUrl', 'node', 'operation', 'version']);
    let downloadUrl: string | undefined;
    if (source.downloadUrl !== undefined) {
      downloadUrl = boundedString(source.downloadUrl, '资料库下载地址', 32 * 1024);
      const parsed = new URL(downloadUrl);
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        || parsed.username
        || parsed.password
      ) {
        throw new Error('资料库下载地址无效');
      }
    }
    const node = normalizeNode(source.node);
    if (node.type !== 'file') throw new Error('资料库来源不是普通文件');
    if (node.libraryId !== expectedLibraryId) throw new Error('资料库来源不属于当前资料库');
    return {
      ...(downloadUrl ? { downloadUrl } : {}),
      node,
      operation: expectedOperation,
      version: 1,
    };
  }
  if (expectedOperation === 'resolve-library-directory') {
    exactKeys(source, ['operation', 'parent', 'version']);
    const parent = normalizeNode(source.parent);
    if (parent.type !== 'dir') throw new Error('资料库目标不是目录');
    if (parent.libraryId !== expectedLibraryId) throw new Error('资料库目标不属于当前资料库');
    return {
      operation: expectedOperation,
      parent,
      version: 1,
    };
  }
  exactKeys(source, ['credentials', 'operation', 'parent', 'providerId', 'providerLabel', 'version']);
  const parent = normalizeNode(source.parent);
  if (parent.type !== 'dir') throw new Error('资料库目标不是目录');
  if (parent.libraryId !== expectedLibraryId) throw new Error('资料库目标不属于当前资料库');
  let credentials: { token: string; username: string } | undefined;
  if (source.credentials !== undefined) {
    const rawCredentials = strictObject(source.credentials, 'Agent 资料库凭据');
    exactKeys(rawCredentials, ['token', 'username']);
    credentials = {
      token: boundedString(rawCredentials.token, 'Agent 资料库凭据', 32 * 1024),
      username: boundedString(rawCredentials.username, 'Agent 资料库用户名', 256),
    };
  }
  const providerId = boundedString(source.providerId, '存储服务', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(providerId)) {
    throw new Error('存储服务无效');
  }
  return {
    ...(credentials ? { credentials } : {}),
    operation: expectedOperation,
    parent,
    providerId,
    providerLabel: boundedString(source.providerLabel, '存储服务名称', 160),
    version: 1,
  };
}

function abortError(): Error {
  const error = new Error('Agent 资料库文件授权已取消');
  error.name = 'AbortError';
  return error;
}

function sameOwner(left: AgentOwnerScope, right: AgentOwnerScope): boolean {
  return left.accountScope === right.accountScope && left.backendScope === right.backendScope;
}

export function createAgentFileAuthorityBroker(options: AgentFileAuthorityBrokerOptions = {}) {
  const createId = options.createId || crypto.randomUUID;
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const pending = new Map<string, PendingAuthority>();

  function request(input: AgentFileAuthorityBrokerRequestInput): Promise<AgentFileAuthorityResultV1> {
    if (input.signal.aborted) return Promise.reject(abortError());
    if (!input.sender || input.sender.isDestroyed()) {
      return Promise.reject(new Error('Agent 资料库文件授权窗口不可用'));
    }
    positiveInteger(input.libraryId, '资料库 ID');
    boundedString(input.runId, 'Agent Run ID', 200);
    boundedString(input.sessionId, 'Agent Session ID', 200);
    boundedString(input.toolRunId, 'Agent ToolRun ID', 200);
    const authorityId = createId();
    if (!authorityId || pending.has(authorityId)) {
      return Promise.reject(new Error('Agent 资料库文件授权身份无效'));
    }
    const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
    const operation = input.operation.operation === 'resolve-library-directory'
      ? Object.freeze({
        directoryPath: normalizeAgentLibraryDirectoryPath(input.operation.directoryPath),
        operation: input.operation.operation,
      })
      : input.operation;
    const requestPayload = Object.freeze({
      ...operation,
      authorityId,
      libraryId: input.libraryId,
      ownerScope,
      runId: input.runId,
      sessionId: input.sessionId,
      toolRunId: input.toolRunId,
      version: 1 as const,
    }) as AgentFileAuthorityRequestV1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal.removeEventListener('abort', handleAbort);
        pending.delete(authorityId);
        handler();
      };
      const handleAbort = () => finish(() => reject(abortError()));
      const timer = setTimeout(() => finish(() => reject(
        new Error('Agent 资料库文件授权请求超时'),
      )), timeoutMs);
      timer.unref?.();
      pending.set(authorityId, {
        cancel: handleAbort,
        libraryId: input.libraryId,
        ownerScope,
        ownerWebContentsId: input.sender.id,
        operation: requestPayload.operation,
        reject: error => finish(() => reject(error)),
        resolve: result => finish(() => resolve(result)),
        runId: input.runId,
        sessionId: input.sessionId,
        toolRunId: input.toolRunId,
      });
      input.signal.addEventListener('abort', handleAbort, { once: true });
      try {
        input.sender.send('agent:file-authority:requested', requestPayload);
      } catch {
        pending.get(authorityId)?.reject(new Error('Agent 资料库文件授权请求发送失败'));
      }
    });
  }

  function complete(ownerWebContentsId: number, input: AgentFileAuthorityCompletionV1): boolean {
    const completion = strictObject(input, 'Agent 资料库文件授权提交');
    exactKeys(completion, COMPLETION_FIELDS);
    const authorityId = boundedString(completion.authorityId, 'Agent 资料库文件授权身份', 200);
    const current = pending.get(authorityId);
    if (!current) throw new Error('Agent 资料库文件授权请求不存在或已经失效');
    const rawOwnerScope = strictObject(completion.ownerScope, 'Agent 资料库文件授权账号');
    exactKeys(rawOwnerScope, OWNER_SCOPE_FIELDS);
    const ownerScope = normalizeAgentOwnerScope(rawOwnerScope);
    if (
      completion.version !== 1
      || current.ownerWebContentsId !== ownerWebContentsId
      || current.libraryId !== positiveInteger(completion.libraryId, '资料库 ID')
      || current.runId !== boundedString(completion.runId, 'Agent Run ID', 200)
      || current.sessionId !== boundedString(completion.sessionId, 'Agent Session ID', 200)
      || current.toolRunId !== boundedString(completion.toolRunId, 'Agent ToolRun ID', 200)
      || !sameOwner(current.ownerScope, ownerScope)
    ) {
      throw new Error('当前窗口无权提交该 Agent 资料库文件授权');
    }
    if (completion.error !== undefined) {
      if (completion.result !== undefined || typeof completion.error !== 'string') {
        throw new Error('Agent 资料库文件授权失败结果无效');
      }
      const message = completion.error.trim().slice(0, 500);
      current.reject(new Error(message || 'Agent 资料库文件授权失败'));
      return true;
    }
    if (!completion.result) throw new Error('Agent 资料库文件授权结果缺失');
    current.resolve(normalizeResult(completion.result, current.operation, current.libraryId));
    return true;
  }

  function releaseOwner(ownerWebContentsId: number): void {
    pending.forEach((entry) => {
      if (entry.ownerWebContentsId === ownerWebContentsId) entry.cancel();
    });
  }

  return Object.freeze({ complete, releaseOwner, request });
}

export const agentFileAuthorityBroker = createAgentFileAuthorityBroker();
