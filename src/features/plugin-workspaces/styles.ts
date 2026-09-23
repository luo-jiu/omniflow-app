import styled from 'styled-components';
import { CommandWorkspaceBody } from '@/features/plugin-commands/styles';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

export const PluginWorkspaceBody = styled(CommandWorkspaceBody)`
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  .workspace-resource-bar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 8px 14px; flex: none; }
  .workspace-resource-bar .field { flex: 1 1 220px; }
  .source-label { overflow-wrap: anywhere; }
  .workspace-host-status { flex: none; }
  .workspace-stage { position: relative; flex: 1; min-height: 0; }
  .workspace-plugin-view { height: 100%; min-height: 0; }
  .workspace-review { height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
  .workspace-review {
    ${workspaceScrollbarStyles}
  }
  .workspace-empty { padding: 20px 0; }
`;
