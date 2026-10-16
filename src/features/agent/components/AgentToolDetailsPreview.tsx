import React from 'react';
import styled from 'styled-components';

import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { agentToolDetailDisclosureSummaryStyles, agentToolDetailSurfaceStyles } from './agent-tool-detail-styles';
import AgentDisclosureChevron from './AgentDisclosureChevron';

const DetailsPreview = styled.details`
  min-width: 0;

  summary {
    ${agentToolDetailDisclosureSummaryStyles}

    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 18px;
  }

  .agent-tool-details-content {
    ${agentToolDetailSurfaceStyles}
    ${workspaceScrollbarStyles}

    box-sizing: border-box;
    min-height: 0;
    max-height: 256px;
    margin-top: 4px;
    overflow: auto;
    overflow-anchor: none;
  }
`;

export default function AgentToolDetailsPreview({
  children, onExpand, title,
}: {
  children: React.ReactNode;
  onExpand?: () => void;
  title: string;
}) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (!workspaceActive) setOpen(false); }, [workspaceActive]);
  if (!workspaceActive) return null;
  return (
    <DetailsPreview open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary onClick={onExpand}><AgentDisclosureChevron expanded={open} /><span>{title}</span></summary>
      {open ? <div className="agent-tool-details-content">{children}</div> : null}
    </DetailsPreview>
  );
}
