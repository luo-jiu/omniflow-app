import path from 'node:path';
import { homedir } from 'node:os';
import { resolveAgentLibraryFilePath } from '../../../src/shared/agent/agent-file-path';
import { normalizeAgentLibraryDirectoryPath } from '../../../src/shared/agent/agent-library-path';
import type { AgentToolExecutionContext } from './agent-tool-registry';
import { classifyAgentLocalPath, normalizeAgentLocalPathExpression } from './tools/agent-local-file';

type FilePathContext = Pick<AgentToolExecutionContext, 'appContext' | 'readLibraryMetadata' | 'signal'>;
export interface AgentFilePathQuery { scope?: 'library' | 'host'; path?: string; basePath?: string }
const unifiedTools = new Set(['file.list', 'file.stat', 'file.search', 'file.resolve', 'file.read', 'file.grep', 'file.write', 'file.patch']);
const libraryTools = new Set(['directory.create', 'file.rename', 'file.move', 'file.copy', 'file.delete']);
const cache = new WeakMap<FilePathContext, WeakMap<object, Map<string, Promise<unknown>>>>();

export class AgentFileTargetError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'AgentFileTargetError'; }
}

/** No process cwd fallback: a relative host target always has an explicit base. */
export function resolveAgentHostFilePath(value: unknown, basePath?: unknown,
  platform: NodeJS.Platform = process.platform, homePath = homedir()): string {
  const base = basePath === undefined ? undefined : normalizeAgentLocalPathExpression(basePath, platform, homePath).absolutePath;
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 4096
    || Array.from(value).some(character => character.charCodeAt(0) < 32)) throw new Error('本机文件路径无效');
  if (classifyAgentLocalPath(value) !== 'relative') return normalizeAgentLocalPathExpression(value, platform, homePath).absolutePath;
  if (!base) throw new AgentFileTargetError('HOST_BASE_PATH_REQUIRED', '本机相对路径需要明确 basePath（当前平台绝对目录或 ~/ 路径）；请提供 basePath 或改用绝对 path。不会使用应用进程工作目录。');
  if (platform === 'win32' && (value.startsWith('\\') || value.includes(':'))) throw new Error('本机相对路径不支持隐式盘符根、盘符相对路径或备用数据流');
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return normalizeAgentLocalPathExpression(pathApi.resolve(base, value), platform, homePath).absolutePath;
}

async function currentLibraryBase(context: FilePathContext): Promise<string> {
  const id = context.appContext.currentDirectory?.id;
  if (!id) return '/';
  if (!context.readLibraryMetadata) throw new Error('无法读取当前资料库目录路径；请提供绝对 basePath 或绝对 path');
  const result = await context.readLibraryMetadata({ kind: 'stat', nodeId: id }, context.signal);
  context.signal.throwIfAborted();
  const node = result.node;
  if (!node || node.id !== id || node.type !== 'dir' || node.libraryId !== context.appContext.libraryId || !node.path) {
    throw new Error('当前资料库目录身份或路径不可用；请提供明确的绝对 basePath 或绝对 path');
  }
  return normalizeAgentLibraryDirectoryPath(node.path);
}

function canonicalPatchHeaders(patch: unknown, originalPath: unknown, canonicalPath: string): unknown {
  if (typeof patch !== 'string' || typeof originalPath !== 'string' || originalPath === canonicalPath || !patch.startsWith('--- ')) return patch;
  const lines = patch.split(/\r?\n/u, 3);
  const relative = originalPath.replace(/^\//u, '');
  if (lines[0] === `--- ${originalPath}` && lines[1] === `+++ ${originalPath}`
    || lines[0] === `--- a/${relative}` && lines[1] === `+++ b/${relative}`) {
    return patch.replace(/^--- [^\r\n]+\r?\n\+\+\+ [^\r\n]+/u, () => `--- ${canonicalPath}\n+++ ${canonicalPath}`);
  }
  return patch; // The strict patch parser rejects conflicting headers.
}

async function resolveInput(name: string, input: Record<string, unknown>, context: FilePathContext): Promise<unknown> {
  if (input.scope !== undefined && input.scope !== 'library' && input.scope !== 'host') throw new Error('文件 scope 必须是 library 或 host');
  const scope = input.scope === 'host' ? 'host' : 'library';
  if (libraryTools.has(name) && scope === 'host') throw new Error(`${name} 当前仅支持资料库，不会切换为本机操作`);
  let base: string | undefined;
  const baseForLibrary = async () => base ??= input.basePath === undefined ? await currentLibraryBase(context) : normalizeAgentLibraryDirectoryPath(input.basePath);
  const resolve = async (value: unknown) => scope === 'host' ? resolveAgentHostFilePath(value, input.basePath)
    : resolveAgentLibraryFilePath(value, typeof value === 'string' && value.startsWith('/') && input.basePath === undefined ? undefined : await baseForLibrary());
  const result = { ...input };
  delete result.basePath;
  if (result.path !== undefined) result.path = await resolve(result.path);
  if (result.parentPath !== undefined) result.parentPath = await resolve(result.parentPath);
  // Validate even an unused base so a malformed call cannot acquire a different meaning later.
  if (input.basePath !== undefined && input.path === undefined && input.parentPath === undefined) {
    if (scope === 'host') normalizeAgentLocalPathExpression(input.basePath);
    else await baseForLibrary();
  }
  if (name === 'directory.create' && result.path === undefined && result.parentPath === undefined && result.parentId === undefined) {
    if (input.basePath !== undefined) result.parentPath = await baseForLibrary();
    else if (context.appContext.currentDirectory?.id) result.parentId = context.appContext.currentDirectory.id;
    else result.parentPath = '/';
  }
  if ((name === 'file.list' || name === 'file.search' && input.basePath !== undefined)
    && result.path === undefined && result.directoryId === undefined && scope === 'library') {
    if (input.basePath !== undefined) result.path = await baseForLibrary();
    else if (context.appContext.currentDirectory?.id) result.directoryId = context.appContext.currentDirectory.id;
    else result.path = '/';
  }
  if (name === 'file.patch' && input.format !== 'context-v1' && typeof result.path === 'string') {
    result.patch = canonicalPatchHeaders(result.patch, input.path, result.path);
  }
  return Object.freeze(result);
}

/** Bind once before approval. Assess, prepare, execution and private snapshots reuse this input. */
export async function resolveAgentFileToolInput(name: string, value: unknown, context: FilePathContext): Promise<unknown> {
  if (!unifiedTools.has(name) && !libraryTools.has(name) && name !== 'file.query') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件工具参数无效');
  let inputs = cache.get(context);
  if (!inputs) { inputs = new WeakMap(); cache.set(context, inputs); }
  let names = inputs.get(value);
  if (!names) { names = new Map(); inputs.set(value, names); }
  let result = names.get(name);
  if (!result) { result = resolveInput(name, { ...value }, context); names.set(name, result); }
  return result;
}

export async function resolveAgentFileQuery<T extends AgentFilePathQuery>(query: T, context: FilePathContext): Promise<Omit<T, 'basePath'>> {
  return await resolveAgentFileToolInput('file.query', query, context) as Omit<T, 'basePath'>;
}
