import type { AgentToolExecutionRequest, AgentToolResult } from '@/shared/agent/agent.types';
import { hasAgentFileBinaryControls, normalizeAgentFileWriteInput } from '@/shared/agent/agent-file-write';
import { createAgentOwnerScope, serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { UploadSessionRequestError, UploadSessionExpiredError, UploadSessionNotFoundError } from '@/modules/upload-center/services/upload-session.api';
import { UploadCommitUnknownError, UploadReceiptError } from '@/modules/upload-center/services/upload-direct';
import { reportAgentToolExecutionProgress } from './agent.api';
import { notifyLibraryFileContentChanged } from '@/features/file-viewer/services/file-content-events';
import { fetchNodeDetailById, getFileLink, updateNodeFileContent, uploadLocalPathAndCreateNode } from '@/features/file-explorer/services/file.api';
import { resolveAgentLibraryPath } from './agent-library.api';
import { resolveHealthyLibraryWriteProvider } from './agent-file-authority';
import type { AgentRendererToolOutcome } from './agent-tool-executor';

class WriteValidationError extends Error {}
export interface AgentFileWriteDependencies {
  resolvePath?: typeof resolveAgentLibraryPath;
  detail?: typeof fetchNodeDetailById;
  readBytes?: (nodeId: number, libraryId: number) => Promise<Uint8Array>;
  update?: typeof updateNodeFileContent;
  upload?: typeof uploadLocalPathAndCreateNode;
  stage?: (name: string, content: string) => Promise<{ filePath: string }>;
  cleanup?: (path: string) => Promise<unknown>;
  assertOwner?: () => void;
  onCommitted?: (result: AgentToolResult) => void | Promise<void>;
  beforeCommit?: () => Promise<void>;
  selectProvider?: typeof resolveHealthyLibraryWriteProvider;
  signal?: AbortSignal;
}

async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), value => value.toString(16).padStart(2, '0')).join('');
}

async function readBytes(nodeId: number, libraryId: number): Promise<Uint8Array> {
  const url = await getFileLink(nodeId, libraryId);
  const response = await window.electronAPI.fetchBinary(url, { maxBytes: 8 * 1024 * 1024 + 1 });
  if (!response || response.status >= 400 || response.truncated || response.receivedBytes > 8 * 1024 * 1024) {
    throw new WriteValidationError('无法读取完整的现有文本文件，未覆盖');
  }
  return Uint8Array.from(atob(response.base64), character => character.charCodeAt(0));
}

