import crypto from 'node:crypto';
import path from 'node:path';
import type { AgentFileChangePrepareRequest } from '../../../src/shared/agent/agent-file-changes';
import { AGENT_FILE_TEXT_MAX_BYTES, type AgentFileWriteInput, type AgentFileMutationSnapshot } from '../../../src/shared/agent/agent-file-write';
import { applyAgentFilePatch, decodeAgentMutableText, type AgentFilePatchInput } from '../../../src/shared/agent/agent-file-patch';

function decode(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(AGENT_FILE_TEXT_MAX_BYTES / 3) * 4
    || value.length % 4 !== 0) throw new Error('文件快照编码无效或超限');
  // Round-trip equality rejects whitespace, URL alphabet, ignored bytes and noncanonical pad bits.
  // A repeated-group regex over an allowed 11 MiB encoding can overflow V8's regexp stack.
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > AGENT_FILE_TEXT_MAX_BYTES || bytes.toString('base64') !== value) throw new Error('文件快照编码无效或超限');
  decodeAgentMutableText(bytes);
  return bytes;
}
export function decodeAgentFileChangeSnapshot(
  source: AgentFileChangePrepareRequest['snapshot'], input: AgentFileWriteInput | AgentFilePatchInput,
): AgentFileMutationSnapshot {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some(key => !['path', 'nodeId', 'beforeBase64', 'afterBase64', 'beforeRevision', 'afterRevision'].includes(key))
    || source.path !== input.path || input.scope !== 'library') throw new Error('文件快照目标与获准调用不匹配');
  const before = source.beforeBase64 === null ? null : decode(source.beforeBase64);
  const after = decode(source.afterBase64);
  const hash = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
  const beforeRevision = before === null ? undefined : hash(before);
  if (source.afterRevision !== hash(after) || source.beforeRevision !== beforeRevision
    || beforeRevision !== input.revision
    || (before !== null && (!Number.isSafeInteger(source.nodeId) || Number(source.nodeId) < 1))
    || (before === null && source.nodeId !== undefined)) throw new Error('文件快照版本或节点与获准调用不匹配');
  const expectedAfter = 'patch' in input
    ? before === null ? undefined : applyAgentFilePatch(before, input.patch, input.path).bytes
    : Buffer.from(input.content, 'utf8');
  if (!expectedAfter || !Buffer.from(expectedAfter).equals(after)) throw new Error('文件快照内容与获准写入不匹配');
  return { scope: 'library', path: input.path, fileName: path.posix.basename(input.path),
    ...(source.nodeId ? { nodeId: source.nodeId } : {}), beforeBytes: before, afterBytes: after,
    ...(beforeRevision ? { beforeRevision } : {}), afterRevision: source.afterRevision };
}
