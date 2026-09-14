import { auth } from '@/utils/auth';
import { registerAuthSessionRuntime } from '@/service/auth-session-release';
import type { PluginViewerOpen } from '@/shared/plugin-viewer';
const bridge = () => window.electronPluginViewer;
export const pluginViewerApi = {
  available: () => typeof window !== 'undefined' && bridge()?.available === true,
  open: (input: Omit<PluginViewerOpen, 'token' | 'username'>) => bridge().open({ ...input, token: auth.getToken() ?? '', username: auth.getUsername() ?? '' }),
  close: (id: string) => bridge().close(id),
  layout: (...args: Parameters<ReturnType<typeof bridge>['layout']>) => bridge().layout(...args),
  theme: (...args: Parameters<ReturnType<typeof bridge>['theme']>) => bridge().theme(...args),
  subscribe: (...args: Parameters<ReturnType<typeof bridge>['subscribe']>) => bridge().subscribe(...args),
};
const release = registerAuthSessionRuntime({ dispose: () => { if (pluginViewerApi.available()) void bridge().release(); } });
if (import.meta.hot) import.meta.hot.dispose(release);
