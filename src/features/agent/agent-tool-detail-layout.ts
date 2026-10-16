import React from 'react';

export interface AgentToolDetailLayout {
  body: HTMLElement;
  observation: boolean;
}

/** Measurements belong to the containing tool group, never to execution state. */
export const AgentToolDetailLayoutContext = React.createContext<(
  (id: string, detail: AgentToolDetailLayout | null) => void
) | null>(null);

export function useAgentToolDetailLayout(
  ref: React.RefObject<HTMLDivElement>,
  id: string,
  visible: boolean,
  observation: boolean,
) {
  const report = React.useContext(AgentToolDetailLayoutContext);
  React.useLayoutEffect(() => {
    const body = ref.current;
    if (!visible || !body || !report) return;
    const measure = () => report(id, { body, observation });
    measure();
    // The body retains its natural height while its ancestor grid animates.
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => {
      observer.disconnect();
      report(id, null);
    };
  }, [id, observation, ref, report, visible]);
}
