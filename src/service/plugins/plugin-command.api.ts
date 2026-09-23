import { API_CONFIG } from '@/config/api';
import { registerAuthSessionRuntime } from '@/service/auth-session-release';
import { createAgentOwnerScope, serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import type { PluginCommandExecutionRequest, PluginCommandPrepareRequest, PluginCommandScope } from '@/shared/plugins/manual-command.types';
import { auth } from '@/utils/auth';

const scopes = new Map<number, PluginCommandScope>();
const bridge = () => {
  if (!window.electronPluginCommands) throw new Error('当前环境不支持插件命令');
  return window.electronPluginCommands;
};

function currentScope(libraryId: number): PluginCommandScope {
  const ownerScope = createAgentOwnerScope(API_CONFIG.BASE_URL, auth.getUserInfo()?.id);
  if (!ownerScope) throw new Error('登录状态已失效，请重新登录');
  return { ownerScope, libraryId };
}

export const pluginCommandApi = {
  available: () => typeof window !== 'undefined' && Boolean(window.electronPluginCommands),
  scope: currentScope,
  isCurrentScope(scope: PluginCommandScope): boolean {
    try { return serializeAgentOwnerScope(currentScope(scope.libraryId).ownerScope) === serializeAgentOwnerScope(scope.ownerScope); }
    catch { return false; }
  },
  isActiveScope(scope: PluginCommandScope): boolean {
    const active = scopes.get(scope.libraryId);
    return Boolean(active && this.isCurrentScope(scope) && serializeAgentOwnerScope(active.ownerScope) === serializeAgentOwnerScope(scope.ownerScope));
  },
  async list(libraryId: number) {
    const scope = currentScope(libraryId); scopes.set(libraryId, scope);
    return bridge().list(scope);
  },
  prepare(input: Omit<PluginCommandPrepareRequest, 'ownerScope'>) {
    const scope = currentScope(input.libraryId); scopes.set(input.libraryId, scope);
    return bridge().prepare({ ...input, ...scope });
  },
  approve: (input: Omit<PluginCommandExecutionRequest, 'ownerScope'>) => bridge().approve({ ...input, ...currentScope(input.libraryId) }),
  cancel: (input: Omit<PluginCommandExecutionRequest, 'ownerScope'>) => bridge().cancel({ ...input, ...currentScope(input.libraryId) }),
  reconcile(input: Omit<PluginCommandExecutionRequest, 'ownerScope'>) {
    const token = auth.getToken() ?? '', username = auth.getUsername() ?? '';
    if (!token || !username) throw new Error('登录状态已失效，请重新登录后查询回执');
    return bridge().reconcile({ ...input, ...currentScope(input.libraryId), credentials: { token, username } });
  },
  subscribe: (...args: Parameters<ReturnType<typeof bridge>['subscribe']>) => bridge().subscribe(...args),
  onFileAuthorityRequest: (...args: Parameters<ReturnType<typeof bridge>['onFileAuthorityRequest']>) => bridge().onFileAuthorityRequest(...args),
  completeFileAuthority: (...args: Parameters<ReturnType<typeof bridge>['completeFileAuthority']>) => bridge().completeFileAuthority(...args),
  async releaseLibrary(libraryId: number) {
    const scope = scopes.get(libraryId); scopes.delete(libraryId);
    if (scope && this.available()) await bridge().release(scope);
  },
  async releaseAll() {
    const pending = [...scopes.values()]; scopes.clear();
    if (this.available()) await Promise.allSettled(pending.map(scope => bridge().release(scope)));
  },
};

const unregister = registerAuthSessionRuntime({ dispose: () => { void pluginCommandApi.releaseAll(); } });
if (import.meta.hot) import.meta.hot.dispose(() => { unregister(); void pluginCommandApi.releaseAll(); });
