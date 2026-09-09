const prefix = 'agent-session-selection:v1:';

export function loadAgentSessionSelection(scope: string): string | null | undefined {
  try {
    const raw = localStorage.getItem(prefix + encodeURIComponent(scope));
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (value === null || (typeof value === 'string' && value.length > 0 && value.length <= 200)) return value;
  } catch { /* Selection persistence is optional; session content remains in main. */ }
  return undefined;
}

export function saveAgentSessionSelection(scope: string, sessionId: string | null): void {
  try { localStorage.setItem(prefix + encodeURIComponent(scope), JSON.stringify(sessionId)); }
  catch { /* A storage failure must not block an explicit session action. */ }
}
