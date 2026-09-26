import { useState, type ReactNode } from 'react';
import styled from 'styled-components';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';

const Pane = styled.div`
  &[aria-hidden='true'], &[aria-hidden='true'] * {
    visibility: hidden !important;
    pointer-events: none !important;
  }
`;

export default function RetainedWorkspacePane({ active, children }: { active: boolean; children: ReactNode }) {
  const [opened, setOpened] = useState(active);
  if (active && !opened) setOpened(true);
  if (!active && !opened) return null;
  return <Pane className={`workspace-pane ${active ? 'active' : 'inactive'}`}
    aria-hidden={!active} {...(active ? {} : { inert: '' })}>
    <WorkspaceVisibilityContext.Provider value={active}>{children}</WorkspaceVisibilityContext.Provider>
  </Pane>;
}
