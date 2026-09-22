import { useLayoutEffect, useRef } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { API_CONFIG } from '@/config/api';
import { useAuth } from '@/hooks/useAuth';
import { createAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import { releaseAgentOwnerRuns } from '@/features/agent/services/agent.api';
import { runtimeLogger } from '@/utils/runtimeLogger';

/** Route/Auth are the scope owners; this bridge only releases the departing Run owner. */
export default function AgentLibraryRunLifecycle() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const match = matchPath({ path: '/libraries/:id', end: true }, pathname);
  const libraryId = Number(match?.params.id);
  const ownerScope = createAgentOwnerScope(API_CONFIG.BASE_URL, user?.id);
  const scope = ownerScope && Number.isSafeInteger(libraryId) && libraryId > 0
    ? JSON.stringify([ownerScope.backendScope, ownerScope.accountScope, libraryId])
    : null;
  const previousScope = useRef<string | null>(null);

  useLayoutEffect(() => {
    const previous = previousScope.current;
    previousScope.current = scope;
    if (!previous || previous === scope || typeof window === 'undefined' || !window.electronAgent) return;
    // Dispatch before a newly committed route can start work. Do not defer this
    // to an unmount cleanup: StrictMode/Fast Refresh may replay the same scope.
    void releaseAgentOwnerRuns().catch((error: unknown) => {
      runtimeLogger.warn('release Agent runs after library workspace scope change failed', error);
    });
  }, [scope]);

  return null;
}
