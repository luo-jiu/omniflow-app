import styled from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

export const CommandWorkspaceBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  ${workspaceScrollbarStyles}
  padding: 12px 14px 16px;
  color: var(--app-text);
  font-size: 12px;
  line-height: 1.5;

  .content { display: flex; flex-direction: column; gap: 12px; max-width: 860px; }
  .command-panel, .execution-card { padding: 12px; border: 1px solid var(--app-border); border-radius: 8px; background: var(--app-bg-elevated); }
  .command-panel { display: flex; flex-direction: column; gap: 12px; }
  h3 { font-size: 14px; margin: 0; }
  p { margin: 6px 0; overflow-wrap: anywhere; }
  .muted { color: var(--app-text-muted); font-size: 12px; overflow-wrap: anywhere; }
  .error { color: var(--semi-color-danger); }
  .field, .parameter-fields, .parameter-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .parameter-field { border-left: 2px solid var(--app-border); padding-left: 10px; }
  .parameter-label { display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
  .parameter-fields { gap: 10px; }
  input:not([type='checkbox']), select { width: 100%; min-height: 28px; box-sizing: border-box; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-bg); color: var(--app-text); padding: 4px 8px; font: inherit; }
  input[type='checkbox'] { margin: 0; accent-color: var(--semi-color-primary); }
  button { min-height: 28px; padding: 4px 10px; border: 1px solid var(--app-border); border-radius: var(--app-radius-medium); background: var(--app-bg); color: var(--app-text); font: inherit; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--semi-color-fill-0); }
  button:disabled, input:disabled, select:disabled { opacity: 0.55; cursor: default; }
  button.primary { background: var(--semi-color-primary); border-color: var(--semi-color-primary); color: var(--semi-color-white); }
  button.primary:hover:not(:disabled) { background: var(--semi-color-primary-hover); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--semi-color-primary); outline-offset: 2px; }
  .actions, .array-item, .source-row, .execution-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .array-item > .parameter-fields { flex: 1; }
  .array-item > input, .array-item > select { flex: 1; min-width: 120px; }
  .execution-heading { justify-content: space-between; margin-bottom: 4px; }
  .source-list { display: flex; flex-direction: column; gap: 5px; max-height: 190px; overflow: auto; }
  .source-row { justify-content: space-between; }
  .source-row span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .execution-card { display: flex; flex-direction: column; gap: 8px; }
  .rename-list { max-height: 320px; overflow: auto; border: 1px solid var(--app-border); border-radius: 5px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--app-border); overflow-wrap: anywhere; }
  th { position: sticky; top: 0; background: var(--app-bg-elevated); }
  dl { display: grid; grid-template-columns: 100px minmax(0, 1fr); margin: 0; gap: 5px 10px; }
  dt { color: var(--app-text-muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .detail-row { display: contents; }
  .hash { font-size: 11px; font-family: monospace; }
  details summary { cursor: pointer; }
  .read-result { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; margin: 0; }
  .source-list, .rename-list, .read-result {
    ${workspaceScrollbarStyles}
  }
`;
