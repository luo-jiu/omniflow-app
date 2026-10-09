const GROUP_COLLAPSE_MAX_ENTRIES = 101;

export type AgentSessionGroupCollapseState = Record<string, boolean>;

function getStorage(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return undefined;
  try { return localStorage; } catch { return undefined; }
}

export function loadAgentSessionGroupCollapse(
  storageKey?: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): AgentSessionGroupCollapseState {
  if (!storageKey) return {};
  const target = getStorage(storage);
  if (!target) return {};
  try {
    const value: unknown = JSON.parse(target.getItem(storageKey) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, closed]) => key.length < 220 && typeof closed === 'boolean')
        .slice(0, GROUP_COLLAPSE_MAX_ENTRIES),
    );
  } catch {
    return {};
  }
}

export function saveAgentSessionGroupCollapse(
  storageKey: string | undefined,
  state: AgentSessionGroupCollapseState,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  if (!storageKey) return;
  const target = getStorage(storage);
  if (!target) return;
  try { target.setItem(storageKey, JSON.stringify(state)); } catch { /* Display preference only. */ }
}
