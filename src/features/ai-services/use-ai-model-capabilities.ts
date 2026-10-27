import React from 'react';
import { fetchAIServiceModelCapabilities } from './ai-service.api';
import type { AIServiceProfile } from './ai-service.types';

/** A projection of main's connection-scoped discovery cache; this never discovers models itself. */
export function useAIModelCapabilities(profile: AIServiceProfile | null, model: string, active: boolean, catalog: readonly string[]) {
  const key = JSON.stringify([profile?.id, profile?.updatedAt, model]);
  const [snapshot, setSnapshot] = React.useState<{ key: string; fastMode: boolean } | null>(null);
  const generation = React.useRef(0);
  const refresh = React.useCallback(() => {
    const request = ++generation.current;
    if (!active || !profile || !model) { setSnapshot(null); return; }
    void Promise.resolve().then(() => fetchAIServiceModelCapabilities(model)).then(result => {
      if (request !== generation.current) return;
      const matches = result.profileId === profile.id && result.profileUpdatedAt === profile.updatedAt && result.model === model;
      setSnapshot({ key, fastMode: matches && result.fastMode === true });
    }).catch(() => {
      if (request === generation.current) setSnapshot(null);
    });
  }, [active, key, model, profile]);
  React.useEffect(() => {
    refresh();
    return () => { generation.current += 1; };
  }, [refresh, catalog]);
  return { fastModeAvailable: active && snapshot?.key === key && snapshot.fastMode === true, refresh };
}
