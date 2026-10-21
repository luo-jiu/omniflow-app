import crypto from 'node:crypto';
import path from 'node:path';
import { constants } from 'node:fs';
import { access, link, lstat, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import type { AgentToolResult } from '../../../../src/shared/agent/agent.types';
import {
  AGENT_FILE_TEXT_MAX_BYTES, AgentFileMutationError,
  type AgentFileMutationSnapshot, type AgentFileWriteInput,
} from '../../../../src/shared/agent/agent-file-write';
import { applyAgentFilePatch, decodeAgentMutableText, type AgentFilePatchInput } from '../../../../src/shared/agent/agent-file-patch';
import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { normalizeAgentLocalPathExpression, openAgentLocalFile, verifyAgentLocalFileSnapshot,
  verifyOpenedAgentLocalFileUnchanged, type AgentOpenedLocalFile } from './agent-local-file';

const queues = new Map<string, Promise<void>>();
const digest = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
const isPatch = (input: AgentFileWriteInput | AgentFilePatchInput): input is AgentFilePatchInput => 'patch' in input;

async function readOpened(opened: AgentOpenedLocalFile, signal: AbortSignal): Promise<Uint8Array> {
  if (opened.snapshot.statIdentity.sizeBytes > AGENT_FILE_TEXT_MAX_BYTES) {
    throw new AgentFileMutationError('FILE_TOO_LARGE', '文本超过 8 MiB 修改上限');
  }
  const bytes = Buffer.alloc(opened.snapshot.statIdentity.sizeBytes + 1);
  let offset = 0;
  while (offset < bytes.length) {
    signal.throwIfAborted();
    const result = await opened.fileHandle.read(bytes, offset, bytes.length - offset, offset);
    if (!result.bytesRead) break;
    offset += result.bytesRead;
  }
  await verifyOpenedAgentLocalFileUnchanged(opened);
  if (offset !== opened.snapshot.statIdentity.sizeBytes) {
    throw new AgentFileMutationError('REVISION_CONFLICT', '本机文件在读取期间变化，未修改');
  }
  return bytes.subarray(0, offset);
}

async function withFileQueue<T>(key: string, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => next);
  queues.set(key, tail);
  try { await previous; signal.throwIfAborted(); return await action(); }
  finally { release(); if (queues.get(key) === tail) queues.delete(key); }
}

function resultFor(state: 'committed' | 'uncommitted' | 'commit_unknown', operationId: string,
  data: Record<string, unknown>, message: string): AgentToolResult {
  return { ok: state === 'committed', message, data: { ...data, operationId,
    writeCommitState: state, mutationCommitState: state } };
}

