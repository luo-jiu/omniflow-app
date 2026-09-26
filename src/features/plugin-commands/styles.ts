import styled from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { buttonStyles, focusVisibleStyles, inputAppearanceStyles, surfaceStyles, textToneStyles } from '@/components/ui/theme-foundation-styles';

export const CommandWorkspaceBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  ${workspaceScrollbarStyles}
  padding: 12px 14px 16px;
  ${textToneStyles('primary')}
  font-size: 12px;
  line-height: 1.5;

  .content { display: flex; flex-direction: column; gap: 12px; max-width: 860px; }
  .command-panel, .execution-card {
    ${surfaceStyles('elevated')}
    padding: 12px; border: 1px solid var(--app-border); border-radius: 8px;
  }
  .command-panel { display: flex; flex-direction: column; gap: 12px; }
  h3 { font-size: 14px; margin: 0; }
  p { margin: 6px 0; overflow-wrap: anywhere; }
  .muted { ${textToneStyles('muted')} font-size: 12px; overflow-wrap: anywhere; }
  .error { color: var(--app-danger-text); }
  .field, .parameter-fields, .parameter-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .parameter-field { border-left: 2px solid var(--app-border); padding-left: 10px; }
  .parameter-label { display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
  .parameter-fields { gap: 10px; }
  input:not([type='checkbox']), select {
    width: 100%;
    min-height: 28px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 4px 8px;
    font: inherit;
    ${inputAppearanceStyles}
  }
  input[type='checkbox'] {
    margin: 0;
    accent-color: var(--app-accent);
    ${focusVisibleStyles}
    &:disabled { cursor: not-allowed; }
  }
  button {
    border: 1px solid transparent;
    ${buttonStyles('secondary')}
    min-height: 28px;
    padding: 4px 10px;
    border-radius: var(--app-radius-medium);
    cursor: pointer;
  }
  button.primary { ${buttonStyles('primary')} }
  .actions, .array-item, .source-row, .execution-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .array-item > .parameter-fields { flex: 1; }
  .array-item > input, .array-item > select { flex: 1; min-width: 120px; }
  .execution-heading { justify-content: space-between; margin-bottom: 4px; }
  .source-list { display: flex; flex-direction: column; gap: 5px; max-height: 190px; overflow: auto; }
  .source-row { justify-content: space-between; }
  .source-row span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .execution-card { display: flex; flex-direction: column; gap: 8px; }
  .rename-list {
    max-height: 320px; overflow: auto; border: 1px solid var(--app-border); border-radius: 5px;
    ${focusVisibleStyles}
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--app-border); overflow-wrap: anywhere; }
  th { position: sticky; top: 0; ${surfaceStyles('elevated')} }
  dl { display: grid; grid-template-columns: 100px minmax(0, 1fr); margin: 0; gap: 5px 10px; }
  dt { ${textToneStyles('muted')} }
  dd { margin: 0; overflow-wrap: anywhere; }
  .detail-row { display: contents; }
  .hash { font-size: 11px; font-family: monospace; }
  details summary { cursor: pointer; ${focusVisibleStyles} }
  .read-result { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; margin: 0; }
  .source-list, .rename-list, .read-result {
    ${workspaceScrollbarStyles}
  }
`;
