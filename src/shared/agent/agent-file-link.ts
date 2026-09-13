export interface AgentFileLink { scope: 'library' | 'local'; path: string; line?: number }

export function parseAgentFileLink(href: string): AgentFileLink | null {
  const match = /^omniflow-(library|local):([^?#]+)(?:#L([1-9]\d*))?$/u.exec(href);
  if (!match) return null;
  try {
    const path = decodeURIComponent(match[2]);
    if (path.length > 4096 || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || path.startsWith('//')) return null;
    if (match[1] === 'library' ? !path.startsWith('/') : !/^(\/|~\/|[A-Za-z]:[\\/])/u.test(path)) return null;
    if (path.split(/[\\/]/u).includes('..')) return null;
    const line = match[3] ? Number(match[3]) : undefined;
    if (line !== undefined && !Number.isSafeInteger(line)) return null;
    return { scope: match[1] as 'library' | 'local', path, ...(line ? { line } : {}) };
  } catch { return null; }
}