export async function executeAgentFileWrite(request: AgentToolExecutionRequest, deps: AgentFileWriteDependencies = {}): Promise<AgentRendererToolOutcome> {
  const check = () => {
    deps.signal?.throwIfAborted();
    if (deps.assertOwner) deps.assertOwner();
    else if (serializeAgentOwnerScope(createAgentOwnerScope(API_CONFIG.BASE_URL, auth.getUserInfo()?.id)) !== serializeAgentOwnerScope(request.ownerScope)) {
      throw new WriteValidationError('账号环境已经变化，未继续写入');
    }
  };
  let attempted = false;
  let commitAttempted = false;
  let receiptReceived = false;
  let replacing = false;
  let stagedPath: string | undefined;
  let abortListener: (() => void) | undefined;
  const beforeCommit = async () => {
    check();
    if (deps.beforeCommit) await deps.beforeCommit();
    else await reportAgentToolExecutionProgress({
      executionId: request.executionId, libraryId: Number(request.appContext.libraryId),
      ownerScope: request.ownerScope, runId: request.runId, sessionId: request.sessionId,
      phase: 'committing', progress: { message: '正在保存文件' },
    });
    check();
    commitAttempted = true;
  };
  try {
    check();
    const raw = request.input as Record<string, unknown>;
    if (request.toolName !== 'file.write' || !raw || !Number.isSafeInteger(raw.libraryId)
      || raw.libraryId !== request.appContext.libraryId) throw new WriteValidationError('文件写入范围无效');
    const { libraryId: rawLibrary, ...query } = raw;
    const libraryId = Number(rawLibrary);
    const input = normalizeAgentFileWriteInput(query);
    replacing = Boolean(input.revision);
    const resolve = deps.resolvePath || resolveAgentLibraryPath;
    const fileName = input.path.split('/').at(-1)!;
    const contentBytes = new TextEncoder().encode(input.content);
    const revision = await hash(contentBytes);
    let node: { id: unknown; libraryId?: unknown };
    let parentId: number;
    if (input.revision) {
      const target = await resolve(libraryId, input.path, 'file');
      const detail = await (deps.detail || fetchNodeDetailById)(target.id);
      if (detail.id !== target.id || detail.libraryId !== libraryId || detail.type !== 'file' || detail.parentId !== target.parentId) {
        throw new WriteValidationError('目标文件身份已变化，请重新读取');
      }
      const bytes = !detail.storageKey && Number(detail.fileSize) === 0 ? new Uint8Array()
        : await (deps.readBytes || readBytes)(target.id, libraryId);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.startsWith('%PDF-') || hasAgentFileBinaryControls(text)) throw new WriteValidationError('只支持修改UTF-8文本，不支持二进制文件');
      if (await hash(bytes) !== input.revision) throw new WriteValidationError('文件内容已变化，请重新file.read后修改；未覆盖');
      check();
      parentId = target.parentId;
      attempted = true;
      await beforeCommit();
      node = await (deps.update || updateNodeFileContent)({ nodeId: target.id, libraryId, content: input.content,
        contentType: 'text/plain; charset=utf-8', expectedStorageKey: detail.storageKey || '' });
    } else {
      const parentPath = input.path.slice(0, input.path.lastIndexOf('/')) || '/';
      const parent = await resolve(libraryId, parentPath, 'dir');
      check();
      parentId = parent.id;
      let provider: { id: string; label: string };
      try {
        provider = await (deps.selectProvider || resolveHealthyLibraryWriteProvider)({
          fileName, fileSize: contentBytes.length, contentType: 'text/plain; charset=utf-8',
        }, check);
      } catch {
        check();
        throw new WriteValidationError('没有可用的资料库存储服务，文件未提交；请检查存储连接。');
      }
      check();
      const staged = await (deps.stage || ((name, content) => window.electronAPI.createStagedTextFile(name, content)))(fileName, input.content);
      stagedPath = staged.filePath;
      check();
      attempted = true;
      const uploaded = await (deps.upload || uploadLocalPathAndCreateNode)(stagedPath, parentId, libraryId, {
        conflictPolicy: 'error', contentType: 'text/plain; charset=utf-8',
        storageProvider: provider.id,
        beforeCommit,
        setAbort: abort => {
          abortListener = () => { void abort().catch(() => undefined); };
          if (deps.signal?.aborted) abortListener();
          else deps.signal?.addEventListener('abort', abortListener, { once: true });
        },
      });
      node = { id: uploaded.id, libraryId: uploaded.libraryId };
    }
    receiptReceived = true;
    if (!Number.isSafeInteger(node.id) || Number(node.id) <= 0 || (node.libraryId !== undefined && node.libraryId !== libraryId)) throw new Error('invalid write receipt');
    const result: AgentToolResult = { ok: true, message: `已保存 ${fileName}`, data: {
      scope: 'library', path: input.path, fileName, revision, sizeBytes: contentBytes.length,
      writeCommitState: 'committed', operationId: request.executionId, destination: { kind: 'library', nodeId: Number(node.id), parentId },
    } };
    // A lost UI receipt must not reverse an already committed write.
    notifyLibraryFileContentChanged({ ...request.ownerScope, libraryId, nodeId: Number(node.id) });
    try { await deps.onCommitted?.(result); } catch { /* Final completion retries the receipt. */ }
    return { committed: true, result };
  } catch (error) {
    const unknown = receiptReceived || error instanceof UploadCommitUnknownError || error instanceof UploadReceiptError || (replacing && commitAttempted);
    const status = error instanceof IpcRequestError || error instanceof UploadSessionRequestError ? error.status : undefined;
    if (attempted && status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return { result: { ok: false, message: status === 409
        ? replacing ? '文件版本已变化，未覆盖；请重新file.read后修改。' : '同名文件已存在，未覆盖；修改前请file.read取得revision。'
        : replacing && status === 404 ? '后端条件写入接口或目标文件不存在，未写入；请更新后端并检查路径。' : '服务端拒绝写入，未提交。',
      data: { writeCommitState: 'uncommitted', operationId: request.executionId } } };
    }
    return { result: { ok: false, message: error instanceof WriteValidationError ? error.message
      : unknown ? '写入结果尚未确认，请file.read核对目标；不要盲目重试或覆盖。'
        : deps.signal?.aborted ? '文件保存已取消，未提交。'
          : error instanceof UploadSessionExpiredError || error instanceof UploadSessionNotFoundError
            ? '上传会话已失效，文件未提交；可重新保存。'
            : attempted ? '文件上传失败，未提交；请检查存储可达性后重试。' : '无法准备文件写入，请检查资料库路径、存储可达性和权限。',
    data: { writeCommitState: unknown ? 'commit_unknown' : 'uncommitted', operationId: request.executionId } } };
  } finally {
    if (abortListener) deps.signal?.removeEventListener('abort', abortListener);
    if (stagedPath) {
      try { await (deps.cleanup || (path => window.electronAPI.cleanupStagedTextFile(path)))(stagedPath); } catch { /* Managed staging cleanup can retry later. */ }
    }
  }
}
