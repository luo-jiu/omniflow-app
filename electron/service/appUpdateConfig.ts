const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function normalizeAppUpdateBaseUrl(input: string | null | undefined): string | null {
  const value = String(input || '').trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const loopbackHttp = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
    if (parsed.protocol !== 'https:' && !loopbackHttp) {
      return null;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/`;
    return parsed.toString();
  } catch {
    return null;
  }
}