/** Serializes application writers. External processes still have a compare/rename race. */
export async function executeAgentHostFileMutation(
  input: AgentFileWriteInput | AgentFilePatchInput, context: AgentToolExecutionContext,
): Promise<AgentToolResult> {
  const operationId = context.fileMutation?.operationId;
  if (!operationId || !context.fileMutation || !context.commitSettlement) {
    return { ok: false, message: '当前运行时未接入文件提交与改动记录，未写入',
      data: { code: 'UNSUPPORTED_CAPABILITY', writeCommitState: 'uncommitted' } };
  }
  const hooks = context.fileMutation;
  const commit = context.commitSettlement;
  let prepared = false;
  let begun = false;
  let attempted = false;
  let confirmed = false;
  let temporaryPath: string | undefined;
  let temporaryHandle: FileHandle | undefined;
  let opened: AgentOpenedLocalFile | undefined;
  let data: Record<string, unknown> = { scope: 'host', path: input.path, view: 'saved' };
  let result: AgentToolResult;
  try {
    context.signal.throwIfAborted();
    const expression = normalizeAgentLocalPathExpression(input.path);
    const parentPath = path.dirname(expression.absolutePath);
    const canonicalParent = await realpath(parentPath);
    const parentStat = await lstat(canonicalParent, { bigint: true });
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new AgentFileMutationError('UNSUPPORTED_IDENTITY', '目标父路径必须是普通目录');
    }
    const targetPath = path.join(canonicalParent, path.basename(expression.absolutePath));
    result = await withFileQueue(targetPath, context.signal, async () => {
      const replacing = isPatch(input) || input.mode === 'replace';
      let beforeBytes: Uint8Array | null = null;
      let mode = 0o600;
      let owner: { uid: number; gid: number } | undefined;
      if (replacing) {
        opened = await openAgentLocalFile(targetPath, context.signal);
        await access(targetPath, constants.W_OK);
        beforeBytes = await readOpened(opened, context.signal);
        decodeAgentMutableText(beforeBytes);
        if (digest(beforeBytes) !== input.revision) {
          throw new AgentFileMutationError('REVISION_CONFLICT', '文件内容已变化，请重新 file.read 后修改；未覆盖');
        }
        const metadata = await opened.fileHandle.stat();
        if ((metadata.mode & 0o7000) !== 0) throw new AgentFileMutationError('UNSUPPORTED_METADATA', '暂不支持保留特殊 mode 的本机文件');
        mode = metadata.mode & 0o777;
        owner = { uid: metadata.uid, gid: metadata.gid };
      } else {
        try {
          await lstat(targetPath);
          throw new AgentFileMutationError('TARGET_EXISTS', '同名文件已存在，未覆盖；修改前请 file.read 取得 revision');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      const patch = isPatch(input) ? applyAgentFilePatch(beforeBytes!, input.patch, input.path) : undefined;
      const afterBytes = patch?.bytes || new TextEncoder().encode((input as AgentFileWriteInput).content);
      const revision = digest(afterBytes);
      data = { ...data, path: expression.displayPath, fileName: path.basename(targetPath), revision,
        sizeBytes: afterBytes.byteLength, ...(patch ? { additions: patch.additions, deletions: patch.deletions, hunks: patch.hunks } : {}),
        ...(opened ? { beforeIdentity: opened.snapshot.identityHash } : {}),
        concurrencyGuarantee: 'application-serialized; external-writers-best-effort',
        metadataGuarantee: 'mode-and-owner; extended-metadata-not-guaranteed',
        warnings: replacing ? ['原子替换保留普通 mode 和 owner；ACL、扩展属性与其他扩展元数据尚未保障。'] : [] };
      const snapshot: AgentFileMutationSnapshot = { scope: 'host', path: expression.displayPath,
        fileName: path.basename(targetPath), identity: opened?.snapshot.identityHash || `host:${targetPath}`,
        beforeBytes: beforeBytes?.slice() ?? null, afterBytes: afterBytes.slice(),
        ...(beforeBytes ? { beforeRevision: digest(beforeBytes) } : {}), afterRevision: revision };
      await hooks.prepare(snapshot, context.signal);
      prepared = true;
      context.signal.throwIfAborted();
      temporaryPath = path.join(canonicalParent, `.omniflow-${crypto.randomUUID()}.tmp`);
      temporaryHandle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
        | (process.platform !== 'win32' ? constants.O_NOFOLLOW : 0), 0o600);
      await temporaryHandle.writeFile(afterBytes);
      if (owner && process.platform !== 'win32') await temporaryHandle.chown(owner.uid, owner.gid);
      await temporaryHandle.chmod(mode);
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = undefined;
      const freshParent = await lstat(canonicalParent, { bigint: true });
      if (!freshParent.isDirectory() || freshParent.ino !== parentStat.ino || freshParent.dev !== parentStat.dev
        || await realpath(parentPath) !== canonicalParent) {
        throw new AgentFileMutationError('TARGET_CONFLICT', '目标父目录身份已变化，未写入');
      }
      if (opened) {
        const fresh = await openAgentLocalFile(targetPath, context.signal);
        try {
          await verifyAgentLocalFileSnapshot(fresh, opened.snapshot);
          if (digest(await readOpened(fresh, context.signal)) !== input.revision) {
            throw new AgentFileMutationError('REVISION_CONFLICT', '文件内容在提交前变化，未覆盖');
          }
        } finally { await fresh.fileHandle.close(); }
      }
      context.signal.throwIfAborted();
      commit.begin(resultFor('commit_unknown', operationId, data, '写入结果尚未确认，请核对目标，不要盲目重试'));
      begun = true;
      attempted = true;
      if (replacing) await rename(temporaryPath, targetPath);
      else await link(temporaryPath, targetPath); // exclusive destination; never replace a concurrent creator
      confirmed = true;
      if (replacing) temporaryPath = undefined;
      else {
        try { await unlink(temporaryPath); temporaryPath = undefined; }
        catch { /* Final cleanup retries the private temporary hardlink. */ }
      }
      let verifiedCurrentRevision = false;
      let afterIdentity: string | undefined;
      try {
        const observed = await openAgentLocalFile(targetPath);
        try {
          verifiedCurrentRevision = digest(await readOpened(observed, new AbortController().signal)) === revision;
          if (verifiedCurrentRevision) afterIdentity = observed.snapshot.identityHash;
        }
        finally { await observed.fileHandle.close(); }
      } catch { /* A later reader failure cannot undo the successful filesystem operation. */ }
      let directorySyncConfirmed = false;
      try {
        const directory = await open(canonicalParent, constants.O_RDONLY);
        try { await directory.sync(); directorySyncConfirmed = true; } finally { await directory.close(); }
      } catch { /* Some platforms do not support syncing directory handles. */ }
      return resultFor('committed', operationId, { ...data, verifiedCurrentRevision, directorySyncConfirmed,
        ...(afterIdentity ? { afterIdentity } : {}) }, `已保存 ${path.basename(targetPath)}`);
    });
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    const state = confirmed ? 'committed' : attempted && (!errno || errno === 'EIO') ? 'commit_unknown' : 'uncommitted';
    const code = error instanceof AgentFileMutationError ? error.code : context.signal.aborted ? 'CANCELLED'
      : errno === 'EEXIST' ? 'TARGET_EXISTS' : errno === 'ENOENT' ? 'TARGET_NOT_FOUND'
        : errno === 'EACCES' || errno === 'EPERM' ? 'PERMISSION_DENIED' : 'FILE_MUTATION_FAILED';
    const message = error instanceof AgentFileMutationError ? error.message
      : state === 'commit_unknown' ? '写入结果尚未确认，请 file.read 核对目标；不要盲目重试或覆盖'
        : state === 'committed' ? '文件已经保存，后续核对未完成'
          : context.signal.aborted ? '文件保存已取消，未提交'
            : errno === 'EEXIST' ? '同名文件已存在，未覆盖' : '无法准备或提交本机文件，请检查路径、身份与权限；未写入';
    result = resultFor(state, operationId, { ...data, code }, message);
  } finally {
    if (opened) await opened.fileHandle.close().catch(() => undefined);
    if (temporaryHandle) await temporaryHandle.close().catch(() => undefined);
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
  }
  let settlementAccepted = !begun;
  if (begun) {
    try { commit.settle(result); settlementAccepted = true; }
    catch {
      // A sealed Broker fallback is final. A late filesystem receipt cannot revive it in the journal.
      result = resultFor('commit_unknown', operationId, { ...data, code: 'SETTLEMENT_EXPIRED' },
        '文件提交回执超过当前执行的结算期限，保留待核对状态；不要盲目重试');
    }
  }
  if (prepared && settlementAccepted) {
    try { await hooks.settle(result); }
    catch { result = { ...result, data: { ...(result.data as Record<string, unknown>), changeRecordState: 'pending-recovery' } }; }
  }
  return result;
}
