import { registerAuthSessionRuntime } from '@/service/auth-session-release';
import { pluginCommandApi } from './plugin-command.api';
import type { PluginWorkspaceOpen } from '@/shared/plugins/workspace.types';
import { auth } from '@/utils/auth';

const clients = new Map<string, number>();
const bridge = () => window.electronPluginWorkspace;
export const pluginWorkspaceApi = {
  available: () => typeof window !== 'undefined' && Boolean(window.electronPluginWorkspace),
  async open(input: Omit<PluginWorkspaceOpen, 'token' | 'username' | 'ownerScope'>) {
    const { ownerScope } = pluginCommandApi.scope(input.libraryId);
    clients.set(input.clientId, input.libraryId);
    try {
      const result = await bridge().open({ ...input, ownerScope, token: auth.getToken() ?? '', username: auth.getUsername() ?? '' });
      if (!clients.has(input.clientId)) { await bridge().close(input.clientId); return { ok: false, code: 'CANCELLED' }; }
      if (!result.ok) clients.delete(input.clientId);
      return result;
    } catch (error) { clients.delete(input.clientId); throw error; }
  },
  close(clientId: string) { clients.delete(clientId); return bridge().close(clientId); },
  layout: (...args: Parameters<ReturnType<typeof bridge>['layout']>) => bridge().layout(...args),
  theme: (...args: Parameters<ReturnType<typeof bridge>['theme']>) => bridge().theme(...args),
  destination: (...args: Parameters<ReturnType<typeof bridge>['destination']>) => bridge().destination(...args),
  subscribe: (...args: Parameters<ReturnType<typeof bridge>['subscribe']>) => bridge().subscribe(...args),
  async releaseLibrary(libraryId: number) {
    const ids = [...clients].filter(([, id]) => id === libraryId).map(([id]) => id);
    await Promise.allSettled(ids.map(id => this.close(id)));
  },
  async release() { clients.clear(); if (this.available()) await bridge().release(); },
};
const unregister = registerAuthSessionRuntime({ dispose: () => { void pluginWorkspaceApi.release().catch(() => undefined); } });
if (import.meta.hot) import.meta.hot.dispose(() => { unregister(); void pluginWorkspaceApi.release().catch(() => undefined); });
