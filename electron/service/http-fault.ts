export function createHttpFaultInjector(enabled: boolean, configuration: string) {
  const match = /^(drop-response|timeout):(POST|PUT|PATCH|DELETE):(\/[^?#\s]+)$/u.exec(configuration);
  let consumed = false;
  return (method: string, url: string, status: number): 'drop-response' | 'timeout' | undefined => {
    if (!enabled || !match || consumed || status < 200 || status >= 300) return;
    try {
      const target = new URL(url);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
        || target.pathname !== match[3] || method.toUpperCase() !== match[2]) return;
      consumed = true;
      return match[1] as 'drop-response' | 'timeout';
    } catch { return; }
  };
}
