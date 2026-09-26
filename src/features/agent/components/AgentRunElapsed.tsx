import React from 'react';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import styled from 'styled-components';
import AgentDisclosureChevron from './AgentDisclosureChevron';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';
import { formatAgentRunElapsed, isAgentRunActive } from '../agent-run-presentation';

const ElapsedRow = styled.div`
  min-height: 28px;
  display: flex;
  align-items: center;
  padding: 3px 0 7px;
  border-bottom: 1px solid var(--app-border);
  color: var(--app-text-muted);
  font-size: 13px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    min-height: 24px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button:hover { color: var(--app-text); }
  button:focus-visible { outline: 2px solid var(--semi-color-primary); outline-offset: 3px; }
`;

export default function AgentRunElapsed({ run, collapsible, expanded, onToggle }: {
  run: AgentRunSnapshot;
  collapsible: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [now, setNow] = React.useState(Date.now);
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const active = isAgentRunActive(run);
  React.useEffect(() => {
    if (!active || !workspaceActive) return;
    setNow(Date.now());
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [active, run.id, workspaceActive]);
  const label = formatAgentRunElapsed(run, now);
  return <ElapsedRow data-agent-elapsed={run.id}>
    {collapsible ? <button type="button" aria-expanded={expanded}
      aria-label={`${expanded ? '收起' : '展开'}任务过程，${label}`} onClick={onToggle}>
      <span>{label}</span><AgentDisclosureChevron expanded={expanded} />
    </button> : <span>{label}</span>}
  </ElapsedRow>;
}
