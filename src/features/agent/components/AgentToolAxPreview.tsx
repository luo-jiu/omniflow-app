import React from 'react';
import styled from 'styled-components';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import type { AgentPresentationBlock } from '@/shared/agent/agent.types';
import { agentToolDetailDisclosureSummaryStyles, agentToolDetailSurfaceStyles } from './agent-tool-detail-styles';
import AgentDisclosureChevron from './AgentDisclosureChevron';

const AxPreview = styled.details`
  min-width: 0;
  color: var(--app-text-muted);
  font-size: 12px;
  line-height: 18px;
  summary {
    ${agentToolDetailDisclosureSummaryStyles}
  }
  .agent-tool-ax-content {
    ${agentToolDetailSurfaceStyles}

    display: grid;
    gap: 4px;
    margin-top: 4px;
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  pre {
    ${workspaceScrollbarStyles}
    max-height: 232px;
    min-width: 0;
    margin: 0;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: monospace;
    font-size: 12px;
    line-height: 18px;
  }
`;

export default function AgentToolAxPreview({ tree, scope, scopeScanComplete }: Omit<Extract<AgentPresentationBlock, { type: 'computer-ax' }>, 'type'>) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (!workspaceActive) setOpen(false); }, [workspaceActive]);
  if (!workspaceActive) return null;
  const local = scope?.kind === 'element-ancestor';
  const scopeNotice = scope ? local
    ? `局部范围：${scope.ancestorLevels === 0 ? '控件自身' : `上溯 ${scope.ancestorLevels} 层`}；控件扫描${scopeScanComplete ? '完整' : '不完整'}，不代表全窗口。`
    : scope.kind === 'menu' ? `应用菜单扫描${scopeScanComplete ? '完整' : '不完整'}，不代表全窗口。`
      : `窗口控件扫描${scopeScanComplete ? '完整' : '不完整'}。` : undefined;
  return <AxPreview open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><AgentDisclosureChevron expanded={open} /><span>AX{local ? ' · 局部' : scope?.kind === 'menu' ? ' · 菜单' : ''}</span></summary>
    {open ? <div className="agent-tool-ax-content">
      {scopeNotice ? <p>{scopeNotice}</p> : null}
      <pre>{tree}</pre>
    </div> : null}
  </AxPreview>;
}
