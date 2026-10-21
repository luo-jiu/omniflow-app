import { normalizeAgentLibraryDirectoryPath } from './agent-library-path';

/** Resolve logical library paths without consulting the host filesystem. */
export function resolveAgentLibraryFilePath(value: unknown, basePath?: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\\')
    || Array.from(value).some(character => character.charCodeAt(0) < 32)) throw new Error('资料库路径无效');
  const base = basePath === undefined ? undefined : normalizeAgentLibraryDirectoryPath(basePath);
  if (value.startsWith('/')) return normalizeAgentLibraryDirectoryPath(value);
  if (value === '~' || value.startsWith('~/') || /^[A-Za-z]:/u.test(value)) {
    throw new Error('本机路径请明确使用 scope=host；资料库路径不会自动切换来源');
  }
  if (!base) throw new Error('资料库相对路径需要当前目录或绝对 basePath');
  const segments = base === '/' ? [] : base.slice(1).split('/');
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) throw new Error('资料库相对路径不能越过 / 根目录');
      segments.pop();
    } else segments.push(segment);
  }
  return normalizeAgentLibraryDirectoryPath(`/${segments.join('/')}`);
}
