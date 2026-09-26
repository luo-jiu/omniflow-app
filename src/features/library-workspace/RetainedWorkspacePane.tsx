import { useRef, type ReactNode } from 'react';
import styled from 'styled-components';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';

const Pane = styled.div`
  &[aria-hidden='true'], &[aria-hidden='true'] * {
    visibility: hidden !important;
    pointer-events: none !important;
  }
`;

export default function RetainedWorkspacePane({ active, children }: { active: boolean; children: ReactNode }) {
  // A ref records the first activation without scheduling a render from inside
  // render. The previous state update here could race with library switches.
  const openedRef = useRef(active);
  if (active) openedRef.current = true;
  if (!active && !openedRef.current) return null;
  return <Pane className={`workspace-pane ${active ? 'active' : 'inactive'}`}
    aria-hidden={!active} {...(active ? {} : { inert: '' })}>
    <WorkspaceVisibilityContext.Provider value={active}>{children}</WorkspaceVisibilityContext.Provider>
  </Pane>;
}
