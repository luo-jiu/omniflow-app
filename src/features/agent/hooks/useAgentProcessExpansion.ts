import React from 'react';

// UI choices last only for this renderer lifetime; no transcript data is cached.
const choices = new Map<string, ReadonlyMap<string, boolean>>();
const listeners = new Set<() => void>();
const empty: ReadonlyMap<string, boolean> = new Map();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useAgentProcessExpansion(scope: string) {
  const getSnapshot = React.useCallback(() => choices.get(scope) || empty, [scope]);
  const expanded = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setExpanded = React.useCallback((runId: string, value: boolean) => {
    const next = new Map(choices.get(scope));
    next.set(runId, value);
    choices.set(scope, next);
    listeners.forEach(listener => listener());
  }, [scope]);
  return { expanded, setExpanded };
}
