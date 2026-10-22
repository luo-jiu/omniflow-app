import {
  AgentFileMutationError, hasAgentFileBinaryControls, normalizeAgentFileExpectedRevision,
  normalizeAgentFileMutationTarget,
} from './agent-file-write';
import { AGENT_TOOL_ARGUMENT_MAX_CHARACTERS } from './agent-tool-input-limits';

/** The legacy parser keeps its original body limit; transport limits still apply. */
export const AGENT_FILE_PATCH_MAX_CHARACTERS = 128_000;
export const AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS = 32_000;
/** Matches the existing Provider's per-call serialized argument limit (UTF-16 code units). */
export const AGENT_FILE_PATCH_MAX_ARGUMENT_CHARACTERS = AGENT_TOOL_ARGUMENT_MAX_CHARACTERS;

interface AgentFilePatchTarget {
  scope: 'library' | 'host'; path: string; basePath?: string; view: 'saved'; revision: string;
  patch: string;
}

export type AgentFilePatchInput = AgentFilePatchTarget & (
  | { format: 'unified-v1'; finalNewline?: never }
  | { format: 'context-v1'; finalNewline: 'preserve' | 'ensure' | 'remove' }
);

/** Check the original envelope too: canonical path resolution may remove basePath. */
export function assertAgentFilePatchArgumentBudget(value: unknown): void {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); }
  catch { throw new AgentFileMutationError('INVALID_INPUT', '补丁参数必须为可序列化的 JSON 对象'); }
  if (!serialized || serialized.length > AGENT_FILE_PATCH_MAX_ARGUMENT_CHARACTERS) {
    throw new AgentFileMutationError('PATCH_INPUT_TOO_LARGE', '补丁总参数（含 JSON 转义、路径与元数据）不能超过64000字符，请拆分修改');
  }
}

export function normalizeAgentFilePatchInput(value: unknown): AgentFilePatchInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentFileMutationError('INVALID_INPUT', '补丁参数无效');
  }
  assertAgentFilePatchArgumentBudget(value);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['scope', 'path', 'basePath', 'view', 'revision', 'expectedRevision', 'patch', 'format', 'finalNewline'].includes(key))) {
    throw new AgentFileMutationError('INVALID_INPUT', '补丁包含不支持的参数');
  }
  if (input.format !== undefined && input.format !== 'unified-v1' && input.format !== 'context-v1') {
    throw new AgentFileMutationError('INVALID_PATCH', '补丁格式必须为 context-v1 或历史 unified-v1');
  }
  const format = input.format ?? 'unified-v1';
  const maximum = format === 'context-v1' ? AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS : AGENT_FILE_PATCH_MAX_CHARACTERS;
  if (typeof input.patch !== 'string' || !input.patch || input.patch.length > maximum || hasAgentFileBinaryControls(input.patch)) {
    throw new AgentFileMutationError('INVALID_PATCH', `${format} 补丁必须为非空 UTF-8 文本，正文最多${maximum}字符`);
  }
  if (format === 'context-v1' && (input.revision === undefined || input.expectedRevision !== undefined)) {
    throw new AgentFileMutationError('INVALID_REVISION', 'context-v1 必须显式提供 file.read 返回的 revision，不使用 expectedRevision');
  }
  if (format === 'unified-v1' && input.finalNewline !== undefined) {
    throw new AgentFileMutationError('INVALID_PATCH', '历史 unified-v1 使用原有尾换行标记，不接受 finalNewline');
  }
  const finalNewline = input.finalNewline === undefined ? 'preserve' : input.finalNewline;
  if (finalNewline !== 'preserve' && finalNewline !== 'ensure' && finalNewline !== 'remove') {
    throw new AgentFileMutationError('INVALID_PATCH', 'finalNewline 必须为 preserve、ensure 或 remove');
  }
  const target = { ...normalizeAgentFileMutationTarget(input), revision: normalizeAgentFileExpectedRevision(input, true)!, patch: input.patch };
  const result: AgentFilePatchInput = format === 'context-v1'
    ? { ...target, format, finalNewline }
    : { ...target, format };
  assertAgentFilePatchArgumentBudget(result);
  return result;
}
