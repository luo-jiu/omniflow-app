import { Minimatch } from 'minimatch';

export const agentGlobProperty = {
  type: 'string', minLength: 1, maxLength: 256,
  description: '文件名 glob：支持 *、**、?、[abc]，不区分大小写，包含隐藏文件。不含 / 时匹配任意层级文件名；含 / 时相对查询目录匹配。使用 / 分隔，不支持大括号、extglob 或 ! 排除。',
};

export function createAgentFileGlob(pattern?: string): (relativePath: string) => boolean {
  if (pattern === undefined) return () => true;
  if (!pattern || pattern.length > 256 || pattern.startsWith('/') || pattern.startsWith('!')
    || pattern.includes('\\') || pattern.includes('\0') || /[{}()]/u.test(pattern)
    || pattern.split('/').some(part => part === '.' || part === '..' || !part)) {
    throw new Error('glob 无效：使用相对模式和 / 分隔，仅支持 *、**、?、字符集');
  }
  const matcher = new Minimatch(pattern, {
    dot: true, nocase: true, matchBase: !pattern.includes('/'),
    nobrace: true, noext: true, nonegate: true, nocomment: true,
  });
  return relativePath => matcher.match(relativePath);
}

export const agentGlobListProperty = {
  type: 'array', maxItems: 16, items: agentGlobProperty,
  description: '共同 glob 规则；include 任一命中即保留，exclude 任一命中即排除。相对搜索目录匹配，包含隐藏文件。',
};

export function createAgentFileFilter(query: { glob?: string; include?: string[]; exclude?: string[] }) {
  const compile = (patterns: string[] | undefined) => {
    if (patterns !== undefined && (!Array.isArray(patterns) || patterns.length > 16 || patterns.some(pattern => typeof pattern !== 'string'))) {
      throw new Error('include/exclude 必须为最多 16 个 glob 的数组');
    }
    return patterns?.map(pattern => createAgentFileGlob(pattern)) ?? [];
  };
  const legacy = createAgentFileGlob(query.glob);
  const includes = compile(query.include);
  const excludes = compile(query.exclude);
  return (relativePath: string) => legacy(relativePath)
    && (!includes.length || includes.some(match => match(relativePath)))
    && !excludes.some(match => match(relativePath));
}
