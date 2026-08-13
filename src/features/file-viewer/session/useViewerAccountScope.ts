import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createUserViewerAccountScope } from './viewer-session-identity';

export function useViewerAccountScope(): string | null {
  const { user } = useAuth();
  return useMemo(
    () => createUserViewerAccountScope(Number(user?.id)),
    [user?.id],
  );
}
