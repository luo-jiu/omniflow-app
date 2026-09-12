import { normalizeAgentLibraryDirectoryPath } from './agent-library-path';

export const AGENT_LIBRARY_MUTATION_TOOLS = ['directory.create', 'file.rename', 'file.move', 'file.copy', 'recycle.restore'] as const;
export type AgentLibraryMutationName = typeof AGENT_LIBRARY_MUTATION_TOOLS[number];
export function isAgentRendererMutationTool(name: string): boolean {
  return [...AGENT_LIBRARY_MUTATION_TOOLS, 'file.write', 'file.delete', 'tag.update', 'library.batch'].includes(name);
}
export interface AgentLibraryActionInput {
  path?: string;
  nodeId?: number;
  name?: string;
  parentPath?: string;
  parentId?: number;
  recursive?: boolean;
  conflictPolicy?: 'error' | 'auto_rename';
}

export function normalizeAgentNodeName(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value === '.' || value === '..'
    || new TextEncoder().encode(value).length > 240 || /[<>:"/\\|?*]/u.test(value)
    || Array.from(value).some(character => character.charCodeAt(0) < 32)
    || /[. ]$/u.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(value)) {
    throw new Error('名称必须是有效的单个文件名（包含后缀），不能包含路径或超过240字节');
  }
  return value;
}

export function normalizeAgentLibraryAction(name: AgentLibraryMutationName, value: unknown): AgentLibraryActionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件操作参数无效');
  const source = value as Record<string, unknown>;
  const allowed = name === 'directory.create' ? ['path', 'name', 'parentPath', 'parentId', 'conflictPolicy']
    : name === 'file.rename' ? ['path', 'nodeId', 'name'] : name === 'recycle.restore' ? ['nodeId']
      : ['path', 'nodeId', 'parentPath', 'parentId', ...(name === 'file.copy' ? ['name', 'recursive', 'conflictPolicy'] : [])];
  if (Object.keys(source).some(key => !allowed.includes(key))) throw new Error('文件操作包含不支持的参数');
  const input: AgentLibraryActionInput = {};
  for (const key of ['path', 'parentPath'] as const) if (source[key] !== undefined) input[key] = normalizeAgentLibraryDirectoryPath(source[key]);
  for (const key of ['nodeId', 'parentId'] as const) if (source[key] !== undefined) {
    if (!Number.isSafeInteger(source[key]) || Number(source[key]) <= 0) throw new Error('节点ID必须是正整数');
    input[key] = Number(source[key]);
  }
  if (source.name !== undefined) input.name = normalizeAgentNodeName(source.name);
  if (source.recursive !== undefined) {
    if (typeof source.recursive !== 'boolean') throw new Error('recursive 必须是布尔值');
    input.recursive = source.recursive;
  }
  if (source.conflictPolicy !== undefined) {
    if (!['error', 'auto_rename'].includes(String(source.conflictPolicy))) throw new Error('仅支持拒绝冲突或自动改名，不覆盖文件');
    input.conflictPolicy = source.conflictPolicy as 'error' | 'auto_rename';
  }
  if (input.parentPath !== undefined && input.parentId !== undefined) throw new Error('parentPath 与 parentId 不能同时提供');
  if (name === 'directory.create') {
    if (input.path !== undefined) {
      if (input.path === '/' || input.name !== undefined || input.parentId !== undefined || input.parentPath !== undefined) throw new Error('完整新目录 path 不能与 name/parent 参数混用，也不能是根目录');
      const split = input.path.lastIndexOf('/');
      return { name: normalizeAgentNodeName(input.path.slice(split + 1)), parentPath: input.path.slice(0, split) || '/', conflictPolicy: input.conflictPolicy };
    }
    if (!input.name) throw new Error('请提供新目录 path 或 name');
  } else if ((input.path !== undefined) === (input.nodeId !== undefined)) throw new Error('必须且只能提供 path 或 nodeId');
  if (input.path === '/') throw new Error('不能操作资料库根目录');
  if (name === 'file.rename' && !input.name) throw new Error('重命名需要完整的新文件名 name');
  if (['file.move', 'file.copy'].includes(name) && input.parentPath === undefined && input.parentId === undefined) throw new Error('请提供目标目录 parentPath 或 parentId');
  return input;
}

export function splitAgentNodeName(name: string, type: 'file' | 'dir') {
  const dot = type === 'file' ? name.lastIndexOf('.') : -1;
  return dot > 0 ? { name: name.slice(0, dot), ext: name.slice(dot + 1) } : { name, ext: '' };
}
