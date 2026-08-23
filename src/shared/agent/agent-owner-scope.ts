import type { AgentOwnerScope } from './agent.types';

const USER_ACCOUNT_SCOPE_PATTERN = /^user:([1-9]\d*)$/;
const MAX_BACKEND_SCOPE_LENGTH = 512;

function normalizePositiveUserId(value: unknown): number | null {
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

function normalizeBackendScope(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw || raw.length > MAX_BACKEND_SCOPE_LENGTH) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const normalized = `${parsed.origin}${pathname}`;
    return normalized.length <= MAX_BACKEND_SCOPE_LENGTH ? normalized : null;
  } catch {
    return null;
  }
}

export function createAgentOwnerScope(
  apiBaseUrl: string,
  userId: unknown,
): AgentOwnerScope | null {
  const normalizedUserId = normalizePositiveUserId(userId);
  const backendScope = normalizeBackendScope(apiBaseUrl);
  if (normalizedUserId == null || !backendScope) return null;
  return {
    accountScope: `user:${normalizedUserId}`,
    backendScope,
  };
}

export function normalizeAgentOwnerScope(value: unknown): AgentOwnerScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent 缺少有效的账号环境');
  }
  const input = value as Partial<AgentOwnerScope>;
  const accountScope = String(input.accountScope || '').trim();
  const accountMatch = USER_ACCOUNT_SCOPE_PATTERN.exec(accountScope);
  const userId = accountMatch ? normalizePositiveUserId(accountMatch[1]) : null;
  const backendScope = normalizeBackendScope(input.backendScope);
  if (userId == null || accountScope !== `user:${userId}` || !backendScope) {
    throw new Error('Agent 缺少有效的账号环境');
  }
  return { accountScope, backendScope };
}

export function serializeAgentOwnerScope(value: AgentOwnerScope | null | undefined): string {
  if (!value) return '';
  try {
    const scope = normalizeAgentOwnerScope(value);
    return JSON.stringify([scope.backendScope, scope.accountScope]);
  } catch {
    return '';
  }
}
