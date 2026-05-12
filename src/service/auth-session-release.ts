import { auth } from '@/utils/auth';
import { runtimeLogger } from '@/utils/runtimeLogger';

export interface ClearAuthSessionOptions {
  redirectToLogin?: boolean;
  reason?: string;
}

type AuthSessionWorkspaceDisposer = (options: Required<Pick<ClearAuthSessionOptions, 'reason'>>) => Promise<void> | void;

let workspaceDisposer: AuthSessionWorkspaceDisposer | null = null;
let pendingWorkspaceDispose: Promise<void> | null = null;

export function registerAuthSessionWorkspaceDisposer(disposer: AuthSessionWorkspaceDisposer) {
  workspaceDisposer = disposer;
  return () => {
    if (workspaceDisposer === disposer) {
      workspaceDisposer = null;
    }
  };
}

function redirectToLoginIfNeeded() {
  if (typeof window === 'undefined') {
    return;
  }
  if (!window.location.hash.includes('/login')) {
    window.location.hash = '/login';
  }
}

async function disposeWorkspaces(reason: string) {
  if (!workspaceDisposer) {
    return;
  }
  if (!pendingWorkspaceDispose) {
    pendingWorkspaceDispose = Promise.resolve(workspaceDisposer({ reason }))
      .catch((error: unknown) => {
        runtimeLogger.warn('dispose session workspaces after auth reset failed', {
          error,
          reason,
        });
      })
      .finally(() => {
        pendingWorkspaceDispose = null;
      });
  }
  await pendingWorkspaceDispose;
}

function clearAuthState() {
  auth.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('omniflow:auth-session-cleared'));
  }
}

export function listenAuthSessionCleared(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  window.addEventListener('omniflow:auth-session-cleared', listener);
  return () => {
    window.removeEventListener('omniflow:auth-session-cleared', listener);
  };
}

export async function clearAuthSessionAndDisposeWorkspaces(options: ClearAuthSessionOptions = {}) {
  const reason = options.reason || 'auth session cleared';
  await disposeWorkspaces(reason);
  clearAuthState();
  if (options.redirectToLogin) {
    redirectToLoginIfNeeded();
  }
}
