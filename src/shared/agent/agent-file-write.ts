import { resolveAgentLibraryFilePath } from './agent-file-path';
import type { AgentToolResult } from './agent.types';

export const AGENT_FILE_WRITE_MAX_CHARACTERS = 32_000;
export const AGENT_FILE_TEXT_MAX_BYTES = 8 * 1024 * 1024;

export interface AgentFileWriteInput {
  scope: 'library' | 'host';
  path: string;
  basePath?: string;
  content: string;
  revision?: string;
  mode: 'create' | 'replace';
  view: 'saved';
}

/** Private executor-to-journal payload. Never include it in a Tool result or model history. */
export interface AgentFileMutationSnapshot {
  scope: 'library' | 'host';
  path: string;
  fileName: string;
  libraryId?: number;
  nodeId?: number;
  parentId?: number;
  identity?: string;
  beforeBytes: Uint8Array | null;
  afterBytes: Uint8Array;
  beforeRevision?: string;
  afterRevision: string;
}

/** Bound by main to the current Run and ToolRun; the model cannot choose operationId. */
export interface AgentFileMutationHooks {
  readonly operationId: string;
  prepare(snapshot: AgentFileMutationSnapshot, signal: AbortSignal): Promise<void>;
  settle(result: AgentToolResult): Promise<void>;
}

export class AgentFileMutationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'AgentFileMutationError'; }
}

export function normalizeAgentFileMutationTarget(input: Record<string, unknown>): {
  scope: 'library' | 'host'; path: string; basePath?: string; view: 'saved';
} {
  if (input.scope !== undefined && input.scope !== 'library' && input.scope !== 'host') {
    throw new AgentFileMutationError('INVALID_TARGET', '文件 scope 必须是 library 或 host');
  }
  if (input.view !== undefined && input.view !== 'saved') {
    throw new AgentFileMutationError('UNSUPPORTED_CAPABILITY', '当前文件修改只支持 saved 版本');
  }
  const scope = input.scope === 'host' ? 'host' : 'library';
  if (typeof input.path !== 'string' || !input.path || new TextEncoder().encode(input.path).length > 4096
    || Array.from(input.path).some(character => character.charCodeAt(0) < 32)) {
    throw new AgentFileMutationError('INVALID_TARGET', '文件路径无效');
  }
  if (input.basePath !== undefined && (typeof input.basePath !== 'string' || !input.basePath
    || new TextEncoder().encode(input.basePath).length > 4096
    || Array.from(input.basePath).some(character => character.charCodeAt(0) < 32))) throw new AgentFileMutationError('INVALID_TARGET', 'basePath 无效');
  const path = scope === 'library' ? resolveAgentLibraryFilePath(input.path, input.basePath) : input.path;
  const name = path.split(scope === 'host' ? /[\\/]/u : '/').at(-1) || '';
  if (!name || name === '.' || name === '..' || name !== name.trim() || new TextEncoder().encode(name).length > 240) {
    throw new AgentFileMutationError('INVALID_TARGET', '文件名不能包含首尾空白或超过240字节');
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)) {
    throw new AgentFileMutationError('INVALID_TARGET', '文件名称不兼容 Windows 文件系统');
  }
  return { scope, path, ...(scope === 'host' && typeof input.basePath === 'string' ? { basePath: input.basePath } : {}), view: 'saved' };
}

export function normalizeAgentFileExpectedRevision(input: Record<string, unknown>, required: boolean): string | undefined {
  if (input.revision !== undefined && input.expectedRevision !== undefined) {
    throw new AgentFileMutationError('INVALID_REVISION', 'revision 与 expectedRevision 不能同时提供');
  }
  const revision = input.expectedRevision !== undefined ? input.expectedRevision : input.revision;
  if ((required && revision === undefined) || (revision !== undefined
    && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/u.test(revision)))) {
    throw new AgentFileMutationError('INVALID_REVISION', '修改文件必须提供 file.read 返回的完整 revision');
  }
  return revision as string | undefined;
}

export function hasAgentFileBinaryControls(text: string): boolean {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code <= 8 || (code >= 14 && code <= 31)) return true;
  }
  return false;
}

export function normalizeAgentFileWriteInput(value: unknown): AgentFileWriteInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件写入参数无效');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['scope', 'path', 'basePath', 'content', 'revision', 'expectedRevision', 'mode', 'view'].includes(key))
    || typeof input.content !== 'string' || input.content.length > AGENT_FILE_WRITE_MAX_CHARACTERS || hasAgentFileBinaryControls(input.content)) {
    throw new AgentFileMutationError('INVALID_INPUT', 'file.write 只接受不超过32000字符的 UTF-8 文本正文');
  }
  const target = normalizeAgentFileMutationTarget(input);
  const revision = normalizeAgentFileExpectedRevision(input, input.mode === 'replace');
  const mode = input.mode === undefined ? (revision ? 'replace' : 'create') : input.mode;
  if (mode !== 'create' && mode !== 'replace') {
    throw new AgentFileMutationError('INVALID_INPUT', '文件 mode 必须是 create 或 replace');
  }
  if (mode === 'create' && revision) {
    throw new AgentFileMutationError('INVALID_REVISION', '新建文件不能提供替换版本');
  }
  return { ...target, mode, content: input.content, ...(revision ? { revision } : {}) };
}
