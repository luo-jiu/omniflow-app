import React from 'react';
import { loadAgentSessionSelection, saveAgentSessionSelection } from '../agent-session-selection';

export function useAgentSessionResume({ scope, loadLatest, restore }: {
  scope: string | null;
  loadLatest: () => Promise<string | null>;
  restore: (id: string) => Promise<boolean>;
}) {
  const actions = React.useRef({ loadLatest, restore });
  actions.current = { loadLatest, restore };
  const [attempt, retry] = React.useReducer(value => value + 1, 0);
  const [state, setState] = React.useState<{ scope: string | null; phase: 'loading' | 'ready' | 'error' }>({ scope, phase: 'loading' });
  const generation = React.useRef(0);

  React.useEffect(() => {
    const token = ++generation.current;
    if (!scope) return;
    setState({ scope, phase: 'loading' });
    const currentActions = actions.current;
    void (async () => {
      // Defer past StrictMode's setup/cleanup replay before starting a restore.
      await Promise.resolve();
      if (generation.current !== token) return;
      try {
        const saved = loadAgentSessionSelection(scope);
        const id = saved === undefined ? await currentActions.loadLatest() : saved;
        if (generation.current !== token) return;
        const restored = id === null || await currentActions.restore(id);
        if (generation.current !== token) return;
        if (!restored) { setState({ scope, phase: 'error' }); return; }
        saveAgentSessionSelection(scope, id);
        setState({ scope, phase: 'ready' });
      } catch {
        if (generation.current === token) setState({ scope, phase: 'error' });
      }
    })();
    return () => { generation.current += 1; };
  }, [scope, attempt]);

  const select = React.useCallback((id: string | null) => {
    if (!scope) return;
    generation.current += 1;
    saveAgentSessionSelection(scope, id);
    setState({ scope, phase: 'ready' });
  }, [scope]);

  return {
    loading: Boolean(scope && (state.scope !== scope || state.phase === 'loading')),
    failed: state.scope === scope && state.phase === 'error',
    retry,
    select,
  };
}
