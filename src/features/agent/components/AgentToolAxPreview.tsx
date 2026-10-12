import React from 'react';
import styled from 'styled-components';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import type { AgentPresentationBlock } from '@/shared/agent/agent.types';

const AxPreview = styled.details`
  min-width: 0;
  margin-top: 4px;
  color: var(--app-text-muted);
  font-size: 12px;
  line-height: 18px;
  summary {
    width: fit-content;
    max-width: 100%;
    border-radius: var(--app-radius-small);
    cursor: pointer;
  }
  summary:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
  p {
    margin: 4px 0 0;
    overflow-wrap: anywhere;
  }
  pre {
    ${workspaceScrollbarStyles}
    max-height: 132px;
    margin: 4px 0 0;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--app-font-mono, monospace);
    font-size: 12px;
    line-height: 18px;
  }
`;

export default function AgentToolAxPreview({ tree, truncated, scope, scopeScanComplete }: Omit<Extract<AgentPresentationBlock, { type: 'computer-ax' }>, 'type'>) {
  const workspaceActive = React.useContext(WorkspaceVisibilityContext);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (!workspaceActive) setOpen(false); }, [workspaceActive]);
  if (!workspaceActive) return null;
  const local = scope?.kind === 'element-ancestor';
  const scopeNotice = scope ? local
    ? `局部范围：${scope.ancestorLevels === 0 ? '控件自身' : `上溯 ${scope.ancestorLevels} 层`}；控件扫描${scopeScanComplete ? '完整' : '不完整'}，不代表全窗口。`
    : `窗口控件扫描${scopeScanComplete ? '完整' : '不完整'}。` : undefined;
  return <AxPreview open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>AX{local ? ' · 局部' : ''}{truncated ? ' · 已截断' : ''}</summary>
    {open && scopeNotice ? <p>{scopeNotice}</p> : null}
    {open ? <pre>{tree}</pre> : null}
  </AxPreview>;
}
