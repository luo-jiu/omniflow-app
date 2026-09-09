import { normalizeAgentLibraryDirectoryPath } from './agent-library-path';

export interface AgentFileWriteInput { scope?: 'library'; path: string; content: string; revision?: string }

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
  if (Object.keys(input).some(key => !['scope', 'path', 'content', 'revision'].includes(key))
    || (input.scope !== undefined && input.scope !== 'library') || typeof input.path !== 'string'
    || typeof input.content !== 'string' || input.content.length > 32000 || hasAgentFileBinaryControls(input.content)) {
    throw new Error('file.write只接受资料库路径及不超过32000字符的文本正文');
  }
  const path = normalizeAgentLibraryDirectoryPath(input.path);
  const name = path.split('/').at(-1) || '';
  if (!name || name !== name.trim() || new TextEncoder().encode(name).length > 240) {
    throw new Error('文件名不能包含首尾空白或超过240字节');
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)) {
    throw new Error('文件名称不兼容 Windows 文件系统');
  }
  if (input.revision !== undefined && (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(input.revision))) {
    throw new Error('修改文件必须提供file.read返回的完整revision');
  }
  return { scope: 'library', path, content: input.content, ...(input.revision ? { revision: String(input.revision) } : {}) };
}
